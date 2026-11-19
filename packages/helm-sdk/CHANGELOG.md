# Changelog

## 0.1.0

- First public release of `@summit-pc/helm`.
- HTTP client for HelmSwap `/api/v1/quote` and `/api/v1/build-tx`.
- Default `baseUrl` is `https://helmswap.com`.
- Live chains: Base, BNB Chain, Ethereum, Robinhood Chain, and Solana.
- Disclosed fee tiers: 10 bps majors, 50 bps listed, 100 bps long-tail (pump.fun curves use the 1% long-tail Helm fee, plus pump.fun's own venue fee).
- Keyless integrator share of 20% of Helm's fee, verified against the live API. The 40% API-key tier is implemented in the API but is not issuable on the live host yet.
- Does not claim best price. Never holds keys, never signs, never broadcasts.
