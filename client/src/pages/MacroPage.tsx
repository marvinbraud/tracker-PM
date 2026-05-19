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

function SectionBar({ icon, title }: { icon?: React.ReactNode; title: string }) {
  return (
    <div className="bb-section-bar" style={{ marginBottom: "10px" }}>
      {icon && <span>{icon}</span>}
      {title}
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

const MACRO_GROUPS: { label: string; icon: string; items: StatCard[] }[] = [
  {
    label: "United States",
    icon: "🇺🇸",
    items: [
      { label: "CPI YoY",    value: "2,4%",   sub: "Feb 2026 · BLS",                 delta: 0     },
      { label: "Chômage",    value: "4,4%",   sub: "Feb 2026 · BLS",                 delta: 0.1   },
      { label: "NFP",        value: "−92k",   sub: "Feb 2026 · 3rd neg. month",      delta: -4.0  },
      { label: "GDP QoQ",    value: "+2,3%",  sub: "Q4 2025",                        delta: -0.2  },
      { label: "DXY",        value: "103,6",  sub: "Dollar Index",                   delta: +1.2  },
    ],
  },
  {
    label: "Euro Zone",
    icon: "🇪🇺",
    items: [
      { label: "CPI HICP",   value: "2,3%",   sub: "Euro Zone · Feb 2026"            },
      { label: "EUR / USD",  value: "1,087",  sub: "Spot · forex",                  delta: -0.4  },
      { label: "GDP QoQ",    value: "+0,8%",  sub: "Q4 2025 · Eurostat"             },
      { label: "Chômage",    value: "6,1%",   sub: "Jan 2026 · Eurostat"            },
    ],
  },
  {
    label: "Asia & Japan",
    icon: "🇯🇵",
    items: [
      { label: "USD / JPY",  value: "147,8",  sub: "Spot · forex",                  delta: -0.2  },
      { label: "CPI Japon",  value: "2,2%",   sub: "Jan 2026 · BoJ",               delta: +0.1  },
      { label: "GDP Chine",  value: "+4,5%",  sub: "Q4 2025 · NBS"                 },
      { label: "USD / CNY",  value: "7,24",   sub: "Spot · offshore",              delta: +0.3  },
    ],
  },
  {
    label: "Sentiment & Risk",
    icon: "📊",
    items: [
      { label: "VIX",        value: "28,4",   sub: "Fear elevated",                  delta: +38.0, color: "var(--negative)"  },
      { label: "PMI Mfg",    value: "51,2",   sub: "Feb 2026 · S&P Global",         delta: +0.8  },
      { label: "PMI Svcs",   value: "53,0",   sub: "Feb 2026 · Expanding",          delta: +0.3  },
      { label: "MOVE Index", value: "96,4",   sub: "Bond volatility",               delta: +8.2  },
    ],
  },
  {
    label: "Commodities",
    icon: "🛢️",
    items: [
      { label: "WTI Crude",  value: "$100,6", sub: "↑ ME conflict shock",            delta: +35.0, color: "var(--negative)"  },
      { label: "Brent",      value: "$106,2", sub: "/bbl · spot",                   delta: +33.1, color: "var(--negative)"  },
      { label: "Gold",       value: "$3 012", sub: "Safe haven",                    delta: +12.4  },
      { label: "Silver",     value: "$33,8",  sub: "/oz · spot",                   delta: +8.2   },
    ],
  },
];

function MacroStatsSection() {
  return (
    <div>
      <SectionBar icon={<Activity size={12} />} title="KEY MACRO INDICATORS" />
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

const CENTRAL_BANKS = [
  {
    name: "Fed", fullName: "Federal Reserve", rate: "3.50–3.75%", trend: "hold", color: "#3b82f6",
    nextDate: "18 Mar 2026", nextExpected: "Hold (99%)",
    inflation: "2.4%", gdp: "+2.3%",
    meetings2026: ["28 Jan ✓", "18 Mar", "29 Apr", "17 Jun", "29 Jul", "16 Sep", "28 Oct", "9 Dec"],
  },
  {
    name: "BCE", fullName: "European Central Bank", rate: "2.00%", trend: "cut", color: "#f59e0b",
    nextDate: "19 Mar 2026", nextExpected: "Hold / −25bp",
    inflation: "2.3%", gdp: "+0.8%",
    meetings2026: ["5 Feb ✓", "19 Mar", "30 Apr", "11 Jun", "23 Jul", "10 Sep", "29 Oct", "17 Dec"],
  },
  {
    name: "BoE", fullName: "Bank of England", rate: "3.75%", trend: "hold", color: "#10b981",
    nextDate: "19 Mar 2026", nextExpected: "Hold",
    inflation: "2.8%", gdp: "+0.9%",
    meetings2026: ["5 Feb ✓", "19 Mar", "30 Apr", "18 Jun", "30 Jul", "17 Sep", "5 Nov", "17 Dec"],
  },
  {
    name: "BoJ", fullName: "Bank of Japan", rate: "0.75%", trend: "hike", color: "#ec4899",
    nextDate: "19 Mar 2026", nextExpected: "Hold → +25bp Jun",
    inflation: "2.2%", gdp: "+0.8%",
    meetings2026: ["24 Jan ✓", "19 Mar", "30 Apr", "17 Jun", "30 Jul", "18 Sep", "29 Oct", "18 Dec"],
  },
  {
    name: "PBOC", fullName: "People's Bank of China", rate: "3.10%", trend: "cut", color: "#ef4444",
    nextDate: "—", nextExpected: "Accommodative",
    inflation: "0.1%", gdp: "+4.5%",
    meetings2026: ["Accommodative", "Stimulus", "Pro-consumer", "—", "—", "—", "—", "—"],
  },
  {
    name: "SNB", fullName: "Swiss National Bank", rate: "0.25%", trend: "hold", color: "#8b5cf6",
    nextDate: "19 Mar 2026", nextExpected: "Hold / −25bp",
    inflation: "0.4%", gdp: "+1.3%",
    meetings2026: ["—", "19 Mar", "—", "19 Jun", "—", "24 Sep", "—", "11 Dec"],
  },
];

const TREND_ICONS:  Record<string, string> = { cut: "▼ Easing", hike: "▲ Tightening", hold: "◆ On hold" };
const TREND_COLORS: Record<string, string> = { cut: "var(--positive)", hike: "var(--negative)", hold: "var(--warning)" };

function CentralBanksSection() {
  const [selected, setSelected] = useState("Fed");
  const cb = CENTRAL_BANKS.find(b => b.name === selected) ?? CENTRAL_BANKS[0];

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
            <div style={{ fontSize: "12px", color: "var(--accent)", fontWeight: 600 }}>{cb.nextDate}</div>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>Consensus: {cb.nextExpected}</div>
          </div>
          <div>
            <div style={{ ...s.label, marginBottom: "5px" }}>2026 CALENDAR</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
              {cb.meetings2026.map((m, i) => (
                <span key={i} style={{
                  fontSize: "9px", padding: "3px 6px",
                  background: m.includes("✓") ? "var(--positive-bg)" : "var(--surface-offset)",
                  color: m.includes("✓") ? "var(--positive)" : "var(--text-muted)",
                  border: `1px solid ${m.includes("✓") ? "var(--positive)" : "var(--border)"}`,
                  borderRadius: "var(--r-sm)",
                }}>
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 4. YIELD CURVE ──────────────────────────────────────────────────────────

const YIELD_DATA = [
  { maturity: "1M", yield: 4.32, prev: 4.35 },
  { maturity: "3M", yield: 4.28, prev: 4.30 },
  { maturity: "6M", yield: 4.18, prev: 4.21 },
  { maturity: "1Y", yield: 4.05, prev: 4.08 },
  { maturity: "2Y", yield: 3.76, prev: 3.82 },
  { maturity: "5Y", yield: 3.92, prev: 3.98 },
  { maturity: "7Y", yield: 4.01, prev: 4.07 },
  { maturity: "10Y",yield: 4.27, prev: 4.31 },
  { maturity: "20Y",yield: 4.62, prev: 4.66 },
  { maturity: "30Y",yield: 4.68, prev: 4.71 },
];

function YieldCurveSection() {
  return (
    <div>
      <SectionBar icon={<TrendingUp size={12} />} title="YIELD CURVE — US TREASURIES" />
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
        <div style={s.card}>
          <div style={{ ...s.label, marginBottom: "8px" }}>US YIELD CURVE (MARCH 2026)</div>
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
                { label: "10Y − 2Y", value: "+0.51%", color: "var(--positive)", note: "Normal"  },
                { label: "30Y − 5Y", value: "+0.76%", color: "var(--positive)", note: "Steep"   },
                { label: "10Y − 3M", value: "−0.01%", color: "var(--warning)",  note: "Flat"    },
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
      <SectionBar icon={<DollarSign size={12} />} title="BIG MAC INDEX — PURCHASING POWER PARITY (PPP)" />
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

const COMMODITIES = [
  { name: "WTI Crude",    value: "$100,6", chg: +40.8, unit: "/bbl",   icon: "🛢️" },
  { name: "Brent",        value: "$106,2", chg: +38.6, unit: "/bbl",   icon: "🛢️" },
  { name: "Gold",         value: "$3 012", chg: +12.4, unit: "/oz",    icon: "🥇" },
  { name: "Silver",       value: "$33,8",  chg: +8.2,  unit: "/oz",    icon: "🥈" },
  { name: "Natural Gas",  value: "$4,12",  chg: +22.1, unit: "/MMBtu", icon: "🔥" },
  { name: "Wheat",        value: "$5,62",  chg: +4.3,  unit: "/bu",    icon: "🌾" },
  { name: "Copper",       value: "$4,24",  chg: +6.7,  unit: "/lb",    icon: "🔶" },
  { name: "Bitcoin",      value: "$84 120", chg: -18.4, unit: "/BTC",  icon: "₿"  },
];

const GEO_RISKS = [
  { region: "Middle East",    risk: "CRITICAL", score: 9.2, color: "var(--negative)", detail: "US-Israel/Iran conflict · Shipping disrupted"    },
  { region: "Ukraine/Russie",risk: "HIGH",     score: 7.1, color: "#f97316",         detail: "Prolonged war · Active sanctions"                },
  { region: "Chine/Taïwan",  risk: "MODERATE", score: 5.8, color: "var(--warning)",  detail: "Strait tensions · Military drills"               },
  { region: "Corée du Nord", risk: "MODERATE", score: 5.2, color: "var(--warning)",  detail: "Missile tests · Nuclear rhetoric"                },
  { region: "Latin America", risk: "LOW",      score: 3.1, color: "var(--positive)", detail: "Venezuela instability · Migrations"              },
];

function CommoditiesSection() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
      <div>
        <SectionBar title="COMMODITIES & CRYPTOS" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px" }}>
          {COMMODITIES.map(c => (
            <div key={c.name} style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>{c.icon} {c.name}</span>
                <span style={{ fontSize: "8px", color: "var(--text-faint)" }}>{c.unit}</span>
              </div>
              <div style={{ fontSize: "12px", fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: "2px" }}>{c.value}</div>
              <div style={{ fontSize: "9px", color: c.chg >= 0 ? "var(--positive)" : "var(--negative)", display: "flex", alignItems: "center", gap: "2px" }}>
                {c.chg >= 0 ? <TrendingUp size={8} /> : <TrendingDown size={8} />}
                YTD {c.chg > 0 ? "+" : ""}{c.chg.toFixed(1)}%
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <SectionBar icon={<AlertTriangle size={12} />} title="GEOPOLITICAL RISKS" />
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
      <SectionBar icon={<Pizza size={12} />} title="ALTERNATIVE SENTIMENT — PENTAGON PIZZA + FEAR & GREED" />
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
      <SectionBar icon={<BarChart2 size={12} />} title="BUFFETT INDICATOR — MARKET CAP / GDP" />
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "12px", borderBottom: "1px solid var(--divider)" }}>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--primary)", letterSpacing: "0.04em" }}>Atlas Macro</div>
          <div style={{ fontSize: "10px", color: "var(--text-faint)", marginTop: "1px" }}>Global macroeconomic indicators · March 2026 · Static data</div>
        </div>
        <div style={{ display: "flex", gap: "12px", fontSize: "10px", color: "var(--text-muted)" }}>
          <span>🔴 Active Middle East Conflict</span>
          <span style={{ color: "var(--divider)" }}>|</span>
          <span>Fear & Greed : <strong style={{ color: "var(--negative)" }}>22 — Extreme Fear</strong></span>
          <span style={{ color: "var(--divider)" }}>|</span>
          <span>Buffett Indicator US : <strong style={{ color: "#f97316" }}>165%</strong></span>
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
        Sources: Fed · ECB · BoE · BoJ · BLS · S&P Global PMI · The Economist · FRED · Wilshire Associates · World Bank · CNN · March 2026 · For informational purposes only
      </div>
    </div>
  );
}
