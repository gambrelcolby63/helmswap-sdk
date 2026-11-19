/**
 * Minimal in-process mock of the terminal's /api/v1/quote and /api/v1/build-tx (no mainnet, no RPC).
 * Share rules mirror src/lib/apiPricing.ts resolveApiPricing: keyless 20% (cap 20%), key default 40%, cap 50%,
 * 401 on an unknown key. Equity block mirrors the 451 TOKENIZED_EQUITY_BLOCKED body.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export const PAYOUT = "0x1111111111111111111111111111111111111111";
export const KEY_PAYOUT = "0x2222222222222222222222222222222222222222";
export const USER = "0x3333333333333333333333333333333333333333";
export const WETH = "0x4200000000000000000000000000000000000006";
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const STOCK = "0x5555555555555555555555555555555555555555";
export const GOOD_KEY = "bsk_test_valid_key_for_mock_only";

export type Recorded = { method: string; url: string; headers: http.IncomingHttpHeaders; body: any };

export type MockOptions = { surplusShareBps?: number; quotedOutNet?: string; broadcastableInBody?: boolean; live?: boolean };

function share(apiKey: string | undefined, referrer: string | null, requested: number | undefined) {
  if (apiKey && apiKey !== GOOD_KEY) return { status: 401, error: "Unknown or disabled API key. Omit the x-api-key header to use the free keyless tier." } as const;
  const rec = apiKey === GOOD_KEY;
  const ref = referrer ?? (rec ? KEY_PAYOUT : null);
  const cap = rec ? 5000 : 2000;
  const s = ref ? (requested ?? (rec ? 4000 : 2000)) : 0;
  if (s > cap) return { status: 400, error: rec ? `referrerShareBps ${s} exceeds the disclosed cap of ${cap} (50%).` : "Keyless requests use the disclosed 20% referral-link share; higher shares (default 40%, up to 50%) need a registered integrator API key." } as const;
  return { referrer: ref, referrerShareBps: s, maxReferrerShareBps: cap, shareSource: !ref ? "none" : rec ? "integrator-key" : "referral-link" } as const;
}

function feeFor(gross: bigint, feeBps: number, shareBps: number, referrer: string | null, surplusBps: number, quotedOutNet: string) {
  const feeAmount = (gross * BigInt(feeBps)) / 10_000n;
  const referrerAmount = (feeAmount * BigInt(shareBps)) / 10_000n;
  return {
    disclosed: true, feeBps, feePercent: `${feeBps / 100}%`, feeFrom: "output", feeAmount: feeAmount.toString(),
    netOutAmount: (gross - feeAmount).toString(), grossOutAmount: gross.toString(), referrer, referrerShareBps: shareBps,
    referrerSharePercent: `${shareBps / 100}%`, referrerAmount: referrerAmount.toString(), treasuryAmount: (feeAmount - referrerAmount).toString(),
    description: "mock",
    surplusShare: { disclosed: true, enabled: surplusBps > 0, operatorShareBps: surplusBps, userShareBps: 10_000 - surplusBps, quotedOutNet, description: "mock surplus" },
  };
}

export async function startMock(opts: MockOptions = {}) {
  const requests: Recorded[] = [];
  const surplusBps = opts.surplusShareBps ?? 5000;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ method: req.method!, url: req.url!, headers: req.headers, body });
    const u = new URL(req.url!, "http://x");
    const p: Record<string, any> = Object.fromEntries(u.searchParams.entries());
    if (body) for (const [k, v] of Object.entries(body)) if (p[k] == null) p[k] = v;
    const send = (status: number, j: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(j));
    };
    if (p.tokenIn?.toLowerCase() === STOCK || p.tokenOut?.toLowerCase() === STOCK) {
      return send(451, { error: "Tokenized stocks are not available on this terminal.", code: "TOKENIZED_EQUITY_BLOCKED" });
    }
    const pr = share(req.headers["x-api-key"] as string | undefined, p.referrer ?? null, p.referrerShareBps != null ? Number(p.referrerShareBps) : undefined);
    if ("error" in pr) return send(pr.status ?? 400, { error: pr.error });
    const amountIn = BigInt(p.amountIn);
    const gross = amountIn * 3000n; // fake price
    const fee = feeFor(gross, 10, pr.referrerShareBps, pr.referrer, surplusBps, opts.quotedOutNet ?? (gross - (gross * 10n) / 10_000n).toString());
    const quotedOutNet = opts.quotedOutNet ?? fee.netOutAmount;
    const pricing = { tier: "standard", referrer: pr.referrer, referrerShareBps: pr.referrerShareBps, maxReferrerShareBps: pr.maxReferrerShareBps, shareSource: pr.shareSource };
    const quote = { chainId: Number(p.chainId ?? 8453), tokenIn: p.tokenIn, tokenOut: p.tokenOut, amountIn: p.amountIn, grossOutAmount: gross.toString(), netOutAmount: fee.netOutAmount, minOutNet: fee.netOutAmount, slippageBps: Number(p.slippageBps ?? 50), fee, quotedOutNet, surplusShareBps: surplusBps };
    if (u.pathname === "/api/v1/quote" && req.method === "GET") {
      const ticket = { issuedAt: Date.now(), expiresAt: Date.now() + 15_000, blockNumber: "1", tokenIn: p.tokenIn, tokenOut: p.tokenOut, amountIn: p.amountIn, netOut: fee.netOutAmount, slippageBps: quote.slippageBps, quotedOutNet, surplusShareBps: surplusBps, sig: "ab".repeat(32) };
      const live = opts.live === true;
      return send(200, { ok: true, dryRun: !live, broadcast: false, quote, quoteTicket: ticket, fee, quotedOutNet, surplusShareBps: surplusBps, surplusShare: { ...fee.surplusShare, scope: "evm-fee-router" }, pricing, referrer: pr.referrer, config: { dryRun: !live, feeRouterConfigured: live }, note: "mock" });
    }
    if (u.pathname === "/api/v1/build-tx" && req.method === "POST") {
      if (!body?.quoteTicket?.sig) return send(400, { error: "A valid, unexpired quoteTicket from /api/v1/quote is required.", code: "QUOTE_TICKET_REQUIRED" });
      const t = body.quoteTicket;
      const live = opts.live === true;
      return send(200, {
        ok: true, dryRun: !live, broadcast: false, broadcastable: opts.broadcastableInBody ?? false,
        tx: { to: "0x9999999999999999999999999999999999999999", data: "0xdeadbeef", value: "0", chainId: quote.chainId, description: "mock" },
        approvals: [], quote, fee,
        feeParams: { feeBps: 10, referrer: pr.referrer, referrerShareBps: pr.referrerShareBps, quotedOutNet: t.quotedOutNet, surplusShareBps: t.surplusShareBps },
        quotedOutNet: t.quotedOutNet, surplusShareBps: t.surplusShareBps, surplusShare: { ...fee.surplusShare, scope: "evm-fee-router" },
        pricing, referrer: pr.referrer, feeRouterConfigured: live, feeWalletConfigured: false,
        config: { dryRun: !live, feeRouterConfigured: live },
        note: "mock",
      });
    }
    send(404, { error: "not found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${port}`, requests, close: () => new Promise<void>((r) => server.close(() => r())) };
}
