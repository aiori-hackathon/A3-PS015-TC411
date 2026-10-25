/** Median. Even counts use the mean of the two central values, rounded to 0.1 ms. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(raw * 10) / 10;
}

export function lossPercent(sent: number, received: number): number {
  if (sent <= 0) return Number.NaN;
  return ((sent - received) / sent) * 100;
}

export function round1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}
