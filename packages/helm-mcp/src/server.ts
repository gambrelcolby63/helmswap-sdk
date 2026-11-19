import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Helm, HelmApiError, HelmInputError, DEFAULT_BASE_URL, type HelmChainId, type HelmQuote } from "helmswap";

const FORBIDDEN = ["privateKey", "private_key", "secretKey", "mnemonic", "seed", "seedPhrase", "signer", "wallet", "account"];

function envOr(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  if (v == null || v.trim() === "") return fallback;
  return v.trim();
}

function clientFromEnv(): Helm {
  for (const k of FORBIDDEN) {
    if (process.env[k] || process.env[k.toUpperCase()]) {
      throw new Error(`helm-mcp refuses to start when ${k} is set in the environment. It never holds keys.`);
    }
  }
  return new Helm({
    baseUrl: envOr("HELM_BASE_URL", DEFAULT_BASE_URL),
    payoutAddress: envOr("HELM_REFERRER") ?? envOr("HELM_PAYOUT"),
    apiKey: envOr("HELM_API_KEY"),
    referrerShareBps: process.env.HELM_REFERRER_SHARE_BPS ? Number(process.env.HELM_REFERRER_SHARE_BPS) : undefined,
  });
}

const CHAIN_HELP =
  "Live: 8453 (Base), 56 (BNB Chain), 1 (Ethereum), 4663 (Robinhood Chain), or chain='solana'. Arbitrum (42161) and Polygon (137) can quote but cannot build until a fee router is deployed.";

const FEE_HELP =
  "Helm fee (disclosed, not hidden in the price): 10 bps majors, 50 bps listed, 100 bps long-tail / pump.fun bonding-curve coins. pump.fun also charges its own venue fee (~1.25%), paid to the creator and pump.fun, shown separately. Keyless referrer share is 20% of Helm's fee when HELM_REFERRER or the referrer argument is set. Helm never signs or broadcasts; the user signs in their own wallet.";

const getQuoteShape = {
  type: "object",
  properties: {
    chain: { type: "string", description: "solana, base, bnb, ethereum, robinhood, or a numeric chainId" },
    chainId: { type: "number", description: "EVM chain id. Ignored when chain is solana. Default 8453." },
    tokenIn: { type: "string", description: "Token address or native symbol (ETH, BNB, POL, SOL)" },
    tokenOut: { type: "string", description: "Token address or mint, or a native symbol" },
    amountIn: { type: "string", description: "Integer amount in tokenIn base units (e.g. 10000000 for 0.01 SOL, 9 decimals)" },
    slippageBps: { type: "number", description: "Slippage tolerance in bps. Default 50 (0.5%)." },
    referrer: { type: "string", description: "Optional payout address (EVM 0x or Solana base58). Overrides HELM_REFERRER for this call. 20% of Helm's fee." },
  },
  required: ["tokenIn", "tokenOut", "amountIn"],
} as const;

const buildShape = {
  type: "object",
  properties: {
    ...getQuoteShape.properties,
    recipient: { type: "string", description: "The user's wallet that will sign. Address only, never a key." },
    quote: { type: "object", description: "The object returned by get_quote (must include quoteTicket). If omitted, a fresh quote is taken first." },
  },
  required: ["tokenIn", "tokenOut", "amountIn", "recipient"],
} as const;

function parseChain(args: Record<string, unknown>): { chain?: "solana"; chainId?: HelmChainId } {
  const raw = args.chain ?? args.chainId;
  if (raw == null || raw === "") return { chainId: 8453 };
  const s = String(raw).trim().toLowerCase();
  if (s === "solana" || s === "sol") return { chain: "solana" };
  const aliases: Record<string, HelmChainId> = { base: 8453, bnb: 56, bsc: 56, eth: 1, ethereum: 1, robinhood: 4663, rh: 4663, arbitrum: 42161, arb: 42161, polygon: 137, matic: 137 };
  if (s in aliases) return { chainId: aliases[s] };
  const n = Number(s);
  if ([8453, 56, 1, 4663, 42161, 137].includes(n)) return { chainId: n as HelmChainId };
  throw new HelmInputError(`Unsupported chain '${raw}'. ${CHAIN_HELP}`);
}

function publicQuote(q: HelmQuote) {
  return {
    chain: q.chain,
    tokenIn: q.tokenIn,
    tokenOut: q.tokenOut,
    amountIn: q.amountIn,
    grossOutAmount: q.grossOutAmount,
    netOutAmount: q.netOutAmount,
    minOutNet: q.minOutNet,
    feeBps: q.fee.feeBps,
    feeAmount: q.integrator.feeAmount,
    referrer: q.integrator.payoutAddress,
    referrerShareBps: q.integrator.referrerShareBps,
    referrerAmount: q.integrator.referrerAmount,
    treasuryAmount: q.integrator.treasuryAmount,
    referrerPaid: q.integrator.paid,
    surplusShareBps: q.surplusShareBps,
    expiresAt: q.expiresAt,
    dryRun: q.dryRun,
    note: q.note,
    quoteTicket: q.quoteTicket,
  };
}

export type HelmMcpDeps = { helm?: Helm };

export function createHelmMcpServer(deps: HelmMcpDeps = {}) {
  const helm = deps.helm ?? clientFromEnv();
  const server = new Server(
    { name: "helmswap", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_quote",
        description: `Get a disclosed HelmSwap quote and a short-lived quote ticket. ${FEE_HELP} ${CHAIN_HELP} Tokenized stocks return an error (HTTP 451) and must not be retried. US users can use this swap API. Predictions and perps are not live and are not exposed here.`,
        inputSchema: getQuoteShape,
      },
      {
        name: "build_swap",
        description: `Build an unsigned swap transaction for the user's wallet to sign. ${FEE_HELP} Helm never broadcasts. Prefer passing the quote object from get_quote so the signed ticket is reused. There is no execute/sign tool.`,
        inputSchema: buildShape,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (name !== "get_quote" && name !== "build_swap") {
        return { isError: true, content: [{ type: "text", text: `Unknown tool '${name}'. Available: get_quote, build_swap.` }] };
      }
      const chain = parseChain(args);
      const tokenIn = String(args.tokenIn ?? "");
      const tokenOut = String(args.tokenOut ?? "");
      const amountIn = String(args.amountIn ?? "");
      const slippageBps = args.slippageBps != null ? Number(args.slippageBps) : undefined;
      const override = typeof args.referrer === "string" && args.referrer ? args.referrer : undefined;
      const client = override
        ? new Helm({ baseUrl: helm.baseUrl, payoutAddress: override, referrerShareBps: helm.referrerShareBps })
        : helm;

      const quoteArgs = chain.chain === "solana"
        ? { chain: "solana" as const, tokenIn, tokenOut, amountIn, slippageBps }
        : { chainId: chain.chainId, tokenIn, tokenOut, amountIn, slippageBps };

      if (name === "get_quote") {
        const quote = await client.quote(quoteArgs);
        return { content: [{ type: "text", text: JSON.stringify(publicQuote(quote), null, 2) }] };
      }

      const recipient = String(args.recipient ?? "");
      let quote: HelmQuote;
      if (args.quote && typeof args.quote === "object" && (args.quote as HelmQuote).quoteTicket) {
        quote = args.quote as HelmQuote;
      } else {
        quote = await client.quote(quoteArgs);
      }
      const built = await client.buildTx({ quote, recipient });
      const out = {
        userCanSubmit: built.userCanSubmit,
        dryRun: built.dryRun,
        feeBps: built.fee.feeBps,
        feeAmount: built.integrator.feeAmount,
        referrer: built.integrator.payoutAddress,
        referrerShareBps: built.integrator.referrerShareBps,
        referrerAmount: built.integrator.referrerAmount,
        treasuryAmount: built.integrator.treasuryAmount,
        referrerPaid: built.integrator.paid,
        feeParams: built.feeParams,
        evmTx: built.tx,
        approvals: built.approvals,
        solanaTx: built.solanaTx
          ? { chain: "solana", transactionBase64: built.solanaTx.transactionBase64, recentBlockhash: built.solanaTx.recentBlockhash, lastValidBlockHeight: built.solanaTx.lastValidBlockHeight, feePayer: built.solanaTx.feePayer }
          : null,
        note: "Unsigned. Hand evmTx or solanaTx.transactionBase64 to the user's wallet. Helm never signs or broadcasts.",
      };
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    } catch (err) {
      const msg = err instanceof HelmApiError
        ? `Helm API ${err.status}${err.code ? ` ${err.code}` : ""}: ${err.message}`
        : err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: msg }] };
    }
  });

  return server;
}

export { clientFromEnv };
