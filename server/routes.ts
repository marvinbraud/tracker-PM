import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertHoldingSchema, type InsertHolding, type Position, type PortfolioSummary, type RiskMetrics } from "@shared/schema";
import { getMockPrice, generateHistory, getExchangeRate, getExchangeRateAsync, fetchLiveMacroData, fetchBigMacIndex } from "./marketData";
import {
  dailyReturnsFromValues,
  annualizedReturn, annualizedVolatility, sharpeRatio, sortinoRatio,
  maxDrawdown, beta, trackingError, informationRatio, calmarRatio,
  historicalVaR, expectedShortfall, correlationMatrix, skewness, excessKurtosis,
} from "./calculations";

// ─── Yahoo Finance in-memory cache ───────────────────────────────────────────
const QUOTE_CACHE_TTL = 60_000; // 60 seconds
const quoteCache = new Map<string, { data: any; ts: number }>();

// ─── Indices YTD persistent cache (6 h TTL, stale-on-error) ─────────────────
// When Render's cloud IPs are blocked by Yahoo Finance, we return the last
// known-good payload instead of an empty object, so cards never go blank.
const INDICES_YTD_TTL = 6 * 60 * 60 * 1000; // 6 hours
let indicesYtdCache: { data: Record<string, { dates: string[]; closes: number[] } | null>; fetchedAt: number } | null = null;

// ─── Macro markets live cache (30 min TTL, stale-on-error) ──────────────────
// Covers FX, volatility (VIX/MOVE), commodities and crypto — all from Yahoo.
const MACRO_MKT_TTL = 30 * 60 * 1000; // 30 min
let macroMktCache: { data: Record<string, { price: number; change: number } | null>; fetchedAt: number } | null = null;

const BASE_CURRENCY = "EUR"; // All portfolio values consolidated in EUR

// ─── Portfolio computation cache (keyed by portfolio|period — NO benchmark) ──
// This guarantees portfolio metrics (return, vol, Sharpe…) never change when
// only the benchmark changes.
interface PortfolioComputed {
  positions: Position[];
  portReturns: number[];
  portfolioValues: number[];
  metrics_stable: {
    totalValue: number; totalCostBasis: number;
    totalPnlAmount: number; totalPnlPct: number;
    annualizedReturn: number; volatility: number;
    sharpeRatio: number; sortinoRatio: number;
    maxDrawdown: number; calmarRatio: number;
    var95: number; expectedShortfall: number;
    ytdReturn: number; oneMonthReturn: number; oneYearReturn: number;
  };
  allocationByClass: any[]; allocationBySector: any[];
  allocationByCurrency: any[]; allocationByGeo: any[];
  topGainers: Position[]; topLosers: Position[];
  chartDates: string[]; portfolioHistoryValues: number[];
}
const portfolioComputeCache = new Map<string, { data: PortfolioComputed; expiresAt: number }>();
const PORTFOLIO_COMPUTE_TTL = 5 * 60 * 1000; // 5 min — matches price cache TTL

function invalidatePortfolioCache(portfolio?: string) {
  if (!portfolio) { portfolioComputeCache.clear(); return; }
  for (const key of portfolioComputeCache.keys()) {
    if (key.startsWith(portfolio + "|")) portfolioComputeCache.delete(key);
  }
}

export function registerRoutes(httpServer: Server, app: Express) {

  /** GET /api/portfolios — list all portfolio roots with sub-accounts */
  app.get("/api/portfolios", async (_req, res) => {
    const roots = await storage.getPortfolioRoots();
    res.json(roots);
  });

  /** GET /api/macro — live macro indicators and Big Mac index */
  /** GET /api/indices-ytd — YTD history for global indices (server-side proxy → no CORS) */
  app.get("/api/indices-ytd", async (_req, res) => {
    const INDICES = [
      { key: "SPX",   ticker: "^GSPC"   },
      { key: "NDX",   ticker: "^NDX"    },
      { key: "CAC",   ticker: "^FCHI"   },
      { key: "DAX",   ticker: "^GDAXI"  },
      { key: "NI225", ticker: "^N225"   },
      { key: "MXWO",  ticker: "IWDA.AS" },
      { key: "MXEF",  ticker: "EEM"     },
      { key: "HSI",   ticker: "^HSI"    },
    ] as const;

    // Serve from cache if still fresh (6 h TTL)
    const now = Date.now();
    if (indicesYtdCache && now - indicesYtdCache.fetchedAt < INDICES_YTD_TTL) {
      res.setHeader("X-Cache", "HIT");
      return res.json(indicesYtdCache.data);
    }

    try {
      const results = await Promise.allSettled(
        INDICES.map(async ({ key, ticker }) => {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=ytd&interval=1wk&includePrePost=false`;
          const r = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; ECI-Dashboard/2.0)", "Accept": "application/json" },
            signal: AbortSignal.timeout(10_000),
          });
          if (!r.ok) return { key, data: null };
          const json = await r.json() as any;
          const result = json?.chart?.result?.[0];
          if (!result) return { key, data: null };
          const timestamps: number[] = result.timestamp ?? [];
          const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
          const dates: string[] = [];
          const closes: number[] = [];
          for (let i = 0; i < timestamps.length; i++) {
            const c = rawCloses[i];
            if (c == null || isNaN(c)) continue;
            const d = new Date(timestamps[i] * 1000);
            dates.push(`${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`);
            closes.push(c);
          }
          return { key, data: dates.length > 0 ? { dates, closes } : null };
        })
      );

      const out: Record<string, { dates: string[]; closes: number[] } | null> = {};
      for (const r of results) {
        if (r.status === "fulfilled") out[r.value.key] = r.value.data;
      }

      // Only update the persistent cache when we got at least one real series
      const gotData = Object.values(out).some(v => v != null && v.closes.length > 0);
      if (gotData) {
        indicesYtdCache = { data: out, fetchedAt: now };
        res.setHeader("X-Cache", "MISS");
        return res.json(out);
      }

      // Yahoo returned nothing useful — serve stale cache if available
      if (indicesYtdCache) {
        console.warn("[indices-ytd] Yahoo returned no data — serving stale cache");
        res.setHeader("X-Cache", "STALE");
        return res.json(indicesYtdCache.data);
      }

      // No cache at all — return empty but don't 500
      res.setHeader("X-Cache", "EMPTY");
      return res.json(out);
    } catch (err) {
      console.error("[indices-ytd]", err);
      // On hard error, serve stale cache if we have it
      if (indicesYtdCache) {
        console.warn("[indices-ytd] Fetch error — serving stale cache");
        res.setHeader("X-Cache", "STALE");
        return res.json(indicesYtdCache.data);
      }
      return res.status(500).json({});
    }
  });

  /** GET /api/benchmark-history?ticker=SPY&period=1Y
   *  Returns real historical closes for a benchmark ticker (server-side Yahoo proxy).
   *  Response: { byDate: Record<string, number>, ticker, period, points }
   *  Used by the client to overlay real benchmark data on the portfolio chart.
   */
  app.get("/api/benchmark-history", async (req, res) => {
    const ticker = ((req.query.ticker as string) || "SPY").trim();
    const period = ((req.query.period  as string) || "1Y").trim();

    // Map period → how many calendar days to request from Yahoo
    const periodDaysMap: Record<string, number> = {
      "1W": 10, "1M": 35, "3M": 95, "6M": 190,
      "YTD": Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000) + 5,
      "1Y": 380, "3Y": 800, "Max": 1300,
    };
    const days = periodDaysMap[period] ?? 380;

    try {
      const priceData = await getMockPrice(ticker);
      const history   = await generateHistory(ticker, priceData.price > 0 ? priceData.price : 100, days);

      if (!history || history.length === 0) {
        return res.json({ byDate: {}, ticker, period, points: 0 });
      }

      const byDate: Record<string, number> = {};
      for (const { date, close } of history) byDate[date] = close;

      res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");
      return res.json({ byDate, ticker, period, points: history.length });
    } catch (err) {
      console.error("[benchmark-history]", err);
      return res.json({ byDate: {}, ticker, period, points: 0 });
    }
  });

  /** GET /api/macro-markets — live FX, volatility, commodities & crypto (Yahoo proxy)
   *  Response: { EURUSD: {price, change}, VIX: {...}, GOLD: {...}, ..., fetchedAt }
   *  30-min cache, serves stale data when Yahoo blocks the request.
   */
  app.get("/api/macro-markets", async (_req, res) => {
    const TICKERS = [
      // FX
      { key: "EURUSD", ticker: "EURUSD=X" }, { key: "USDJPY", ticker: "USDJPY=X" },
      { key: "USDCNY", ticker: "USDCNY=X" }, { key: "GBPUSD", ticker: "GBPUSD=X" },
      { key: "USDCHF", ticker: "USDCHF=X" }, { key: "DXY",    ticker: "DX-Y.NYB" },
      // Volatility
      { key: "VIX",    ticker: "^VIX"     }, { key: "MOVE",   ticker: "^MOVE"    },
      // Commodities
      { key: "GOLD",   ticker: "GC=F"     }, { key: "SILVER", ticker: "SI=F"     },
      { key: "WTI",    ticker: "CL=F"     }, { key: "BRENT",  ticker: "BZ=F"     },
      { key: "COPPER", ticker: "HG=F"     }, { key: "NATGAS", ticker: "NG=F"     },
      // Crypto
      { key: "BTC",    ticker: "BTC-USD"  },
    ] as const;

    const now = Date.now();
    if (macroMktCache && now - macroMktCache.fetchedAt < MACRO_MKT_TTL) {
      res.setHeader("X-Cache", "HIT");
      return res.json({ ...macroMktCache.data, fetchedAt: macroMktCache.fetchedAt });
    }

    try {
      const results = await Promise.allSettled(
        TICKERS.map(async ({ key, ticker }) => {
          const data = await getMockPrice(ticker);
          return { key, value: data.price > 0 ? { price: data.price, change: data.dayChange } : null };
        })
      );

      const out: Record<string, { price: number; change: number } | null> = {};
      for (const r of results) {
        if (r.status === "fulfilled") out[r.value.key] = r.value.value;
      }

      const gotData = Object.values(out).some(v => v != null && v.price > 0);
      if (gotData) {
        macroMktCache = { data: out, fetchedAt: now };
        res.setHeader("X-Cache", "MISS");
        return res.json({ ...out, fetchedAt: now });
      }

      // Yahoo gave nothing — serve stale cache if present
      if (macroMktCache) {
        res.setHeader("X-Cache", "STALE");
        return res.json({ ...macroMktCache.data, fetchedAt: macroMktCache.fetchedAt });
      }
      res.setHeader("X-Cache", "EMPTY");
      return res.json({ ...out, fetchedAt: now });
    } catch (err) {
      console.error("[macro-markets]", err);
      if (macroMktCache) {
        res.setHeader("X-Cache", "STALE");
        return res.json({ ...macroMktCache.data, fetchedAt: macroMktCache.fetchedAt });
      }
      return res.status(500).json({});
    }
  });

  app.get("/api/macro", async (_req, res) => {
    try {
      const [macroData, bigMacData] = await Promise.all([
        fetchLiveMacroData(),
        fetchBigMacIndex()
      ]);
      res.json({
        ...macroData,
        bigMac: bigMacData
      });
    } catch (err) {
      console.error("[Macro API Info]", err);
      res.status(500).json({ error: "Failed to fetch macro data" });
    }
  });

  /** POST /api/portfolios — create a new portfolio root */
  app.post("/api/portfolios", async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name required" });
      }
      const root = await storage.addPortfolioRoot(name.trim());
      res.status(201).json(root);
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  /** PUT /api/portfolios/:name — rename a portfolio root */
  app.put("/api/portfolios/:name", async (req, res) => {
    try {
      const oldName = decodeURIComponent(req.params.name);
      const { name: newName } = req.body;
      if (!newName || typeof newName !== "string" || !newName.trim()) {
        return res.status(400).json({ error: "new name required" });
      }
      await storage.renamePortfolioRoot(oldName, newName.trim());
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  /** DELETE /api/portfolios/:name — delete a portfolio root and all its holdings */
  app.delete("/api/portfolios/:name", async (req, res) => {
    try {
      const name = decodeURIComponent(req.params.name);
      await storage.deletePortfolioRoot(name);
      res.status(204).send();
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  /** GET /api/settings/gsheet — get ALL portfolio gsheet settings
   *  Returns: { [portfolioName]: { url: string|null, lastSyncAt: string|null } }
   */
  app.get("/api/settings/gsheet", async (_req, res) => {
    const all = await storage.getAllGSheetSettings();
    res.json(all);
  });

  /** POST /api/settings/gsheet — save Google Sheet URL for a specific portfolio
   *  Body: { portfolio: string, url: string }
   */
  app.post("/api/settings/gsheet", async (req, res) => {
    const { portfolio, url } = req.body;
    if (typeof portfolio !== "string" || !portfolio.trim()) return res.status(400).json({ error: "portfolio required" });
    if (typeof url !== "string") return res.status(400).json({ error: "url required" });
    await storage.setGSheetUrl(portfolio.trim(), url.trim());
    res.json({ ok: true });
  });

  /** POST /api/sync/gsheet — fetch CSV from Google Sheet and import holdings
   *  Body: { portfolio?: string }  — if omitted, syncs ALL portfolios that have a URL
   */
  app.post("/api/sync/gsheet", async (req, res) => {
    try {
      const { portfolio: reqPortfolio } = req.body ?? {};

      // Build list of portfolios to sync
      let toSync: string[];
      if (reqPortfolio) {
        toSync = [reqPortfolio];
      } else {
        // Sync all portfolios that have a URL configured
        const allSettings = await storage.getAllGSheetSettings();
        toSync = Object.entries(allSettings)
          .filter(([, s]) => s.url)
          .map(([name]) => name);
      }

      if (toSync.length === 0) {
        return res.status(400).json({ error: "No Google Sheet URL configured for any portfolio" });
      }

      let totalImported = 0;
      const results: Record<string, { imported: number; lastSyncAt: string } | { error: string }> = {};

      for (const portfolioName of toSync) {
        try {
          const settings = await storage.getGSheetSettings(portfolioName);
          const rawUrl = settings.url;
          if (!rawUrl) {
            results[portfolioName] = { error: "No URL configured" };
            continue;
          }

          const url = normalizeGSheetUrl(rawUrl);
          const response = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/csv,text/plain,*/*" },
          });
          if (!response.ok) {
            results[portfolioName] = { error: `HTTP ${response.status}` };
            continue;
          }
          const csvText = await response.text();

          const rows = parseCSVBackend(csvText);
          if (rows.length === 0) {
            const lines = csvText.replace(/\r\n/g, "\n").split("\n");
            const sep = detectSeparator(lines[0] ?? "");
            const rawHeaders = splitCSVLine(lines[0] ?? "", sep);
            results[portfolioName] = { error: `No valid rows found (sep='${sep}', headers: ${rawHeaders.join("|")}` };
            continue;
          }

          // Qualify sub-account names with the root portfolio name
          // e.g. "PEA" → "ECI::PEA" so Marvin::PEA and ECI::PEA never collide
          const qualifiedRows = rows.map(h => ({
            ...h,
            portfolio: qualifySubAccount(portfolioName, h.portfolio),
          }));

          // Group by qualified portfolio sub-account and replace
          const byPortfolio = new Map<string, InsertHolding[]>();
          for (const h of qualifiedRows) {
            const p = h.portfolio;
            if (!byPortfolio.has(p)) byPortfolio.set(p, []);
            byPortfolio.get(p)!.push(h);
          }
          for (const [pName, pHoldings] of byPortfolio.entries()) {
            await storage.replacePortfolioHoldings(pName, pHoldings);
            totalImported += pHoldings.length;
          }

          const ts = new Date().toISOString();
          await storage.setLastSyncAt(portfolioName, ts);
          invalidatePortfolioCache(portfolioName); // holdings changed after sync
          results[portfolioName] = { imported: rows.length, lastSyncAt: ts };
        } catch (innerErr) {
          results[portfolioName] = { error: String(innerErr) };
        }
      }

      res.json({ imported: totalImported, results });
    } catch (err) {
      console.error("[gsheet sync error]", err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** GET /api/summary?portfolio=Global&period=1Y&benchmark=SPY
   *  Main endpoint — returns all positions + risk metrics + charts data
   */
  app.get("/api/summary", async (req, res) => {
    try {
      const portfolio = (req.query.portfolio as string) || "Global";
      const period    = (req.query.period    as string) || "1Y";
      const benchmark = (req.query.benchmark as string) || "SPY";

      const holdings = await storage.getHoldings(portfolio);
      if (holdings.length === 0) return res.json(emptyPortfolio());

      // ── 1. PORTFOLIO DATA — cached by portfolio|period (no benchmark) ──────
      const portCacheKey = `${portfolio}|${period}`;
      let computed = (() => {
        const hit = portfolioComputeCache.get(portCacheKey);
        return hit && hit.expiresAt > Date.now() ? hit.data : null;
      })();

      if (!computed) {
        // Warm up FX rates
        await getExchangeRateAsync("EUR", "USD").catch(() => {});

        // Enrich positions with live prices + history (all async in parallel)
        const positions: Position[] = await Promise.all(holdings.map(async h => {
          const isCash = h.assetClass.toLowerCase() === "cash" || h.ticker.toLowerCase().startsWith("cash");

          if (isCash) {
            const priceCurrency = h.currency;
            const fxRate        = getExchangeRate(h.currency, BASE_CURRENCY);
            const flatHistory   = buildCashHistory(365);
            return {
              id: h.id, portfolio: h.portfolio, ticker: h.ticker, name: h.name,
              assetClass: h.assetClass, sector: h.sector, geography: h.geography,
              quantity: h.quantity, costPrice: h.costPrice, currency: h.currency,
              priceCurrency, isin: h.isin ?? "",
              currentPrice: 1.0,
              marketValue: h.quantity * fxRate,
              costBasis:   h.quantity * fxRate,
              pnlAmount: 0, pnlPct: 0, weight: 0, dayChange: 0, history: flatHistory,
            };
          }

          const priceData     = await getMockPrice(h.ticker);
          const history       = await generateHistory(h.ticker, priceData.price, 365);
          const currentPrice  = priceData.price;
          const priceCurrency = priceData.currency || h.currency;
          const fxRatePrice   = getExchangeRate(priceCurrency, BASE_CURRENCY);
          const marketValue   = h.quantity * currentPrice * fxRatePrice;
          const fxRateCost    = getExchangeRate(h.currency, BASE_CURRENCY);
          const costBasis     = h.quantity * h.costPrice * fxRateCost;
          const pnlAmount     = marketValue - costBasis;
          return {
            id: h.id, portfolio: h.portfolio, ticker: h.ticker, name: h.name,
            assetClass: h.assetClass, sector: h.sector, geography: h.geography,
            quantity: h.quantity, costPrice: h.costPrice, currency: h.currency,
            priceCurrency, isin: h.isin ?? "", currentPrice, marketValue, costBasis,
            pnlAmount, pnlPct: costBasis > 0 ? (pnlAmount / costBasis) * 100 : 0,
            weight: 0, dayChange: priceData.dayChange, history,
          };
        }));

        const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
        positions.forEach(p => { p.weight = totalValue > 0 ? (p.marketValue / totalValue) * 100 : 0; });

        const portfolioValues  = buildPortfolioValueSeries(positions, totalValue, period);
        const portReturns      = dailyReturnsFromValues(portfolioValues);

        const ytdValues      = buildPortfolioValueSeries(positions, totalValue, "YTD");
        const oneMonthValues = buildPortfolioValueSeries(positions, totalValue, "1M");
        const oneYearValues  = buildPortfolioValueSeries(positions, totalValue, "1Y");
        const ytdRet         = ytdValues.length > 1      ? (ytdValues[ytdValues.length - 1] - ytdValues[0]) / ytdValues[0] : 0;
        const oneMonthRet    = oneMonthValues.length > 1 ? (oneMonthValues[oneMonthValues.length - 1] - oneMonthValues[0]) / oneMonthValues[0] : 0;
        const oneYearRet     = oneYearValues.length > 1  ? (oneYearValues[oneYearValues.length - 1]  - oneYearValues[0])  / oneYearValues[0]  : 0;

        const totalCostBasis = positions.reduce((s, p) => s + p.costBasis, 0);
        const totalPnlAmount = positions.reduce((s, p) => s + p.pnlAmount, 0);

        const chartDates = buildDateSeries(period);
        const portfolioHistoryValues = portfolioValues.slice(-chartDates.length);

        computed = {
          positions, portReturns, portfolioValues,
          metrics_stable: {
            totalValue, totalCostBasis, totalPnlAmount,
            totalPnlPct: totalCostBasis > 0 ? (totalPnlAmount / totalCostBasis) * 100 : 0,
            annualizedReturn: annualizedReturn(portReturns),
            volatility:       annualizedVolatility(portReturns),
            sharpeRatio:      sharpeRatio(portReturns),
            sortinoRatio:     sortinoRatio(portReturns),
            maxDrawdown:      maxDrawdown(portfolioValues),
            calmarRatio:      calmarRatio(portReturns, portfolioValues),
            var95:            historicalVaR(portReturns, totalValue),
            expectedShortfall: expectedShortfall(portReturns, totalValue),
            ytdReturn: ytdRet, oneMonthReturn: oneMonthRet, oneYearReturn: oneYearRet,
          },
          allocationByClass:    groupAllocation(positions, p => p.assetClass),
          allocationBySector:   groupAllocation(positions, p => p.sector),
          allocationByCurrency: groupAllocation(positions, p => p.currency),
          allocationByGeo:      groupAllocation(positions, p => p.geography),
          topGainers: [...positions].sort((a, b) => b.pnlPct - a.pnlPct).slice(0, 5),
          topLosers:  [...positions].filter(p => p.pnlPct < 0).sort((a, b) => a.pnlPct - b.pnlPct).slice(0, 5),
          chartDates, portfolioHistoryValues,
        };
        portfolioComputeCache.set(portCacheKey, { data: computed, expiresAt: Date.now() + PORTFOLIO_COMPUTE_TTL });
      }

      // ── 2. BENCHMARK DATA — always fresh (cheap: one ticker) ───────────────
      const benchmarkData    = await getMockPrice(benchmark);
      const benchmarkHistory = await generateHistory(benchmark, benchmarkData.price, 365);
      const benchmarkValues  = filterByPeriod(benchmarkHistory.map(h => h.close), period, benchmarkHistory.length);
      const normBench        = normalizeSeries(benchmarkValues, computed.portfolioValues[0] ?? 1);
      const benchReturns     = dailyReturnsFromValues(benchmarkValues);

      // ── 3. COMBINE ─────────────────────────────────────────────────────────
      const ms = computed.metrics_stable;
      const metrics: RiskMetrics = {
        ...ms,
        beta:              beta(computed.portReturns, benchReturns),
        trackingError:     trackingError(computed.portReturns, benchReturns),
        informationRatio:  informationRatio(computed.portReturns, benchReturns),
      };

      const benchmarkNormSliced = normBench.slice(-computed.chartDates.length);
      const portfolioHistory = computed.chartDates.map((date, i) => ({
        date,
        value:     computed.portfolioHistoryValues[i] ?? computed.portfolioValues[computed.portfolioValues.length - 1],
        benchmark: benchmarkNormSliced[i]             ?? normBench[normBench.length - 1],
      }));

      res.json({
        portfolios: [],
        positions: computed.positions,
        metrics,
        allocationByClass:    computed.allocationByClass,
        allocationBySector:   computed.allocationBySector,
        allocationByCurrency: computed.allocationByCurrency,
        allocationByGeo:      computed.allocationByGeo,
        topGainers:           computed.topGainers,
        topLosers:            computed.topLosers,
        portfolioHistory,
      } as PortfolioSummary);

    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** GET /api/correlation?portfolio=Global — correlation matrix for top positions */
  app.get("/api/correlation", async (req, res) => {
    const portfolio = (req.query.portfolio as string) || "Global";
    const holdings = await storage.getHoldings(portfolio);
    const top = holdings.slice(0, 12);
    const series = await Promise.all(top.map(async h => {
      const p = (await getMockPrice(h.ticker)).price;
      const hist = await generateHistory(h.ticker, p, 252);
      return dailyReturnsFromValues(hist.map(d => d.close));
    }));
    const matrix = correlationMatrix(series);
    res.json({
      tickers: top.map(h => h.ticker),
      names: top.map(h => h.name),
      matrix,
    });
  });

  /** POST /api/holdings — add a single holding */
  app.post("/api/holdings", async (req, res) => {
    const parsed = insertHoldingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const holding = await storage.addHolding(parsed.data);
    res.status(201).json(holding);
  });

  /** PUT /api/holdings/:id — update a holding */
  app.put("/api/holdings/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const updated = await storage.updateHolding(id, req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  /** DELETE /api/holdings/:id */
  app.delete("/api/holdings/:id", async (req, res) => {
    await storage.deleteHolding(parseInt(req.params.id));
    invalidatePortfolioCache(); // holdings changed → invalidate all portfolio cache
    res.status(204).send();
  });

  /** POST /api/holdings/import — bulk import CSV data
   *  Body: { rootPortfolio?: string, holdings: InsertHolding[] }
   *  If rootPortfolio is provided, sub-account names in holdings are qualified:
   *  "PEA" -> "Marvin::PEA"
   */
  app.post("/api/holdings/import", async (req, res) => {
    try {
      const { holdings: rawHoldings, rootPortfolio } = req.body;
      if (!Array.isArray(rawHoldings)) {
        return res.status(400).json({ error: "holdings array required" });
      }

      // Sanitize each row before Zod validation
      const sanitized = rawHoldings.map((h: any) => {
        const rawPortfolio = (h.portfolio ?? "").toString().trim() || "Global";
        // Qualify sub-account with root name if provided
        const portfolio = rootPortfolio
          ? qualifySubAccount(rootPortfolio, rawPortfolio)
          : rawPortfolio;
        return {
          portfolio,
          ticker:     (h.ticker     ?? "").toString().trim(),
          name:       (h.name       ?? h.ticker ?? "").toString().trim(),
          assetClass: (h.assetClass ?? "Action").toString().trim() || "Action",
          sector:     (h.sector     ?? "—").toString().trim() || "—",
          geography:  (h.geography  ?? "—").toString().trim() || "—",
          quantity:   typeof h.quantity  === "number" ? h.quantity  : parseFloat(String(h.quantity  ?? "0").replace(",", ".")),
          costPrice:  typeof h.costPrice === "number" ? h.costPrice : parseFloat(String(h.costPrice ?? "0").replace(",", ".")),
          currency:   (h.currency   ?? "EUR").toString().trim() || "EUR",
          isin:       (h.isin       ?? "").toString().trim(),
        };
      });

      // Filter out rows with no ticker or invalid numbers
      const clean = sanitized.filter(h =>
        h.ticker.length > 0 &&
        !isNaN(h.quantity) && h.quantity >= 0 &&
        !isNaN(h.costPrice) && h.costPrice >= 0
      );

      if (clean.length === 0) {
        return res.status(400).json({ error: "No valid holdings found. Check ticker and quantity columns." });
      }

      const parsed = clean.map((h) => insertHoldingSchema.safeParse(h));
      const valid = parsed.filter(r => r.success).map(r => (r as any).data as InsertHolding);
      const skipped = parsed.filter(r => !r.success).length;

      // Group by qualified portfolio name and replace atomically
      const byPortfolio = new Map<string, InsertHolding[]>();
      for (const h of valid) {
        const p = h.portfolio;
        if (!byPortfolio.has(p)) byPortfolio.set(p, []);
        byPortfolio.get(p)!.push(h);
      }

      let totalImported = 0;
      for (const [pName, pHoldings] of byPortfolio.entries()) {
        await storage.replacePortfolioHoldings(pName, pHoldings);
        totalImported += pHoldings.length;
      }
      invalidatePortfolioCache(); // holdings changed
      res.json({ imported: totalImported, skipped });
    } catch (err) {
      console.error("[import error]", err);
      res.status(500).json({ error: String(err) });
    }
  });

  /** GET /api/quote?symbols=AAPL,MC.PA — Yahoo Finance live price proxy (v8 chart, no external lib) */
  app.get("/api/quote", async (req, res) => {
    const symbolsParam = req.query.symbols as string | undefined;
    if (!symbolsParam) {
      return res.status(400).json({ error: "Missing ?symbols= query parameter" });
    }

    const requested = symbolsParam.split(",").map(s => s.trim()).filter(Boolean);
    if (requested.length === 0) {
      return res.status(400).json({ error: "No valid symbols" });
    }

    const now    = Date.now();
    const result: any[] = [];
    const toFetch: string[] = [];

    // Serve from cache when possible
    for (const sym of requested) {
      const hit = quoteCache.get(sym);
      if (hit && now - hit.ts < QUOTE_CACHE_TTL) {
        result.push(hit.data);
      } else {
        toFetch.push(sym);
      }
    }

    // Fetch uncached symbols via Yahoo Finance v8 chart endpoint (no auth required)
    await Promise.all(toFetch.map(async (sym) => {
      try {
        const url =
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
          `?range=1d&interval=1d&includePrePost=false`;

        const r = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; ECI-Dashboard/2.0)",
            "Accept": "application/json",
          },
          signal: AbortSignal.timeout(8_000),
        });

        if (!r.ok) {
          console.warn(`[quote] ${sym} → HTTP ${r.status}`);
          return;
        }

        const data = await r.json() as any;
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta?.regularMarketPrice) return;

        const price     = meta.regularMarketPrice as number;
        const prevClose = (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
        const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

        const item = {
          symbol:                     sym,
          regularMarketPrice:         price,
          regularMarketChangePercent: changePct,
          regularMarketPreviousClose: prevClose,
          currency:                   (meta.currency    ?? "USD") as string,
          shortName:                  (meta.shortName   ?? undefined) as string | undefined,
          marketState:                (meta.marketState ?? undefined) as string | undefined,
        };

        quoteCache.set(sym, { data: item, ts: now });
        result.push(item);
      } catch (err) {
        console.warn(`[quote] fetch failed for ${sym}:`, (err as Error)?.message);
      }
    }));

    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return res.json({ quoteResponse: { result, error: null } });
  });

  /**
   * POST /api/portfolio-history
   * Body: { holdings: [{ticker, quantity, currency, currentPrice, assetClass?}], period: string }
   * Returns real portfolio value series built from Yahoo Finance historical closes.
   * Used by the client to replace the synthetic GBM path with actual performance.
   */
  app.post("/api/portfolio-history", async (req, res) => {
    type HoldingInput = {
      ticker: string; quantity: number; currency: string;
      currentPrice: number; assetClass?: string;
    };
    const { holdings, period } = req.body as { holdings: HoldingInput[]; period: string };

    if (!Array.isArray(holdings) || holdings.length === 0) {
      return res.json({ dates: [], values: [] });
    }

    // Warm up FX cache so getExchangeRate() has live rates
    await getExchangeRateAsync("EUR", "USD").catch(() => {});

    const histDays = periodToDays(period) + 15; // a bit of buffer for alignment

    // Fetch history for all tickers in parallel, skip pure-cash lines
    const enriched = await Promise.all(
      holdings.map(async (h) => {
        const isCash = (h.assetClass ?? "").toLowerCase() === "cash"
                    || h.ticker.toLowerCase().startsWith("cash");
        if (isCash) {
          const hist = buildCashHistory(histDays);
          return { ticker: h.ticker, quantity: h.quantity, currency: h.currency,
                   priceCurrency: h.currency, history: hist };
        }
        const priceData = await getMockPrice(h.ticker);
        const price     = h.currentPrice > 0 ? h.currentPrice : priceData.price;
        const hist      = await generateHistory(h.ticker, price, histDays);
        // Build a date→close map for O(1) lookup
        const byDate: Record<string, number> = {};
        for (const e of hist) byDate[e.date] = e.close;
        return {
          ticker: h.ticker, quantity: h.quantity, currency: h.currency,
          priceCurrency: priceData.currency || h.currency,
          history: hist, byDate,
          lastClose: hist.length > 0 ? hist[hist.length - 1].close : price,
        };
      })
    );

    const dates = buildDateSeries(period);

    // Pre-sort each position's date keys once (O(k log k) instead of O(k) per date)
    const enrichedWithSortedDates = enriched.map(h => {
      const byDate = (h as any).byDate as Record<string, number> | undefined;
      const sortedDates = byDate ? Object.keys(byDate).sort() : [];
      return { ...h, _sortedDates: sortedDates };
    });

    // For each date, sum quantity × close × fxRate across all positions.
    // Carry forward for holidays; carry backward (use first known close) for dates
    // before history — avoids the distortion of using current price as a "past" price.
    const values = dates.map(date => {
      let total = 0;
      for (const h of enrichedWithSortedDates) {
        const byDate = (h as any).byDate as Record<string, number> | undefined;
        let close: number;
        if (byDate && byDate[date] != null) {
          close = byDate[date];
        } else if (byDate) {
          const sd = (h as any)._sortedDates as string[];
          const prior = sd.filter(d => d <= date).at(-1);
          if (prior) {
            close = byDate[prior];                      // carry forward (holiday / weekend)
          } else {
            close = sd.length > 0 ? byDate[sd[0]] : 1; // carry backward from first known close
          }
        } else {
          close = 1; // cash
        }
        const fxRate = getExchangeRate(
          (h as any).priceCurrency || h.currency,
          BASE_CURRENCY
        );
        total += h.quantity * close * fxRate;
      }
      return +total.toFixed(2);
    });

    // Compute real risk/return metrics from the reconstructed value series
    const n = values.length;
    const dailyRets = dailyReturnsFromValues(values);
    const ytdTD = ytdTradingDays();
    let metrics: Record<string, number | null> | null = null;
    if (dailyRets.length >= 2) {
      metrics = {
        annualizedReturn:  annualizedReturn(dailyRets),
        volatility:        annualizedVolatility(dailyRets),
        sharpeRatio:       sharpeRatio(dailyRets),
        sortinoRatio:      sortinoRatio(dailyRets),
        maxDrawdown:       maxDrawdown(values),
        calmarRatio:       calmarRatio(dailyRets, values),
        var95:             historicalVaR(dailyRets, values[n - 1]),
        expectedShortfall: expectedShortfall(dailyRets, values[n - 1]),
        // Period returns — null when we don't have enough history for that window
        ytdReturn:         n > ytdTD ? values[n - 1] / values[n - 1 - ytdTD] - 1 : null,
        oneMonthReturn:    n > 21    ? values[n - 1] / values[n - 1 - 21]    - 1 : null,
        oneYearReturn:     n > 252   ? values[n - 1] / values[n - 1 - 252]   - 1 : null,
      };
    }

    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    return res.json({ dates, values, metrics });
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Flat history at price=1.0 for cash positions (price never changes) */
function buildCashHistory(days: number): { date: string; close: number }[] {
  const result: { date: string; close: number }[] = [];
  const end = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      result.push({ date: d.toISOString().split("T")[0], close: 1.0 });
    }
  }
  return result;
}

/**
 * Ensure a sub-account name is fully qualified with the root portfolio name.
 * "PEA" + rootName "ECI" → "ECI::PEA"  (prevents collision with "Marvin::PEA")
 * Already-qualified names (containing "::") are left untouched.
 */
function qualifySubAccount(rootName: string, subAccount: string): string {
  if (!subAccount || subAccount === rootName) return rootName;
  if (subAccount.includes("::")) return subAccount;
  return `${rootName}::${subAccount}`;
}

function groupAllocation(positions: Position[], keyFn: (p: Position) => string) {
  const total = positions.reduce((s, p) => s + p.marketValue, 0);
  const groups: Record<string, number> = {};
  for (const p of positions) {
    const key = keyFn(p) || "—";
    groups[key] = (groups[key] ?? 0) + p.marketValue;
  }
  return Object.entries(groups)
    .map(([name, value]) => ({ name, value, pct: total > 0 ? (value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

function buildPortfolioValueSeries(positions: Position[], totalValue: number, period: string): number[] {
  // Use position histories weighted by current allocation to simulate portfolio value series
  const dayCount = periodToDays(period);
  const n = Math.min(dayCount, 252);
  if (positions.length === 0) return Array(n).fill(totalValue);

  // Align all histories to same length
  const minLen = Math.min(...positions.map(p => p.history.length));
  const len = Math.min(n, minLen);
  if (len <= 0) return [totalValue];

  const values: number[] = [];
  for (let i = minLen - len; i < minLen; i++) {
    let dayValue = 0;
    for (const p of positions) {
      const histClose = p.history[i]?.close ?? p.currentPrice;
      // Use priceCurrency (native Yahoo currency) for FX conversion of price series
      const fxRate = getExchangeRate(p.priceCurrency || p.currency, BASE_CURRENCY);
      dayValue += p.quantity * histClose * fxRate;
    }
    values.push(dayValue);
  }
  return values;
}

function filterByPeriod(values: number[], period: string, available: number): number[] {
  const days = periodToDays(period);
  const take = Math.min(days, available, values.length);
  return values.slice(-take);
}

function periodToDays(period: string): number {
  const map: Record<string, number> = {
    "1W": 5, "1M": 21, "3M": 63, "6M": 126, "YTD": ytdDays(), "1Y": 252, "3Y": 756, "Max": 1260,
  };
  return map[period] ?? 252;
}

function ytdDays(): number {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  return Math.max(1, Math.ceil((now.getTime() - startOfYear.getTime()) / (1000 * 86400)));
}

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

function buildDateSeries(period: string): string[] {
  const days = periodToDays(period);
  const end = new Date(); // always use today
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      dates.push(d.toISOString().split("T")[0]);
    }
  }
  return dates;
}

function normalizeSeries(values: number[], targetStart: number): number[] {
  if (values.length === 0 || values[0] === 0) return values;
  const scale = targetStart / values[0];
  return values.map(v => v * scale);
}

function emptyPortfolio(): PortfolioSummary {
  return {
    portfolios: [], positions: [],
    metrics: {
      totalValue: 0, totalCostBasis: 0, totalPnlAmount: 0, totalPnlPct: 0,
      annualizedReturn: 0, volatility: 0, sharpeRatio: 0, sortinoRatio: 0,
      maxDrawdown: 0, beta: 0, trackingError: 0, informationRatio: 0,
      calmarRatio: 0, var95: 0, expectedShortfall: 0,
      ytdReturn: 0, oneMonthReturn: 0, oneYearReturn: 0,
    },
    allocationByClass: [], allocationBySector: [], allocationByCurrency: [], allocationByGeo: [],
    topGainers: [], topLosers: [], portfolioHistory: [],
  };
}

// ─── Google Sheets URL normalizer ──────────────────────────────────

/**
 * Accept any Google Sheets URL format and return the CSV export URL.
 * Handles:
 *   - /edit?usp=sharing
 *   - /pub?output=csv  (already correct)
 *   - /export?format=csv  (already correct)
 *   - Any URL containing the spreadsheet ID
 */
function normalizeGSheetUrl(url: string): string {
  // Already a direct CSV export
  if (url.includes("/export") || url.includes("output=csv")) return url;

  // Extract spreadsheet ID from any Google Sheets URL
  // Pattern: /spreadsheets/d/{ID}/...
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) {
    const id = match[1];
    // Also try to extract gid (sheet tab ID)
    const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : "0";
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  }

  // Not a recognizable Google Sheets URL — return as-is and hope for the best
  return url;
}

// ─── CSV parser (backend, mirrors frontend logic) ─────────────────────────────

function splitCSVLine(line: string, sep = ","): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === sep && !inQuotes) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

/** Detect CSV separator: semicolon (French locale) or comma */
function detectSeparator(firstLine: string): string {
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas     = (firstLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

/** Normalize a header name to a known canonical key */
function normalizeHeader(h: string): string {
  const s = h.trim().toLowerCase().replace(/[^a-z]/g, "");
  // Map common variants
  const map: Record<string, string> = {
    "costprice": "costprice", "pru": "costprice", "prix": "costprice",
    "prixachat": "costprice", "prixrevient": "costprice", "unitcost": "costprice",
    "assetclass": "assetclass", "classe": "assetclass", "type": "assetclass",
    "quantity": "quantity", "quantite": "quantity", "qte": "quantity", "qty": "quantity",
    "portfolio": "portfolio", "portefeuille": "portfolio",
    "ticker": "ticker", "symbole": "ticker", "symbol": "ticker", "code": "ticker",
    "name": "name", "nom": "name",
    "sector": "sector", "secteur": "sector",
    "geography": "geography", "geo": "geography", "geographie": "geography", "pays": "geography",
    "currency": "currency", "devise": "currency", "monnaie": "currency",
    "isin": "isin",
  };
  return map[s] ?? s;
}

function parseCSVBackend(text: string): InsertHolding[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (lines.length < 2) return [];

  const sep = detectSeparator(lines[0]);
  const rawHeaders = splitCSVLine(lines[0], sep);
  const headers = rawHeaders.map(normalizeHeader);

  console.log(`[gsheet] separator='${sep}', headers:`, headers);

  const rows: InsertHolding[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const vals = splitCSVLine(line, sep);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? "").trim(); });

    const ticker = (obj["ticker"] ?? "").trim();
    if (!ticker) continue;

    // Parse quantity — handle both decimal separators
    const qtyRaw = (obj["quantity"] ?? "0").replace(/\s/g, "");
    // French format: "1 234,56" → remove spaces, replace comma with dot
    const quantity = parseFloat(qtyRaw.replace(/\s/g, "").replace(",", "."));

    // Parse costPrice
    const cpRaw = (obj["costprice"] ?? "0").replace(/\s/g, "");
    const costPrice = parseFloat(cpRaw.replace(",", "."));

    // Skip rows with truly invalid numbers (NaN), but allow 0
    if (isNaN(quantity) || isNaN(costPrice)) {
      console.log(`[gsheet] skipping row (NaN): ticker=${ticker} qty=${qtyRaw} cp=${cpRaw}`);
      continue;
    }

    rows.push({
      portfolio:  (obj["portfolio"]  ?? "").trim() || "Global",
      ticker,
      name:       (obj["name"]       ?? ticker).trim(),
      assetClass: (obj["assetclass"] ?? "Action").trim() || "Action",
      sector:     (obj["sector"]     ?? "\u2014").trim() || "\u2014",
      geography:  (obj["geography"]  ?? "\u2014").trim() || "\u2014",
      quantity,
      costPrice,
      currency:   (obj["currency"]   ?? "EUR").trim() || "EUR",
      isin:       (obj["isin"]       ?? "").trim(),
    });
  }
  console.log(`[gsheet] parsed ${rows.length} valid rows from ${lines.length - 1} data lines`);
  return rows;
}
