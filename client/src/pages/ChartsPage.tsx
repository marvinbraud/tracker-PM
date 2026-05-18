import { useQuery } from "@tanstack/react-query";
import { PortfolioSummary } from "@shared/schema";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  AreaChart, Area, PieChart, Pie, Cell, BarChart, Bar, ReferenceLine,
} from "recharts";
import { fmt, fmtPct } from "../lib/utils";

interface Props { portfolio: string; period: string; benchmark: string; }

const COLORS = ["#f5a623", "#4d9eff", "#00d45a", "#a569db", "#00c7db", "#ff3b4a", "#ffd700", "#ff6b35", "#00ffff", "#ff69b4"];
const fmtDate = (d: string) => { const p = d.split("-"); return p.length >= 3 ? `${p[2]}/${p[1]}` : d; };

function SectionBar({ title }: { title: string }) {
  return <div className="bb-section-bar" style={{ marginBottom: "6px" }}>{title}</div>;
}

export default function ChartsPage({ portfolio, period, benchmark }: Props) {
  const { data, isLoading } = useQuery<PortfolioSummary>({
    queryKey: [`/api/summary?portfolio=${portfolio}&period=${period}&benchmark=${benchmark}`],
  });

  if (isLoading || !data) return (
    <div style={{ padding: "24px", textAlign: "center", color: "var(--bb-text-muted)" }} className="bb-loading">
      Chargement des graphiques…
    </div>
  );

  const { portfolioHistory, allocationByClass, allocationBySector, allocationByCurrency, allocationByGeo, positions } = data;

  // Normalized performance chart
  const startV = portfolioHistory[0]?.value ?? 1;
  const startB = portfolioHistory[0]?.benchmark ?? 1;
  const perfData = portfolioHistory.map(h => ({
    date: fmtDate(h.date),
    "Portefeuille (%)": +((h.value / startV - 1) * 100).toFixed(2),
    [`${benchmark} (%)`]: +((h.benchmark / startB - 1) * 100).toFixed(2),
    "Surperf.": +((h.value / startV - h.benchmark / startB) * 100).toFixed(2),
  }));

  // Value chart
  const valueData = portfolioHistory.map(h => ({
    date: fmtDate(h.date),
    "Valeur (€)": +h.value.toFixed(0),
  }));

  // Portfolio by sector
  const topSectors = allocationBySector.slice(0, 8);

  // Rolling volatility approximation (30d std dev of daily returns)
  const rollingVol: { date: string; vol: number }[] = [];
  for (let i = 30; i < portfolioHistory.length; i++) {
    const slice = portfolioHistory.slice(i - 30, i);
    const returns = slice.slice(1).map((h, j) => (h.value - slice[j].value) / slice[j].value);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0) / returns.length);
    rollingVol.push({ date: fmtDate(portfolioHistory[i].date), vol: +(stdDev * Math.sqrt(252) * 100).toFixed(2) });
  }

  // Drawdown series
  let peak = portfolioHistory[0]?.value ?? 1;
  const ddData = portfolioHistory.map(h => {
    if (h.value > peak) peak = h.value;
    const dd = peak > 0 ? ((h.value - peak) / peak) * 100 : 0;
    return { date: fmtDate(h.date), "Drawdown (%)": +dd.toFixed(2) };
  });

  return (
    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "12px" }}>

      {/* Performance relative */}
      <SectionBar title="📈 Performance relative (%) — Portefeuille vs Benchmark" />
      <div className="bb-card">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={perfData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--bb-border)" opacity={0.5} />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: "var(--bb-text-muted)" }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: "var(--bb-text-muted)" }} tickLine={false} axisLine={false}
              tickFormatter={v => `${v >= 0 ? "+" : ""}${v}%`} width={44} />
            <ReferenceLine y={0} stroke="var(--bb-border-2)" strokeDasharray="2 2" />
            <Tooltip contentStyle={{ background: "var(--bb-surface)", border: "1px solid var(--bb-border)", fontSize: "10px", fontFamily: "IBM Plex Mono" }}
              formatter={(v: number, n: string) => [`${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, n]} />
            <Legend iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
            <Line type="monotone" dataKey="Portefeuille (%)" stroke="var(--bb-amber)" dot={false} strokeWidth={1.5} />
            <Line type="monotone" dataKey={`${benchmark} (%)`} stroke="var(--bb-blue)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
            <Line type="monotone" dataKey="Surperf." stroke="var(--bb-green)" dot={false} strokeWidth={1} strokeDasharray="2 3" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Portfolio value + Drawdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <div>
          <SectionBar title="💰 Valeur absolue du portefeuille" />
          <div className="bb-card">
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={valueData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f5a623" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#f5a623" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bb-border)" opacity={0.4} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "var(--bb-text-muted)" }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: "var(--bb-text-muted)" }} tickLine={false} axisLine={false}
                  tickFormatter={v => fmt(v, 0)} width={52} />
                <Tooltip contentStyle={{ background: "var(--bb-surface)", border: "1px solid var(--bb-border)", fontSize: "10px" }}
                  formatter={(v: number) => [fmt(v)]} />
                <Area type="monotone" dataKey="Valeur (€)" stroke="var(--bb-amber)" fill="url(#valueGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <SectionBar title="📉 Drawdown historique (%)" />
          <div className="bb-card">
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={ddData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff3b4a" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ff3b4a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bb-border)" opacity={0.4} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "var(--bb-text-muted)" }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: "var(--bb-text-muted)" }} tickLine={false} axisLine={false}
                  tickFormatter={v => `${v.toFixed(0)}%`} width={36} />
                <ReferenceLine y={0} stroke="var(--bb-border-2)" />
                <Tooltip contentStyle={{ background: "var(--bb-surface)", border: "1px solid var(--bb-border)", fontSize: "10px" }}
                  formatter={(v: number) => [`${v.toFixed(2)}%`]} />
                <Area type="monotone" dataKey="Drawdown (%)" stroke="var(--bb-red)" fill="url(#ddGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Volatility + Allocations */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
        {/* Rolling vol */}
        <div>
          <SectionBar title="⚡ Volatilité glissante 30j (%)" />
          <div className="bb-card">
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={rollingVol} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bb-border)" opacity={0.4} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "var(--bb-text-muted)" }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: "var(--bb-text-muted)" }} tickLine={false} axisLine={false}
                  tickFormatter={v => `${v}%`} width={30} />
                <Tooltip contentStyle={{ background: "var(--bb-surface)", border: "1px solid var(--bb-border)", fontSize: "10px" }}
                  formatter={(v: number) => [`${v.toFixed(1)}%`]} />
                <Line type="monotone" dataKey="vol" stroke="var(--bb-cyan)" dot={false} strokeWidth={1.5} name="Volatilité annualisée" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sector allocation */}
        <div>
          <SectionBar title="Secteurs" />
          <div className="bb-card">
            <ResponsiveContainer width="100%" height={Math.max(160, topSectors.length * 26)}>
              <BarChart data={topSectors} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }}
                barCategoryGap="20%">
                <XAxis type="number" tick={{ fontSize: 9, fill: "var(--bb-text-muted)" }} tickLine={false} axisLine={false}
                  tickFormatter={v => `${v.toFixed(0)}%`} domain={[0, 100]} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "var(--bb-text-muted)" }}
                  width={90} tickLine={false} axisLine={false}
                  tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 13) + "…" : v} />
                <Tooltip contentStyle={{ background: "var(--bb-surface)", border: "1px solid var(--bb-border)", fontSize: "10px" }}
                  formatter={(v: number) => [`${v.toFixed(1)}%`, "Poids"]} />
                <Bar dataKey="pct" radius={[0, 2, 2, 0]}>
                  {topSectors.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Asset class donut */}
        <div>
          <SectionBar title="Classes d'actifs" />
          <div className="bb-card" style={{ height: "150px" }}>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={allocationByClass} dataKey="pct" nameKey="name" cx="50%" cy="50%"
                  innerRadius={30} outerRadius={55}
                  label={({ name, pct }) => pct > 6 ? `${pct.toFixed(0)}%` : ""}
                  labelLine={false}>
                  {allocationByClass.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "var(--bb-surface)", border: "1px solid var(--bb-border)", fontSize: "10px" }}
                  formatter={(v: number, n: string) => [`${v.toFixed(1)}%`, n]} />
                <Legend iconSize={7} wrapperStyle={{ fontSize: "9px" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

    </div>
  );
}
