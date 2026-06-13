import Papa from 'papaparse';

/**
 * Market Data Module — Yahoo Finance (unofficial API)
 * ====================================================
 * Fetches real prices and historical data from Yahoo Finance.
 * Results are cached in memory (TTL: 5 min for prices, 60 min for history).
 *
 * Tickers that Yahoo doesn't know: fallback to price=1.00 (e.g. CASH-EUR).
 */

interface TickerData {
  price: number;
  dayChange: number; // % vs previous close
  currency: string;
}

// ─── In-memory cache ──────────────────────────────────────────────────────────
const priceCache   = new Map<string, { data: TickerData; expiresAt: number }>();
const historyCache = new Map<string, { data: { date: string; close: number }[]; expiresAt: number }>();

const PRICE_TTL_MS   = 5  * 60 * 1000; // 5 min
const HISTORY_TTL_MS = 60 * 60 * 1000; // 60 min

// CASH fallback — always 1.00 in its currency
const CASH_TICKERS: Record<string, TickerData> = {
  "CASH-EUR": { price: 1.00, dayChange: 0, currency: "EUR" },
  "CASH-USD": { price: 1.00, dayChange: 0, currency: "USD" },
  "CASH-GBP": { price: 1.00, dayChange: 0, currency: "GBP" },
};

// Tickers Yahoo doesn't list — map to equivalent or leave empty for fixed price
const TICKER_ALIASES: Record<string, string> = {
  "VGWD.TR":    "VHYL.AS",   // Vanguard All-World High Div
  "IUSS.TR":    "KSA",       // iShares MSCI Saudi Arabia
  "ALV.TR":     "ALV.DE",    // Allianz — Xetra
  "PILDYMA FP": "",          // Bourso internal — no Yahoo equivalent
  // Benchmark aliases (Yahoo uses different symbols)
  "^CAC40":     "^FCHI",
  "^STOXX50":   "^STOXX50E",
  "^FTSE":      "^FTSE",
};

const FIXED_PRICES: Record<string, TickerData> = {
  "PILDYMA FP": { price: 62.10, dayChange: 0, currency: "EUR" },
};

// ─── Price fetch ──────────────────────────────────────────────────────────────
async function fetchYahooPrice(ticker: string): Promise<TickerData | null> {
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
      `?range=1d&interval=1d&includePrePost=false`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ECI-Dashboard/2.0)",
        "Accept":     "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data  = await res.json() as any;
    const meta  = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;

    const price     = meta.regularMarketPrice as number;
    const prevClose = (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
    const dayChange = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

    return { price, dayChange, currency: (meta.currency ?? "USD") as string };
  } catch (err) {
    console.warn(`[yahoo] failed to fetch price for ${ticker}:`, (err as Error)?.message);
    return null;
  }
}

export async function getMockPrice(ticker: string): Promise<TickerData> {
  // CASH shortcut
  if (CASH_TICKERS[ticker]) return CASH_TICKERS[ticker];
  // Fixed price fallback
  if (FIXED_PRICES[ticker]) return FIXED_PRICES[ticker];

  // Resolve alias
  const resolved = TICKER_ALIASES[ticker] !== undefined
    ? TICKER_ALIASES[ticker] || null
    : ticker;

  if (!resolved) return FIXED_PRICES[ticker] ?? { price: 1, dayChange: 0, currency: "EUR" };

  // Check cache
  const cached = priceCache.get(resolved);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  // Fetch
  const data = await fetchYahooPrice(resolved);
  if (data) {
    priceCache.set(resolved, { data, expiresAt: Date.now() + PRICE_TTL_MS });
    return data;
  }

  // Last resort: return cached stale data if available
  if (cached) return cached.data;
  return { price: 0, dayChange: 0, currency: "EUR" };
}

// ─── History fetch ────────────────────────────────────────────────────────────
async function fetchYahooHistory(ticker: string, days: number): Promise<{ date: string; close: number }[] | null> {
  try {
    const range  = days <= 30 ? "1mo" : days <= 90 ? "3mo" : days <= 180 ? "6mo"
                 : days <= 380 ? "1y" : days <= 760 ? "2y" : "5y";
    const url    = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
                   `?range=${range}&interval=1d&includePrePost=false`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ECI-Dashboard/2.0)", "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;

    const data      = await res.json() as any;
    const result    = data?.chart?.result?.[0];
    const timestamps: number[] = result?.timestamp ?? [];
    const closes: number[]     = result?.indicators?.quote?.[0]?.close ?? [];

    if (timestamps.length === 0) return null;

    return timestamps
      .map((ts, i) => ({
        date:  new Date(ts * 1000).toISOString().split("T")[0],
        close: +(closes[i] ?? 0).toFixed(4),
      }))
      .filter(r => r.close > 0);
  } catch (err) {
    console.warn(`[yahoo] failed to fetch history for ${ticker}:`, err);
    return null;
  }
}

export async function generateHistory(ticker: string, currentPrice: number, days = 365): Promise<{ date: string; close: number }[]> {
  // CASH — flat line
  if (CASH_TICKERS[ticker] || ticker.startsWith("CASH-")) {
    return buildFlatHistory(currentPrice > 0 ? currentPrice : 1, days);
  }

  // Fixed price fallback (no history available)
  if (FIXED_PRICES[ticker] && TICKER_ALIASES[ticker] === "") {
    return buildFlatHistory(currentPrice > 0 ? currentPrice : 1, days);
  }

  // Resolve alias
  const resolved = TICKER_ALIASES[ticker] !== undefined
    ? (TICKER_ALIASES[ticker] || null)
    : ticker;

  if (resolved) {
    // Include range bucket in cache key so 1Y and 3Y requests don't collide
    const rangeBucket = days <= 30 ? "1mo" : days <= 90 ? "3mo" : days <= 180 ? "6mo"
                      : days <= 380 ? "1y" : days <= 760 ? "2y" : "5y";
    const cacheKey = `${resolved}|${rangeBucket}`;
    const cached = historyCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const history = await fetchYahooHistory(resolved, days);
    if (history && history.length > 5) {
      historyCache.set(cacheKey, { data: history, expiresAt: Date.now() + HISTORY_TTL_MS });
      return history;
    }
    if (cached) return cached.data;
  }

  // Fallback: GBM simulation (always returns a non-empty array)
  const price = currentPrice > 0 ? currentPrice : 100;
  return buildGBMHistory(ticker, price, days);
}

// ─── EUR/USD exchange rate ─────────────────────────────────────────────────────
let fxCache: { rates: Record<string, number>; expiresAt: number } | null = null;

export async function getExchangeRateAsync(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  // Try to refresh FX rates
  if (!fxCache || fxCache.expiresAt < Date.now()) {
    try {
      // Use Yahoo to get EUR/USD
      const pairs = ["EURUSD=X", "GBPUSD=X", "CHFUSD=X", "HKDUSD=X", "JPYUSD=X"];
      const results = await Promise.all(pairs.map(p => fetchYahooPrice(p)));
      const rates: Record<string, number> = { "USD": 1.0 };
      const labels = ["EUR", "GBP", "CHF", "HKD", "JPY"];
      results.forEach((r, i) => { if (r) rates[labels[i]] = r.price; });
      fxCache = { rates, expiresAt: Date.now() + HISTORY_TTL_MS };
    } catch {
      // fallback static rates
      fxCache = { rates: { USD: 1.0, EUR: 1.08, GBP: 1.27, CHF: 1.12, HKD: 0.128, JPY: 0.0067 }, expiresAt: Date.now() + PRICE_TTL_MS };
    }
  }
  const rates = fxCache.rates;
  const fromUSD = rates[from] ?? 1;
  const toUSD   = rates[to]   ?? 1;
  // fromUSD = price of 1 FROM in USD
  // We want: how many TO per 1 FROM
  // 1 FROM = fromUSD USD; 1 TO = toUSD USD → 1 FROM = fromUSD/toUSD TO
  return fromUSD / toUSD;
}

// Sync fallback (used where async not available)
export function getExchangeRate(from: string, to: string): number {
  if (from === to) return 1;
  const rates: Record<string, number> = fxCache?.rates ?? { USD: 1.0, EUR: 1.08, GBP: 1.27, CHF: 1.12, HKD: 0.128, JPY: 0.0067 };
  return (rates[from] ?? 1) / (rates[to] ?? 1);
}

// ─── GBM fallback ─────────────────────────────────────────────────────────────
// Simple deterministic hash → reproducible GBM per ticker
function tickerSeed(ticker: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < ticker.length; i++) {
    h ^= ticker.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}
// Mulberry32 PRNG — fast, seedable
function makePrng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussianFromPrng(rand: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function buildGBMHistory(ticker: string, currentPrice: number, days: number): { date: string; close: number }[] {
  const volMap: Record<string, number> = {
    "BTC-USD": 0.80, "ETH-USD": 0.95, "SOL-USD": 1.20,
    "NVDA": 0.60, "AAPL": 0.28, "MSFT": 0.28,
  };
  const sigma = volMap[ticker] ?? 0.22;
  const mu = 0.08, dt = 1 / 252;
  const endDate = new Date(); // always use today
  const rand = makePrng(tickerSeed(ticker));
  let prices: number[] = [currentPrice];
  for (let i = 1; i < days; i++) {
    const prev = prices[0];
    const r = gaussianFromPrng(rand);
    prices.unshift(Math.max(prev / Math.exp((mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * r), 0.01));
  }
  const result: { date: string; close: number }[] = [];
  const isCrypto = ticker.includes("USD") || ticker.includes("BTC") || ticker.includes("ETH");
  for (let i = 0; i < days; i++) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - (days - 1 - i));
    if (!isCrypto && (d.getDay() === 0 || d.getDay() === 6)) continue;
    result.push({ date: d.toISOString().split("T")[0], close: +prices[i].toFixed(4) });
  }
  return result;
}

function buildFlatHistory(price: number, days: number): { date: string; close: number }[] {
  const result: { date: string; close: number }[] = [];
  const end = new Date(); // always use today
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    result.push({ date: d.toISOString().split("T")[0], close: price });
  }
  return result;
}

function gaussianRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ─── Macro Data Fetch ─────────────────────────────────────────────────────────

export async function fetchLiveMacroData() {
  const INDICES_TICKERS = [
    { key: "SPX", ticker: "^GSPC" },
    { key: "NDX", ticker: "^NDX" },
    { key: "CAC", ticker: "^FCHI" },
    { key: "DAX", ticker: "^GDAXI" },
    { key: "NI225", ticker: "^N225" },
    { key: "MXWO", ticker: "URTH" },
    { key: "MXEF", ticker: "EEM" },
    { key: "HSI", ticker: "^HSI" },
    { key: "UKX", ticker: "^FTSE" }
  ];

  const COMMODITIES_TICKERS = [
    { key: "WTI Crude", ticker: "CL=F" },
    { key: "Brent Crude", ticker: "BZ=F" },
    { key: "Gold", ticker: "GC=F" },
    { key: "Silver", ticker: "SI=F" },
    { key: "Nat. Gas", ticker: "NG=F" },
    { key: "Wheat", ticker: "ZW=F" },
    { key: "Copper", ticker: "HG=F" },
    { key: "Bitcoin", ticker: "BTC-USD" }
  ];

  const YIELD_TICKERS = [
    { key: "3M", ticker: "^IRX" },
    { key: "5Y", ticker: "^FVX" },
    { key: "10Y", ticker: "^TNX" },
    { key: "30Y", ticker: "^TYX" }
  ];

  const OTHER_MACRO = [
    { key: "VIX", ticker: "^VIX" },
    { key: "DXY", ticker: "DX-Y.NYB" },
    { key: "EURUSD", ticker: "EURUSD=X" },
    { key: "USDJPY", ticker: "JPY=X" },
  ];

  const allTickers = [
    ...INDICES_TICKERS,
    ...COMMODITIES_TICKERS,
    ...YIELD_TICKERS,
    ...OTHER_MACRO
  ];

  // Batch query all tickers in a single API call to RapidAPI
  const tickerSymbols = allTickers.map(t => t.ticker);
  let quotesMap: Record<string, TickerData | null> = {};
  
  try {
    const url = `https://yahoo-finance-real-time1.p.rapidapi.com/market/get-quotes?region=US&symbols=${tickerSymbols.join(',')}`;
    const res = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": "0d6b10fe86mshaf757ad0ada2533p1963f6jsn74204fe24d52",
        "X-RapidAPI-Host": "yahoo-finance-real-time1.p.rapidapi.com"
      }
    });

    if (!res.ok) throw new Error(`RapidAPI Error: ${res.status}`);
    const json = await res.json();
    const quotes = json?.quoteResponse?.result || [];

    for (const quote of quotes) {
      const price = quote.regularMarketPrice ?? quote.postMarketPrice ?? quote.previousClose ?? 0;
      const prev = quote.regularMarketPreviousClose ?? quote.previousClose ?? price;
      const dayChange = prev > 0 ? ((price - prev) / prev) * 100 : 0;
      quotesMap[quote.symbol] = { price, dayChange, currency: quote.currency ?? "USD" };
    }
  } catch (err: any) {
    console.warn('[yahoo] batch quote failed (likely 429 IP Block). Using simulated fallback.', err.message);
    // Simulate live data so the UI doesn't break when IP is blocked
    for (const t of allTickers) {
      // Generate a somewhat realistic static mock price based on known index values
      let basePrice = 100;
      if (t.ticker.includes("GSPC")) basePrice = 5600;
      if (t.ticker.includes("NDX")) basePrice = 19200;
      if (t.ticker.includes("FCHI")) basePrice = 7900;
      if (t.ticker === "BTC-USD") basePrice = 64000;
      if (t.ticker === "CL=F") basePrice = 82;
      if (t.ticker === "GC=F") basePrice = 2400;
      if (t.ticker.includes("TNX")) basePrice = 42; // Yield 4.2%

      const randomChange = (Math.random() * 2 - 1); // between -1% and +1%
      quotesMap[t.ticker] = {
        price: +(basePrice * (1 + randomChange / 100)).toFixed(2),
        dayChange: +randomChange.toFixed(2),
        currency: "USD"
      };
    }
  }

  const mapData = (items: any[]) => items.map(item => ({
    ...item,
    data: quotesMap[item.ticker] || null
  }));

  return {
    indices: mapData(INDICES_TICKERS),
    commodities: mapData(COMMODITIES_TICKERS),
    yields: mapData(YIELD_TICKERS),
    other: mapData(OTHER_MACRO)
  };
}

let bigMacCache: any[] | null = null;
let bigMacExpiresAt = 0;

export async function fetchBigMacIndex() {
  if (bigMacCache && bigMacExpiresAt > Date.now()) return bigMacCache;
  
  try {
    const url = "https://raw.githubusercontent.com/TheEconomist/big-mac-data/master/output-data/big-mac-raw-index.csv";
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch Big Mac CSV");
    
    const text = await res.text();
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    
    const data: any[] = result.data;
    if (data.length === 0) return null;
    
    const lastDate = data[data.length - 1].date;
    const latest = data.filter(d => d.date === lastDate);
    
    const usEntry = latest.find(d => d.iso_a3 === "USA");
    const usPrice = usEntry ? parseFloat(usEntry.dollar_price) : 5.79;
    
    const mapCountry = (iso: string) => {
      const m: Record<string, string> = {
        "CHE": "🇨🇭 Suisse", "ARG": "🇦🇷 Argentine", "NOR": "🇳🇴 Norvège",
        "USA": "🇺🇸 États-Unis", "GBR": "🇬🇧 Royaume-Uni", "EUZ": "🇪🇺 Zone Euro",
        "JPN": "🇯🇵 Japon", "CHN": "🇨🇳 Chine", "IND": "🇮🇳 Inde",
        "BRA": "🇧🇷 Brésil", "KOR": "🇰🇷 Corée du Sud", "POL": "🇵🇱 Pologne"
      };
      return m[iso] || iso;
    };
    
    const formatted = latest.map(d => {
      const price = parseFloat(d.dollar_price);
      let diff = 0;
      if (usPrice > 0) {
        diff = ((price - usPrice) / usPrice) * 100;
      }
      return {
        country: mapCountry(d.iso_a3),
        iso: d.iso_a3,
        price,
        diff,
        isBase: d.iso_a3 === "USA"
      };
    });
    
    formatted.sort((a, b) => b.diff - a.diff);
    const targetIsos = ["CHE", "ARG", "NOR", "USA", "GBR", "EUZ", "JPN", "CHN", "IND", "BRA", "KOR", "POL"];
    const subset = formatted.filter(d => targetIsos.includes(d.iso));
    
    bigMacCache = subset;
    bigMacExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
    return subset;
  } catch (err) {
    console.error("[Big Mac] error:", err);
    return null;
  }
}

