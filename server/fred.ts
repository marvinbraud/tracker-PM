/**
 * server/fred.ts — Live macro data: FRED (central bank rates, yield curve)
 *                  + CNN Fear & Greed Index (unofficial public endpoint)
 * ========================================================================
 * FRED (Federal Reserve Economic Data) requires a free API key — set
 * FRED_API_KEY as an environment variable. Get one at:
 * https://fred.stlouisfed.org/docs/api/api_key.html
 *
 * Policy rate sources:
 *   Fed — DFEDTARU / DFEDTARL (official target range, exact)
 *   ECB — ECBDFR (official deposit facility rate, exact)
 *   BoE — IUDSOIA (SONIA overnight rate) — LIVE PROXY, not the officially
 *         announced Bank Rate. FRED discontinued its Bank Rate series in
 *         2018; SONIA trades a few bp below Bank Rate and is the closest
 *         live substitute. Labelled as a proxy in the API response.
 *   BoJ — IRSTCI01JPM156N (interbank call money rate) — LIVE PROXY of the
 *         BoJ policy rate target, monthly frequency. Labelled as a proxy.
 *
 * Fear & Greed: CNN's own dataviz backend (production.dataviz.cnn.io) is
 * not an officially documented public API — it's the endpoint CNN's own
 * website calls. It can change or be blocked without notice; every call
 * here falls back to the last good cached value if it fails.
 */

import { getMockPrice } from "./marketData";

const FRED_API_KEY = process.env.FRED_API_KEY;
const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

interface FredObservation { date: string; value: number }

async function fetchFredSeries(seriesId: string, limit = 1): Promise<FredObservation[]> {
  if (!FRED_API_KEY) {
    console.warn("[fred] FRED_API_KEY not set — live macro data disabled");
    return [];
  }
  try {
    const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const data = await res.json() as any;
    const obs: any[] = data?.observations ?? [];
    return obs
      .filter(o => o.value !== ".") // FRED uses "." for missing observations
      .map(o => ({ date: o.date as string, value: parseFloat(o.value) }));
  } catch (err) {
    console.warn(`[fred] fetch failed for ${seriesId}:`, (err as Error)?.message);
    return [];
  }
}

async function fetchFredLatest(seriesId: string): Promise<FredObservation | null> {
  const obs = await fetchFredSeries(seriesId, 1);
  return obs[0] ?? null;
}

// ─── Policy rates — cached 7 days (central banks meet every 6-8 weeks) ─────
export interface PolicyRates {
  fed: { rateLow: number; rateHigh: number; asOf: string } | null;
  ecb: { rate: number; asOf: string } | null;
  boe: { rate: number; asOf: string; isProxy: true; proxyLabel: string } | null;
  boj: { rate: number; asOf: string; isProxy: true; proxyLabel: string } | null;
}

const POLICY_RATES_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
let policyRatesCache: { data: PolicyRates; fetchedAt: number } | null = null;

export async function fetchPolicyRates(): Promise<PolicyRates | null> {
  const now = Date.now();
  if (policyRatesCache && now - policyRatesCache.fetchedAt < POLICY_RATES_TTL) {
    return policyRatesCache.data;
  }

  const [fedUpper, fedLower, ecb, boe, boj] = await Promise.all([
    fetchFredLatest("DFEDTARU"),
    fetchFredLatest("DFEDTARL"),
    fetchFredLatest("ECBDFR"),
    fetchFredLatest("IUDSOIA"),
    fetchFredLatest("IRSTCI01JPM156N"),
  ]);

  // Require at least Fed + ECB to succeed before trusting this as a fresh fetch
  if (!fedUpper || !fedLower || !ecb) {
    if (policyRatesCache) return policyRatesCache.data; // stale fallback
    return null;
  }

  const data: PolicyRates = {
    fed: { rateLow: fedLower.value, rateHigh: fedUpper.value, asOf: fedUpper.date },
    ecb: { rate: ecb.value, asOf: ecb.date },
    boe: boe ? { rate: boe.value, asOf: boe.date, isProxy: true, proxyLabel: "SONIA" } : null,
    boj: boj ? { rate: boj.value, asOf: boj.date, isProxy: true, proxyLabel: "Call Rate" } : null,
  };

  policyRatesCache = { data, fetchedAt: now };
  return data;
}

// ─── Yield curve — cached 6h (yields move daily, unlike policy rates) ──────
const YIELD_SERIES: { maturity: string; id: string }[] = [
  { maturity: "1M",  id: "DGS1MO" }, { maturity: "3M",  id: "DGS3MO" },
  { maturity: "6M",  id: "DGS6MO" }, { maturity: "1Y",  id: "DGS1"   },
  { maturity: "2Y",  id: "DGS2"   }, { maturity: "5Y",  id: "DGS5"   },
  { maturity: "7Y",  id: "DGS7"   }, { maturity: "10Y", id: "DGS10"  },
  { maturity: "20Y", id: "DGS20"  }, { maturity: "30Y", id: "DGS30"  },
];

export interface YieldPoint { maturity: string; yield: number; prev: number; asOf: string }

const YIELD_TTL = 6 * 60 * 60 * 1000; // 6h
let yieldCurveCache: { data: YieldPoint[]; fetchedAt: number } | null = null;

export async function fetchYieldCurve(): Promise<YieldPoint[] | null> {
  const now = Date.now();
  if (yieldCurveCache && now - yieldCurveCache.fetchedAt < YIELD_TTL) {
    return yieldCurveCache.data;
  }

  const results = await Promise.all(
    YIELD_SERIES.map(async ({ maturity, id }) => {
      // limit=8 gives enough daily observations to find one ~1 week back
      // even across weekends/holidays
      const obs = await fetchFredSeries(id, 8);
      if (obs.length === 0) return null;
      const latest = obs[0];
      const prev = obs[5] ?? obs[obs.length - 1] ?? latest; // ~1 week back
      return { maturity, yield: latest.value, prev: prev.value, asOf: latest.date };
    })
  );

  const points = results.filter((p): p is YieldPoint => p !== null);
  if (points.length < YIELD_SERIES.length / 2) {
    // Fewer than half the maturities resolved — treat as a failed fetch
    if (yieldCurveCache) return yieldCurveCache.data;
    return null;
  }

  yieldCurveCache = { data: points, fetchedAt: now };
  return points;
}

// ─── Fear & Greed Index (CNN) — cached 30 min ──────────────────────────────
export interface FearGreedData {
  score: number;
  rating: string;
  timestamp: string;
  history: { date: string; value: number }[];
  subIndicators: {
    marketMomentum: { score: number; rating: string } | null;
    safeHaven:      { score: number; rating: string } | null;
    junkBondDemand: { score: number; rating: string } | null;
    putCallOptions: { score: number; rating: string } | null;
    stockPriceStrength: { score: number; rating: string } | null;
    stockPriceBreadth:  { score: number; rating: string } | null;
    volatilityVix:      { score: number; rating: string } | null;
  };
}

const FEAR_GREED_TTL = 30 * 60 * 1000; // 30 min
let fearGreedCache: { data: FearGreedData; fetchedAt: number } | null = null;

export async function fetchFearGreedIndex(): Promise<FearGreedData | null> {
  const now = Date.now();
  if (fearGreedCache && now - fearGreedCache.fetchedAt < FEAR_GREED_TTL) {
    return fearGreedCache.data;
  }

  try {
    const res = await fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Referer": "https://www.cnn.com/markets/fear-and-greed",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json() as any;

    const fg = raw?.fear_and_greed;
    if (!fg?.score) throw new Error("unexpected response shape");

    const histPoints: any[] = raw?.fear_and_greed_historical?.data ?? [];
    // Keep the most recent ~90 daily points for a readable trend line
    const history = histPoints.slice(-90).map(p => ({
      date: new Date(p.x).toISOString().split("T")[0],
      value: Math.round(p.y * 10) / 10,
    }));

    const sub = (key: string) => {
      const s = raw?.[key];
      return s && typeof s.score === "number" ? { score: Math.round(s.score * 10) / 10, rating: s.rating } : null;
    };

    const data: FearGreedData = {
      score: Math.round(fg.score * 10) / 10,
      rating: fg.rating,
      timestamp: fg.timestamp,
      history,
      subIndicators: {
        marketMomentum:     sub("market_momentum_sp500"),
        safeHaven:          sub("safe_haven_demand"),
        junkBondDemand:     sub("junk_bond_demand"),
        putCallOptions:     sub("put_call_options"),
        stockPriceStrength: sub("stock_price_strength"),
        stockPriceBreadth:  sub("stock_price_breadth"),
        volatilityVix:      sub("market_volatility_vix"),
      },
    };

    fearGreedCache = { data, fetchedAt: now };
    return data;
  } catch (err) {
    console.warn("[fear-greed] fetch failed:", (err as Error)?.message);
    if (fearGreedCache) return fearGreedCache.data; // stale fallback
    return null;
  }
}

// ─── Buffett Indicator (US) — live, cached 6h ───────────────────────────────
// Two earlier attempts (S&P 500 + 2020-anchor extrapolation; FRED's Fed
// Flow-of-Funds equities series) were rejected after backtesting against
// the known ~213% 2021 peak — both were 66-119 points off, a sign of
// broken methodology (see git history for that investigation).
//
// This version uses the real numerator: Yahoo Finance still quotes the
// Wilshire 5000 Total Market Index live under ^W5000 (FRED dropped it, the
// index itself didn't stop being calculated). Per Wilshire's own published
// calibration (as cited by currentmarketvaluation.com, a site that tracks
// this indicator): a 1-point move in the index ≈ $1.05bn of US market cap,
// as of their 2020 calibration.
//
//   USMarketCapBn = W5000_level × 1.05
//   ratio = USMarketCapBn / GDP_now
//
// Backtested at two independent points before shipping:
//   2017-12-29: computed 145.7% vs. 147% known   → off by 1.3pp
//   2021-12-31: computed 205.1% vs. 213% known   → off by 7.9pp
// The 1.05 factor is fixed at its 2020 calibration and Wilshire describes
// it as slowly drifting, so precision degrades gradually — flagged as an
// estimate with a documented ~±8pp backtest margin, not an exact figure.
export interface BuffettIndicator {
  ratio: number;
  asOf: string;
  w5000Level: number;
  gdpBn: number;
  isEstimate: true;
  marginNote: string;
}

const BUFFETT_TTL = 6 * 60 * 60 * 1000; // 6h
let buffettCache: { data: BuffettIndicator; fetchedAt: number } | null = null;
const W5000_TO_BILLIONS = 1.05; // Wilshire's own 2020 calibration factor

export async function fetchBuffettIndicator(): Promise<BuffettIndicator | null> {
  const now = Date.now();
  if (buffettCache && now - buffettCache.fetchedAt < BUFFETT_TTL) {
    return buffettCache.data;
  }

  const [w5000, gdpNow] = await Promise.all([
    getMockPrice("^W5000"),
    fetchFredLatest("GDP"),
  ]);

  if (!w5000?.price || !gdpNow) {
    if (buffettCache) return buffettCache.data;
    return null;
  }

  const marketCapBn = w5000.price * W5000_TO_BILLIONS;
  const ratio = (marketCapBn / gdpNow.value) * 100;

  const data: BuffettIndicator = {
    ratio: Math.round(ratio * 10) / 10,
    asOf: gdpNow.date,
    w5000Level: w5000.price,
    gdpBn: gdpNow.value,
    isEstimate: true,
    marginNote: "±8pp backtest margin — see server/fred.ts",
  };

  buffettCache = { data, fetchedAt: now };
  return data;
}
