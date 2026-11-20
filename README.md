# HelmSwap developer kit

Public TypeScript SDK and MCP server for [HelmSwap](https://helmswap.com), a non-custodial swap terminal operated by Summit Private Credit LLC.

Live since 18 November 2026, 11:57 PM CT, on **Solana, Base, BNB Chain, Ethereum, Robinhood Chain, Ink, HyperEVM, Elysium and Arc**.

| Package | npm (after you publish) | What it does |
| --- | --- | --- |
| `helmswap` | `packages/helm-sdk` | Quote + unsigned swap client |
| `helmswap-mcp` | `packages/helm-mcp` | stdio MCP server (`get_quote`, `build_swap`) |

Neither package holds keys, signs, or broadcasts. The user signs in their own wallet.

## Quickstart

```bash
npm install helmswap
```

```ts
import { Helm } from "helmswap";

const helm = new Helm({ payoutAddress: "0xYourPayout" }); // 20% of Helm's fee
const quote = await helm.quote({ chainId: 8453, tokenIn: "ETH", tokenOut: USDC, amountIn: 10n ** 16n });
const built = await helm.buildTx({ quote, recipient: userWallet });
// built.tx goes to the user's wallet. Helm does not submit it.
```

Solana:

```ts
const quote = await helm.quote({ chain: "solana", tokenIn: "SOL", tokenOut: usdcMint, amountIn: 50_000_000n });
const built = await helm.buildTx({ quote, recipient: userSolanaWallet });
// built.solanaTx.transactionBase64
```

MCP (after publish):

```json
{ "mcpServers": { "helmswap": { "command": "npx", "args": ["-y", "helmswap-mcp"], "env": { "HELM_REFERRER": "0xYourPayout" } } } }
```

## Fees (disclosed)

- **10 bps** majors, **50 bps** listed, **100 bps** long-tail / new tokens (including pump.fun bonding-curve coins).
- pump.fun also charges its own curve fee (~1.25%), paid to the creator and pump.fun, not Helm.
- Keyless integrator / referral share: **20% of Helm's fee**, live and verified on 19 Nov 2026. The user pays the same total.
- Helm does not claim the best price.

## Not in these packages

Perps and prediction markets are not part of this SDK (when they exist they keep a US block). **Spot swaps on this API are available to US users**. Tokenized stocks return HTTP 451. Limit and DCA orders, when enabled on HelmSwap, are used from the site, not these packages.

Arbitrum and Polygon may return quotes; `build-tx` is refused until a fee router is deployed there.

## Develop in this repo

```bash
npm install
npm test
npm run build
```

## License

MIT © Summit Private Credit LLC
