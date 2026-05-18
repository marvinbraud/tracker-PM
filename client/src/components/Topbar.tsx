import { Sun, Moon } from "lucide-react";
import type { Theme } from "../App";

const PERIODS = ["1W", "1M", "3M", "6M", "YTD", "1Y", "3Y", "Max"];
const BENCHMARKS = [
  { value: "SPY",      label: "S&P 500"       },
  { value: "QQQ",      label: "NASDAQ 100"    },
  { value: "^CAC40",   label: "CAC 40"        },
  { value: "^DAX",     label: "DAX 40"        },
  { value: "^STOXX50", label: "Euro Stoxx 50" },
  { value: "^FTSE",    label: "FTSE 100"      },
  { value: "^N225",    label: "Nikkei 225"    },
  { value: "CW8.PA",   label: "MSCI World"    },
  { value: "IWDA.AS",  label: "MSCI World EU" },
  { value: "EEM",      label: "MSCI Emerging" },
  { value: "GLD",      label: "Gold (GLD)"    },
];

interface Props {
  theme: Theme;
  toggleTheme: () => void;
  period: string;
  setPeriod: (p: string) => void;
  benchmark: string;
  setBenchmark: (b: string) => void;
  portfolio: string;
}

export default function Topbar({
  theme, toggleTheme, period, setPeriod, benchmark, setBenchmark, portfolio,
}: Props) {
  const dateStr = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  const portfolioLabel = portfolio === "Global"
    ? "All portfolios"
    : portfolio.replace("::", " › ");

  return (
    <header className="topbar">
      <div className="topbar-inner">

        {/* Portfolio pill */}
        <div style={{
          display: "inline-flex", alignItems: "center",
          padding: "4px 12px", borderRadius: "var(--r-full)",
          background: "var(--primary-dim)", border: "1px solid var(--border)",
          fontSize: "12px", fontWeight: 600, color: "var(--primary)",
          whiteSpace: "nowrap", flexShrink: 0,
        }}>
          {portfolioLabel}
        </div>

        <div className="topbar-divider" />

        {/* Period selector */}
        <div style={{ display: "flex", gap: "3px" }}>
          {PERIODS.map(p => (
            <button
              key={p}
              data-testid={`period-${p}`}
              onClick={() => setPeriod(p)}
              className={`period-btn ${p === period ? "active" : ""}`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="topbar-divider" />

        {/* Benchmark */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          <span style={{ fontSize: "10px", color: "var(--text-faint)", fontWeight: 600, letterSpacing: "0.04em" }}>VS</span>
          <select
            data-testid="select-benchmark"
            value={benchmark}
            onChange={e => setBenchmark(e.target.value)}
            style={{
              fontSize: "12px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              color: "var(--text)",
              padding: "4px 8px",
              cursor: "pointer",
              fontFamily: "inherit",
              outline: "none",
            }}
          >
            {BENCHMARKS.map(b => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Simulated badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          <div className="live-dot" />
          <span style={{ fontSize: "11px", color: "var(--text-faint)", fontWeight: 500 }}>
            Local data
          </span>
        </div>

        <div className="topbar-divider" />

        {/* Date */}
        <span style={{ fontSize: "11px", color: "var(--text-muted)", flexShrink: 0 }}>
          {dateStr}
        </span>

        <div className="topbar-divider" />

        {/* Theme toggle */}
        <button
          data-testid="btn-theme-toggle"
          onClick={toggleTheme}
          style={{
            padding: "6px",
            borderRadius: "var(--r-md)",
            color: "var(--text-muted)",
            background: "none",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            transition: "all var(--t) var(--ease)",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-offset)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
}
