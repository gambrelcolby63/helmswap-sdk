import { afterEach, describe, expect, it, vi } from "vitest";
import { Helm, HelmApiError, HelmInputError, HELM_FEE_POLICY, integratorSplit } from "../src/index";
import { GOOD_KEY, KEY_PAYOUT, PAYOUT, STOCK, USDC, USER, WETH, startMock } from "./mockServer";

let mock: Awaited<ReturnType<typeof startMock>> | null = null;
afterEach(async () => {
  await mock?.close();
  mock = null;
  vi.restoreAllMocks();
});

const swap = { chainId: 8453 as const, tokenIn: WETH, tokenOut: USDC, amountIn: 10n ** 18n };

describe("integrator share", () => {
  it("gets the 40% default share with a valid API key and sends x-api-key", async () => {
    mock = await startMock();
    const helm = new Helm({ baseUrl: mock.baseUrl, apiKey: GOOD_KEY, payoutAddress: PAYOUT });
    const q = await helm.quote(swap);
    expect(q.integrator.referrerShareBps).toBe(4000);
    expect(q.integrator.payoutAddress).toBe(PAYOUT);
    expect(q.integrator.shareSource).toBe("integrator-key");
    expect(BigInt(q.integrator.referrerAmount)).toBe((BigInt(q.integrator.feeAmount) * 4000n) / 10_000n);
    expect(BigInt(q.integrator.referrerAmount) + BigInt(q.integrator.treasuryAmount)).toBe(BigInt(q.integrator.feeAmount));
    expect(mock.requests[0].headers["x-api-key"]).toBe(GOOD_KEY);
    expect(mock.requests[0].url).toContain(`referrer=${PAYOUT}`);
  });

  it("uses the key's registered payout when payoutAddress is omitted", async () => {
    mock = await startMock();
    const q = await new Helm({ baseUrl: mock.baseUrl, apiKey: GOOD_KEY }).quote(swap);
    expect(q.integrator.payoutAddress).toBe(KEY_PAYOUT);
    expect(q.integrator.referrerShareBps).toBe(4000);
  });

  it("keyless is the 20% referral-link share, and asking for more is refused", async () => {
    mock = await startMock();
    const q = await new Helm({ baseUrl: mock.baseUrl, payoutAddress: PAYOUT }).quote(swap);
    expect(q.integrator.referrerShareBps).toBe(2000);
    expect(q.integrator.maxReferrerShareBps).toBe(2000);
    expect(mock.requests[0].headers["x-api-key"]).toBeUndefined();
    const greedy = new Helm({ baseUrl: mock.baseUrl, payoutAddress: PAYOUT, referrerShareBps: 4000 });
    await expect(greedy.quote(swap)).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a share above the 50% cap before any request", () => {
    expect(() => new Helm({ baseUrl: "http://127.0.0.1:1", referrerShareBps: 5001 })).toThrow(HelmInputError);
  });

  it("surfaces 401 on a bad API key", async () => {
    mock = await startMock();
    const helm = new Helm({ baseUrl: mock.baseUrl, apiKey: "bsk_wrong", payoutAddress: PAYOUT });
    const err = await helm.quote(swap).catch((e) => e);
    expect(err).toBeInstanceOf(HelmApiError);
    expect(err.status).toBe(401);
    expect(err.isUnauthorized).toBe(true);
  });
});

describe("quote ticket and surplus", () => {
  it("always forwards the quoteTicket unchanged to build-tx", async () => {
    mock = await startMock();
    const helm = new Helm({ baseUrl: mock.baseUrl, apiKey: GOOD_KEY, payoutAddress: PAYOUT });
    const q = await helm.quote(swap);
    const built = await helm.buildTx({ quote: q, recipient: USER });
    const buildReq = mock.requests[1];
    expect(buildReq.method).toBe("POST");
    expect(buildReq.body.quoteTicket).toEqual(q.quoteTicket);
    expect(buildReq.headers["x-api-key"]).toBe(GOOD_KEY);
    expect(built.tx).toMatchObject({ to: expect.stringMatching(/^0x/), data: "0xdeadbeef", value: "0", chainId: 8453 });
    expect(built.integrator.referrerShareBps).toBe(4000);
  });

  it("refuses to build without a quoteTicket (no request sent), and the server refuses too", async () => {
    mock = await startMock();
    const helm = new Helm({ baseUrl: mock.baseUrl, payoutAddress: PAYOUT });
    const q = await helm.quote(swap);
    const stripped = { ...q, quoteTicket: undefined as any };
    await expect(helm.buildTx({ quote: stripped, recipient: USER })).rejects.toBeInstanceOf(HelmInputError);
    expect(mock.requests).toHaveLength(1);
    const raw = await fetch(`${mock.baseUrl}/api/v1/build-tx`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokenIn: WETH, tokenOut: USDC, amountIn: "1", recipient: USER }) });
    expect(raw.status).toBe(400);
    expect((await raw.json()).code).toBe("QUOTE_TICKET_REQUIRED");
  });

  it("forwards the server's surplus terms and never invents or sends them", async () => {
    mock = await startMock({ surplusShareBps: 3000, quotedOutNet: "123456" });
    const helm = new Helm({ baseUrl: mock.baseUrl, payoutAddress: PAYOUT });
    const q = await helm.quote(swap);
    expect(q.surplusShareBps).toBe(3000);
    expect(q.quotedOutNet).toBe("123456");
    expect(q.surplusShare.operatorShareBps).toBe(3000);
    // Even if an integrator tampers with the quote object, the build body never carries surplus terms.
    const tampered = { ...q, surplusShareBps: 0, quotedOutNet: "1" } as typeof q;
    const built = await helm.buildTx({ quote: tampered, recipient: USER });
    const body = mock.requests[1].body;
    expect(Object.keys(body).sort()).toEqual(["amountIn", "chainId", "quoteTicket", "recipient", "referrer", "slippageBps", "tokenIn", "tokenOut"]);
    expect(body).not.toHaveProperty("surplusShareBps");
    expect(body).not.toHaveProperty("quotedOutNet");
    expect(built.surplusShareBps).toBe(3000);
    expect(built.quotedOutNet).toBe("123456");
  });

  it("reports Solana-style 0 surplus as 0, not the EVM default", async () => {
    mock = await startMock({ surplusShareBps: 0 });
    const q = await new Helm({ baseUrl: mock.baseUrl }).quote(swap);
    expect(q.surplusShareBps).toBe(0);
    expect(q.surplusShare.enabled).toBe(false);
  });
});

describe("blocks and chains", () => {
  it("surfaces HTTP 451 for tokenized stocks", async () => {
    mock = await startMock();
    const err = await new Helm({ baseUrl: mock.baseUrl }).quote({ ...swap, tokenOut: STOCK }).catch((e) => e);
    expect(err).toBeInstanceOf(HelmApiError);
    expect(err.status).toBe(451);
    expect(err.code).toBe("TOKENIZED_EQUITY_BLOCKED");
    expect(err.isTokenizedEquityBlocked).toBe(true);
  });

  it("accepts Base, BNB, Ethereum, Robinhood Chain, Arbitrum and Polygon; rejects unknown EVM ids", async () => {
    mock = await startMock();
    const helm = new Helm({ baseUrl: mock.baseUrl });
    for (const chainId of [8453, 56, 1, 4663, 42161, 137] as const) {
      const q = await helm.quote({ ...swap, chainId });
      expect(q.chainId).toBe(chainId);
      expect(q.chain).toBe(chainId);
    }
    await expect(helm.quote({ ...swap, chainId: 10 as any })).rejects.toBeInstanceOf(HelmInputError);
  });

  it("accepts chain: \"solana\" and forwards chain=solana", async () => {
    mock = await startMock();
    const helm = new Helm({ baseUrl: mock.baseUrl, payoutAddress: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9" });
    const q = await helm.quote({ chain: "solana", tokenIn: "SOL", tokenOut: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountIn: 50_000_000n });
    expect(mock.requests[0].url).toContain("chain=solana");
    expect(mock.requests[0].url).toContain("referrer=5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
    // Mock is EVM-shaped, so mapping falls through; the request is what matters here.
    expect(q.amountIn).toBe("50000000");
  });
});

describe("no keys, no signing, no broadcast", () => {
  it("has no signing or broadcast API", () => {
    const methods = Object.getOwnPropertyNames(Helm.prototype);
    expect(methods.sort()).toEqual(["buildTx", "constructor", "hasApiKey", "quote"].sort());
    for (const m of methods) expect(m).not.toMatch(/sign|send|broadcast|submit|execute/i);
  });

  it("refuses private keys, seed phrases and signers in options", () => {
    const pk = "0x" + "a".repeat(64);
    for (const k of ["privateKey", "mnemonic", "signer", "wallet", "account", "secretKey"]) {
      expect(() => new Helm({ baseUrl: "http://127.0.0.1:1", [k]: pk } as any)).toThrow(HelmInputError);
    }
    expect(() => new Helm({ baseUrl: "http://127.0.0.1:1", apiKey: pk })).toThrow(/private key/);
    expect(() => new Helm({ baseUrl: "http://127.0.0.1:1", payoutAddress: pk })).toThrow(/private key/);
    const words = "abandon ".repeat(11) + "about";
    expect(() => new Helm({ baseUrl: "http://127.0.0.1:1", apiKey: words })).toThrow(/private key/);
  });

  it("refuses a key as recipient", async () => {
    mock = await startMock();
    const helm = new Helm({ baseUrl: mock.baseUrl });
    const q = await helm.quote(swap);
    await expect(helm.buildTx({ quote: q, recipient: "0x" + "b".repeat(64) })).rejects.toThrow(/private key/);
  });

  it("never exposes or logs the API key", async () => {
    mock = await startMock();
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "debug")];
    const helm = new Helm({ baseUrl: mock.baseUrl, apiKey: GOOD_KEY, payoutAddress: PAYOUT });
    expect(JSON.stringify(helm)).not.toContain(GOOD_KEY);
    expect(Object.values(helm).join(" ")).not.toContain(GOOD_KEY);
    expect(helm.hasApiKey).toBe(true);
    const q = await helm.quote(swap);
    await helm.buildTx({ quote: q, recipient: USER });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("userCanSubmit is false when the app is dry-run, even if the body says broadcastable", async () => {
    mock = await startMock({ broadcastableInBody: true });
    const helm = new Helm({ baseUrl: mock.baseUrl });
    const built = await helm.buildTx({ quote: await helm.quote(swap), recipient: USER });
    expect(built.userCanSubmit).toBe(false);
    expect(built.broadcastable).toBe(false);
    expect(built.dryRun).toBe(true);
  });

  it("userCanSubmit is true when config.dryRun is false and the fee router is configured", async () => {
    mock = await startMock({ live: true });
    const helm = new Helm({ baseUrl: mock.baseUrl });
    const q = await helm.quote(swap);
    expect(q.dryRun).toBe(false);
    const built = await helm.buildTx({ quote: q, recipient: USER });
    expect(built.dryRun).toBe(false);
    expect(built.userCanSubmit).toBe(true);
    expect(built.broadcastable).toBe(true);
    expect(built.feeRouterConfigured).toBe(true);
    expect(built.tx?.to).toMatch(/^0x/);
  });

  it("defaults baseUrl to https://helmswap.com", () => {
    const helm = new Helm();
    expect(helm.baseUrl).toBe("https://helmswap.com");
  });
});

describe("disclosed math", () => {
  it("$10,000 majors swap: 10 bps = $10 fee, 40% = $4 integrator, $6 treasury", () => {
    const usdc = 10_000n * 10n ** 6n;
    const s = integratorSplit({ grossOut: usdc, feeBps: HELM_FEE_POLICY.standardTiersBps.major, referrerShareBps: HELM_FEE_POLICY.integratorShareBps.withApiKeyDefault });
    expect(s.feeAmount).toBe(10n * 10n ** 6n);
    expect(s.referrerAmount).toBe(4n * 10n ** 6n);
    expect(s.treasuryAmount).toBe(6n * 10n ** 6n);
  });

  it("documents the unchanged 10/50/100 bps tiers and 20/40/50% shares", () => {
    expect(HELM_FEE_POLICY.standardTiersBps).toEqual({ major: 10, listed: 50, longTail: 100 });
    expect(HELM_FEE_POLICY.integratorShareBps).toMatchObject({ keylessMax: 2000, withApiKeyDefault: 4000, max: 5000 });
    expect(HELM_FEE_POLICY.surplusShareBps).toEqual({ evmDefault: 5000, max: 5000, solana: 0 });
  });
});
