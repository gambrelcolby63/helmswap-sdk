# @summit-pc/helm — HelmSwap integrator SDK

Add HelmSwap quotes and **unsigned** swap transactions to your app. Your user always signs in their own wallet. Helm never holds keys, never signs, and never broadcasts.

Default host: **https://helmswap.com** (live since 18 Nov 2026, 11:57 PM CT).

## 5-minute quickstart

```bash
npm install @summit-pc/helm
```

```ts
import { Helm } from "@summit-pc/helm";

const helm = new Helm({
  // baseUrl defaults to https://helmswap.com
  payoutAddress: "0xYourPayout", // or a Solana wallet for Solana swaps
});

const quote = await helm.quote({
  chainId: 8453, // Base. Or 56, 1, 4663, or { chain: "solana", tokenIn: "SOL", ... }
  tokenIn: "ETH",
  tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
  amountIn: 10n ** 16n, // 0.01 ETH
});

console.log(`fee ${quote.fee.feeBps} bps; your 20% share = ${quote.integrator.referrerAmount}`);

const built = await helm.buildTx({ quote, recipient: userWallet });
// EVM: built.tx = { to, data, value, chainId } — hand this to the user's wallet.
// Solana: built.solanaTx.transactionBase64 — hand this to the user's wallet.
// Helm does not submit it. If built.userCanSubmit is true, the user can.
```

See `examples/quickstart.ts` for a runnable version (`npx tsx examples/quickstart.ts`).

## What this SDK will never do

- Accept, store or log a private key or seed phrase. The constructor refuses `privateKey`, `mnemonic`, `signer`, `wallet`, `account` and anything that looks like a 32-byte key.
- Sign, send or broadcast. There is no `signAndSend`. You get unsigned calldata or a Solana v0 transaction and hand it to the user's wallet.
- Let you set the surplus share or `quotedOutNet`. The server reads them from the signed quote ticket.

## Live chains

| chain | Status |
| --- | --- |
| Base (`8453`) | Live. Fee router `0x2384EFffE80523aAe945d996257810282D4E25eB` |
| BNB Chain (`56`) | Live. Same fee router address |
| Ethereum (`1`) | Live. Same fee router address |
| Robinhood Chain (`4663`) | Live. Same fee router address |
| Solana (`chain: "solana"`) | Live. Fee wallet `A53weMtWcL4Y1tNPj8778HaiwacpzQPU9P8A3HTP7j3G`. Routes: Orca Whirlpools, PumpSwap, pump.fun bonding curves |
| Arbitrum (`42161`) and Polygon (`137`) | Quotes may return; **build-tx is refused** until a fee router is deployed. Not live. |

Native assets: pass `ETH`, `BNB`, `POL` or `SOL` (or the usual wrapped-native mint / `0xEeee…` sentinel).

## Fees (disclosed)

The user-facing Helm fee, taken in the same transaction the user signs:

| Tier | Fee | Examples |
| --- | --- | --- |
| Majors | 10 bps (0.10%) | ETH, WETH, SOL, USDC, USDT, and other majors listed in the API |
| Listed | 50 bps (0.50%) | Other curated tokens |
| Long-tail / new tokens | 100 bps (1.00%) | Unlisted tokens, including **pump.fun bonding-curve** coins |

A pair pays the higher of its two tokens' tiers. On a pump.fun curve, Helm's 1% is **separate** from pump.fun's own curve fee (currently about 1.25%, already inside the price, paid to the coin's creator and pump.fun). That venue fee is disclosed on the quote as `venueFees` and is not Helm's.

Helm does **not** claim the best price. Quotes show net output after the disclosed Helm fee. On major pairs, a direct DEX or another aggregator often quotes a better net. Compare before the user signs. The fee is never hidden in the price.

Positive slippage (surplus) may be split 50/50 on EVM fee-router swaps (operator cap 50%). It is **off** on Solana: the user keeps any extra. Limit / DCA / perps / predictions are **not live** and are not part of this SDK.

## Integrator share (20% live; 40% not issuable yet)

The user pays the same Helm fee with or without you. Your share comes out of that fee.

- **Keyless, live today:** pass `payoutAddress` (EVM or Solana). You receive **20%** of Helm's fee, encoded in the unsigned transaction (`referrerShareBps = 2000`). Verified on 19 Nov 2026 against production `/api/v1/quote` and `/api/v1/build-tx` on Base and Solana. Asking for more than 20% without a key returns HTTP 400.
- **40% API-key tier:** the API implements a 40% default (cap 50%) for a registered `x-api-key`. **This is not issuable on the live host today.** Keys are stored in a local JSON file, and production has no persistent key store, so a key returns HTTP 401. Do not advertise or rely on the 40% share until the operator can issue keys in production.

Worked example, keyless 20%, a $10,000 majors swap at 10 bps:

- Fee: $10,000 × 0.10% = **$10**
- Your 20%: **$2**
- Treasury: **$8**

`integratorSplit({ grossOut, feeBps, referrerShareBps })` reproduces the integer math for display (your share rounds down). Always show the server's numbers from `quote.fee` / `quote.integrator`.

On Solana, the 20% is a second transfer in the same unsigned transaction. If the referrer has no token account for an SPL fee mint (or no SOL account and the share is below rent-exempt), the quote sets `integrator.paid = false` and the whole fee goes to Helm on that trade — disclosed, never created at the user's expense.

## `dryRun`, `broadcastable`, and `userCanSubmit`

The live v1 API currently returns top-level `dryRun: true` and `broadcastable: false` on every response. That only means **Helm never broadcasts**. Check:

- `quote.dryRun` / `built.dryRun` — this client maps `config.dryRun` when present (false on the live host)
- `built.userCanSubmit` — true when the fee router (EVM) or fee wallet (Solana) is configured and the app is not in dry-run
- `built.tx` (EVM) or `built.solanaTx` (Solana) — unsigned; the user's wallet submits it

## Errors

All server errors throw `HelmApiError` with `status`, `code`, `body`, and helpers:

- `isTokenizedEquityBlocked` — **451** `TOKENIZED_EQUITY_BLOCKED`: a tokenized stock is on one side. Not available; do not retry.
- `isUnauthorized` — **401**: unknown or disabled `x-api-key`. Omit the key and use the keyless 20% tier.
- `isQuoteStale` — **409**: ticket expired or the net moved > 30 bps. Quote again.
- `isRateLimited` — **429**.
- 400 for invalid input (including asking for > 20% without a key).
- 503 on Arbitrum or Polygon build-tx until a fee router is deployed there.

Input problems caught before any request (bad address, unsupported chain, missing ticket, key-like strings) throw `HelmInputError`. **US users can use the swap terminal.** Predictions and perps (not live, not in this SDK) have a US block; that does not apply here.

## Develop

```bash
npm test        # vitest, mock HTTP server, no network
npm run typecheck
npm run build
```

MIT © Summit Private Credit LLC
