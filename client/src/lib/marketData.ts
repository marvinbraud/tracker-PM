/**
 * marketData.ts — Live price fetcher
 * ====================================
 * Strategy:
 *   1. Call /api/quote (Express → yahoo-finance2 → Yahoo Finance) — server-side, handles crumb/cookies.
 *   2. If the server returns no results (blocked IP, cold start), fall back to direct browser calls
 *      to the Yahoo Finance v8 chart endpoint, which has CORS headers and uses the user's IP.
 */

export interface LiveQuote {
  ticker: string;
  price: number;
  changePercent: number;
  prevClose: number;
  currency: string;
  name?: string;
  marketState?: string; // "REGULAR" | "PRE" | "POST" | "CLOSED"
}

const BATCH_SIZE   = 20;   // symbols per server request
const DIRECT_DELAY = 120;  // ms between direct browser calls (avoid rate-limit)

// ─── 1. Server proxy (primary) ───────────────────────────────────────────────

async function fetchViaSever(tickers: string[]): Promise<Record<string, LiveQuote>> {
  const results: Record<string, LiveQuote> = {};

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE).join(",");
    try {
      const res = await fetch(
        `/api/quote?symbols=${encodeURIComponent(batch)}`,
        { signal: AbortSignal.timeout(12_000) }
      );
      if (!res.ok) {
        console.warn(`[marketData] /api/quote returned ${res.status}`);
        continue;
      }
      const data = await res.json();
      const quotes: any[] = data?.quoteResponse?.result ?? [];
      for (const q of quotes) {
        if (q.regularMarketPrice != null) {
          results[q.symbol] = {
            ticker:        q.symbol,
            price:         q.regularMarketPrice,
            changePercent: q.regularMarketChangePercent ?? 0,
            prevClose:     q.regularMarketPreviousClose ?? q.regularMarketPrice,
            currency:      q.currency   ?? "USD",
            name:          q.shortName  ?? undefined,
            marketState:   q.marketState ?? undefined,
          };
        }
      }
    } catch (err) {
      console.warn("[marketData] server fetch error:", err);
    }
  }

  return results;
}

// ─── 2. Direct browser fallback (v8 chart, CORS enabled) ────────────────────

async function fetchViaBrowser(tickers: string[]): Promise<Record<string, LiveQuote>> {
  const results: Record<string, LiveQuote> = {};

  for (const ticker of tickers) {
    try {
      const url =
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
        `?range=1d&interval=1d&includePrePost=false`;

      const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
      if (!res.ok) continue;

      const data  = await res.json();
      const meta  = data?.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) continue;

      const price    = meta.regularMarketPrice as number;
      const prevClose =
        (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
      const changePercent =
        prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

      results[ticker] = {
        ticker,
        price,
        changePercent,
        prevClose,
        currency:    meta.currency    ?? "USD",
        marketState: meta.marketState ?? undefined,
      };
    } catch (err) {
      console.warn("[marketData] direct fetch failed for", ticker, (err as Error)?.message);
    }

    // Small delay to stay under Yahoo Finance rate limit
    await new Promise(r => setTimeout(r, DIRECT_DELAY));
  }

  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches live quotes for a list of tickers.
 * Returns a map { ticker → LiveQuote } for every ticker resolved.
 * Tickers not found (delisted / wrong symbol) are silently omitted.
 */
export async function fetchLivePrices(
  tickers: string[]
): Promise<Record<string, LiveQuote>> {
  if (!tickers.length) return {};

  // Primary: server proxy with yahoo-finance2
  const serverResults = await fetchViaSever(tickers);

  // Find which tickers the server didn't return
  const missing = tickers.filter(t => !serverResults[t]);

  if (missing.length === 0) return serverResults;

  console.info(`[marketData] server missed ${missing.length} tickers, trying direct browser fetch`);

  // Fallback: direct browser → Yahoo Finance v8 chart (uses user's IP, not server IP)
  const directResults = await fetchViaBrowser(missing);

  return { ...serverResults, ...directResults };
}
