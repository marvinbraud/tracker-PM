/**
 * Portfolio Risk & Performance Calculations
 * ==========================================
 * 
 * All formulas are standard portfolio management:
 * - Sharpe = (Rp - Rf) / σp
 * - Sortino = (Rp - Rf) / σd  (downside deviation only)
 * - Max Drawdown = max peak-to-trough decline
 * - Beta = Cov(Rp, Rb) / Var(Rb)
 * - VaR (Historical 95%) = 5th percentile of daily P&L
 * - Expected Shortfall (CVaR) = mean of returns below VaR
 * - Calmar = Annualized Return / |Max Drawdown|
 * - Tracking Error = std dev of (Rp - Rb)
 * - Information Ratio = (Rp - Rb) / TE
 * 
 * TO ADD NEW INDICATORS:
 *   1. Add calculation function here
 *   2. Add to computeMetrics() return object
 *   3. Add to RiskMetrics interface in schema.ts
 *   4. Display in Risk Analytics panel in the frontend
 */

export interface PeriodReturns {
  portfolio: number[];   // daily returns of portfolio
  benchmark: number[];   // daily returns of benchmark (aligned)
}

const RISK_FREE_RATE = 0.04; // 4% annual, adjust as needed
const TRADING_DAYS = 252;

/** Annualized return from array of daily returns */
export function annualizedReturn(dailyReturns: number[]): number {
  if (dailyReturns.length === 0) return 0;
  const cumProduct = dailyReturns.reduce((acc, r) => acc * (1 + r), 1);
  const years = dailyReturns.length / TRADING_DAYS;
  return Math.pow(cumProduct, 1 / years) - 1;
}

/** Annualized volatility from daily returns */
export function annualizedVolatility(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0) / (dailyReturns.length - 1);
  return Math.sqrt(variance * TRADING_DAYS);
}

/** Sharpe Ratio */
export function sharpeRatio(dailyReturns: number[]): number {
  const ret = annualizedReturn(dailyReturns);
  const vol = annualizedVolatility(dailyReturns);
  if (vol === 0) return 0;
  return (ret - RISK_FREE_RATE) / vol;
}

/** Sortino Ratio (uses downside deviation) */
export function sortinoRatio(dailyReturns: number[]): number {
  const ret = annualizedReturn(dailyReturns);
  const dailyRf = RISK_FREE_RATE / TRADING_DAYS;
  const downsideReturns = dailyReturns.filter(r => r < dailyRf);
  if (downsideReturns.length === 0) return ret > 0 ? Infinity : 0;
  // Denominator uses all observations (standard Sortino) — not just downside count
  const downsideVariance = downsideReturns.reduce((acc, r) => acc + Math.pow(r - dailyRf, 2), 0) / dailyReturns.length;
  const downsideDev = Math.sqrt(downsideVariance * TRADING_DAYS);
  if (downsideDev === 0) return 0;
  return (ret - RISK_FREE_RATE) / downsideDev;
}

/** Maximum Drawdown — peak to trough decline */
export function maxDrawdown(cumulativeValues: number[]): number {
  let peak = cumulativeValues[0];
  let maxDD = 0;
  for (const val of cumulativeValues) {
    if (val > peak) peak = val;
    const dd = (val - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD; // negative value, e.g. -0.15 = -15%
}

/** Beta vs benchmark */
export function beta(portfolioReturns: number[], benchmarkReturns: number[]): number {
  const n = Math.min(portfolioReturns.length, benchmarkReturns.length);
  if (n < 2) return 1;
  const pSlice = portfolioReturns.slice(-n);
  const bSlice = benchmarkReturns.slice(-n);
  const pMean = pSlice.reduce((a, b) => a + b, 0) / n;
  const bMean = bSlice.reduce((a, b) => a + b, 0) / n;
  let cov = 0, bVar = 0;
  for (let i = 0; i < n; i++) {
    cov += (pSlice[i] - pMean) * (bSlice[i] - bMean);
    bVar += Math.pow(bSlice[i] - bMean, 2);
  }
  if (bVar === 0) return 1;
  return cov / bVar;
}

/** Tracking Error */
export function trackingError(portfolioReturns: number[], benchmarkReturns: number[]): number {
  const n = Math.min(portfolioReturns.length, benchmarkReturns.length);
  if (n < 2) return 0;
  const diffs = portfolioReturns.slice(-n).map((r, i) => r - benchmarkReturns.slice(-n)[i]);
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((acc, d) => acc + Math.pow(d - mean, 2), 0) / (diffs.length - 1);
  return Math.sqrt(variance * TRADING_DAYS);
}

/** Information Ratio */
export function informationRatio(portfolioReturns: number[], benchmarkReturns: number[]): number {
  const te = trackingError(portfolioReturns, benchmarkReturns);
  if (te === 0) return 0;
  const pRet = annualizedReturn(portfolioReturns);
  const bRet = annualizedReturn(benchmarkReturns);
  return (pRet - bRet) / te;
}

/** Calmar Ratio = Annualized Return / |Max Drawdown| */
export function calmarRatio(dailyReturns: number[], cumulativeValues: number[]): number {
  const ret = annualizedReturn(dailyReturns);
  const md = Math.abs(maxDrawdown(cumulativeValues));
  if (md === 0) return 0;
  return ret / md;
}

/** Historical VaR at given confidence level (default 95%) */
export function historicalVaR(dailyReturns: number[], portfolioValue: number, confidence = 0.95): number {
  if (dailyReturns.length === 0) return 0;
  const sorted = [...dailyReturns].sort((a, b) => a - b);
  const idx = Math.floor((1 - confidence) * sorted.length);
  return sorted[idx] * portfolioValue; // negative = loss
}

/** Expected Shortfall (CVaR) — mean of returns below VaR */
export function expectedShortfall(dailyReturns: number[], portfolioValue: number, confidence = 0.95): number {
  if (dailyReturns.length === 0) return 0;
  const sorted = [...dailyReturns].sort((a, b) => a - b);
  const cutoff = Math.floor((1 - confidence) * sorted.length);
  const tail = sorted.slice(0, cutoff + 1);
  if (tail.length === 0) return 0;
  const meanTail = tail.reduce((a, b) => a + b, 0) / tail.length;
  return meanTail * portfolioValue;
}

/** Compute daily returns from a value series */
export function dailyReturnsFromValues(values: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) {
      returns.push((values[i] - values[i - 1]) / values[i - 1]);
    }
  }
  return returns;
}

/** Correlation matrix between position return series */
export function correlationMatrix(returnSeries: number[][]): number[][] {
  const n = returnSeries.length;
  const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) { matrix[i][j] = 1; continue; }
      const series1 = returnSeries[i];
      const series2 = returnSeries[j];
      const len = Math.min(series1.length, series2.length);
      if (len < 2) { matrix[i][j] = 0; continue; }
      const s1 = series1.slice(-len);
      const s2 = series2.slice(-len);
      const m1 = s1.reduce((a, b) => a + b, 0) / len;
      const m2 = s2.reduce((a, b) => a + b, 0) / len;
      let cov = 0, std1 = 0, std2 = 0;
      for (let k = 0; k < len; k++) {
        cov += (s1[k] - m1) * (s2[k] - m2);
        std1 += Math.pow(s1[k] - m1, 2);
        std2 += Math.pow(s2[k] - m2, 2);
      }
      const denom = Math.sqrt(std1 * std2);
      matrix[i][j] = denom === 0 ? 0 : cov / denom;
    }
  }
  return matrix;
}

/**
 * Compute skewness of return distribution.
 * Positive = right tail (gains), Negative = left tail (losses)
 */
export function skewness(returns: number[]): number {
  const n = returns.length;
  if (n < 3) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(returns.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0) / n);
  if (std === 0) return 0;
  return returns.reduce((acc, r) => acc + Math.pow((r - mean) / std, 3), 0) / n;
}

/**
 * Excess kurtosis (normal = 0). High kurtosis = fat tails = more extreme events.
 */
export function excessKurtosis(returns: number[]): number {
  const n = returns.length;
  if (n < 4) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(returns.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0) / n);
  if (std === 0) return 0;
  return returns.reduce((acc, r) => acc + Math.pow((r - mean) / std, 4), 0) / n - 3;
}
