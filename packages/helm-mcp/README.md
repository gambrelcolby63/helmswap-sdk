# @summit-pc/helm-mcp — HelmSwap MCP server

stdio MCP server so AI agents can quote and build **unsigned** HelmSwap transactions. Helm never holds keys, never signs, and never broadcasts. The user's wallet signs.

Default API: **https://helmswap.com**.

## Tools

- `get_quote` — disclosed quote + short-lived quote ticket
- `build_swap` — unsigned EVM calldata or a Solana v0 transaction for the user's wallet

There is **no** execute, sign, or broadcast tool.

## Install (after npm publish)

```bash
npx -y @summit-pc/helm-mcp
```

Claude Desktop / Cursor MCP config:

```json
{
  "mcpServers": {
    "helmswap": {
      "command": "npx",
      "args": ["-y", "@summit-pc/helm-mcp"],
      "env": {
        "HELM_REFERRER": "0xYourPayout"
      }
    }
  }
}
```

`HELM_REFERRER` can also be a Solana wallet if you mostly quote Solana. You can pass `referrer` per tool call instead.

Optional env:

| Variable | Meaning |
| --- | --- |
| `HELM_BASE_URL` | Default `https://helmswap.com` |
| `HELM_REFERRER` / `HELM_PAYOUT` | Keyless 20% of Helm's fee |
| `HELM_API_KEY` | Not useful on the live host today (see below) |

The process **refuses to start** if a `privateKey`, `mnemonic`, `signer`, or similar env var is set.

## Fees and share

- Helm fee: **10 bps** majors, **50 bps** listed, **100 bps** long-tail. pump.fun bonding-curve coins pay the 1% long-tail Helm fee, **plus** pump.fun's own venue fee (~1.25%, not Helm's).
- Keyless referrer share: **20% of Helm's fee**, live and verified on 19 Nov 2026. The user pays the same total fee.
- A 40% API-key share exists in the API but **cannot be issued on the live host today**. Do not rely on it.
- Live chains: Solana, Base, BNB Chain, Ethereum, Robinhood Chain. Arbitrum and Polygon can quote but cannot build.
- Tokenized stocks return an error (HTTP 451). US users can use the swap tools. Predictions and perps are not live and are not exposed.

Helm does not claim the best price. Compare net output before the user signs.

## Develop

```bash
npm test
npm run build
npm start
```

MIT © Summit Private Credit LLC
