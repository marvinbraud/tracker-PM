/**
 * marketData.ts — Live price fetcher
 * ====================================
 * Calls /api/quote (→ Netlify Function → Yahoo Finance).
 * Works on deployed site. During local dev, use `netlify dev` instead of
 * `npm run dev` so the function is available at the same origin.
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

const BATCH_SIZE = 20; // Yahoo Finance handles up to ~40 but 20 is safe

/**
 * Fetches live quotes for a list of tickers.
 * Returns a map { ticker → LiveQuote } for every ticker that was found.
 * Tickers not found (delisted, wrong symbol) are silently omitted.
 */
export async function fetchLivePrices(
  tickers: string[]
): Promise<Record<string, LiveQuote>> {
  if (!tickers.length) return {};

  const results: Record<string, LiveQuote> = {};

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE).join(",");

    try {
      const res = await fetch(
        `/api/quote?symbols=${encodeURIComponent(batch)}`,
        { signal: AbortSignal.timeout(10_000) }
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
            ticker: q.symbol,
            price: q.regularMarketPrice,
            changePercent: q.regularMarketChangePercent ?? 0,
            prevClose: q.regularMarketPreviousClose ?? q.regularMarketPrice,
            currency: q.currency ?? "USD",
            name: q.shortName ?? undefined,
            marketState: q.marketState ?? undefined,
          };
        }
      }
    } catch (err) {
      // Network error, timeout, or function not available (local dev without netlify dev)
      console.warn("[marketData] fetch error:", err);
    }
  }

  return results;
}
