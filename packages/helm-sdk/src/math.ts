/**
 * Disclosed fee/share math, for display only (the server computes the real amounts; use quote.fee).
 * feeAmount = grossOut * feeBps / 10_000; integrator = feeAmount * shareBps / 10_000; treasury = rest.
 * Integer floor division, same rounding direction as the server (integrator rounds down).
 */
export function integratorSplit(input: { grossOut: bigint; feeBps: number; referrerShareBps: number }): { feeAmount: bigint; referrerAmount: bigint; treasuryAmount: bigint } {
  const feeAmount = (input.grossOut * BigInt(input.feeBps)) / 10_000n;
  const referrerAmount = (feeAmount * BigInt(input.referrerShareBps)) / 10_000n;
  return { feeAmount, referrerAmount, treasuryAmount: feeAmount - referrerAmount };
}
