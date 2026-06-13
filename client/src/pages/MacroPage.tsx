import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Globe, Activity, Pizza, DollarSign, BarChart2 } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface StatCard {
  label: string;
  value: string;
  sub?: string;
  delta?: number;
  color?: string;
}

const s = {
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-lg)",
    padding: "10px 14px",
    boxShadow: "var(--shadow-xs)",
  } as React.CSSProperties,
  label: {
    fontSize: "9px",
    color: "var(--text-faint)",
    letterSpacing: "0.08em",
    fontWeight: 700,
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
  subHeader: {
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: "var(--accent)",
    padding: "6px 0 4px",
    borderBottom: "1px solid var(--divider)",
    marginBottom: "6px",
    display: "flex",
    alignItems: "center",
    gap: "5px",
  } as React.CSSProperties,
};

function Delta({ v }: { v?: number }) {
  if (v === undefined) return null;
  const color = v > 0 ? "var(--positive)" : v < 0 ? "var(--negative)" : "var(--text-faint)";
  const Icon  = v > 0 ? TrendingUp : v < 0 ? TrendingDown : Minus;
  return (
    <span style={{ fontSize: "10px", color, display: "flex", alignItems: "center", gap: "2px", marginTop: "2px" }}>
      <Icon size={9} />{v > 0 ? "+" : ""}{v.toFixed(2)}%
    </span>
  );
}

function SectionBar({ icon, title, note }: { icon?: React.ReactNode; title: string; note?: string }) {
  return (
    <div className="bb-section-bar" style={{ marginBottom: "10px" }}>
      {icon && <span>{icon}</span>}
      {title}
      {note && (
        <span style={{ marginLeft: "auto", fontSize: "8px", fontWeight: 700, letterSpacing: "0.06em",
          color: "var(--text-faint)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", padding: "1px 5px" }}>
          {note}
        </span>
      )}
    </div>
  );
}

// ─── 1. INDICES MONDIAUX — live via Yahoo Finance ────────────────────────────

const LIVE_INDICES = [
  { key: "SPX",   ticker: "^GSPC",   label: "S&P 500",    color: "#ef4444", region: "🇺🇸", name: "S&P 500",    sub: "US Large Cap"  },
  { key: "NDX",   ticker: "^NDX",    label: "NASDAQ 100", color: "#3b82f6", region: "🇺🇸", name: "NASDAQ 100", sub: "US Tech"        },
  { key: "CAC",   ticker: "^FCHI",   label: "CAC 40",     color: "#60a5fa", region: "🇫🇷", name: "CAC 40",     sub: "France"         },
  { key: "DAX",   ticker: "^GDAXI",  label: "DAX 40",     color: "#eab308", region: "🇩🇪", name: "DAX 40",     sub: "Germany"        },
  { key: "NI225", ticker: "^N225",   label: "Nikkei 225", color: "#ec4899", region: "🇯🇵", name: "Nikkei 225", sub: "Japan"          },
  { key: "MXWO",  ticker: "IWDA.AS", label: "MSCI World", color: "#22d3ee", region: "🌍",  name: "MSCI World", sub: "Dev. Mkts"      },
  { key: "MXEF",  ticker: "EEM",     label: "MSCI EM",    color: "#f97316", region: "🌏",  name: "MSCI EM",    sub: "Emerging Mkts"  },
  { key: "HSI",   ticker: "^HSI",    label: "Hang Seng",  color: "#22c55e", region: "🇭🇰", name: "Hang Seng",  sub: "Hong Kong"      },
] as const;

type SeriesKey = typeof LIVE_INDICES[number]["key"];

interface LiveQuote { price: number; dayChange: number; ytd: number }
interface SeriesHistory { dates: string[]; closes: number[] }

// Indices data is now fetched server-side to avoid CORS issues
// The _fetchYtd function is kept for typing reference only

function _buildChartData(all: Partial<Record<SeriesKey, SeriesHistory | null>>): Record<string, number | string>[] {
  // Find the series with the most data points → master date axis
  const sorted = Object.entries(all)
    .filter(([,s]) => s != null)
    .sort(([,a],[,b]) => (b?.dates.length ?? 0) - (a?.dates.length ?? 0));
  if (!sorted.length) return [];
  const [masterKey, masterSeries] = sorted[0] as [SeriesKey, SeriesHistory];

  return masterSeries.dates.map((d, i) => {
    const point: Record<string, number | string> = { d };
    for (const { key } of LIVE_INDICES) {
      const s = all[key];
      if (!s || s.closes.length < 1) continue;
      const firstClose = s.closes[0];
      // Match by exact date label or fall back to positional index
      const idx = s.dates.indexOf(d);
      const close = idx >= 0 ? s.closes[idx] : s.closes[Math.min(i, s.closes.length - 1)];
      point[key] = parseFloat(((close / firstClose - 1) * 100).toFixed(2));
    }
    return point;
  });
}

function useIndexHistory() {
  const today = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });

  const { data: rawData, isLoading } = useQuery<Partial<Record<SeriesKey, SeriesHistory | null>>>({
    queryKey: ["/api/indices-ytd"],
    staleTime: 5 * 60 * 1000, // 5 min
    retry: 2,
  });

  const all = rawData ?? {};
  const quotes: Partial<Record<SeriesKey, LiveQuote>> = {};
  for (const { key } of LIVE_INDICES) {
    const s = all[key];
    if (s && s.closes.length >= 2) {
      const first = s.closes[0], last = s.closes[s.closes.length - 1];
      const prev  = s.closes[s.closes.length - 2];
      quotes[key] = {
        price:     last,
        dayChange: prev > 0 ? ((last - prev) / prev) * 100 : 0,
        ytd:       parseFloat(((last / first - 1) * 100).toFixed(2)),
      };
    }
  }

  return {
    chartData: _buildChartData(all),
    quotes,
    loading: isLoading,
    updatedAt: today,
  };
}

function IndicesSection() {
  const { chartData, quotes, loading, updatedAt } = useIndexHistory();
  const [visible, setVisible] = useState<Set<SeriesKey>>(
    () => new Set(LIVE_INDICES.map(s => s.key))
  );

  function toggle(key: SeriesKey) {
    setVisible(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // Dynamic Y domain from chart data
  const allVals = chartData.flatMap(pt =>
    LIVE_INDICES.filter(idx => visible.has(idx.key)).map(idx => pt[idx.key] as number).filter(v => typeof v === "number")
  );
  const yMin = allVals.length ? Math.floor(Math.min(...allVals) / 5) * 5 - 5 : -20;
  const yMax = allVals.length ? Math.ceil(Math.max(...allVals) / 5) * 5 + 5 : 30;

  return (
    <div>
      <SectionBar icon={<Globe size={12} />} title="GLOBAL INDICES" />

      {/* Index cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "6px", marginBottom: "12px" }}>
        {LIVE_INDICES.map(idx => {
          const q = quotes[idx.key];
          const priceStr = q ? q.price.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) : "—";
          const ytd   = q?.ytd ?? null;
          const chg   = q?.dayChange ?? null;
          return (
            <div key={idx.key} style={{ ...s.card, display: "flex", flexDirection: "column", gap: "2px", opacity: loading && !q ? 0.5 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: "10px", color: idx.color, fontWeight: 700, letterSpacing: "0.06em" }}>{idx.key}</span>
                <span style={{ fontSize: "10px" }}>{idx.region}</span>
              </div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{priceStr}</div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {chg !== null && (
                  <span style={{ fontSize: "10px", color: chg >= 0 ? "var(--positive)" : "var(--negative)", display: "flex", alignItems: "center", gap: "2px" }}>
                    {chg >= 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                    {chg > 0 ? "+" : ""}{chg.toFixed(2)}%
                  </span>
                )}
                {ytd !== null && (
                  <span style={{ fontSize: "9px", color: ytd >= 0 ? "var(--positive)" : "var(--negative)" }}>
                    YTD {ytd > 0 ? "+" : ""}{ytd.toFixed(2)}%
                  </span>
                )}
              </div>
              <div style={{ fontSize: "9px", color: "var(--text-faint)" }}>{idx.name}</div>
            </div>
          );
        })}
      </div>

      {/* Chart */}
      <div style={s.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "6px" }}>
          <div style={{ ...s.label }}>
            COMPARATIVE PERFORMANCE 2026 YTD (%) — BASE 0 ON 1/01/2026 · UPDATED {updatedAt}
            {loading && <span style={{ marginLeft: "6px", color: "var(--accent)" }}>⟳ Loading…</span>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {LIVE_INDICES.map(({ key, label, color }) => {
              const on = visible.has(key);
              return (
                <button key={key} onClick={() => toggle(key)} style={{
                  fontSize: "9px", padding: "2px 8px", borderRadius: "var(--r-full)",
                  border: `1px solid ${color}`, cursor: "pointer",
                  background: on ? `${color}22` : "transparent",
                  color: on ? color : "var(--text-faint)",
                  opacity: on ? 1 : 0.45, transition: "all 0.15s",
                }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" />
            <XAxis dataKey="d" tick={{ fontSize: 9, fill: "var(--text-faint)" }} interval="preserveStartEnd" />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fontSize: 9, fill: "var(--text-faint)" }}
              tickFormatter={v => `${v > 0 ? "+" : ""}${v}%`}
            />
            <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: "10px", borderRadius: "8px" }}
              formatter={(v: any, name: any) => [`${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}%`, name]}
            />
            {LIVE_INDICES.map(({ key, label, color }) =>
              visible.has(key) ? (
                <Line key={key} type="monotone" dataKey={key} stroke={color} strokeWidth={2}
                  dot={false} name={label} activeDot={{ r: 4, fill: color }} />
              ) : null
            )}
          </LineChart>
        </ResponsiveContainer>
        <div style={{ fontSize: "9px", color: "var(--text-faint)", marginTop: "4px" }}>
          Live data via Yahoo Finance · % change since Jan 1st 2026 · Click on an index to show/hide
        </div>
      </div>
    </div>
  );
}

// ─── 2. INDICATEURS MACRO — REGROUPÉS ────────────────────────────────────────
// Les taux directeurs (Fed, BCE, BoJ) sont retirés → gérés dans "Banques Centrales"
// Fear & Greed retiré → fusionné avec Pentagon Pizza

// ─── Date helpers — the page always reads the real current date ─────────────
const MONTHS_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function todayISO(): string {
  // Local date as yyyy-mm-dd (avoids UTC off-by-one near midnight)
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtISO(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_EN[m - 1]} ${y}`;
}

// ─── Live market hook (server proxy → Yahoo) — FX, vol, commodities, crypto ──
interface MktQuote { price: number; change: number }
type MktKey =
  | "EURUSD" | "USDJPY" | "USDCNY" | "GBPUSD" | "USDCHF" | "DXY"
  | "VIX" | "MOVE"
  | "GOLD" | "SILVER" | "WTI" | "BRENT" | "COPPER" | "NATGAS"
  | "BTC";

// Fallback used only when the live endpoint is unreachable.
// Real values captured 13 Jun 2026 (Yahoo); the live feed overrides them.
const MKT_FALLBACK: Record<MktKey, MktQuote> = {
  EURUSD: { price: 1.1573, change: -0.05 }, USDJPY: { price: 160.19, change:  0.17 },
  USDCNY: { price: 6.762,  change: -0.19 }, GBPUSD: { price: 1.3407, change: -0.07 },
  USDCHF: { price: 0.7964, change:  0.24 }, DXY:    { price: 99.81,  change: -0.24 },
  VIX:    { price: 17.68,  change: -9.05 }, MOVE:   { price: 78.0,   change:  0.0  },
  GOLD:   { price: 4238.8, change: -2.24 }, SILVER: { price: 67.97,  change: -0.66 },
  WTI:    { price: 84.88,  change: -7.03 }, BRENT:  { price: 87.33,  change: -7.34 },
  COPPER: { price: 6.445,  change:  1.82 }, NATGAS: { price: 3.12,   change: -0.86 },
  BTC:    { price: 63921,  change:  3.69 },
};

function useMacroMarkets() {
  const { data } = useQuery<Record<string, MktQuote | null>>({
    queryKey: ["/api/macro-markets"],
    staleTime: 10 * 60 * 1000, // 10 min
    retry: 1,
  });
  const mkt: Record<MktKey, MktQuote> = { ...MKT_FALLBACK };
  let live = false;
  if (data) {
    for (const k of Object.keys(MKT_FALLBACK) as MktKey[]) {
      const v = data[k];
      if (v && typeof v.price === "number" && v.price > 0) { mkt[k] = v; live = true; }
    }
  }
  return { mkt, live };
}

function frNum(n: number, digits: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
// US dollar price formatting (thousands separator, no decimals over 1000)
function usd(n: number): string {
  const digits = n >= 1000 ? 0 : n >= 100 ? 1 : 2;
  return "$" + n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
// VIX risk label/color by level
function vixState(v: number): { sub: string; color: string } {
  if (v >= 30) return { sub: "High fear",     color: "var(--negative)" };
  if (v >= 20) return { sub: "Elevated",      color: "#f97316" };
  if (v >= 15) return { sub: "Normal",        color: "var(--warning)" };
  return            { sub: "Calm / low vol", color: "var(--positive)" };
}

// Macro indicators — FX / vol / commodity cards are LIVE; macro prints are latest reported.
function buildMacroGroups(mkt: Record<MktKey, MktQuote>): { label: string; icon: string; items: StatCard[] }[] {
  const vix = vixState(mkt.VIX.price);
  return [
    {
      label: "United States",
      icon: "🇺🇸",
      items: [
        { label: "CPI YoY",    value: "4,2%",   sub: "May 2026 · BLS",                 delta: +0.4  },
        { label: "Fed Funds",  value: "3,50–3,75%", sub: "Effective 3,63% · held",    delta: 0     },
        { label: "GDP QoQ",    value: "+2,3%",  sub: "Q4 2025",                        delta: -0.2  },
        { label: "US 10Y",     value: "4,48%",  sub: "Treasury · 12 Jun",              delta: -1.5  },
        { label: "DXY",        value: frNum(mkt.DXY.price, 1),    sub: "Dollar Index · live", delta: mkt.DXY.change    },
      ],
    },
    {
      label: "Euro Zone",
      icon: "🇪🇺",
      items: [
        { label: "CPI HICP",   value: "2,3%",   sub: "Euro Zone · latest"             },
        { label: "EUR / USD",  value: frNum(mkt.EURUSD.price, 4), sub: "Spot · live",   delta: mkt.EURUSD.change  },
        { label: "GBP / USD",  value: frNum(mkt.GBPUSD.price, 4), sub: "Spot · live",   delta: mkt.GBPUSD.change  },
        { label: "USD / CHF",  value: frNum(mkt.USDCHF.price, 4), sub: "Spot · live",   delta: mkt.USDCHF.change  },
      ],
    },
    {
      label: "Asia & Japan",
      icon: "🇯🇵",
      items: [
        { label: "USD / JPY",  value: frNum(mkt.USDJPY.price, 2), sub: "Spot · live",   delta: mkt.USDJPY.change  },
        { label: "CPI Japon",  value: "2,2%",   sub: "latest · BoJ",                  delta: +0.1  },
        { label: "GDP Chine",  value: "+4,5%",  sub: "Q4 2025 · NBS"                 },
        { label: "USD / CNY",  value: frNum(mkt.USDCNY.price, 3), sub: "Spot · live",   delta: mkt.USDCNY.change  },
      ],
    },
    {
      label: "Sentiment & Risk",
      icon: "📊",
      items: [
        { label: "VIX",        value: frNum(mkt.VIX.price, 2),  sub: vix.sub + " · live", delta: mkt.VIX.change, color: vix.color },
        { label: "MOVE Index", value: frNum(mkt.MOVE.price, 1), sub: "Bond vol · live",   delta: mkt.MOVE.change },
        { label: "PMI Mfg",    value: "51,2",   sub: "latest · S&P Global",           delta: +0.8  },
        { label: "PMI Svcs",   value: "53,0",   sub: "Expanding",                     delta: +0.3  },
      ],
    },
    {
      label: "Commodities & Crypto",
      icon: "🛢️",
      items: [
        { label: "WTI Crude",  value: usd(mkt.WTI.price),    sub: "/bbl · live",  delta: mkt.WTI.change    },
        { label: "Brent",      value: usd(mkt.BRENT.price),  sub: "/bbl · live",  delta: mkt.BRENT.change  },
        { label: "Gold",       value: usd(mkt.GOLD.price),   sub: "/oz · live",   delta: mkt.GOLD.change   },
        { label: "Silver",     value: usd(mkt.SILVER.price), sub: "/oz · live",   delta: mkt.SILVER.change },
      ],
    },
  ];
}

function MacroStatsSection() {
  const { mkt, live } = useMacroMarkets();
  const MACRO_GROUPS = buildMacroGroups(mkt);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionBar icon={<Activity size={12} />} title="KEY MACRO INDICATORS" />
        <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", marginBottom: "10px",
          color: live ? "var(--positive)" : "var(--text-faint)" }}>
          {live ? "● LIVE" : "○ CACHED"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {MACRO_GROUPS.map(group => (
          <div key={group.label}>
            <div style={s.subHeader}>
              <span>{group.icon}</span>
              <span>{group.label}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "5px" }}>
              {group.items.map((stat, i) => (
                <div key={i} style={{ ...s.card, borderLeft: stat.color ? `3px solid ${stat.color}` : undefined }}>
                  <div style={s.label}>{stat.label}</div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: stat.color || "var(--text)", marginTop: "2px", fontVariantNumeric: "tabular-nums" }}>
                    {stat.value}
                  </div>
                  {stat.sub   && <div style={{ fontSize: "9px", color: "var(--text-faint)", marginTop: "1px" }}>{stat.sub}</div>}
                  {stat.delta !== undefined && <Delta v={stat.delta} />}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 3. BANQUES CENTRALES (inclut les taux directeurs) ────────────────────────

interface CBMeeting { date: string; label: string }  // date = yyyy-mm-dd
interface CentralBank {
  name: string; fullName: string; rate: string; trend: "cut" | "hike" | "hold"; color: string;
  nextExpected: string; inflation: string; gdp: string;
  meetings: CBMeeting[];
  note?: string;  // for banks without a fixed-date calendar (PBOC)
}

// Official 2026 policy-meeting calendars. Past/upcoming status is computed from
// the real current date — no manual "✓" to maintain.
const CENTRAL_BANKS: CentralBank[] = [
  {
    name: "Fed", fullName: "Federal Reserve", rate: "3.50–3.75%", trend: "hold", color: "#3b82f6",
    nextExpected: "Hold — sticky inflation (CPI 4.2%)", inflation: "4.2%", gdp: "+2.3%",
    meetings: [
      { date: "2026-01-28", label: "28 Jan" }, { date: "2026-03-18", label: "18 Mar" },
      { date: "2026-04-29", label: "29 Apr" }, { date: "2026-06-17", label: "17 Jun" },
      { date: "2026-07-29", label: "29 Jul" }, { date: "2026-09-16", label: "16 Sep" },
      { date: "2026-10-28", label: "28 Oct" }, { date: "2026-12-09", label: "9 Dec" },
    ],
  },
  {
    name: "BCE", fullName: "European Central Bank", rate: "2.25%", trend: "hike", color: "#f59e0b",
    nextExpected: "Hold after June +25bp hike", inflation: "2.3%", gdp: "+0.8%",
    meetings: [
      { date: "2026-02-05", label: "5 Feb" }, { date: "2026-03-19", label: "19 Mar" },
      { date: "2026-04-30", label: "30 Apr" }, { date: "2026-06-11", label: "11 Jun" },
      { date: "2026-07-23", label: "23 Jul" }, { date: "2026-09-10", label: "10 Sep" },
      { date: "2026-10-29", label: "29 Oct" }, { date: "2026-12-17", label: "17 Dec" },
    ],
  },
  {
    name: "BoE", fullName: "Bank of England", rate: "3.75%", trend: "hold", color: "#10b981",
    nextExpected: "Hold", inflation: "2.8%", gdp: "+0.9%",
    meetings: [
      { date: "2026-02-05", label: "5 Feb" }, { date: "2026-03-19", label: "19 Mar" },
      { date: "2026-04-30", label: "30 Apr" }, { date: "2026-06-18", label: "18 Jun" },
      { date: "2026-07-30", label: "30 Jul" }, { date: "2026-09-17", label: "17 Sep" },
      { date: "2026-11-05", label: "5 Nov" }, { date: "2026-12-17", label: "17 Dec" },
    ],
  },
  {
    name: "BoJ", fullName: "Bank of Japan", rate: "0.75%", trend: "hike", color: "#ec4899",
    nextExpected: "Hold → gradual hikes", inflation: "2.2%", gdp: "+0.8%",
    meetings: [
      { date: "2026-01-24", label: "24 Jan" }, { date: "2026-03-19", label: "19 Mar" },
      { date: "2026-04-30", label: "30 Apr" }, { date: "2026-06-17", label: "17 Jun" },
      { date: "2026-07-30", label: "30 Jul" }, { date: "2026-09-18", label: "18 Sep" },
      { date: "2026-10-29", label: "29 Oct" }, { date: "2026-12-18", label: "18 Dec" },
    ],
  },
  {
    name: "PBOC", fullName: "People's Bank of China", rate: "3.10%", trend: "cut", color: "#ef4444",
    nextExpected: "Accommodative — stimulus ongoing", inflation: "0.1%", gdp: "+4.5%",
    meetings: [],
    note: "No fixed schedule — LPR set monthly. Stance: accommodative, pro-consumer stimulus.",
  },
  {
    name: "SNB", fullName: "Swiss National Bank", rate: "0.25%", trend: "hold", color: "#8b5cf6",
    nextExpected: "Hold / −25bp", inflation: "0.4%", gdp: "+1.3%",
    meetings: [
      { date: "2026-03-19", label: "19 Mar" }, { date: "2026-06-18", label: "18 Jun" },
      { date: "2026-09-24", label: "24 Sep" }, { date: "2026-12-11", label: "11 Dec" },
    ],
  },
];

const TREND_ICONS:  Record<string, string> = { cut: "▼ Easing", hike: "▲ Tightening", hold: "◆ On hold" };
const TREND_COLORS: Record<string, string> = { cut: "var(--positive)", hike: "var(--negative)", hold: "var(--warning)" };

function CentralBanksSection() {
  const [selected, setSelected] = useState("Fed");
  const cb = CENTRAL_BANKS.find(b => b.name === selected) ?? CENTRAL_BANKS[0];

  const iso  = todayISO();
  const next = cb.meetings.find(m => m.date >= iso);  // first upcoming meeting
  const pastCount = cb.meetings.filter(m => m.date < iso).length;

  return (
    <div>
      <SectionBar icon={<Activity size={12} />} title="CENTRAL BANKS — POLICY RATES & CALENDAR" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        {/* Left: rate cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          {CENTRAL_BANKS.map(bank => (
            <button key={bank.name} onClick={() => setSelected(bank.name)} style={{
              ...s.card, display: "flex", alignItems: "center", gap: "10px",
              cursor: "pointer", textAlign: "left", color: "var(--text)",
              borderColor: selected === bank.name ? bank.color : "var(--border)",
              background: selected === bank.name ? `${bank.color}22` : "var(--surface)",
              transition: "all 0.15s",
            }}>
              <div style={{ width: "3px", height: "30px", background: bank.color, borderRadius: "2px", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: bank.color }}>{bank.name}</span>
                  <span style={{ fontSize: "13px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>{bank.rate}</span>
                </div>
                <div style={{ fontSize: "9px", color: TREND_COLORS[bank.trend] }}>{TREND_ICONS[bank.trend]}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Right: calendar detail */}
        <div style={{ ...s.card, display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ borderBottom: "1px solid var(--divider)", paddingBottom: "8px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: cb.color, marginBottom: "6px" }}>{cb.fullName}</div>
            <div style={{ display: "flex", gap: "20px" }}>
              {[
                { l: "RATE", v: cb.rate, big: true },
                { l: "INFLATION", v: cb.inflation },
                { l: "GDP", v: cb.gdp },
              ].map(({ l, v, big }) => (
                <div key={l}>
                  <div style={s.label}>{l}</div>
                  <div style={{ fontSize: big ? "22px" : "14px", fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: "2px", color: big ? "var(--primary)" : "var(--text)" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ ...s.label, marginBottom: "5px" }}>NEXT MEETING</div>
            <div style={{ fontSize: "12px", color: "var(--accent)", fontWeight: 600 }}>
              {next ? fmtISO(next.date) : "—"}
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>Consensus: {cb.nextExpected}</div>
          </div>
          <div>
            <div style={{ ...s.label, marginBottom: "5px", display: "flex", justifyContent: "space-between" }}>
              <span>2026 CALENDAR</span>
              {cb.meetings.length > 0 && (
                <span style={{ color: "var(--positive)", fontWeight: 700 }}>
                  {pastCount}/{cb.meetings.length} done
                </span>
              )}
            </div>
            {cb.meetings.length === 0 ? (
              <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.6 }}>{cb.note}</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {cb.meetings.map((m, i) => {
                  const done   = m.date < iso;
                  const isNext = next?.date === m.date;
                  const bg     = done ? "var(--positive-bg)" : isNext ? `${cb.color}22` : "var(--surface-offset)";
                  const fg     = done ? "var(--positive)"    : isNext ? cb.color        : "var(--text-muted)";
                  const bd     = done ? "var(--positive)"    : isNext ? cb.color        : "var(--border)";
                  return (
                    <span key={i} style={{
                      fontSize: "9px", padding: "3px 6px",
                      background: bg, color: fg, border: `1px solid ${bd}`,
                      borderRadius: "var(--r-sm)", fontWeight: isNext ? 700 : 400,
                    }}>
                      {m.label}{done ? " ✓" : isNext ? " •" : ""}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 4. YIELD CURVE ──────────────────────────────────────────────────────────

// US Treasury par yields — 12 Jun 2026 (yield) vs 5 Jun 2026 (prev). Source: US Treasury.
const YIELD_DATA = [
  { maturity: "1M", yield: 3.69, prev: 3.71 },
  { maturity: "3M", yield: 3.78, prev: 3.78 },
  { maturity: "6M", yield: 3.82, prev: 3.81 },
  { maturity: "1Y", yield: 3.86, prev: 3.88 },
  { maturity: "2Y", yield: 4.09, prev: 4.17 },
  { maturity: "5Y", yield: 4.21, prev: 4.29 },
  { maturity: "7Y", yield: 4.34, prev: 4.41 },
  { maturity: "10Y",yield: 4.48, prev: 4.55 },
  { maturity: "20Y",yield: 4.98, prev: 5.03 },
  { maturity: "30Y",yield: 4.97, prev: 5.01 },
];

function YieldCurveSection() {
  return (
    <div>
      <SectionBar icon={<TrendingUp size={12} />} title="YIELD CURVE — US TREASURIES" note="SNAPSHOT · 12 JUN" />
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
        <div style={s.card}>
          <div style={{ ...s.label, marginBottom: "8px" }}>US YIELD CURVE (12 JUN 2026)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={YIELD_DATA} margin={{ top: 4, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" />
              <XAxis dataKey="maturity" tick={{ fontSize: 9, fill: "var(--text-faint)" }} />
              <YAxis domain={[3.5, 5.0]} tick={{ fontSize: 9, fill: "var(--text-faint)" }} tickFormatter={v => `${v}%`} />
              <Tooltip
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: "10px", borderRadius: "8px" }}
                formatter={(v: any) => [`${v.toFixed(2)}%`]}
              />
              <Line type="monotone" dataKey="yield" stroke="var(--primary)" strokeWidth={2} dot={{ fill: "var(--primary)", r: 3 }} name="Actuel" />
              <Line type="monotone" dataKey="prev" stroke="var(--text-faint)" strokeWidth={1} strokeDasharray="4 2" dot={false} name="Sem. préc." />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={s.card}>
            <div style={s.label}>KEY SPREADS</div>
            <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "5px" }}>
              {[
                { label: "10Y − 2Y", value: "+0.39%", color: "var(--positive)", note: "Normal"  },
                { label: "30Y − 5Y", value: "+0.76%", color: "var(--positive)", note: "Steep"   },
                { label: "10Y − 3M", value: "+0.70%", color: "var(--positive)", note: "Positive"},
              ].map(sp => (
                <div key={sp.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--divider)" }}>
                  <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>{sp.label}</span>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: sp.color, fontVariantNumeric: "tabular-nums" }}>{sp.value}</div>
                    <div style={{ fontSize: "8px", color: sp.color }}>{sp.note}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={s.card}>
            <div style={s.label}>KEY RATES</div>
            <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
              {YIELD_DATA.filter(d => ["2Y","5Y","10Y","30Y"].includes(d.maturity)).map(t => (
                <div key={t.maturity} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{t.maturity}</span>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: t.yield > t.prev ? "var(--negative)" : "var(--positive)", fontVariantNumeric: "tabular-nums" }}>
                    {t.yield.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 5. BIG MAC INDEX ─────────────────────────────────────────────────────────

const BIG_MAC_DATA = [
  { country: "🇨🇭 Suisse",      price: 7.99, diff:  38.0  },
  { country: "🇦🇷 Argentine",   price: 6.95, diff:  20.1  },
  { country: "🇳🇴 Norvège",     price: 6.67, diff:  15.3  },
  { country: "🇺🇸 États-Unis",  price: 5.79, diff:   0,   isBase: true },
  { country: "🇬🇧 Royaume-Uni", price: 5.73, diff:  -1.1  },
  { country: "🇪🇺 Zone Euro",   price: 5.56, diff:  -4.0  },
  { country: "🇯🇵 Japon",       price: 3.11, diff: -46.3  },
  { country: "🇨🇳 Chine",       price: 3.52, diff: -39.2  },
  { country: "🇮🇳 Inde",        price: 2.62, diff: -54.8  },
  { country: "🇧🇷 Brésil",      price: 4.03, diff: -30.5  },
  { country: "🇰🇷 Corée",       price: 3.84, diff: -33.6  },
  { country: "🇵🇱 Pologne",     price: 5.21, diff: -10.0  },
];

function BigMacSection() {
  return (
    <div>
      <SectionBar icon={<DollarSign size={12} />} title="BIG MAC INDEX — PURCHASING POWER PARITY (PPP)" note="STATIC · ECONOMIST 2025" />
      <div style={s.card}>
        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "10px", lineHeight: 1.7 }}>
          The <strong style={{ color: "var(--primary)" }}>Big Mac Index</strong> (The Economist, 1986) measures currency under/overvaluation via the cost of a Big Mac. Base: US price = <strong style={{ color: "var(--accent)" }}>$5.79</strong>.
          Positive = currency overvalued vs USD; negative = undervalued.
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={BIG_MAC_DATA} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" horizontal={false} />
            <XAxis type="number" tickFormatter={v => `${v}%`} tick={{ fontSize: 8, fill: "var(--text-faint)" }} domain={[-65, 45]} />
            <YAxis type="category" dataKey="country" tick={{ fontSize: 9, fill: "var(--text-muted)" }} width={100} />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: "10px", borderRadius: "8px" }}
              formatter={(v: any, _: any, props: any) => [`$${props.payload.price.toFixed(2)} (${v > 0 ? "+" : ""}${v.toFixed(1)}%)`]}
            />
            <ReferenceLine x={0} stroke="var(--primary)" strokeWidth={1.5} />
            <Bar dataKey="diff" radius={[0, 3, 3, 0]}>
              {BIG_MAC_DATA.map((entry: any, i: number) => (
                <Cell key={i} fill={entry.isBase ? "var(--primary)" : entry.diff > 0 ? "var(--negative)" : "var(--positive)"} opacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: "9px", color: "var(--text-faint)", marginTop: "4px" }}>
          Source: The Economist 2025 · 🔴 Overvalued · 🟢 Undervalued vs USD
        </div>
      </div>
    </div>
  );
}

// ─── 6. COMMODITÉS & RISQUES ─────────────────────────────────────────────────

const GEO_RISKS = [
  { region: "Middle East",    risk: "CRITICAL", score: 9.2, color: "var(--negative)", detail: "US-Israel/Iran conflict · Shipping disrupted"    },
  { region: "Ukraine/Russie",risk: "HIGH",     score: 7.1, color: "#f97316",         detail: "Prolonged war · Active sanctions"                },
  { region: "Chine/Taïwan",  risk: "MODERATE", score: 5.8, color: "var(--warning)",  detail: "Strait tensions · Military drills"               },
  { region: "Corée du Nord", risk: "MODERATE", score: 5.2, color: "var(--warning)",  detail: "Missile tests · Nuclear rhetoric"                },
  { region: "Latin America", risk: "LOW",      score: 3.1, color: "var(--positive)", detail: "Venezuela instability · Migrations"              },
];

function CommoditiesSection() {
  const { mkt, live } = useMacroMarkets();
  const items: { name: string; key: MktKey; unit: string; icon: string }[] = [
    { name: "Gold",        key: "GOLD",   unit: "/oz",    icon: "🥇" },
    { name: "Silver",      key: "SILVER", unit: "/oz",    icon: "🥈" },
    { name: "WTI Crude",   key: "WTI",    unit: "/bbl",   icon: "🛢️" },
    { name: "Brent",       key: "BRENT",  unit: "/bbl",   icon: "🛢️" },
    { name: "Natural Gas", key: "NATGAS", unit: "/MMBtu", icon: "🔥" },
    { name: "Copper",      key: "COPPER", unit: "/lb",    icon: "🔶" },
    { name: "Bitcoin",     key: "BTC",    unit: "/BTC",   icon: "₿"  },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <SectionBar title="COMMODITIES & CRYPTOS" />
          <span style={{ fontSize: "9px", fontWeight: 700, marginBottom: "10px",
            color: live ? "var(--positive)" : "var(--text-faint)" }}>
            {live ? "● LIVE" : "○ CACHED"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px" }}>
          {items.map(c => {
            const q = mkt[c.key];
            return (
              <div key={c.name} style={s.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>{c.icon} {c.name}</span>
                  <span style={{ fontSize: "8px", color: "var(--text-faint)" }}>{c.unit}</span>
                </div>
                <div style={{ fontSize: "12px", fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: "2px" }}>{usd(q.price)}</div>
                <div style={{ fontSize: "9px", color: q.change >= 0 ? "var(--positive)" : "var(--negative)", display: "flex", alignItems: "center", gap: "2px" }}>
                  {q.change >= 0 ? <TrendingUp size={8} /> : <TrendingDown size={8} />}
                  1D {q.change > 0 ? "+" : ""}{q.change.toFixed(2)}%
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <SectionBar icon={<AlertTriangle size={12} />} title="GEOPOLITICAL RISKS" note="STATIC" />
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          {GEO_RISKS.map(r => (
            <div key={r.region} style={{ ...s.card, borderLeft: `3px solid ${r.color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: "11px", fontWeight: 700 }}>{r.region}</span>
                  <span style={{ fontSize: "9px", color: r.color, fontWeight: 700, marginLeft: "8px" }}>{r.risk}</span>
                </div>
                <div style={{ fontSize: "18px", fontWeight: 700, color: r.color, fontVariantNumeric: "tabular-nums" }}>{r.score}</div>
              </div>
              <div style={{ fontSize: "9px", color: "var(--text-faint)", marginTop: "2px" }}>{r.detail}</div>
              <div style={{ marginTop: "4px", height: "3px", background: "var(--surface-offset)", borderRadius: "2px" }}>
                <div style={{ width: `${r.score * 10}%`, height: "100%", background: r.color, borderRadius: "2px", opacity: 0.8 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── 7. PENTAGON PIZZA INDEX + FEAR & GREED ───────────────────────────────────

const PIZZA_EVENTS = [
  { date: "1 May 2011",  event: "Neptune Spear — Death of Bin Laden",  spike: 95, ok: true  },
  { date: "3 Jan 2020",  event: "Drone strike — Soleimani",            spike: 88, ok: true  },
  { date: "13 Apr 2024", event: "Iranian drone attack vs Israel",       spike: 82, ok: true  },
  { date: "Jun 2025",    event: "US-Israeli strikes on Iran",           spike: 91, ok: true  },
  { date: "Mar 2026",    event: "Extended Middle East conflict",        spike: 74, ok: false },
];

const FEAR_GREED_HISTORY = [
  { d: "Jan 1",  v: 55 }, { d: "Jan 15", v: 62 }, { d: "Feb 1", v: 58 },
  { d: "Feb 15", v: 48 }, { d: "Mar 1",  v: 35 }, { d: "Mar 10", v: 24 },
  { d: "Mar 16", v: 22 },
];

const PIZZA_VALUE  = 74;
const FG_VALUE     = 22;

function PizzaMeter({ value }: { value: number }) {
  const color = value > 80 ? "var(--negative)" : value > 60 ? "#f97316" : value > 40 ? "var(--warning)" : "var(--positive)";
  const label = value > 80 ? "CRITICAL ALERT" : value > 60 ? "HIGH TENSION" : value > 40 ? "MODERATE ACTIVITY" : "NORMAL";
  return (
    <div style={{ textAlign: "center", padding: "6px 0" }}>
      <div style={{ ...s.label, marginBottom: "4px" }}>PENTAGON PIZZA INDEX</div>
      <div style={{ fontSize: "44px", fontWeight: 800, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: "10px", color, fontWeight: 700, marginTop: "2px" }}>{label}</div>
      <div style={{ marginTop: "8px", height: "6px", background: "var(--surface-offset)", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: "linear-gradient(90deg, var(--positive), var(--warning), var(--negative))", borderRadius: "3px" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "8px", color: "var(--text-faint)", marginTop: "2px" }}>
        <span>CALM</span><span>TENSION</span><span>CRISIS</span>
      </div>
    </div>
  );
}

function FearGreedMeter({ value }: { value: number }) {
  const color = value < 25 ? "var(--negative)" : value < 45 ? "#f97316" : value < 55 ? "var(--warning)" : value < 75 ? "var(--positive)" : "#22c55e";
  const label = value < 25 ? "EXTREME FEAR" : value < 45 ? "FEAR" : value < 55 ? "NEUTRAL" : value < 75 ? "GREED" : "EXTREME GREED";
  return (
    <div style={{ textAlign: "center", padding: "6px 0" }}>
      <div style={{ ...s.label, marginBottom: "4px" }}>CNN FEAR & GREED</div>
      <div style={{ fontSize: "44px", fontWeight: 800, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: "10px", color, fontWeight: 700, marginTop: "2px" }}>{label}</div>
      <div style={{ marginTop: "8px", height: "6px", background: "var(--surface-offset)", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: "linear-gradient(90deg, var(--negative), var(--warning), var(--positive), #22c55e)", borderRadius: "3px" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "8px", color: "var(--text-faint)", marginTop: "2px" }}>
        <span>FEAR</span><span>NEUTRAL</span><span>GREED</span>
      </div>
    </div>
  );
}

function PizzaAndFearSection() {
  return (
    <div>
      <SectionBar icon={<Pizza size={12} />} title="ALTERNATIVE SENTIMENT — PENTAGON PIZZA + FEAR & GREED" note="STATIC · ILLUSTRATIVE" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>

        {/* Pentagon Pizza */}
        <div style={s.card}>
          <div style={{ fontSize: "9px", color: "var(--text-muted)", marginBottom: "10px", lineHeight: 1.7 }}>
            The <strong style={{ color: "var(--primary)" }}>Pentagon Pizza Index</strong> is an unofficial OSINT indicator: a sudden spike in pizza orders around the Pentagon and CIA has historically correlated with imminent military operations.
          </div>
          <PizzaMeter value={PIZZA_VALUE} />
          <div style={{ marginTop: "12px" }}>
            <div style={{ ...s.label, marginBottom: "5px" }}>CORRELATED EVENTS</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>{["Date","Event","Spike","✓"].map(h => (
                  <th key={h} style={{ ...s.label, padding: "3px 4px", textAlign: "left", borderBottom: "1px solid var(--divider)" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {PIZZA_EVENTS.map((ev, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--divider)" }}>
                    <td style={{ fontSize: "9px", color: "var(--text-faint)", padding: "4px", whiteSpace: "nowrap" }}>{ev.date}</td>
                    <td style={{ fontSize: "9px", padding: "4px" }}>{ev.event}</td>
                    <td style={{ fontSize: "10px", color: ev.spike > 80 ? "var(--negative)" : "var(--warning)", padding: "4px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{ev.spike}</td>
                    <td style={{ fontSize: "10px", padding: "4px", textAlign: "center", color: ev.ok ? "var(--positive)" : "var(--warning)" }}>{ev.ok ? "✓" : "~"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: "8px", color: "var(--text-faint)", marginTop: "5px" }}>⚠ Unofficial anecdotal indicator · Source: X (@PentagonPizzaReport)</div>
          </div>
        </div>

        {/* Fear & Greed */}
        <div style={s.card}>
          <div style={{ fontSize: "9px", color: "var(--text-muted)", marginBottom: "10px", lineHeight: 1.7 }}>
            The <strong style={{ color: "var(--primary)" }}>Fear & Greed Index</strong> by CNN measures the overall sentiment of US markets across 7 sub-indicators (momentum, VIX, junk bond demand, options, safe haven flows, breadth, strength).
          </div>
          <FearGreedMeter value={FG_VALUE} />
          <div style={{ marginTop: "12px" }}>
            <div style={{ ...s.label, marginBottom: "6px" }}>2026 YTD EVOLUTION</div>
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={FEAR_GREED_HISTORY} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="fgGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" />
                <XAxis dataKey="d" tick={{ fontSize: 8, fill: "var(--text-faint)" }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: "var(--text-faint)" }} ticks={[0,25,50,75,100]} />
                <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: "10px", borderRadius: "8px" }} />
                <ReferenceLine y={25} stroke="var(--negative)" strokeDasharray="3 3" label={{ value: "Extreme Fear", fill: "var(--negative)", fontSize: 8 }} />
                <ReferenceLine y={75} stroke="var(--positive)" strokeDasharray="3 3" label={{ value: "Extreme Greed", fill: "var(--positive)", fontSize: 8 }} />
                <Area type="monotone" dataKey="v" stroke="#ef4444" fill="url(#fgGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px", marginTop: "8px" }}>
              {[
                { l: "Market Momentum",   v: "Bearish",  c: "var(--negative)" },
                { l: "Safe Haven",        v: "↑ High",   c: "var(--negative)" },
                { l: "HY Bond Demand",    v: "Low",      c: "var(--warning)"  },
                { l: "Options (Put/Call)",v: "Bearish",  c: "var(--negative)" },
              ].map(({ l, v, c }) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", padding: "2px 0", borderBottom: "1px solid var(--divider)" }}>
                  <span style={{ color: "var(--text-faint)" }}>{l}</span>
                  <span style={{ color: c, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 8. BUFFETT INDICATOR ──────────────────────────────────────────────────────

const BUFFETT_HISTORY = [
  { d: "2000", us: 153, world: 112 },
  { d: "2003", us:  75, world:  61 },
  { d: "2007", us: 105, world:  99 },
  { d: "2009", us:  57, world:  49 },
  { d: "2013", us: 113, world:  79 },
  { d: "2017", us: 147, world: 101 },
  { d: "2020", us: 186, world: 119 },
  { d: "2021", us: 213, world: 131 },
  { d: "2022", us: 154, world: 107 },
  { d: "2023", us: 169, world: 115 },
  { d: "2024", us: 199, world: 125 },
  { d: "Mar 26",us: 165, world: 118 },
];

const BUFFETT_CURRENT_US    = 165;
const BUFFETT_CURRENT_WORLD = 118;

function buffettStatus(v: number) {
  if (v > 200) return { label: "EXTREMELY OVERVALUED",    color: "var(--negative)" };
  if (v > 150) return { label: "SIGNIFICANTLY OVERVALUED",color: "#f97316" };
  if (v > 115) return { label: "MODERATELY OVERVALUED",   color: "var(--warning)" };
  if (v > 85)  return { label: "FAIR VALUED",             color: "var(--positive)" };
  return          {    label: "UNDERVALUED",              color: "#22c55e" };
}

function BuffettSection() {
  const usStatus    = buffettStatus(BUFFETT_CURRENT_US);
  const worldStatus = buffettStatus(BUFFETT_CURRENT_WORLD);

  return (
    <div>
      <SectionBar icon={<BarChart2 size={12} />} title="BUFFETT INDICATOR — MARKET CAP / GDP" note="STATIC" />
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
        {/* Chart */}
        <div style={s.card}>
          <div style={{ fontSize: "9px", color: "var(--text-muted)", marginBottom: "10px", lineHeight: 1.7 }}>
            The <strong style={{ color: "var(--primary)" }}>Buffett Indicator</strong> = Total market capitalization / Nominal GDP.
            Warren Buffett calls it "<em>the best single measure of where valuations stand at any given moment</em>".
            Historically: below 85% = undervalued · 85–115% = fair · 115–150% = overvalued · above 150% = bubble zone.
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={BUFFETT_HISTORY} margin={{ top: 4, right: 12, left: -4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" />
              <XAxis dataKey="d" tick={{ fontSize: 9, fill: "var(--text-faint)" }} />
              <YAxis domain={[40, 230]} tick={{ fontSize: 9, fill: "var(--text-faint)" }} tickFormatter={v => `${v}%`} />
              <Tooltip
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: "10px", borderRadius: "8px" }}
                formatter={(v: any, name: string) => [`${v}%`, name]}
              />
              {/* Zone references */}
              <ReferenceLine y={85}  stroke="var(--positive)" strokeDasharray="4 2" strokeOpacity={0.5} label={{ value: "Undervalued",  fill: "var(--positive)", fontSize: 8, position: "insideTopLeft" }} />
              <ReferenceLine y={115} stroke="var(--warning)"  strokeDasharray="4 2" strokeOpacity={0.5} label={{ value: "Fair value",   fill: "var(--warning)",  fontSize: 8, position: "insideTopLeft" }} />
              <ReferenceLine y={150} stroke="#f97316"         strokeDasharray="4 2" strokeOpacity={0.5} label={{ value: "Overvalued",   fill: "#f97316",         fontSize: 8, position: "insideTopLeft" }} />
              <ReferenceLine y={200} stroke="var(--negative)" strokeDasharray="4 2" strokeOpacity={0.5} label={{ value: "Bubble",       fill: "var(--negative)", fontSize: 8, position: "insideTopLeft" }} />
              <Line type="monotone" dataKey="us"    stroke="var(--primary)"  strokeWidth={2} dot={{ r: 3, fill: "var(--primary)" }}  name="US (Wilshire/GDP)"   />
              <Line type="monotone" dataKey="world" stroke="var(--accent)"   strokeWidth={2} dot={{ r: 3, fill: "var(--accent)" }}   name="World (Mkt Cap/GDP)" strokeDasharray="5 3" />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ fontSize: "9px", color: "var(--text-faint)", marginTop: "4px" }}>
            Source: Wilshire 5000 · BEA · World Bank · Quarterly data
          </div>
        </div>

        {/* Readings */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {[
            { label: "US Markets",       value: BUFFETT_CURRENT_US,    status: usStatus,    sub: "Wilshire 5000 / US GDP"    },
            { label: "World Markets",    value: BUFFETT_CURRENT_WORLD, status: worldStatus, sub: "MSCI World / World GDP"    },
          ].map(({ label, value, status, sub }) => (
            <div key={label} style={{ ...s.card, borderLeft: `3px solid ${status.color}` }}>
              <div style={s.label}>{label}</div>
              <div style={{ fontSize: "36px", fontWeight: 800, color: status.color, lineHeight: 1, fontVariantNumeric: "tabular-nums", marginTop: "4px" }}>
                {value}%
              </div>
              <div style={{ fontSize: "10px", color: status.color, fontWeight: 700, marginTop: "3px" }}>{status.label}</div>
              <div style={{ fontSize: "9px", color: "var(--text-faint)", marginTop: "2px" }}>{sub}</div>
              <div style={{ marginTop: "8px", height: "5px", background: "var(--surface-offset)", borderRadius: "3px", overflow: "hidden" }}>
                <div style={{
                  width: `${Math.min(value / 230 * 100, 100)}%`,
                  height: "100%",
                  background: `linear-gradient(90deg, var(--positive), var(--warning), #f97316, var(--negative))`,
                  borderRadius: "3px",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "7px", color: "var(--text-faint)", marginTop: "2px" }}>
                <span>0%</span><span>115%</span><span>200%</span>
              </div>
            </div>
          ))}
          <div style={{ ...s.card, fontSize: "9px", color: "var(--text-muted)", lineHeight: 1.7 }}>
            <div style={{ ...s.label, marginBottom: "5px" }}>INTERPRETATION</div>
            US markets at <strong style={{ color: usStatus.color }}>{BUFFETT_CURRENT_US}%</strong> remain in
            {" "}<strong style={{ color: usStatus.color }}>{usStatus.label.toLowerCase()}</strong> territory despite the early 2026 correction.
            World valuations at <strong style={{ color: worldStatus.color }}>{BUFFETT_CURRENT_WORLD}%</strong> remain moderately elevated.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function MacroPage() {
  const { data: _data } = useQuery({
    queryKey: ["/api/macro"],
    staleTime: Infinity,
  });

  const todayLabel = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const { mkt, live } = useMacroMarkets();
  const vix = vixState(mkt.VIX.price);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "12px", borderBottom: "1px solid var(--divider)" }}>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--primary)", letterSpacing: "0.04em" }}>Atlas Macro</div>
          <div style={{ fontSize: "10px", color: "var(--text-faint)", marginTop: "1px" }}>Global macroeconomic indicators · Live market data · {todayLabel}</div>
        </div>
        <div style={{ display: "flex", gap: "12px", fontSize: "10px", color: "var(--text-muted)", alignItems: "center" }}>
          <span>VIX <strong style={{ color: vix.color }}>{frNum(mkt.VIX.price, 1)} — {vix.sub}</strong></span>
          <span style={{ color: "var(--divider)" }}>|</span>
          <span>DXY <strong style={{ color: "var(--text)" }}>{frNum(mkt.DXY.price, 1)}</strong></span>
          <span style={{ color: "var(--divider)" }}>|</span>
          <span>Gold <strong style={{ color: "var(--text)" }}>{usd(mkt.GOLD.price)}</strong></span>
          <span style={{ color: "var(--divider)" }}>|</span>
          <span style={{ color: live ? "var(--positive)" : "var(--text-faint)", fontWeight: 700 }}>{live ? "● LIVE" : "○ CACHED"}</span>
        </div>
      </div>

      <IndicesSection />
      <MacroStatsSection />
      <CentralBanksSection />
      <YieldCurveSection />
      <CommoditiesSection />
      <BigMacSection />
      <PizzaAndFearSection />
      <BuffettSection />

      <div style={{ fontSize: "9px", color: "var(--text-faint)", textAlign: "center", padding: "8px 0", borderTop: "1px solid var(--divider)" }}>
        Sources: Fed · ECB · BoE · BoJ · BLS · S&P Global PMI · The Economist · FRED · Wilshire Associates · World Bank · CNN · {todayLabel} · For informational purposes only
      </div>
    </div>
  );
}
