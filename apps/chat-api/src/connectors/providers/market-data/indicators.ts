/**
 * Deterministic technical indicators (plan §8 Phase D: "technical indicator
 * calculation using deterministic code" - never estimated by the model).
 * Each returns null when there isn't enough data rather than a guess.
 */

const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const window = values.slice(-period);
  return round(window.reduce((a, b) => a + b, 0) / period);
}

export function ema(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values (standard convention).
  let current = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) current = values[i] * k + current * (1 - k);
  return round(current);
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return round(100 - 100 / (1 + avgGain / avgLoss), 2);
}

/** Annualized volatility of simple daily returns (252 trading days). */
export function annualizedVolatility(values: number[]): number | null {
  if (values.length < 3) return null;
  const returns = values.slice(1).map((v, i) => v / values[i] - 1);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  return round(Math.sqrt(variance) * Math.sqrt(252) * 100, 2);
}

export function periodReturn(values: number[]): number | null {
  if (values.length < 2 || values[0] === 0) return null;
  return round((values[values.length - 1] / values[0] - 1) * 100, 2);
}

/** Herfindahl-Hirschman index of portfolio weights (0..1); higher = more concentrated. */
export function concentrationIndex(weights: number[]): number {
  return round(weights.reduce((a, w) => a + w * w, 0));
}
