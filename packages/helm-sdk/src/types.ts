/**
 * Public types for helmswap. These mirror the HelmSwap /api/v1 responses.
 * The server is the source of truth for routing, fees, quote tickets, surplus terms,
 * the tokenized-stock block and sanctions.
 */

/** Live EVM chains with a deployed fee router (v1.3, or Arc 1.3b). */
export type HelmLiveEvmChainId = 8453 | 56 | 1 | 4663 | 57073 | 999 | 99901 | 5042;

/**
 * EVM chain IDs the v1 API accepts.
 * Quotes may succeed on Arbitrum (42161) and Polygon (137), but build-tx is refused
 * until a fee router is deployed there. Do not treat those as live.
 */
export type HelmChainId = HelmLiveEvmChainId | 42161 | 137;

/** Live trading venues: the eight fee-router EVM chains, plus Solana. */
export type HelmChain = HelmLiveEvmChainId | "solana";

export const HELM_CHAINS: Readonly<Record<HelmChainId, { name: string; nativeSymbol: string; live: boolean }>> = Object.freeze({
  8453: { name: "Base", nativeSymbol: "ETH", live: true },
  56: { name: "BNB Chain", nativeSymbol: "BNB", live: true },
  1: { name: "Ethereum", nativeSymbol: "ETH", live: true },
  4663: { name: "Robinhood Chain", nativeSymbol: "ETH", live: true },
  57073: { name: "Ink", nativeSymbol: "ETH", live: true },
  999: { name: "HyperEVM", nativeSymbol: "HYPE", live: true },
  99901: { name: "Elysium", nativeSymbol: "HYPE", live: true },
  5042: { name: "Arc", nativeSymbol: "USDC", live: true },
  42161: { name: "Arbitrum One", nativeSymbol: "ETH", live: false },
  137: { name: "Polygon", nativeSymbol: "POL", live: false },
});

export const HELM_CHAIN_IDS: readonly HelmChainId[] = Object.freeze([8453, 56, 1, 4663, 57073, 999, 99901, 5042, 42161, 137] as HelmChainId[]);
export const HELM_LIVE_EVM_CHAIN_IDS: readonly HelmLiveEvmChainId[] = Object.freeze([8453, 56, 1, 4663, 57073, 999, 99901, 5042] as HelmLiveEvmChainId[]);

/** Disclosed fee policy. Informational: the server applies the rates; this client never changes them. */
export const HELM_FEE_POLICY = Object.freeze({
  /** Standard interface fee, bps of output (or of input on some Solana routes): majors / listed (default) / long-tail. */
  standardTiersBps: Object.freeze({ major: 10, listed: 50, longTail: 100 }),
  /**
   * Integrator share of that fee. Not added on top: the user pays the same fee with or without you.
   * Keyless 20% is live (verified against https://helmswap.com). The 40% API-key default is implemented
   * in the API but cannot be issued on the live host until a persistent key store exists; do not assume it works today.
   */
  integratorShareBps: Object.freeze({ keylessDefault: 2000, keylessMax: 2000, withApiKeyDefault: 4000, max: 5000 }),
  /** Positive-slippage (surplus) share on EVM fee-router swaps: default 50/50, cap 50% to the operator. Off on Solana. */
  surplusShareBps: Object.freeze({ evmDefault: 5000, max: 5000, solana: 0 }),
  /** pump.fun bonding-curve trades use the long-tail Helm fee (100 bps / 1%), plus pump.fun's own venue fee (not Helm's). */
  pumpFunCurveHelmBps: 100,
});

export type HelmOptions = {
  /**
   * Origin of a HelmSwap terminal serving /api/v1.
   * Defaults to "https://helmswap.com".
   */
  baseUrl?: string;
  /**
   * Optional integrator API key issued by the operator (sent as x-api-key).
   * Intended to lift the share from 20% to 40% (cap 50%). As of 19 Nov 2026 the live host
   * has no persistent API-key store, so a key will 401. Omit it and use the keyless 20% tier.
   * This is an API key, not a wallet key: never pass a private key or seed phrase anywhere here.
   */
  apiKey?: string;
  /**
   * Your payout (referrer) address. Address only.
   * EVM: 0x-prefixed 20-byte address. Solana: a base58 wallet (on-curve), not a program id.
   */
  payoutAddress?: string;
  /** Optional requested share in bps. Keyless max 2000. Server enforces. */
  referrerShareBps?: number;
  /** Inject a fetch implementation (tests, older runtimes). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Request timeout in ms. Default 15000. */
  timeoutMs?: number;
};

export type HelmQuoteParams = {
  /** EVM chain id. Ignored when `chain` is "solana". Default 8453 (Base). */
  chainId?: HelmChainId;
  /** Pass "solana" for Solana (Orca, PumpSwap, pump.fun curves). */
  chain?: "solana" | HelmChainId;
  /** Token address, or a native symbol (ETH / BNB / POL / SOL). */
  tokenIn: string;
  tokenOut: string;
  /** Integer base units of tokenIn. */
  amountIn: string | bigint;
  /** Default 50 (0.5%). */
  slippageBps?: number;
};

/** Signed, opaque quote ticket. Lasts ~15 s. Pass it back unchanged; the build is refused without it. */
export type HelmQuoteTicket = {
  issuedAt: number;
  expiresAt: number;
  blockNumber: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  netOut: string;
  slippageBps: number;
  quotedOutNet: string;
  surplusShareBps: number;
  sig: string;
};

export type HelmSurplusShare = {
  disclosed: true;
  enabled: boolean;
  operatorShareBps: number;
  userShareBps: number;
  quotedOutNet: string;
  description: string;
  scope?: string;
};

/** Server fee disclosure (amounts are integer base units). EVM fees are typically taken from output; some Solana fees are taken from input. */
export type HelmFeeDisclosure = {
  disclosed: true;
  feeBps: number;
  feePercent?: string;
  feeFrom?: "output" | "input";
  feeAmount: string;
  netOutAmount?: string;
  grossOutAmount?: string;
  referrer?: string | null;
  referrerShareBps?: number;
  referrerSharePercent?: string;
  referrerAmount?: string;
  treasuryAmount?: string;
  description?: string;
  reason?: string;
  surplusShare?: HelmSurplusShare;
  [key: string]: unknown;
};

/** Your cut, taken out of the disclosed fee (not added to it). */
export type HelmIntegratorShare = {
  payoutAddress: string | null;
  referrerShareBps: number;
  /** Max share the server allows this caller (2000 keyless, 5000 with a key). */
  maxReferrerShareBps: number | null;
  /** "integrator-key" | "referral-link" | "none" */
  shareSource: string | null;
  /** Total fee, in fee-token base units. */
  feeAmount: string;
  /** Your part of feeAmount. */
  referrerAmount: string;
  /** Operator treasury part of feeAmount. */
  treasuryAmount: string;
  /** Solana only: false when the referrer cannot be paid on this swap (e.g. missing token account). */
  paid?: boolean;
  reason?: string | null;
};

/** Server price-impact guard for the executable path (percent). build-tx refuses when buildable is false. */
export type HelmPriceImpact = {
  level: "ok" | "warn" | "blocked" | "unknown";
  priceImpactPct: number | null;
  liquidityExhausted: boolean;
  buildable: boolean;
  overridable: boolean;
  warnPct: number;
  maxPct: number;
  warning: string | null;
};

export type HelmQuote = {
  chain: HelmChain | HelmChainId;
  chainId: HelmChainId | null;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps: number;
  grossOutAmount: string;
  /** Honest expected output after the disclosed fee (not padded). */
  netOutAmount: string;
  /** netOutAmount minus slippage tolerance: the floor the user signs. */
  minOutNet: string;
  fee: HelmFeeDisclosure;
  integrator: HelmIntegratorShare;
  /** As returned by the server (from the signed ticket). This client never invents or overrides them. */
  quotedOutNet: string;
  surplusShareBps: number;
  surplusShare: HelmSurplusShare;
  quoteTicket: HelmQuoteTicket;
  /** Price impact of the executable path vs a small reference quote, percent. null if not measured. */
  priceImpactPct: number | null;
  /** Impact level, thresholds and warning, as returned by the server. */
  priceImpact: HelmPriceImpact | null;
  /** ms since epoch, from the ticket. */
  expiresAt: number;
  /**
   * App-level dry-run from `config.dryRun` when present. The v1 API currently also returns a
   * top-level `dryRun: true` on every response, which only means Helm itself never broadcasts.
   */
  dryRun: boolean;
  note: string;
  /** Full server body for anything not mapped above. */
  raw: Record<string, unknown>;
};

export type HelmUnsignedTx = { to: string; data: string; value: string; chainId: number; description?: string };

/** Unsigned Solana v0 transaction, base64, for the user's wallet to sign and send. */
export type HelmSolanaUnsignedTx = {
  chain: "solana";
  transactionBase64: string;
  encoding?: string;
  version?: number;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
  feePayer?: string;
  feeInstructionIncluded?: boolean;
  [key: string]: unknown;
};

export type HelmBuildParams = {
  /** The quote returned by helm.quote(). Its quoteTicket is always forwarded. */
  quote: HelmQuote;
  /** The user's wallet that will sign. Address only (EVM 0x or Solana base58). */
  recipient: string;
  /** Use Permit2 approvals when building EVM txs. Default false. */
  usePermit2?: boolean;
  /** Explicit opt-in to build above the server's price-impact cap. Never lifts the exhausted-liquidity refusal. */
  allowHighPriceImpact?: boolean;
};

export type HelmBuiltTx = {
  /** Unsigned EVM calldata, or null when this is a Solana build (see `solanaTx`). */
  tx: HelmUnsignedTx | null;
  /** Unsigned Solana v0 tx, or null on EVM. */
  solanaTx: HelmSolanaUnsignedTx | null;
  /** Unsigned token approvals the user may need first (EVM). */
  approvals: HelmUnsignedTx[];
  fee: HelmFeeDisclosure;
  integrator: HelmIntegratorShare;
  quotedOutNet: string;
  surplusShareBps: number;
  surplusShare: HelmSurplusShare;
  /** FeeParams decoded from tx.data, for display and checks (EVM). */
  feeParams: Record<string, unknown> | null;
  /**
   * Helm never broadcasts. The live v1 API currently hardcodes `broadcastable: false` even for
   * live, fee-router-encoded txs. Use `userCanSubmit` to decide whether the user's wallet can send it.
   */
  broadcastable: boolean;
  dryRun: boolean;
  /**
   * True when a fee router (EVM) or fee wallet (Solana) is configured and the app is not in
   * dry-run (`config.dryRun === false`). The user can sign and submit the unsigned tx themselves.
   */
  userCanSubmit: boolean;
  feeRouterConfigured: boolean;
  feeWalletConfigured?: boolean;
  feesAttached?: boolean;
  note: string;
  raw: Record<string, unknown>;
};
