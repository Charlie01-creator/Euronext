/** Rounds a monetary value to 2 decimal places. Use this after any floating-point arithmetic on
 *  money (percentages, conversions) — never persist or compare an unrounded intermediate value. */
export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
