import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Locale FR : séparateur de milliers = espace insecable, décimale = virgule
const FR = new Intl.NumberFormat("fr-FR");

function frNum(value: number, decimals: number): string {
  return value.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Format valeur monétaire en €, style français */
export function fmt(value: number, decimals = 2, currency = "€"): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}${currency}${frNum(abs / 1_000_000, 2)} M`;
  if (abs >= 1_000)     return `${sign}${currency}${frNum(abs / 1_000, 1)} K`;
  return `${sign}${currency}${frNum(abs, decimals)}`;
}

/** Format pourcentage style français */
export function fmtPct(value: number, decimals = 2): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${frNum(value, decimals)} %`;
}

/** Format nombre brut sans devise */
export function fmtNum(value: number, decimals = 2): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${frNum(abs / 1_000_000, 2)} M`;
  if (abs >= 1_000)     return `${sign}${frNum(abs / 1_000, 1)} K`;
  return `${sign}${frNum(abs, decimals)}`;
}

/** Color class based on value sign */
export function colorClass(value: number): string {
  if (value > 0) return "pos";
  if (value < 0) return "neg";
  return "neutral";
}

/** Heatmap color for P&L percentage (−30% to +30%) */
export function heatmapColor(pct: number, isDark = true): string {
  const clamped = Math.max(-30, Math.min(30, pct));
  if (isDark) {
    if (clamped > 20) return "#006b2e";
    if (clamped > 10) return "#008c3a";
    if (clamped > 3)  return "#00a845";
    if (clamped > 0)  return "#1a6b35";
    if (clamped > -3) return "#6b1a2a";
    if (clamped > -10) return "#8c002a";
    if (clamped > -20) return "#a8003b";
    return "#cc0044";
  } else {
    if (clamped > 20) return "#d4f0dc";
    if (clamped > 10) return "#b0e8c4";
    if (clamped > 3)  return "#8dd4a8";
    if (clamped > 0)  return "#c8ecd6";
    if (clamped > -3) return "#f5d0d8";
    if (clamped > -10) return "#f0a8b8";
    if (clamped > -20) return "#e87894";
    return "#d94070";
  }
}

/** Asset class badge CSS class */
export function assetBadgeClass(assetClass: string): string {
  const map: Record<string, string> = {
    "Action": "badge-action",
    "ETF": "badge-etf",
    "Crypto": "badge-crypto",
    "Obligation": "badge-obligation",
    "Cash": "badge-cash",
  };
  return map[assetClass] ?? "badge-action";
}
