import { HelmApiError, HelmInputError } from "./errors.js";
import {
  HELM_CHAIN_IDS,
  type HelmBuildParams,
  type HelmBuiltTx,
  type HelmChainId,
  type HelmFeeDisclosure,
  type HelmIntegratorShare,
  type HelmOptions,
  type HelmPriceImpact,
  type HelmQuote,
  type HelmQuoteParams,
  type HelmQuoteTicket,
  type HelmSolanaUnsignedTx,
  type HelmSurplusShare,
  type HelmUnsignedTx,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://helmswap.com";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NATIVE_SYMBOLS = new Set(["eth", "bnb", "pol", "matic", "sol"]);
/** Option names that would mean someone is trying to hand us signing material. Refused outright. */
const FORBIDDEN_OPTION_KEYS = ["privateKey", "private_key", "secretKey", "mnemonic", "seed", "seedPhrase", "signer", "wallet", "account"];
const SOLANA_BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** 32-byte hex (with or without 0x) or a 12/15/18/21/24-word phrase: looks like a private key or seed. */
export function looksLikeSecretKey(s: unknown): boolean {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(t)) return true;
  const words = t.split(/\s+/);
  if ([12, 15, 18, 21, 24].includes(words.length) && words.every((w) => /^[a-z]+$/.test(w))) return true;
  return false;
}

function isSolanaAddress(v: string): boolean {
  return SOLANA_BASE58.test(v) && !looksLikeSecretKey(v);
}

function assertEvmAddress(label: string, v: string): void {
  if (looksLikeSecretKey(v)) throw new HelmInputError(`${label} looks like a private key or seed phrase. Pass an address only; this client never accepts keys.`);
  if (!EVM_ADDRESS.test(v)) throw new HelmInputError(`${label} must be a 0x-prefixed 20-byte EVM address.`);
}

function assertPayoutOrRecipient(label: string, v: string, solana: boolean): void {
  if (looksLikeSecretKey(v)) throw new HelmInputError(`${label} looks like a private key or seed phrase. Pass an address only; this client never accepts keys.`);
  if (solana) {
    if (EVM_ADDRESS.test(v)) throw new HelmInputError(`${label} must be a Solana base58 wallet address for a Solana swap.`);
    if (!isSolanaAddress(v)) throw new HelmInputError(`${label} must be a Solana base58 wallet address (never a private key).`);
    return;
  }
  assertEvmAddress(label, v);
}

function assertToken(label: string, v: string, solana: boolean): void {
  if (typeof v !== "string" || !v.trim()) throw new HelmInputError(`${label} is required.`);
  if (NATIVE_SYMBOLS.has(v.trim().toLowerCase())) return;
  if (solana) {
    if (looksLikeSecretKey(v)) throw new HelmInputError(`${label} looks like a private key. Pass a mint or SOL.`);
    if (!isSolanaAddress(v.trim())) throw new HelmInputError(`${label} must be a Solana mint or the symbol SOL.`);
    return;
  }
  assertEvmAddress(label, v.trim());
}

function str(v: unknown, fallback = "0"): string {
  if (v == null) return fallback;
  return String(v);
}

function isSolanaRequest(params: HelmQuoteParams | HelmQuote): boolean {
  if ("chain" in params && (params as { chain?: unknown }).chain === "solana") return true;
  return false;
}

/**
 * HelmSwap integrator client (HTTP, v1 API). Quote -> unsigned transaction.
 * The user signs in their own wallet. No signing, no broadcast, no key handling anywhere in this class.
 */
export class Helm {
  readonly baseUrl: string;
  readonly payoutAddress: string | null;
  readonly referrerShareBps: number | undefined;
  readonly #apiKey: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: HelmOptions = {}) {
    if (options && typeof options !== "object") throw new HelmInputError("Helm options must be an object.");
    const opts = options ?? {};
    for (const k of FORBIDDEN_OPTION_KEYS) {
      if (k in (opts as Record<string, unknown>)) {
        throw new HelmInputError(`Helm does not accept "${k}". It never holds, stores or logs keys; the user signs in their own wallet.`);
      }
    }
    const baseUrl = (opts.baseUrl && opts.baseUrl.trim()) || DEFAULT_BASE_URL;
    if (!/^https?:\/\//.test(baseUrl)) throw new HelmInputError("baseUrl must be an http(s) origin, e.g. https://helmswap.com.");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    if (opts.apiKey != null && opts.apiKey !== "") {
      if (looksLikeSecretKey(opts.apiKey)) throw new HelmInputError("apiKey looks like a wallet private key. Use the integrator API key from the operator (bsk_...), never a wallet key.");
      this.#apiKey = opts.apiKey;
    }
    if (opts.payoutAddress) {
      if (looksLikeSecretKey(opts.payoutAddress)) throw new HelmInputError("payoutAddress looks like a private key or seed phrase. Pass an address only; this client never accepts keys.");
      const ok = EVM_ADDRESS.test(opts.payoutAddress) || isSolanaAddress(opts.payoutAddress);
      if (!ok) throw new HelmInputError("payoutAddress must be an EVM 0x address or a Solana base58 wallet (never a private key).");
      this.payoutAddress = opts.payoutAddress;
    } else {
      this.payoutAddress = null;
    }
    if (opts.referrerShareBps != null) {
      const n = opts.referrerShareBps;
      if (!Number.isInteger(n) || n < 0 || n > 5000) throw new HelmInputError("referrerShareBps must be an integer 0–5000 (server cap 50%; keyless 20%).");
      this.referrerShareBps = n;
    }
    const f = opts.fetch ?? (globalThis.fetch as typeof fetch | undefined);
    if (!f) throw new HelmInputError("No fetch available. Use Node 18+ or pass options.fetch.");
    this.#fetch = f;
    this.#timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** True when an API key is configured (the value itself is never exposed or logged). */
  get hasApiKey(): boolean {
    return !!this.#apiKey;
  }

  /** Get a disclosed quote plus a signed ~15-second quoteTicket. */
  async quote(params: HelmQuoteParams): Promise<HelmQuote> {
    const solana = isSolanaRequest(params);
    let chainId: HelmChainId | undefined;
    if (!solana) {
      chainId = (typeof params.chain === "number" ? params.chain : params.chainId) ?? 8453;
      if (!HELM_CHAIN_IDS.includes(chainId as HelmChainId)) {
        throw new HelmInputError(`chainId must be one of ${HELM_CHAIN_IDS.join(", ")}, or chain: "solana".`);
      }
    }
    assertToken("tokenIn", params.tokenIn, solana);
    assertToken("tokenOut", params.tokenOut, solana);
    const amountIn = typeof params.amountIn === "bigint" ? params.amountIn.toString() : String(params.amountIn ?? "").trim();
    if (!/^[0-9]+$/.test(amountIn) || BigInt(amountIn) <= 0n) throw new HelmInputError("amountIn must be a positive integer in token base units.");
    const q = new URLSearchParams({ tokenIn: params.tokenIn, tokenOut: params.tokenOut, amountIn });
    if (solana) q.set("chain", "solana");
    else q.set("chainId", String(chainId));
    if (params.slippageBps != null) q.set("slippageBps", String(params.slippageBps));
    if (this.payoutAddress) q.set("referrer", this.payoutAddress);
    if (this.referrerShareBps != null) q.set("referrerShareBps", String(this.referrerShareBps));
    const body = await this.#request("GET", `/api/v1/quote?${q.toString()}`);
    return mapQuote(body, solana ? "solana" : chainId!);
  }

  /**
   * Turn a quote into an unsigned transaction for the user's wallet. Always forwards quote.quoteTicket.
   * Surplus share and quotedOutNet are never sent: the server reads them from the signed ticket.
   */
  async buildTx(params: HelmBuildParams): Promise<HelmBuiltTx> {
    const { quote } = params ?? ({} as HelmBuildParams);
    if (!quote || typeof quote !== "object") throw new HelmInputError("buildTx needs the quote returned by helm.quote().");
    if (!quote.quoteTicket || typeof quote.quoteTicket !== "object" || !quote.quoteTicket.sig) {
      throw new HelmInputError("quote.quoteTicket is missing. Call helm.quote() first and pass its result unchanged; the server refuses builds without a signed ticket.");
    }
    const solana = quote.chain === "solana";
    assertPayoutOrRecipient("recipient", params.recipient, solana);
    const body: Record<string, unknown> = {
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
      amountIn: quote.amountIn,
      slippageBps: quote.slippageBps,
      recipient: params.recipient,
      quoteTicket: quote.quoteTicket,
    };
    if (solana) body.chain = "solana";
    else body.chainId = quote.chainId ?? quote.chain;
    if (params.usePermit2) body.usePermit2 = true;
    if (params.allowHighPriceImpact === true) body.allowHighPriceImpact = true;
    const referrer = this.payoutAddress ?? quote.integrator.payoutAddress;
    if (referrer) body.referrer = referrer;
    if (this.referrerShareBps != null) body.referrerShareBps = this.referrerShareBps;
    const res = await this.#request("POST", "/api/v1/build-tx", body);
    return mapBuilt(res, solana ? "solana" : (quote.chainId ?? 8453));
  }

  async #request(method: "GET" | "POST", path: string, json?: unknown): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (json !== undefined) headers["content-type"] = "application/json";
    if (this.#apiKey) headers["x-api-key"] = this.#apiKey;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.#timeoutMs);
    let res: Response;
    try {
      res = await this.#fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: json === undefined ? undefined : JSON.stringify(json),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    let parsed: unknown = null;
    const text = await res.text();
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const b = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
      const msg = typeof b.error === "string" ? b.error : `Helm API ${res.status}`;
      throw new HelmApiError(res.status, msg, typeof b.code === "string" ? b.code : null, parsed);
    }
    if (!parsed || typeof parsed !== "object") throw new HelmApiError(res.status, "Helm API returned a non-JSON body.", null, parsed);
    return parsed as Record<string, unknown>;
  }
}

function mapSurplus(v: unknown): HelmSurplusShare {
  return (v ?? { disclosed: true, enabled: false, operatorShareBps: 0, userShareBps: 10_000, quotedOutNet: "0", description: "" }) as HelmSurplusShare;
}

function mapIntegrator(body: Record<string, unknown>, fee: HelmFeeDisclosure | undefined, pricing: Record<string, unknown> | undefined): HelmIntegratorShare {
  const referral = (body.referral ?? (body.tx as Record<string, unknown> | undefined)?.referral) as Record<string, unknown> | undefined;
  const payout =
    (typeof referral?.address === "string" ? referral.address : null) ??
    (typeof body.referrer === "string" ? body.referrer : null) ??
    fee?.referrer ??
    null;
  const feeAmount = str(fee?.feeAmount ?? fee?.amount ?? (referral ? (BigInt(str(referral.amount, "0")) + BigInt(str(referral.treasuryAmount, "0"))).toString() : "0"));
  const referrerAmount = str(referral?.amount ?? fee?.referrerAmount, "0");
  const treasuryAmount = str(referral?.treasuryAmount ?? fee?.treasuryAmount, feeAmount);
  return {
    payoutAddress: payout,
    referrerShareBps: Number(referral?.shareBps ?? pricing?.referrerShareBps ?? fee?.referrerShareBps ?? 0),
    maxReferrerShareBps: pricing?.maxReferrerShareBps != null ? Number(pricing.maxReferrerShareBps) : referral ? 2000 : null,
    shareSource: typeof pricing?.shareSource === "string" ? pricing.shareSource : referral ? "referral-link" : null,
    feeAmount,
    referrerAmount,
    treasuryAmount,
    paid: typeof referral?.paid === "boolean" ? referral.paid : undefined,
    reason: typeof referral?.reason === "string" ? referral.reason : null,
  };
}

function appDryRun(body: Record<string, unknown>): boolean {
  const cfg = body.config as Record<string, unknown> | undefined;
  if (cfg && typeof cfg.dryRun === "boolean") return cfg.dryRun;
  return body.dryRun === true;
}

function userCanSubmitFrom(body: Record<string, unknown>, solana: boolean): boolean {
  if (appDryRun(body)) return false;
  if (solana) return body.feeWalletConfigured === true || body.feesAttached === true;
  return body.feeRouterConfigured === true || (body.config as Record<string, unknown> | undefined)?.feeRouterConfigured === true;
}

function mapQuote(body: Record<string, unknown>, requested: HelmChainId | "solana"): HelmQuote {
  const q = (body.quote ?? {}) as Record<string, unknown>;
  const ticket = body.quoteTicket as HelmQuoteTicket | undefined;
  if (!ticket || typeof ticket !== "object") throw new HelmApiError(502, "Helm quote response had no quoteTicket.", "NO_TICKET", body);
  const solana = requested === "solana" || q.chain === "solana" || body.chain === "solana";
  const feeRaw = (body.fee ?? q.fee ?? {}) as Record<string, unknown>;
  const fee = {
    ...feeRaw,
    disclosed: true,
    feeBps: Number(feeRaw.feeBps ?? 0),
    feeAmount: str(feeRaw.feeAmount ?? feeRaw.amount, "0"),
  } as HelmFeeDisclosure;
  const pricing = body.pricing as Record<string, unknown> | undefined;
  const chainId = solana ? null : Number(q.chainId ?? requested);
  return {
    chain: solana ? "solana" : (chainId as HelmChainId),
    chainId: solana ? null : (chainId as HelmChainId),
    tokenIn: str(q.tokenIn ?? q.inputMint ?? ticket.tokenIn, ""),
    tokenOut: str(q.tokenOut ?? q.outputMint ?? ticket.tokenOut, ""),
    amountIn: str(q.amountIn ?? ticket.amountIn, ""),
    slippageBps: Number(q.slippageBps ?? ticket.slippageBps),
    grossOutAmount: str(q.grossOutAmount),
    netOutAmount: str(q.netOutAmount),
    minOutNet: str(q.minOutNet ?? q.minNetOutAmount),
    fee,
    integrator: mapIntegrator(body, fee, pricing),
    quotedOutNet: str(body.quotedOutNet ?? q.quotedOutNet ?? ticket.quotedOutNet),
    surplusShareBps: Number(body.surplusShareBps ?? q.surplusShareBps ?? ticket.surplusShareBps ?? 0),
    surplusShare: mapSurplus(body.surplusShare ?? q.surplusShare ?? fee?.surplusShare),
    quoteTicket: ticket,
    priceImpactPct: typeof body.priceImpactPct === "number" ? body.priceImpactPct : typeof q.priceImpactPct === "number" ? q.priceImpactPct : null,
    priceImpact: ((body.priceImpact ?? q.priceImpact) as HelmPriceImpact | undefined) ?? null,
    expiresAt: Number(ticket.expiresAt),
    dryRun: appDryRun(body),
    note: str(body.note, ""),
    raw: body,
  };
}

function mapBuilt(body: Record<string, unknown>, requested: HelmChainId | "solana"): HelmBuiltTx {
  const solana = requested === "solana" || body.chain === "solana";
  const feeRaw = (body.fee ?? (body.quote as Record<string, unknown> | undefined)?.fee ?? {}) as Record<string, unknown>;
  const fee = {
    ...feeRaw,
    disclosed: true,
    feeBps: Number(feeRaw.feeBps ?? 0),
    feeAmount: str(feeRaw.feeAmount ?? feeRaw.amount, "0"),
  } as HelmFeeDisclosure;
  let evmTx: HelmUnsignedTx | null = null;
  let solanaTx: HelmSolanaUnsignedTx | null = null;
  if (solana) {
    const tx = body.tx as Record<string, unknown> | undefined;
    if (!tx || typeof tx !== "object" || typeof tx.transactionBase64 !== "string") {
      throw new HelmApiError(502, "Helm build-tx response had no Solana transaction.", "NO_TX", body);
    }
    solanaTx = { chain: "solana", ...tx, transactionBase64: tx.transactionBase64 } as HelmSolanaUnsignedTx;
  } else {
    const tx = body.tx as HelmUnsignedTx | undefined;
    if (!tx || typeof tx !== "object" || !tx.to || !tx.data) throw new HelmApiError(502, "Helm build-tx response had no tx.", "NO_TX", body);
    evmTx = { to: tx.to, data: tx.data, value: str(tx.value), chainId: Number(tx.chainId ?? requested), description: tx.description };
  }
  const canSubmit = userCanSubmitFrom(body, solana);
  return {
    tx: evmTx,
    solanaTx,
    approvals: Array.isArray(body.approvals) ? (body.approvals as HelmUnsignedTx[]) : [],
    fee,
    integrator: mapIntegrator(body, fee, body.pricing as Record<string, unknown> | undefined),
    quotedOutNet: str(body.quotedOutNet),
    surplusShareBps: Number(body.surplusShareBps ?? 0),
    surplusShare: mapSurplus(body.surplusShare ?? fee?.surplusShare),
    feeParams: (body.feeParams as Record<string, unknown>) ?? null,
    broadcastable: canSubmit,
    dryRun: appDryRun(body),
    userCanSubmit: canSubmit,
    feeRouterConfigured: body.feeRouterConfigured === true,
    feeWalletConfigured: body.feeWalletConfigured === true,
    feesAttached: body.feesAttached === true,
    note: str(body.note, ""),
    raw: body,
  };
}
