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

const BASE_CURRENCY = "EUR"; // All portfolio values consolidated in EUR

export function registerRoutes(httpServer: Server, app: Express) {

  /** GET /api/portfolios — list all portfolio roots with sub-accounts */
  app.get("/api/portfolios", async (_req, res) => {
    const roots = await storage.getPortfolioRoots();
    res.json(roots);
  });

  /** GET /api/macro — live macro indicators and Big Mac index */
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
      const period = (req.query.period as string) || "1Y";
      const benchmark = (req.query.benchmark as string) || "SPY";

      const holdings = await storage.getHoldings(portfolio);
      if (holdings.length === 0) {
        return res.json(emptyPortfolio());
      }

      // Warm up FX rates async first
      await getExchangeRateAsync("EUR", "USD").catch(() => {});

      // Enrich with live prices + history (all async in parallel)
      const positions: Position[] = await Promise.all(holdings.map(async h => {
        const priceData = await getMockPrice(h.ticker);
        const history = await generateHistory(h.ticker, priceData.price, 365);
        const currentPrice = priceData.price;
        // Market value: convert using the price's native currency (from Yahoo)
        // e.g. 2359.HK → price in HKD → convert HKD→EUR
        const priceCurrency = priceData.currency || h.currency;
        const fxRatePrice = getExchangeRate(priceCurrency, BASE_CURRENCY);
        const marketValue = h.quantity * currentPrice * fxRatePrice;
        // Cost basis: user always enters costPrice in EUR (h.currency), convert that
        const fxRateCost = getExchangeRate(h.currency, BASE_CURRENCY);
        const costBasis = h.quantity * h.costPrice * fxRateCost;
        const pnlAmount = marketValue - costBasis;
        const pnlPct = costBasis > 0 ? (pnlAmount / costBasis) * 100 : 0;
        return {
          id: h.id, portfolio: h.portfolio, ticker: h.ticker, name: h.name,
          assetClass: h.assetClass, sector: h.sector, geography: h.geography,
          quantity: h.quantity, costPrice: h.costPrice, currency: h.currency,
          priceCurrency,
          isin: h.isin ?? "", currentPrice, marketValue, costBasis,
          pnlAmount, pnlPct, weight: 0, dayChange: priceData.dayChange, history,
        };
      }));

      // Compute weights
      const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
      positions.forEach(p => { p.weight = totalValue > 0 ? (p.marketValue / totalValue) * 100 : 0; });

      // Build portfolio daily value series (weighted sum of position histories)
      const portfolioValues = buildPortfolioValueSeries(positions, totalValue, period);
      const benchmarkData = await getMockPrice(benchmark);
      const benchmarkHistory = await generateHistory(benchmark, benchmarkData.price, 365);
      const benchmarkValues = filterByPeriod(benchmarkHistory.map(h => h.close), period, benchmarkHistory.length);

      // Normalise benchmark to same start as portfolio
      const normBench = normalizeSeries(benchmarkValues, portfolioValues[0]);

      // Daily returns
      const portReturns = dailyReturnsFromValues(portfolioValues);
      const benchReturns = dailyReturnsFromValues(benchmarkValues);

      // Period-specific returns
      const ytdValues = buildPortfolioValueSeries(positions, totalValue, "YTD");
      const oneMonthValues = buildPortfolioValueSeries(positions, totalValue, "1M");
      const oneYearValues = buildPortfolioValueSeries(positions, totalValue, "1Y");
      const ytdRet = ytdValues.length > 1 ? (ytdValues[ytdValues.length - 1] - ytdValues[0]) / ytdValues[0] : 0;
      const oneMonthRet = oneMonthValues.length > 1 ? (oneMonthValues[oneMonthValues.length - 1] - oneMonthValues[0]) / oneMonthValues[0] : 0;
      const oneYearRet = oneYearValues.length > 1 ? (oneYearValues[oneYearValues.length - 1] - oneYearValues[0]) / oneYearValues[0] : 0;

      const cumValues = portfolioValues;
      const metrics: RiskMetrics = {
        totalValue,
        totalCostBasis: positions.reduce((s, p) => s + p.costBasis, 0),
        totalPnlAmount: positions.reduce((s, p) => s + p.pnlAmount, 0),
        totalPnlPct: 0,
        annualizedReturn: annualizedReturn(portReturns),
        volatility: annualizedVolatility(portReturns),
        sharpeRatio: sharpeRatio(portReturns),
        sortinoRatio: sortinoRatio(portReturns),
        maxDrawdown: maxDrawdown(cumValues),
        beta: beta(portReturns, benchReturns),
        trackingError: trackingError(portReturns, benchReturns),
        informationRatio: informationRatio(portReturns, benchReturns),
        calmarRatio: calmarRatio(portReturns, cumValues),
        var95: historicalVaR(portReturns, totalValue),
        expectedShortfall: expectedShortfall(portReturns, totalValue),
        ytdReturn: ytdRet,
        oneMonthReturn: oneMonthRet,
        oneYearReturn: oneYearRet,
      };
      metrics.totalPnlPct = metrics.totalCostBasis > 0 ? (metrics.totalPnlAmount / metrics.totalCostBasis) * 100 : 0;

      // Allocations
      const allocationByClass = groupAllocation(positions, p => p.assetClass);
      const allocationBySector = groupAllocation(positions, p => p.sector);
      const allocationByCurrency = groupAllocation(positions, p => p.currency);
      const allocationByGeo = groupAllocation(positions, p => p.geography);

      // Top 5 gainers by P&L %
      const sorted = [...positions].sort((a, b) => b.pnlPct - a.pnlPct);
      const topGainers = sorted.slice(0, 5);
      // Top 5 losers — only positions with negative P&L, worst first
      const topLosers = [...positions]
        .filter(p => p.pnlPct < 0)
        .sort((a, b) => a.pnlPct - b.pnlPct)
        .slice(0, 5);

      // Build chart history dates
      const chartDates = buildDateSeries(period);
      const portfolioHistorySliced = portfolioValues.slice(-chartDates.length);
      const benchmarkNormSliced = normBench.slice(-chartDates.length);
      const portfolioHistory = chartDates.map((date, i) => ({
        date,
        value: portfolioHistorySliced[i] ?? portfolioValues[portfolioValues.length - 1],
        benchmark: benchmarkNormSliced[i] ?? normBench[normBench.length - 1],
      }));

      const summary: PortfolioSummary = {
        portfolios: [],
        positions,
        metrics,
        allocationByClass,
        allocationBySector,
        allocationByCurrency,
        allocationByGeo,
        topGainers,
        topLosers,
        portfolioHistory,
      };
      res.json(summary);
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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  const now = new Date("2026-03-15");
  const startOfYear = new Date("2026-01-01");
  return Math.ceil((now.getTime() - startOfYear.getTime()) / (1000 * 86400));
}

function buildDateSeries(period: string): string[] {
  const days = periodToDays(period);
  const end = new Date("2026-03-15");
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
