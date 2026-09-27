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

// ─── Buffett Indicator (US) — investigated, NOT implemented live ───────────
// Two methodologies were tried and both rejected after verification against
// the known ~213% 2021 peak (this app's own historical data point):
//
//   1. Anchor on the last free market-cap/GDP print (World Bank via FRED,
//      stopped updating in 2020 = 194.9%), projected forward with live S&P
//      500 (as a market-cap proxy) and live GDP. Result for today: ~313% —
//      doesn't hold up; 6 years of buybacks/IPOs aren't captured by price
//      alone.
//   2. FRED's Fed Flow-of-Funds series BOGZ1LM883164105Q ("All Domestic
//      Sectors; Corporate Equities; Liability, Market Value") as a direct
//      Wilshire 5000 substitute. Backtested against 2021: gives 279% vs.
//      the documented 213% — systematically ~30% too high, likely because
//      it includes private/closely-held equity, not just public-market cap.
//
// Both produce numbers with no historical precedent in either direction —
// a strong signal of a broken methodology, not a genuine reading. Rather
// than ship a confidently-wrong number, the Buffett Indicator stays static
// (see MacroPage.tsx). Revisit only with a numerator that's a clean match
// for "public US market cap" (e.g. a paid data vendor).
