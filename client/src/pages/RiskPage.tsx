import { useQuery } from "@tanstack/react-query";
import { PortfolioSummary } from "@shared/schema";
import { fmtPct, fmt } from "../lib/utils";

interface Props { portfolio: string; period: string; benchmark: string; }

function SectionBar({ title }: { title: string }) {
  return <div className="bb-section-bar" style={{ marginBottom: "6px" }}>{title}</div>;
}

function RiskMetric({ label, value, note, color }: { label: string; value: string; note?: string; color?: string }) {
  return (
    <div className="bb-card" style={{ borderLeft: `3px solid ${color ?? "var(--bb-border)"}` }}>
      <div className="bb-label">{label}</div>
      <div className="bb-value-md tabnum" style={{ color: color ?? "var(--bb-text)", marginTop: "3px" }}>{value}</div>
      {note && <div style={{ fontSize: "9px", color: "var(--bb-text-muted)", marginTop: "2px" }}>{note}</div>}
    </div>
  );
}

function RatingBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.abs(value / max) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
      <div style={{ width: "130px", fontSize: "10px", color: "var(--bb-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ flex: 1, height: "6px", background: "var(--bb-surface-2)", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "3px", transition: "width 0.5s ease" }} />
      </div>
      <div className="tabnum" style={{ fontSize: "10px", color: "var(--bb-text)", width: "50px", textAlign: "right" }}>
        {typeof value === "number" && !isNaN(value) ? value.toFixed(3) : "—"}
      </div>
    </div>
  );
}

interface CorrData { tickers: string[]; names: string[]; matrix: number[][] }

export default function RiskPage({ portfolio, period, benchmark }: Props) {
  const { data } = useQuery<PortfolioSummary>({
    queryKey: [`/api/summary?portfolio=${portfolio}&period=${period}&benchmark=${benchmark}`],
  });
  const { data: corrData } = useQuery<CorrData>({
    queryKey: [`/api/correlation?portfolio=${portfolio}`],
  });

  const m = data?.metrics;
  if (!m) return (
    <div style={{ padding: "24px", textAlign: "center", color: "var(--bb-text-muted)" }} className="bb-loading">
      Loading risk metrics…
    </div>
  );

  const corrColor = (v: number) => {
    const abs = Math.abs(v);
    if (abs > 0.8) return v > 0 ? "rgba(255,59,74,0.7)" : "rgba(0,212,90,0.4)";
    if (abs > 0.5) return v > 0 ? "rgba(245,166,35,0.5)" : "rgba(0,212,90,0.25)";
    return "var(--bb-surface-2)";
  };

  return (
    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "12px" }}>

      {/* Performance metrics */}
      <SectionBar title="📊 Performance Metrics" />
      <div className="risk-grid">
        <RiskMetric label="Annualized Return" value={fmtPct(m.annualizedReturn * 100)}
          color={m.annualizedReturn >= 0 ? "var(--bb-green)" : "var(--bb-red)"} />
        <RiskMetric label="YTD Return" value={fmtPct(m.ytdReturn * 100)}
          color={m.ytdReturn >= 0 ? "var(--bb-green)" : "var(--bb-red)"} />
        <RiskMetric label="1 Month" value={fmtPct(m.oneMonthReturn * 100)}
          color={m.oneMonthReturn >= 0 ? "var(--bb-green)" : "var(--bb-red)"} />
        {(() => {
          const Rf = 0.04;
          const Rp = m.annualizedReturn;
          // Rm derived from active return: IR = (Rp - Rm) / TE → Rm = Rp - IR * TE
          const Rm = Rp - m.informationRatio * m.trackingError;
          const alpha = (Rp - (Rf + m.beta * (Rm - Rf))) * 100;
          return (
            <RiskMetric
              label="Jensen's Alpha"
              value={`${alpha >= 0 ? "+" : ""}${alpha.toFixed(2)}%`}
              note="α = Rp − [Rf + β·(Rm − Rf)]"
              color={alpha >= 0 ? "var(--bb-green)" : "var(--bb-red)"}
            />
          );
        })()}
      </div>

      {/* Risk ratios */}
      <SectionBar title="⚡ Risk-Adjusted Ratios" />
      <div className="risk-grid">
        <RiskMetric label="Sharpe Ratio" value={m.sharpeRatio.toFixed(3)}
          note="Rf = 4% — > 1 = excellent"
          color={m.sharpeRatio >= 1 ? "var(--bb-green)" : m.sharpeRatio >= 0.5 ? "var(--bb-amber)" : "var(--bb-red)"} />
        <RiskMetric label="Sortino Ratio" value={isFinite(m.sortinoRatio) ? m.sortinoRatio.toFixed(3) : "∞"}
          note="Downside volatility only"
          color="var(--bb-cyan)" />
        <RiskMetric label="Calmar Ratio" value={m.calmarRatio.toFixed(3)}
          note="Ann. Return / |Max Drawdown|"
          color="var(--bb-purple)" />
        <RiskMetric label="Information Ratio" value={m.informationRatio.toFixed(3)}
          note="Active alpha / Tracking error"
          color={m.informationRatio >= 0 ? "var(--bb-green)" : "var(--bb-red)"} />
      </div>

      {/* Volatility & VaR */}
      <SectionBar title="🎯 Volatility & Value at Risk" />
      <div className="risk-grid">
        <RiskMetric label="Annualized Volatility" value={fmtPct(m.volatility * 100)}
          note="Daily returns std dev × √252"
          color="var(--bb-amber)" />
        <RiskMetric label="VaR 95% (1 jour)" value={fmt(m.var95)}
          note="Max loss at 95% confidence (historical VaR)"
          color="var(--bb-red)" />
        <RiskMetric label="Expected Shortfall" value={fmt(m.expectedShortfall)}
          note="CVaR 95% — avg loss beyond VaR"
          color="var(--bb-red)" />
        <RiskMetric label="Max Drawdown" value={fmtPct(m.maxDrawdown * 100)}
          note="Maximum peak-to-trough loss"
          color="var(--bb-red)" />
      </div>

      {/* Beta & tracking */}
      <SectionBar title="📐 Beta & Tracking vs Benchmark" />
      <div className="risk-grid">
        <RiskMetric label="Beta" value={m.beta.toFixed(3)}
          note={m.beta > 1.1 ? "Aggressive (amplifies moves)" : m.beta < 0.9 ? "Defensive (dampens moves)" : "Neutral"}
          color="var(--bb-blue)" />
        <RiskMetric label="Tracking Error" value={fmtPct(m.trackingError * 100)}
          note="Std dev of active return vs benchmark"
          color="var(--bb-cyan)" />
      </div>

      {/* Risk decomposition by position */}
      {data && data.positions.length > 0 && (
        <>
          <SectionBar title="🔬 Risk Decomposition by Position" />
          <div className="bb-card">
            {data.positions
              .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
              .slice(0, 15)
              .map(p => (
                <RatingBar
                  key={p.id}
                  label={`${p.ticker} — ${p.name.substring(0, 20)}`}
                  value={p.weight}
                  max={30}
                  color="var(--bb-amber)"
                />
              ))}
          </div>
        </>
      )}

      {/* Correlation matrix */}
      {corrData && corrData.tickers.length > 1 && (
        <>
          <SectionBar title="🔗 Correlation Matrix (1Y)" />
          <div className="bb-card" style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: "9px", fontFamily: "IBM Plex Mono, monospace" }}>
              <thead>
                <tr>
                  <th style={{ padding: "3px 6px", color: "var(--bb-text-muted)", textAlign: "left", minWidth: "70px" }}>Ticker</th>
                  {corrData.tickers.map(t => (
                    <th key={t} style={{ padding: "3px 6px", color: "var(--bb-amber)", textAlign: "center", minWidth: "52px" }}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corrData.tickers.map((ticker, i) => (
                  <tr key={ticker}>
                    <td style={{ padding: "3px 6px", color: "var(--bb-cyan)", fontWeight: 600 }}>{ticker}</td>
                    {corrData.matrix[i].map((corr, j) => (
                      <td key={j} style={{
                        padding: "3px 6px", textAlign: "center",
                        background: corrColor(corr),
                        color: i === j ? "var(--bb-amber)" : "var(--bb-text)",
                        fontWeight: i === j ? 700 : 400,
                        borderRadius: "2px",
                      }}>
                        {corr.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: "8px", fontSize: "9px", color: "var(--bb-text-faint)" }}>
              Red: strong positive correlation (+0.8) — Green: decorrelated — Grey: neutral
            </div>
          </div>
        </>
      )}

      {/* Risk methodology note */}
      <div className="bb-card" style={{ borderColor: "var(--bb-border-2)" }}>
        <div className="bb-card-title">📖 Methodology</div>
        <div style={{ fontSize: "10px", color: "var(--bb-text-muted)", lineHeight: 1.7 }}>
          <strong style={{ color: "var(--bb-text)" }}>Historical VaR 95%:</strong> 5th percentile of simulated daily returns over 252 days.<br />
          <strong style={{ color: "var(--bb-text)" }}>Expected Shortfall (CVaR):</strong> Average loss beyond VaR 95%.<br />
          <strong style={{ color: "var(--bb-text)" }}>Sharpe Ratio:</strong> (Rp − Rf) / σp — risk-free rate = 4%.<br />
          <strong style={{ color: "var(--bb-text)" }}>Sortino Ratio:</strong> Uses downside volatility only (downside deviation).<br />
          <strong style={{ color: "var(--bb-text)" }}>Jensen's Alpha:</strong> α = Rp − [Rf + β·(Rm − Rf)] — measures risk-adjusted outperformance vs systematic risk.<br />
          <strong style={{ color: "var(--bb-text)" }}>Beta:</strong> Cov(Rp, Rb) / Var(Rb) over the selected period.<br />
          <strong style={{ color: "var(--bb-text)" }}>Max Drawdown:</strong> Maximum peak-to-trough loss on the portfolio value series.<br />
          <strong style={{ color: "var(--bb-text)" }}>Note:</strong> Prices used are simulated. Data can be updated via CSV import or Google Sheets sync.
        </div>
      </div>

    </div>
  );
}
