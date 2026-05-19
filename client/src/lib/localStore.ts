/**
 * LOCAL STORE — No-API data layer
 * ================================
 * Remplace entièrement le backend Express/PostgreSQL.
 * Toutes les données sont stockées dans localStorage.
 *
 * SOLUTION SANS API :
 *   • Holdings stockés dans localStorage (persistants)
 *   • Import CSV → parse direct dans le navigateur → localStorage
 *   • Google Sheets → fetch direct du CSV publié (sans proxy)
 *   • Tous les calculs de portfolio se font côté client
 *   • Déployable comme site statique (Netlify, Vercel, GitHub Pages)
 *
 * FORMAT CSV (ajouter une colonne currentPrice) :
 *   portfolio,ticker,name,assetClass,sector,geography,
 *   quantity,costPrice,currentPrice,currency,isin
 */

import type {
  PortfolioRoot,
  PortfolioSummary,
  RiskMetrics,
  Position,
} from "@shared/schema";

// ─── Types internes ────────────────────────────────────────────────────────

export interface StoredHolding {
  id: number;
  portfolio: string;
  ticker: string;
  name: string;
  assetClass: string;
  sector: string;
  geography: string;
  quantity: number;
  costPrice: number;
  currentPrice: number;  // market price — set via CSV/GSheets/live refresh
  currency: string;
  isin: string;
  dayChange?: number;       // % day change — set by refreshLivePrices()
  lastLiveUpdate?: string;  // ISO timestamp of last live price fetch
}

export interface InsertHoldingLocal {
  portfolio: string;
  ticker: string;
  name?: string;
  assetClass?: string;
  sector?: string;
  geography?: string;
  quantity: number;
  costPrice: number;
  currentPrice?: number;
  currency?: string;
  isin?: string;
}

interface GSheetSettings {
  url: string | null;
  lastSyncAt: string | null;
}

interface StoreData {
  holdings: StoredHolding[];
  portfolioRoots: PortfolioRoot[];
  gsheetSettings: Record<string, GSheetSettings>;
  nextId: number;
}

const STORE_KEY = "eci_portfolio_store_v2";

// ─── Seed data — affiché au premier lancement ─────────────────────────────

const SEED: StoreData = {
  nextId: 10,
  portfolioRoots: [{ name: "ECI", subAccounts: ["PEA", "CTO", "Crypto"] }],
  gsheetSettings: {},
  holdings: [
    { id: 1, portfolio: "ECI::PEA", ticker: "AIR.PA", name: "Air Liquide", assetClass: "Action", sector: "Industrie", geography: "France", quantity: 10, costPrice: 145, currentPrice: 162, currency: "EUR", isin: "FR0000120073" },
    { id: 2, portfolio: "ECI::PEA", ticker: "MC.PA", name: "LVMH", assetClass: "Action", sector: "Luxe", geography: "France", quantity: 3, costPrice: 680, currentPrice: 710, currency: "EUR", isin: "FR0000121014" },
    { id: 3, portfolio: "ECI::PEA", ticker: "SAN.PA", name: "Sanofi", assetClass: "Action", sector: "Santé", geography: "France", quantity: 12, costPrice: 90, currentPrice: 97, currency: "EUR", isin: "FR0000120578" },
    { id: 4, portfolio: "ECI::CTO", ticker: "MSFT", name: "Microsoft", assetClass: "Action", sector: "Tech", geography: "USA", quantity: 5, costPrice: 340, currentPrice: 415, currency: "USD", isin: "US5949181045" },
    { id: 5, portfolio: "ECI::CTO", ticker: "NVDA", name: "NVIDIA", assetClass: "Action", sector: "Tech", geography: "USA", quantity: 4, costPrice: 480, currentPrice: 870, currency: "USD", isin: "US67066G1040" },
    { id: 6, portfolio: "ECI::CTO", ticker: "CW8.PA", name: "MSCI World ETF", assetClass: "ETF", sector: "Monde", geography: "Global", quantity: 20, costPrice: 390, currentPrice: 435, currency: "EUR", isin: "LU1681043599" },
    { id: 7, portfolio: "ECI::Crypto", ticker: "BTC-USD", name: "Bitcoin", assetClass: "Crypto", sector: "Crypto", geography: "Global", quantity: 0.12, costPrice: 42000, currentPrice: 67000, currency: "USD", isin: "" },
    { id: 8, portfolio: "ECI::Crypto", ticker: "ETH-USD", name: "Ethereum", assetClass: "Crypto", sector: "Crypto", geography: "Global", quantity: 1.5, costPrice: 2200, currentPrice: 3400, currency: "USD", isin: "" },
    { id: 9, portfolio: "ECI::PEA", ticker: "TTE.PA", name: "TotalEnergies", assetClass: "Action", sector: "Énergie", geography: "France", quantity: 15, costPrice: 58, currentPrice: 62, currency: "EUR", isin: "FR0014000MR3" },
  ],
};

// ─── Persistence ──────────────────────────────────────────────────────────

function load(): StoreData {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as StoreData;
  } catch {
    // corrupted data — reset
  }
  const initial = JSON.parse(JSON.stringify(SEED)) as StoreData;
  save(initial);
  return initial;
}

function save(data: StoreData): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

// ─── Portfolio Roots CRUD ─────────────────────────────────────────────────

export function getPortfolioRoots(): PortfolioRoot[] {
  return load().portfolioRoots;
}

export function addPortfolioRoot(name: string): PortfolioRoot {
  const data = load();
  const root: PortfolioRoot = { name, subAccounts: ["PEA", "CTO", "Crypto", "Retraite"] };
  data.portfolioRoots.push(root);
  save(data);
  return root;
}

export function renamePortfolioRoot(oldName: string, newName: string): void {
  const data = load();
  // Rename root
  const root = data.portfolioRoots.find(r => r.name === oldName);
  if (!root) throw new Error(`Portfolio ${oldName} not found`);
  root.name = newName;
  // Rename all holdings
  data.holdings = data.holdings.map(h => ({
    ...h,
    portfolio: h.portfolio === oldName
      ? newName
      : h.portfolio.startsWith(`${oldName}::`)
        ? `${newName}::${h.portfolio.slice(oldName.length + 2)}`
        : h.portfolio,
  }));
  // Rename gsheet settings
  if (data.gsheetSettings[oldName]) {
    data.gsheetSettings[newName] = data.gsheetSettings[oldName];
    delete data.gsheetSettings[oldName];
  }
  save(data);
}

export function deletePortfolioRoot(name: string): void {
  const data = load();
  data.portfolioRoots = data.portfolioRoots.filter(r => r.name !== name);
  data.holdings = data.holdings.filter(
    h => h.portfolio !== name && !h.portfolio.startsWith(`${name}::`)
  );
  delete data.gsheetSettings[name];
  save(data);
}

// ─── Holdings CRUD ────────────────────────────────────────────────────────

export function getHoldings(portfolio: string): StoredHolding[] {
  const data = load();
  if (portfolio === "Global") return data.holdings;
  return data.holdings.filter(
    h => h.portfolio === portfolio || h.portfolio.startsWith(`${portfolio}::`)
  );
}

export function addHolding(h: InsertHoldingLocal): StoredHolding {
  const data = load();
  const holding: StoredHolding = {
    id: data.nextId++,
    portfolio: h.portfolio,
    ticker: h.ticker,
    name: h.name ?? h.ticker,
    assetClass: h.assetClass ?? "Action",
    sector: h.sector ?? "—",
    geography: h.geography ?? "—",
    quantity: h.quantity,
    costPrice: h.costPrice,
    currentPrice: h.currentPrice ?? h.costPrice,
    currency: h.currency ?? "EUR",
    isin: h.isin ?? "",
  };
  data.holdings.push(holding);
  save(data);
  return holding;
}

export function deleteHolding(id: number): void {
  const data = load();
  data.holdings = data.holdings.filter(h => h.id !== id);
  save(data);
}

export function replacePortfolioHoldings(
  portfolio: string,
  holdings: InsertHoldingLocal[]
): number {
  const data = load();
  // Remove existing holdings for this portfolio
  data.holdings = data.holdings.filter(h => h.portfolio !== portfolio);
  // Add new ones
  const now = data.nextId;
  const newHoldings: StoredHolding[] = holdings.map((h, i) => ({
    id: now + i,
    portfolio,
    ticker: h.ticker,
    name: h.name ?? h.ticker,
    assetClass: h.assetClass ?? "Action",
    sector: h.sector ?? "—",
    geography: h.geography ?? "—",
    quantity: h.quantity,
    costPrice: h.costPrice,
    currentPrice: h.currentPrice ?? h.costPrice,
    currency: h.currency ?? "EUR",
    isin: h.isin ?? "",
  }));
  data.nextId = now + newHoldings.length;
  data.holdings.push(...newHoldings);
  save(data);
  return newHoldings.length;
}

export function importHoldings(
  holdings: InsertHoldingLocal[],
  rootPortfolio?: string
): { imported: number; skipped: number } {
  const qualified = holdings.map(h => ({
    ...h,
    portfolio: rootPortfolio
      ? qualifySubAccount(rootPortfolio, h.portfolio)
      : h.portfolio,
  }));

  // Filter invalid
  const valid = qualified.filter(
    h => h.ticker && !isNaN(h.quantity) && h.quantity >= 0
         && !isNaN(h.costPrice) && h.costPrice >= 0
  );
  const skipped = holdings.length - valid.length;

  // Group by portfolio and replace atomically
  const byPortfolio = new Map<string, InsertHoldingLocal[]>();
  for (const h of valid) {
    if (!byPortfolio.has(h.portfolio)) byPortfolio.set(h.portfolio, []);
    byPortfolio.get(h.portfolio)!.push(h);
  }
  let imported = 0;
  for (const [p, pHoldings] of byPortfolio) {
    imported += replacePortfolioHoldings(p, pHoldings);
  }
  return { imported, skipped };
}

// ─── Google Sheets Settings ───────────────────────────────────────────────

export function getAllGSheetSettings(): Record<string, GSheetSettings> {
  return load().gsheetSettings;
}

export function getGSheetSettings(portfolio: string): GSheetSettings {
  const data = load();
  return data.gsheetSettings[portfolio] ?? { url: null, lastSyncAt: null };
}

export function setGSheetUrl(portfolio: string, url: string): void {
  const data = load();
  if (!data.gsheetSettings[portfolio]) {
    data.gsheetSettings[portfolio] = { url: null, lastSyncAt: null };
  }
  data.gsheetSettings[portfolio].url = url;
  save(data);
}

export function setLastSyncAt(portfolio: string, ts: string): void {
  const data = load();
  if (!data.gsheetSettings[portfolio]) {
    data.gsheetSettings[portfolio] = { url: null, lastSyncAt: null };
  }
  data.gsheetSettings[portfolio].lastSyncAt = ts;
  save(data);
}

/** Sync a Google Sheet directly in the browser (published CSV URL) */
export async function syncGSheet(
  portfolio: string
): Promise<{ imported: number; error?: string }> {
  const settings = getGSheetSettings(portfolio);
  if (!settings.url) return { imported: 0, error: "Aucune URL configurée" };

  const url = normalizeGSheetUrl(settings.url);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const csv = await res.text();
    const rows = parseCSV(csv);
    if (rows.length === 0) return { imported: 0, error: "Aucune ligne valide trouvée" };

    const qualified = rows.map(h => ({
      ...h,
      portfolio: qualifySubAccount(portfolio, h.portfolio),
    }));

    const byPortfolio = new Map<string, InsertHoldingLocal[]>();
    for (const h of qualified) {
      if (!byPortfolio.has(h.portfolio)) byPortfolio.set(h.portfolio, []);
      byPortfolio.get(h.portfolio)!.push(h);
    }
    let imported = 0;
    for (const [p, pHoldings] of byPortfolio) {
      imported += replacePortfolioHoldings(p, pHoldings);
    }
    setLastSyncAt(portfolio, new Date().toISOString());
    return { imported };
  } catch (err) {
    return { imported: 0, error: String(err) };
  }
}

/** Sync tous les portfolios qui ont une URL configurée */
export async function syncAllGSheets(): Promise<
  Record<string, { imported: number; error?: string }>
> {
  const settings = getAllGSheetSettings();
  const results: Record<string, { imported: number; error?: string }> = {};
  for (const [portfolio, s] of Object.entries(settings)) {
    if (s.url) {
      results[portfolio] = await syncGSheet(portfolio);
    }
  }
  return results;
}

// ─── Portfolio Summary Computation ───────────────────────────────────────

// Static FX rates (1 CURRENCY → EUR). Updated periodically.
// Live rates are refreshed when positions are saved via /api/quote.
const EUR_RATES: Record<string, number> = {
  EUR: 1,     USD: 0.921,  GBP: 1.172,  CHF: 1.065,  JPY: 0.00620,
  CAD: 0.680, AUD: 0.601,  HKD: 0.118,  SGD: 0.692,  SEK: 0.0872,
  // Asia
  CNY: 0.127, CNH: 0.127,  // Chinese Yuan (mainland / offshore)
  HKD: 0.118, TWD: 0.0284, KRW: 0.000672, SGD: 0.692,
  INR: 0.0110, THB: 0.0253, IDR: 0.0000566, MYR: 0.207,
  // Middle East
  SAR: 0.245, AED: 0.251,  QAR: 0.253,  KWD: 2.99,
  // LatAm
  BRL: 0.165, MXN: 0.0459, ARS: 0.00092, CLP: 0.000972,
  // EMEA
  NOK: 0.0866, DKK: 0.1342, PLN: 0.233,  CZK: 0.0408,
  ZAR: 0.0488, TRY: 0.0258, ILS: 0.254,  EGP: 0.0185,
  // Others
  NZD: 0.556,  RUB: 0.00989,
};

function toEur(amount: number, currency: string): number {
  return amount * (EUR_RATES[currency.toUpperCase()] ?? 1);
}

export function computeSummary(
  portfolio: string,
  period: string,
  benchmark: string
): PortfolioSummary & { portfolioNames: string[] } {
  const holdings = getHoldings(portfolio);
  if (holdings.length === 0) return emptyPortfolio();

  // Build positions
  const positions: Position[] = holdings.map(h => {
    const isCash      = h.assetClass?.toLowerCase() === "cash" || h.ticker.toLowerCase().startsWith("cash");
    const unitPrice   = isCash ? 1.0 : h.currentPrice;  // cash: 1 unit = 1 currency unit always
    const marketValue = toEur(h.quantity * unitPrice, h.currency);
    const costBasis   = toEur(h.quantity * (isCash ? 1.0 : h.costPrice), h.currency);
    const pnlAmount   = marketValue - costBasis;
    const pnlPct      = costBasis > 0 ? (pnlAmount / costBasis) * 100 : 0;

    return {
      id: h.id,
      portfolio: h.portfolio,
      ticker: h.ticker,
      name: h.name,
      assetClass: h.assetClass,
      sector: h.sector,
      geography: h.geography,
      quantity: h.quantity,
      costPrice: h.costPrice,
      currency: h.currency,
      priceCurrency: h.currency,
      isin: h.isin,
      currentPrice: isCash ? 1.0 : h.currentPrice,
      marketValue,
      costBasis,
      pnlAmount,
      pnlPct,
      weight: 0,
      dayChange: h.dayChange ?? 0,
      history: [],
    };
  });

  const totalValue    = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalCostBasis = positions.reduce((s, p) => s + p.costBasis, 0);
  positions.forEach(p => {
    p.weight = totalValue > 0 ? (p.marketValue / totalValue) * 100 : 0;
  });

  // Synthetic history for charts
  const dates = buildDateSeries(period);
  const n = dates.length;
  const portfolioValues = generatePath(totalCostBasis, totalValue, n, 0.009);
  // Benchmark: use realistic annual return per index (approximate, for synthetic path)
  const BENCH_ANNUAL: Record<string, number> = {
    "SPY": 0.115, "^GSPC": 0.115, "QQQ": 0.145, "^NDX": 0.145,
    "^FCHI": 0.055, "^GDAXI": 0.085, "^N225": 0.075, "EWU": 0.065,
    "IWDA.AS": 0.105, "URTH": 0.105, "EEM": 0.045, "IWM": 0.090,
    "^FTSE": 0.060,
  };
  const benchAnnual = BENCH_ANNUAL[benchmark] ?? 0.10;
  const benchmarkEnd   = totalCostBasis * Math.pow(1 + benchAnnual, n / 252);
  const benchmarkValues = generatePath(totalCostBasis, benchmarkEnd, n, 0.011);

  const pReturns = dailyReturnsFromValues(portfolioValues);
  const bReturns = dailyReturnsFromValues(benchmarkValues);

  const metrics = computeMetrics(
    portfolioValues, pReturns, bReturns,
    totalValue, totalCostBasis
  );

  const portfolioHistory = dates.map((date, i) => ({
    date,
    value: portfolioValues[i] ?? totalValue,
    benchmark: benchmarkValues[i] ?? totalCostBasis,
  }));

  const sorted = [...positions].sort((a, b) => b.pnlPct - a.pnlPct);

  return {
    portfolioNames: getPortfolioRoots().map(r => r.name),
    portfolios: getPortfolioRoots().map(r => r.name),
    positions,
    metrics,
    allocationByClass:    groupAllocation(positions, p => p.assetClass),
    allocationBySector:   groupAllocation(positions, p => p.sector),
    allocationByCurrency: groupAllocation(positions, p => p.currency),
    allocationByGeo:      groupAllocation(positions, p => p.geography),
    topGainers: sorted.slice(0, 5).filter(p => p.pnlPct > 0),
    topLosers:  [...sorted].reverse().slice(0, 5).filter(p => p.pnlPct < 0),
    portfolioHistory,
  };
}

// ─── Math helpers ─────────────────────────────────────────────────────────

const RISK_FREE = 0.04;
const TRADING_DAYS = 252;

function dailyReturnsFromValues(values: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) returns.push((values[i] - values[i - 1]) / values[i - 1]);
  }
  return returns;
}

function annualizedReturn(r: number[]): number {
  if (r.length === 0) return 0;
  const cum = r.reduce((acc, x) => acc * (1 + x), 1);
  return Math.pow(cum, TRADING_DAYS / r.length) - 1;
}

function annualizedVol(r: number[]): number {
  if (r.length < 2) return 0;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((acc, x) => acc + (x - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v * TRADING_DAYS);
}

function maxDrawdown(values: number[]): number {
  let peak = values[0], dd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    dd = Math.min(dd, (v - peak) / peak);
  }
  return dd;
}

function betaFn(p: number[], b: number[]): number {
  const n = Math.min(p.length, b.length);
  if (n < 2) return 1;
  const pm = p.slice(-n).reduce((a, x) => a + x, 0) / n;
  const bm = b.slice(-n).reduce((a, x) => a + x, 0) / n;
  let cov = 0, bVar = 0;
  for (let i = 0; i < n; i++) {
    cov  += (p[i] - pm) * (b[i] - bm);
    bVar += (b[i] - bm) ** 2;
  }
  return bVar === 0 ? 1 : cov / bVar;
}

function computeMetrics(
  values: number[], pR: number[], bR: number[],
  totalValue: number, totalCostBasis: number
): RiskMetrics {
  const ret  = annualizedReturn(pR);
  const vol  = annualizedVol(pR);
  const md   = maxDrawdown(values);
  const beta = betaFn(pR, bR);
  const te   = trackingError(pR, bR);
  const bRet = annualizedReturn(bR);

  const sharpe  = vol > 0 ? (ret - RISK_FREE) / vol : 0;
  const sortino = sortinoRatio(pR);
  const calmar  = md !== 0 ? ret / Math.abs(md) : 0;
  const ir      = te > 0 ? (ret - bRet) / te : 0;

  const sorted5 = [...pR].sort((a, b) => a - b);
  const varIdx  = Math.floor(0.05 * sorted5.length);
  const var95   = (sorted5[varIdx] ?? 0) * totalValue;
  const es      = sorted5.slice(0, varIdx + 1).reduce((s, x) => s + x, 0)
                  / (varIdx + 1 || 1) * totalValue;

  const n   = values.length;
  const ytd = ytdTradingDays(); // trading days since Jan 1 — aligns with values[] index

  return {
    totalValue,
    totalCostBasis,
    totalPnlAmount: totalValue - totalCostBasis,
    totalPnlPct: totalCostBasis > 0 ? ((totalValue - totalCostBasis) / totalCostBasis) * 100 : 0,
    // ── Store as DECIMALS (e.g. 0.15 for 15%) — display layer does × 100 ──
    annualizedReturn: ret,
    volatility: vol,
    sharpeRatio: sharpe,
    sortinoRatio: sortino,
    maxDrawdown: md,
    beta,
    trackingError: te,
    informationRatio: ir,
    calmarRatio: calmar,
    var95,
    expectedShortfall: es,
    ytdReturn:      n > ytd  ? (values[n - 1] / values[n - 1 - ytd]  - 1) : (values[n - 1] / values[0] - 1),
    oneMonthReturn: n > 21   ? (values[n - 1] / values[n - 1 - 21]  - 1)  : (values[n - 1] / values[0] - 1),
    oneYearReturn:  n > 252  ? (values[n - 1] / values[n - 1 - 252] - 1)  : (values[n - 1] / values[0] - 1),
  };
}

function sortinoRatio(r: number[]): number {
  const ret = annualizedReturn(r);
  const dailyRf = RISK_FREE / TRADING_DAYS;
  const down = r.filter(x => x < dailyRf);
  if (down.length === 0) return ret > 0 ? 5 : 0;
  // Denominator uses r.length (all observations), not just downside count — standard Sortino
  const dv = down.reduce((s, x) => s + (x - dailyRf) ** 2, 0) / r.length;
  const dd = Math.sqrt(dv * TRADING_DAYS);
  return dd === 0 ? 0 : (ret - RISK_FREE) / dd;
}

function trackingError(p: number[], b: number[]): number {
  const n = Math.min(p.length, b.length);
  if (n < 2) return 0;
  const diffs = p.slice(-n).map((x, i) => x - b.slice(-n)[i]);
  const m = diffs.reduce((a, x) => a + x, 0) / diffs.length;
  const v = diffs.reduce((s, x) => s + (x - m) ** 2, 0) / (diffs.length - 1);
  return Math.sqrt(v * TRADING_DAYS);
}

function groupAllocation(
  positions: Position[],
  keyFn: (p: Position) => string
): { name: string; value: number; pct: number }[] {
  const total = positions.reduce((s, p) => s + p.marketValue, 0);
  const groups: Record<string, number> = {};
  for (const p of positions) {
    const k = keyFn(p) || "—";
    groups[k] = (groups[k] ?? 0) + p.marketValue;
  }
  return Object.entries(groups)
    .map(([name, value]) => ({
      name, value,
      pct: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

// ─── Synthetic history generation ─────────────────────────────────────────

function generatePath(start: number, end: number, n: number, dailyVol: number): number[] {
  if (n <= 1) return [end];
  const logReturn = start > 0 ? Math.log(end / start) / n : 0;

  // Deterministic pseudo-random (seeded by start value)
  let seed = Math.floor(Math.abs(start)) % 9999 || 42;
  function rand() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  }

  const values: number[] = [start];
  for (let i = 1; i < n; i++) {
    const prev = values[i - 1];
    const step = logReturn + rand() * dailyVol;
    values.push(Math.max(prev * Math.exp(step), 1));
  }

  // Scale to force last value = end
  const scale = end / values[values.length - 1];
  return values.map(v => +(v * scale).toFixed(2));
}

function buildDateSeries(period: string): string[] {
  const days = periodToDays(period);
  const end  = new Date();
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      dates.push(d.toISOString().split("T")[0]);
    }
  }
  return dates;
}

function periodToDays(period: string): number {
  const map: Record<string, number> = {
    "1W": 7, "1M": 30, "3M": 90, "6M": 180,
    "YTD": ytdDays(), "1Y": 365, "3Y": 1095, "Max": 1825,
  };
  return map[period] ?? 365;
}

function ytdDays(): number {
  const now = new Date();
  const soy = new Date(now.getFullYear(), 0, 1);
  return Math.ceil((now.getTime() - soy.getTime()) / 86400000);
}

/** Count business days (Mon-Fri) from Jan 1 to today — used to index into values[] */
function ytdTradingDays(): number {
  const now = new Date();
  const soy = new Date(now.getFullYear(), 0, 1);
  let count = 0;
  const d = new Date(soy);
  while (d < now) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return Math.max(1, count);
}

// ─── CSV Parsing ─────────────────────────────────────────────────────────

function detectSep(line: string): string {
  return (line.match(/;/g)?.length ?? 0) > (line.match(/,/g)?.length ?? 0) ? ";" : ",";
}

function splitLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === sep && !inQ) { result.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  result.push(cur.trim());
  return result;
}

function normalizeHeader(h: string): string {
  const s = h.trim().toLowerCase().replace(/[^a-z]/g, "");
  const MAP: Record<string, string> = {
    costprice: "costprice", pru: "costprice", prix: "costprice",
    currentprice: "currentprice", prixactuel: "currentprice", cours: "currentprice",
    assetclass: "assetclass", classe: "assetclass", type: "assetclass",
    quantity: "quantity", quantite: "quantity", qte: "quantity", qty: "quantity",
    portfolio: "portfolio", portefeuille: "portfolio",
    ticker: "ticker", symbole: "ticker", symbol: "ticker",
    name: "name", nom: "name",
    sector: "sector", secteur: "sector",
    geography: "geography", geo: "geography", pays: "geography",
    currency: "currency", devise: "currency",
    isin: "isin",
  };
  return MAP[s] ?? s;
}

export function parseCSV(text: string): InsertHoldingLocal[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (lines.length < 2) return [];

  const sep     = detectSep(lines[0]);
  const headers = splitLine(lines[0], sep).map(normalizeHeader);

  return lines
    .slice(1)
    .filter(l => l.trim())
    .map(line => {
      const vals: Record<string, string> = {};
      splitLine(line, sep).forEach((v, i) => {
        if (headers[i]) vals[headers[i]] = v;
      });

      const ticker = vals["ticker"]?.trim();
      if (!ticker) return null;

      const qty = parseFloat((vals["quantity"] ?? "0").replace(/\s/g, "").replace(",", "."));
      const cp  = parseFloat((vals["costprice"] ?? "0").replace(/\s/g, "").replace(",", "."));
      const cur = parseFloat((vals["currentprice"] ?? "").replace(/\s/g, "").replace(",", "."));

      if (isNaN(qty) || isNaN(cp)) return null;

      return {
        portfolio:    (vals["portfolio"] ?? "Global").trim() || "Global",
        ticker,
        name:         (vals["name"] ?? ticker).trim(),
        assetClass:   (vals["assetclass"] ?? "Action").trim() || "Action",
        sector:       (vals["sector"] ?? "—").trim() || "—",
        geography:    (vals["geography"] ?? "—").trim() || "—",
        quantity:     qty,
        costPrice:    cp,
        currentPrice: isNaN(cur) ? undefined : cur,
        currency:     (vals["currency"] ?? "EUR").trim() || "EUR",
        isin:         (vals["isin"] ?? "").trim(),
      } as InsertHoldingLocal;
    })
    .filter((r): r is InsertHoldingLocal => r !== null);
}

// ─── URL helpers ─────────────────────────────────────────────────────────

function normalizeGSheetUrl(url: string): string {
  if (url.includes("/export") || url.includes("output=csv")) return url;
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) {
    const gidM = url.match(/[#&?]gid=([0-9]+)/);
    return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gidM?.[1] ?? "0"}`;
  }
  return url;
}

function qualifySubAccount(root: string, sub: string): string {
  if (!sub || sub === root) return root;
  if (sub.includes("::")) return sub;
  return `${root}::${sub}`;
}

// ─── Empty portfolio ──────────────────────────────────────────────────────

function emptyPortfolio(): PortfolioSummary & { portfolioNames: string[] } {
  return {
    portfolioNames: [],
    portfolios: [],
    positions: [],
    metrics: {
      totalValue: 0, totalCostBasis: 0, totalPnlAmount: 0, totalPnlPct: 0,
      annualizedReturn: 0, volatility: 0, sharpeRatio: 0, sortinoRatio: 0,
      maxDrawdown: 0, beta: 0, trackingError: 0, informationRatio: 0,
      calmarRatio: 0, var95: 0, expectedShortfall: 0,
      ytdReturn: 0, oneMonthReturn: 0, oneYearReturn: 0,
    },
    allocationByClass: [], allocationBySector: [],
    allocationByCurrency: [], allocationByGeo: [],
    topGainers: [], topLosers: [], portfolioHistory: [],
  };
}

// ─── Live Price Refresh ───────────────────────────────────────────────────

/**
 * Returns the ISO timestamp of the most recent live price refresh,
 * or null if prices have never been refreshed.
 */
export function getLastLiveUpdate(): string | null {
  const data = load();
  const ts = data.holdings.find(h => h.lastLiveUpdate)?.lastLiveUpdate;
  return ts ?? null;
}

/**
 * Fetches live prices for all tickers in the store via the Netlify Function
 * proxy (/api/quote → Yahoo Finance), then persists updated currentPrice and
 * dayChange values back to localStorage.
 *
 * Returns { updated, failed } where:
 *   updated — number of individual holdings that received a new price
 *   failed  — tickers that were not returned by Yahoo Finance
 */
export async function refreshLivePrices(): Promise<{
  updated: number;
  failed: string[];
}> {
  const { fetchLivePrices } = await import("./marketData");
  const data = load();

  // Deduplicate tickers — skip cash (price is always 1.0, no Yahoo needed)
  const isCashTicker = (h: { ticker: string; assetClass?: string }) =>
    (h.assetClass ?? "").toLowerCase() === "cash" || h.ticker.toLowerCase().startsWith("cash");

  const tickers = Array.from(new Set(
    data.holdings.filter(h => !isCashTicker(h)).map(h => h.ticker)
  ));
  if (!tickers.length) return { updated: 0, failed: [] };

  const quotes = await fetchLivePrices(tickers);
  const now = new Date().toISOString();

  let updated = 0;
  const failedSet = new Set<string>();

  data.holdings = data.holdings.map(h => {
    // Cash: keep price fixed at 1.0, never overwrite with Yahoo data
    if (isCashTicker(h)) {
      return { ...h, currentPrice: 1.0, dayChange: 0, lastLiveUpdate: now };
    }
    const q = quotes[h.ticker];
    if (q && q.price > 0) {
      updated++;
      return {
        ...h,
        currentPrice: q.price,
        dayChange: q.changePercent,
        lastLiveUpdate: now,
      };
    }
    // Track tickers that came back empty (wrong symbol, delisted, etc.)
    if (!quotes[h.ticker]) failedSet.add(h.ticker);
    return h;
  });

  save(data);
  return { updated, failed: Array.from(failedSet) };
}
