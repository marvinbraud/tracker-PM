import { useQuery } from "@tanstack/react-query";
import { PortfolioSummary } from "@shared/schema";
import KpiCard from "../components/KpiCard";
import { fmt, fmtPct, fmtNum, colorClass, heatmapColor, assetBadgeClass } from "../lib/utils";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";

interface Props {
  portfolio: string;
  period: string;
  benchmark: string;
}

const CHART_COLORS = ["#f5a623", "#4d9eff", "#00d45a", "#a569db", "#00c7db", "#ff3b4a", "#ffd700", "#ff6b35"];

const formatDate = (d: string) => {
  const parts = d.split("-");
  if (parts.length < 3) return d;
  return `${parts[2]}/${parts[1]}`;
};

function SectionBar({ title }: { title: string }) {
  return (
    <div className="bb-section-bar" style={{ marginBottom: "6px" }}>
      {title}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
      {[1, 2, 3].map(i => (
        <div key={i} className="bb-loading" style={{
          height: "60px", background: "var(--bb-surface)", borderRadius: "2px", border: "1px solid var(--bb-border)"
        }} />
      ))}
    </div>
  );
}

export default function OverviewPage({ portfolio, period, benchmark }: Props) {
  const { data, isLoading, error } = useQuery<PortfolioSummary & { portfolioNames: string[] }>({
    queryKey: [`/api/summary?portfolio=${portfolio}&period=${period}&benchmark=${benchmark}`],
  });

  if (isLoading) return <LoadingSkeleton />;
  if (error || !data) return (
    <div style={{ padding: "24px", color: "var(--bb-red)", fontSize: "12px" }}>
      Error loading data
    </div>
  );

  const { metrics, positions, allocationByClass, allocationBySector, allocationByCurrency, topGainers, topLosers, portfolioHistory } = data;

  const chartData = portfolioHistory.slice(-Math.min(portfolioHistory.length, 252)).map(h => ({
    date: formatDate(h.date),
    portfolio: +h.value.toFixed(2),
    benchmark: +h.benchmark.toFixed(2),
  }));

  // Normalize chart values for % comparison
  const startVal = chartData[0]?.portfolio ?? 1;
  const startBench = chartData[0]?.benchmark ?? 1;
  const chartDataPct = chartData.map(d => ({
    date: d.date,
    "Portfolio": +((d.portfolio / startVal - 1) * 100).toFixed(2),
    [benchmark]: +((d.benchmark / startBench - 1) * 100).toFixed(2),
  }));

  return (
    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "10px" }}>

      {/* ── KPI Row 1: Portfolio Totals ── */}
      <SectionBar title="📊 Portfolio Overview" />
      <div className="kpi-grid">
        <KpiCard
          label="Total Value"
          value={fmt(metrics.totalValue)}
          sub={`Cost: ${fmt(metrics.totalCostBasis)}`}
          accent
          tooltip="Total consolidated market value in EUR"
        />
        <KpiCard
          label="Unrealized P&L"
          value={fmt(metrics.totalPnlAmount)}
          sub={fmtPct(metrics.totalPnlPct)}
          subColor={metrics.totalPnlPct >= 0 ? "var(--bb-green)" : "var(--bb-red)"}
          tooltip="Total unrealized gains/losses"
        />
        <KpiCard
          label="YTD Return"
          value={fmtPct(metrics.ytdReturn * 100)}
          sub="Since Jan 1st"
          subColor={metrics.ytdReturn >= 0 ? "var(--bb-green)" : "var(--bb-red)"}
          tooltip="Performance since January 1st 2026"
        />
        <KpiCard
          label="1M Return"
          value={fmtPct(metrics.oneMonthReturn * 100)}
          subColor={metrics.oneMonthReturn >= 0 ? "var(--bb-green)" : "var(--bb-red)"}
          tooltip="Performance over the last 30 days"
        />
        <KpiCard
          label="1Y Return"
          value={fmtPct(metrics.oneYearReturn * 100)}
          subColor={metrics.oneYearReturn >= 0 ? "var(--bb-green)" : "var(--bb-red)"}
          tooltip="Performance over the last 12 months"
        />
        <KpiCard
          label="Ann. Return"
          value={fmtPct(metrics.annualizedReturn * 100)}
          sub={`Vol: ${fmtPct(metrics.volatility * 100)}`}
          tooltip="Annualized return over the period"
        />
      </div>

      {/* ── KPI Row 2: Risk Metrics ── */}
      <SectionBar title="⚡ Key Risk Metrics" />
      <div className="kpi-grid">
        <KpiCard
          label="Sharpe Ratio"
          value={metrics.sharpeRatio.toFixed(2)}
          sub={metrics.sharpeRatio >= 1 ? "Excellent" : metrics.sharpeRatio >= 0.5 ? "Good" : "Low"}
          subColor={metrics.sharpeRatio >= 1 ? "var(--bb-green)" : metrics.sharpeRatio >= 0.5 ? "var(--bb-amber)" : "var(--bb-red)"}
          tooltip="Risk-adjusted return (risk-free rate: 4%)"
        />
        <KpiCard
          label="Sortino Ratio"
          value={isFinite(metrics.sortinoRatio) ? metrics.sortinoRatio.toFixed(2) : "∞"}
          tooltip="Sharpe using downside volatility only"
        />
        <KpiCard
          label="Max Drawdown"
          value={fmtPct(metrics.maxDrawdown * 100)}
          subColor="var(--bb-red)"
          tooltip="Maximum peak-to-trough loss over the period"
        />
        <KpiCard
          label="VaR 95% (1j)"
          value={fmt(metrics.var95)}
          sub="Max expected loss / day"
          subColor="var(--bb-red)"
          tooltip="Historical Value at Risk at 95% — maximum daily loss (5% probability)"
        />
        <KpiCard
          label="Expected Shortfall"
          value={fmt(metrics.expectedShortfall)}
          sub="CVaR 95%"
          subColor="var(--bb-red)"
          tooltip="Average loss beyond VaR 95%"
        />
        <KpiCard
          label="Beta vs Benchmark"
          value={metrics.beta.toFixed(2)}
          sub={metrics.beta > 1.1 ? "Aggressive" : metrics.beta < 0.9 ? "Defensive" : "Neutral"}
          tooltip="Sensitivity to benchmark movements"
        />
      </div>

      {/* ── Performance Chart ── */}
      <SectionBar title="📈 Relative Performance vs Benchmark" />
      <div className="bb-card" style={{ padding: "10px" }}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartDataPct} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--bb-border)" opacity={0.5} />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: "var(--bb-text-muted)", fontFamily: "IBM Plex Mono" }}
              tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: "var(--bb-text-muted)", fontFamily: "IBM Plex Mono" }}
              tickLine={false} axisLine={false} tickFormatter={v => `${v > 0 ? "+" : ""}${v}%`} width={42} />
            <Tooltip
              contentStyle={{ background: "var(--bb-surface)", border: "1px solid var(--bb-border)", fontSize: "10px", fontFamily: "IBM Plex Mono" }}
              formatter={(v: number, name: string) => [`${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, name]}
              labelStyle={{ color: "var(--bb-text-muted)", marginBottom: "2px" }}
            />
            <Legend iconSize={8} wrapperStyle={{ fontSize: "10px", fontFamily: "IBM Plex Mono", color: "var(--bb-text)" }} />
            <Line type="monotone" dataKey="Portfolio" stroke="var(--bb-amber)" dot={false} strokeWidth={1.5} />
            <Line type="monotone" dataKey={benchmark} stroke="var(--bb-blue)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Allocations + Movers ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
        {/* Allocation par classe */}
        <div>
          <SectionBar title="Asset Allocation" />
          <div className="bb-card" style={{ height: "180px" }}>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={allocationByClass} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60}
                  labelLine={false}
                >
                  {allocationByClass.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "var(--bb-surface)", border: "1px solid var(--bb-border)", fontSize: "10px" }}
                  formatter={(v: number, name: string) => [fmt(v), name]} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: "9px", color: "var(--bb-text)" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Allocation par devise */}
        <div>
          <SectionBar title="Currency Allocation" />
          <div className="bb-card" style={{ height: "180px" }}>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={allocationByCurrency.slice(0, 6)} layout="vertical" margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
                <XAxis type="number" tick={{ fontSize: 9, fill: "var(--bb-text-muted)" }} tickLine={false} axisLine={false}
                  tickFormatter={v => `${v.toFixed(0)}%`} domain={[0, 100]} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "var(--bb-text-muted)", fontFamily: "IBM Plex Mono" }}
                  width={28} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "var(--bb-surface)", border: "1px solid var(--bb-border)", fontSize: "10px" }}
                  formatter={(v: number) => [`${v.toFixed(1)}%`]} />
                <Bar dataKey="pct" fill="var(--bb-cyan)" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top gainers/losers */}
        <div>
          <SectionBar title="Top Movers" />
          <div className="bb-card" style={{ overflow: "hidden" }}>
            <div style={{ fontSize: "10px", color: "var(--bb-text-muted)", marginBottom: "4px", fontWeight: 600 }}>TOP 5 GAINERS</div>
            {topGainers.map(p => (
              <div key={p.id} data-testid={`gainer-${p.ticker}`} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid var(--bb-border)" }}>
                <span className="ticker-badge">{p.ticker}</span>
                <span className="tabnum pos" style={{ fontSize: "11px" }}>{fmtPct(p.pnlPct)}</span>
                <span className="tabnum pos" style={{ fontSize: "11px" }}>{fmt(p.pnlAmount)}</span>
              </div>
            ))}
            <div style={{ fontSize: "10px", color: "var(--bb-text-muted)", marginTop: "8px", marginBottom: "4px", fontWeight: 600 }}>TOP 5 LOSERS</div>
            {topLosers.map(p => (
              <div key={p.id} data-testid={`loser-${p.ticker}`} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid var(--bb-border)" }}>
                <span className="ticker-badge">{p.ticker}</span>
                <span className="tabnum neg" style={{ fontSize: "11px" }}>{fmtPct(p.pnlPct)}</span>
                <span className="tabnum neg" style={{ fontSize: "11px" }}>{fmt(p.pnlAmount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Heatmap ── */}
      <SectionBar title="🔥 Position Heatmap (color = P&L%, size = weight)" />
      <div className="bb-card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
          {[...positions].sort((a, b) => b.weight - a.weight).map(p => {
            const size = Math.max(60, Math.min(180, p.weight * 8 + 50));
            return (
              <div
                key={p.id}
                data-testid={`heatmap-${p.ticker}`}
                className="heatmap-cell"
                style={{
                  background: heatmapColor(p.pnlPct),
                  width: `${size}px`,
                  minHeight: `${Math.max(44, size * 0.6)}px`,
                }}
                title={`${p.name} | Poids: ${p.weight.toFixed(1)}% | P&L: ${fmtPct(p.pnlPct)} | Valeur: ${fmt(p.marketValue)}`}
              >
                <div style={{ fontSize: "9px", fontWeight: 700, color: "#fff", fontFamily: "IBM Plex Mono", textAlign: "center" }}>{p.ticker}</div>
                <div style={{ fontSize: "9px", color: "#ffffffcc", textAlign: "center" }}>{fmtPct(p.pnlPct)}</div>
                <div style={{ fontSize: "9px", color: "#ffffff88", textAlign: "center" }}>{p.weight.toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
