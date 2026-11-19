/**
 * Quickstart against the live HelmSwap API. Nothing here signs or broadcasts.
 *
 *   npx tsx examples/quickstart.ts
 *
 * Optional: HELM_PAYOUT=0xYourAddress HELM_USER=0xUserAddress
 * Optional Solana: HELM_CHAIN=solana HELM_PAYOUT=<solana wallet> HELM_USER=<solana wallet>
 */
import { Helm, HelmApiError, DEFAULT_BASE_URL } from "../src/index";

const WETH_BASE = "0x4200000000000000000000000000000000000006";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const solana = (process.env.HELM_CHAIN ?? "").toLowerCase() === "solana";
const USER = process.env.HELM_USER ?? (solana ? "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" : "0x000000000000000000000000000000000000dEaD");

const helm = new Helm({
  baseUrl: process.env.HELM_BASE_URL ?? DEFAULT_BASE_URL,
  payoutAddress: process.env.HELM_PAYOUT, // keyless 20% of Helm's fee when set
});

try {
  const quote = solana
    ? await helm.quote({ chain: "solana", tokenIn: "SOL", tokenOut: USDC_SOL, amountIn: 50_000_000n })
    : await helm.quote({ chainId: 8453, tokenIn: WETH_BASE, tokenOut: USDC_BASE, amountIn: 10n ** 16n });
  console.log("chain:", quote.chain, "net out:", quote.netOutAmount);
  console.log(`fee: ${quote.fee.feeBps} bps = ${quote.integrator.feeAmount}; share ${quote.integrator.referrerShareBps / 100}% = ${quote.integrator.referrerAmount}; treasury ${quote.integrator.treasuryAmount}`);

  const built = await helm.buildTx({ quote, recipient: USER });
  console.log("userCanSubmit:", built.userCanSubmit, "dryRun:", built.dryRun);
  if (built.solanaTx) console.log("unsigned Solana tx bytes:", built.solanaTx.transactionBase64?.length);
  else console.log("unsigned EVM tx:", built.tx, "approvals:", built.approvals.length);
} catch (e) {
  if (e instanceof HelmApiError) console.error(`Helm API ${e.status}${e.code ? ` ${e.code}` : ""}: ${e.message}`);
  else throw e;
}
