/**
 * shared/currency.ts
 * ===================
 * LSE-listed stocks and ETFs are quoted by Yahoo Finance in British pence
 * (currency code "GBp", sometimes "GBX" from other vendors), not pounds
 * sterling. 100 pence = 1 GBP — divide the raw Yahoo price by 100 before
 * any GBP→EUR/USD conversion, or portfolio values are inflated 100x.
 *
 * Used by every Yahoo Finance fetch path (server + client fallback) so the
 * same normalization rule applies everywhere a raw quote enters the app.
 */
export function normalizeGbx(
  price: number,
  currency: string | null | undefined
): { price: number; currency: string } {
  const cur = currency ?? "USD";
  if (cur === "GBp" || cur.toUpperCase() === "GBX") {
    return { price: price / 100, currency: "GBP" };
  }
  return { price, currency: cur };
}
