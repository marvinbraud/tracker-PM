/**
 * queryClient.ts — Routeur local (sans API)
 * ==========================================
 * Remplace les appels HTTP vers le serveur Express par des appels directs
 * au localStore (localStorage). Le reste du code (useQuery, useMutation)
 * n'a pas besoin d'être modifié — seul le "transport" change.
 *
 * /api/summary  → computed locally from localStorage, then the benchmark column
 *                 is overwritten with real Yahoo Finance data fetched from the
 *                 server (/api/benchmark-history). Falls back to the synthetic
 *                 path if the server is unreachable.
 */

import { QueryClient, QueryFunction } from "@tanstack/react-query";
import {
  computeSummary,
  getPortfolioRoots,
  getHoldings,
  getAllGSheetSettings,
} from "./localStore";

// ─── Routeur local ────────────────────────────────────────────────────────

function parseQuery(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

// Routes servies uniquement depuis localStorage (pas de réseau)
const LOCAL_PATHS = new Set([
  "/api/portfolios",
  "/api/settings/gsheet",
  "/api/holdings",
  "/api/macro",
]);

function localGet(url: string): unknown {
  const path = url.split("?")[0];

  if (path === "/api/portfolios")     return getPortfolioRoots();
  if (path === "/api/settings/gsheet") return getAllGSheetSettings();
  if (path === "/api/holdings") {
    const q = parseQuery(url);
    return getHoldings(q.get("portfolio") ?? "Global");
  }
  if (path === "/api/macro") return getMacroData();

  return undefined;
}

// ─── Query function ───────────────────────────────────────────────────────

const localQueryFn: QueryFunction = async ({ queryKey }) => {
  const url = Array.isArray(queryKey)
    ? queryKey.map(String).join("").replace(/\/+/g, "/")
    : String(queryKey);

  const path = url.split("?")[0];

  // ── /api/summary — portfolio computed locally, benchmark overlaid from server ──
  if (path === "/api/summary") {
    const q         = parseQuery(url);
    const portfolio = q.get("portfolio") ?? "Global";
    const period    = q.get("period")    ?? "1Y";
    const benchmark = q.get("benchmark") ?? "SPY";

    // 1. Compute portfolio metrics synchronously from localStorage
    const summary = computeSummary(portfolio, period, benchmark);

    // 2. Fetch REAL benchmark history from server (Yahoo Finance proxy)
    try {
      const benchRes = await fetch(
        `/api/benchmark-history?ticker=${encodeURIComponent(benchmark)}&period=${encodeURIComponent(period)}`
      );
      if (benchRes.ok) {
        const { byDate }: { byDate: Record<string, number> } = await benchRes.json();
        const dateKeys = Object.keys(byDate);
        if (dateKeys.length >= 2) {
          // Normalize: scale benchmark so it starts at the same value as the portfolio
          const portfolioStart = summary.portfolioHistory[0]?.value ?? 1;
          const firstPortDate  = summary.portfolioHistory[0]?.date ?? "";
          // Find closest available benchmark close for the first portfolio date
          const firstClose     = byDate[firstPortDate]
            ?? byDate[dateKeys.find(d => d >= firstPortDate) ?? dateKeys[0]]
            ?? Object.values(byDate)[0]
            ?? 1;
          const scale = firstClose > 0 ? portfolioStart / firstClose : 1;

          summary.portfolioHistory = summary.portfolioHistory.map(h => ({
            ...h,
            benchmark: (byDate[h.date] ?? firstClose) * scale,
          }));
        }
      }
    } catch {
      // Server unreachable or Yahoo blocked — keep synthetic benchmark silently
    }

    return summary;
  }

  // ── Routes pures localStorage ──────────────────────────────────────────────
  if (LOCAL_PATHS.has(path)) {
    return localGet(url);
  }

  // ── Fallback: appel HTTP réel (ex: /api/indices-ytd, /api/benchmark-history) ──
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("[localRouter] HTTP error:", res.status, url);
      return null;
    }
    return res.json();
  } catch (err) {
    console.warn("[localRouter] fetch failed:", url, err);
    return null;
  }
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: localQueryFn,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: false,
    },
    mutations: { retry: false },
  },
});

// ─── apiRequest — pointe vers le store local ─────────────────────────────
// Les mutations sont gérées directement dans les composants via localStore.
// Cette fonction reste pour compatibilité.

export async function apiRequest(
  _method: string,
  _url: string,
  _data?: unknown
): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Macro data statique ─────────────────────────────────────────────────

function getMacroData() {
  return {
    lastUpdated: new Date().toISOString(),
    isStatic: true,
    rates: {
      fed:    { value: 5.25,  label: "Fed Funds Rate",  change: 0,     date: "2024-11-07" },
      ecb:    { value: 3.40,  label: "BCE Taux dépôt",  change: -0.25, date: "2024-10-17" },
      boe:    { value: 5.00,  label: "BoE Rate",        change: -0.25, date: "2024-11-07" },
      boj:    { value: 0.25,  label: "BoJ Rate",        change: 0.15,  date: "2024-07-31" },
    },
    inflation: {
      us:    { value: 2.7,  label: "CPI US",        change: -0.1, date: "Nov 2024" },
      eu:    { value: 2.3,  label: "HICP Eurozone",  change: -0.2, date: "Nov 2024" },
      uk:    { value: 2.6,  label: "CPI UK",        change: 0.3,  date: "Nov 2024" },
      fr:    { value: 1.7,  label: "IPC France",    change: -0.3, date: "Nov 2024" },
    },
    gdp: {
      us:  { value: 2.8,  label: "GDP US (T3)",       change: 0.1  },
      eu:  { value: 0.9,  label: "GDP Eurozone (T3)",  change: 0.3  },
      cn:  { value: 4.6,  label: "GDP Chine (T3)",     change: -0.2 },
      fr:  { value: 1.1,  label: "GDP France (T3)",    change: 0.2  },
    },
    yields: {
      us10y:  { value: 4.43, label: "US 10Y",   change: 0.18 },
      us2y:   { value: 4.29, label: "US 2Y",    change: 0.12 },
      de10y:  { value: 2.38, label: "Bund 10Y", change: 0.09 },
      fr10y:  { value: 3.07, label: "OAT 10Y",  change: 0.11 },
      uk10y:  { value: 4.42, label: "Gilt 10Y", change: 0.15 },
    },
    fx: {
      eurusd: { value: 1.054, label: "EUR/USD", change: -0.003 },
      gbpusd: { value: 1.268, label: "GBP/USD", change: -0.002 },
      usdjpy: { value: 151.8, label: "USD/JPY", change: 0.9    },
      usdchf: { value: 0.882, label: "USD/CHF", change: 0.001  },
    },
    commodities: {
      gold:   { value: 2635, label: "Or ($/oz)",      change: 12   },
      silver: { value: 31.2, label: "Argent ($/oz)",  change: 0.4  },
      crude:  { value: 71.2, label: "Pétrole WTI",    change: -0.8 },
      brent:  { value: 75.1, label: "Brent ($/bbl)",  change: -0.6 },
    },
    equityIndices: {
      sp500:  { value: 5893,  label: "S&P 500",       change: 0.74,  ytd: 26.5 },
      nasdaq: { value: 19218, label: "NASDAQ 100",    change: 0.82,  ytd: 28.1 },
      cac40:  { value: 7228,  label: "CAC 40",        change: -0.12, ytd: -2.3 },
      dax:    { value: 19404, label: "DAX 40",        change: 0.43,  ytd: 19.2 },
      stoxx:  { value: 4775,  label: "Euro Stoxx 50", change: 0.21,  ytd: 8.4  },
      nikkei: { value: 38283, label: "Nikkei 225",    change: 1.1,   ytd: 16.0 },
    },
    bigMac: [
      { country: "États-Unis",  price: 5.69, impliedRate: 1.000, actualRate: 1.000, overUnder: 0    },
      { country: "Zone Euro",   price: 5.12, impliedRate: 0.900, actualRate: 0.950, overUnder: -5.3 },
      { country: "Royaume-Uni", price: 4.98, impliedRate: 0.875, actualRate: 0.787, overUnder: -10.1},
      { country: "Suisse",      price: 7.01, impliedRate: 1.232, actualRate: 0.882, overUnder: 39.6 },
      { country: "Japon",       price: 4.19, impliedRate: 0.737, actualRate: 0.006, overUnder: -26.5},
      { country: "Chine",       price: 3.65, impliedRate: 0.642, actualRate: 0.138, overUnder: -35.8},
      { country: "Brésil",      price: 4.71, impliedRate: 0.828, actualRate: 0.190, overUnder: -17.2},
      { country: "Inde",        price: 2.62, impliedRate: 0.461, actualRate: 0.012, overUnder: -53.9},
    ],
  };
}
