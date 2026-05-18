import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PortfolioSummary, Position } from "@shared/schema";
import { fmt, fmtPct, colorClass, assetBadgeClass } from "../lib/utils";
import { TrendingUp, TrendingDown, Minus, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "../hooks/use-toast";

interface Props { portfolio: string; period: string; benchmark: string; }

type SortKey = "ticker" | "name" | "assetClass" | "marketValue" | "pnlAmount" | "pnlPct" | "weight" | "dayChange" | "quantity" | "currentPrice" | "costPrice";

function Badge({ cls }: { cls: string }) {
  return <span className={`ticker-badge ${assetBadgeClass(cls)}`}>{cls}</span>;
}

export default function PositionsPage({ portfolio, period, benchmark }: Props) {
  const { data, isLoading } = useQuery<PortfolioSummary>({
    queryKey: [`/api/summary?portfolio=${portfolio}&period=${period}&benchmark=${benchmark}`],
  });

  const { toast } = useToast();
  const [sortKey, setSortKey] = useState<SortKey>("marketValue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterClass, setFilterClass] = useState<string>("All");
  const [filterSector, setFilterSector] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/holdings/${id}`),
    onSuccess: () => {
      toast({ title: "Position deleted" });
      queryClient.invalidateQueries();
      setConfirmDelete(null);
    },
    onError: () => toast({ title: "Error deleting position", variant: "destructive" }),
  });

  const positions = data?.positions ?? [];

  const assetClasses = useMemo(() => ["All", ...Array.from(new Set(positions.map(p => p.assetClass)))], [positions]);
  const sectors = useMemo(() => ["All", ...Array.from(new Set(positions.map(p => p.sector)))], [positions]);

  const filtered = useMemo(() => {
    return positions
      .filter(p => filterClass === "All" || p.assetClass === filterClass)
      .filter(p => filterSector === "All" || p.sector === filterSector)
      .filter(p => !search || p.ticker.toLowerCase().includes(search.toLowerCase()) || p.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const valA = a[sortKey] as number | string;
        const valB = b[sortKey] as number | string;
        if (typeof valA === "number" && typeof valB === "number") {
          return sortDir === "asc" ? valA - valB : valB - valA;
        }
        return sortDir === "asc"
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA));
      });
  }, [positions, sortKey, sortDir, filterClass, filterSector, search]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  function thClass(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? "sort-asc" : "sort-desc";
  }

  const totalMV = filtered.reduce((s, p) => s + p.marketValue, 0);
  const totalPnl = filtered.reduce((s, p) => s + p.pnlAmount, 0);

  if (isLoading) return (
    <div style={{ padding: "24px", textAlign: "center", color: "var(--bb-text-muted)" }} className="bb-loading">
      Loading positions…
    </div>
  );

  const COLS: { key: SortKey; label: string; w?: string }[] = [
    { key: "ticker", label: "Ticker", w: "80px" },
    { key: "name", label: "Name", w: "180px" },
    { key: "assetClass", label: "Class", w: "80px" },
    { key: "currentPrice", label: "Price" },
    { key: "quantity", label: "Qty" },
    { key: "costPrice", label: "Cost" },
    { key: "marketValue", label: "Mkt Value" },
    { key: "pnlAmount", label: "P&L €" },
    { key: "pnlPct", label: "P&L %" },
    { key: "weight", label: "Weight" },
    { key: "dayChange", label: "Δ Day" },
  ];

  // Quantité : affiche jusqu'à 6 décimales, supprime les zéros inutiles, virgule comme décimale
  function fmtQty(qty: number): string {
    if (Number.isInteger(qty)) return qty.toLocaleString("fr-FR");
    // Trouve le bon nombre de décimales significatives (max 6)
    for (let d = 1; d <= 6; d++) {
      const rounded = parseFloat(qty.toFixed(d));
      if (Math.abs(rounded - qty) < 1e-9) {
        return rounded.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
      }
    }
    return qty.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  }

  return (
    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
      {/* Summary totals */}
      <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
        <div className="bb-section-bar" style={{ flex: 0 }}>POSITIONS ({filtered.length}/{positions.length})</div>
        <span style={{ fontSize: "11px", color: "var(--bb-text-muted)" }}>Total value: <span className="tabnum" style={{ color: "var(--bb-amber)" }}>{fmt(totalMV)}</span></span>
        <span style={{ fontSize: "11px", color: "var(--bb-text-muted)" }}>Total P&L: <span className={`tabnum ${colorClass(totalPnl)}`}>{fmt(totalPnl)}</span></span>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <input
          data-testid="input-search"
          placeholder="Search…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{
            fontSize: "11px", background: "var(--bb-surface-2)", border: "1px solid var(--bb-border)",
            color: "var(--bb-text)", borderRadius: "2px", padding: "3px 8px", width: "140px",
          }}
        />
        <select data-testid="filter-class" value={filterClass} onChange={e => setFilterClass(e.target.value)}
          style={{ fontSize: "11px", background: "var(--bb-surface-2)", border: "1px solid var(--bb-border)", color: "var(--bb-text)", borderRadius: "2px", padding: "3px 6px" }}>
          {assetClasses.map(c => <option key={c}>{c}</option>)}
        </select>
        <select data-testid="filter-sector" value={filterSector} onChange={e => setFilterSector(e.target.value)}
          style={{ fontSize: "11px", background: "var(--bb-surface-2)", border: "1px solid var(--bb-border)", color: "var(--bb-text)", borderRadius: "2px", padding: "3px 6px" }}>
          {sectors.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{ overflow: "auto", flex: 1 }}>
        <table className="bb-table">
          <thead>
            <tr>
              {COLS.map(c => (
                <th key={c.key} className={thClass(c.key)} onClick={() => toggleSort(c.key)}
                  style={{ width: c.w }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} data-testid={`row-${p.ticker}`}>
                <td style={{ textAlign: "left", paddingLeft: "6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    {confirmDelete === p.id ? (
                      <>
                        <button
                          data-testid={`btn-confirm-delete-${p.ticker}`}
                          onClick={() => deleteMutation.mutate(p.id)}
                          disabled={deleteMutation.isPending}
                          style={{ fontSize: "9px", background: "var(--bb-red)", color: "#fff", border: "none", borderRadius: "2px", padding: "1px 5px", cursor: "pointer", fontWeight: 700, whiteSpace: "nowrap" }}
                        >YES</button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          style={{ fontSize: "9px", background: "var(--bb-surface-2)", color: "var(--bb-text-muted)", border: "1px solid var(--bb-border)", borderRadius: "2px", padding: "1px 5px", cursor: "pointer" }}
                        >NO</button>
                      </>
                    ) : (
                      <>
                        <button
                          data-testid={`btn-delete-${p.ticker}`}
                          onClick={() => setConfirmDelete(p.id)}
                          title="Delete this position"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--bb-text-faint)", padding: "1px", lineHeight: 1, flexShrink: 0 }}
                          onMouseEnter={e => (e.currentTarget.style.color = "var(--bb-red)")}
                          onMouseLeave={e => (e.currentTarget.style.color = "var(--bb-text-faint)")}
                        >
                          <Trash2 size={10} />
                        </button>
                        <span className="ticker-badge">{p.ticker}</span>
                      </>
                    )}
                  </div>
                </td>
                <td style={{ textAlign: "left", maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", color: "var(--bb-text)" }}>{p.name}</td>
                <td><Badge cls={p.assetClass} /></td>
                <td className="tabnum" style={{ color: "var(--bb-text)" }}>{p.currentPrice.toLocaleString("fr-FR", { minimumFractionDigits: p.currentPrice > 100 ? 2 : 4, maximumFractionDigits: p.currentPrice > 100 ? 2 : 4 })}</td>
                <td className="tabnum" style={{ color: "var(--bb-text-muted)" }}>{fmtQty(p.quantity)}</td>
                <td className="tabnum" style={{ color: "var(--bb-text-muted)" }}>{p.costPrice.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="tabnum" style={{ color: "var(--bb-amber)", fontWeight: 600 }}>{fmt(p.marketValue)}</td>
                <td className={`tabnum ${colorClass(p.pnlAmount)}`}>{fmt(p.pnlAmount)}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "3px" }}>
                    {p.pnlPct > 0.5 ? <TrendingUp size={10} color="var(--bb-green)" /> :
                      p.pnlPct < -0.5 ? <TrendingDown size={10} color="var(--bb-red)" /> :
                        <Minus size={10} color="var(--bb-text-muted)" />}
                    <span className={`tabnum ${colorClass(p.pnlPct)}`}>{fmtPct(p.pnlPct)}</span>
                  </div>
                </td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "4px" }}>
                    <div style={{ width: "40px", height: "4px", background: "var(--bb-border)", borderRadius: "2px", overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, p.weight)}%`, height: "100%", background: "var(--bb-amber)", borderRadius: "2px" }} />
                    </div>
                    <span className="tabnum" style={{ color: "var(--bb-text-muted)" }}>{p.weight.toFixed(1)}%</span>
                  </div>
                </td>
                <td className={`tabnum ${colorClass(p.dayChange)}`}>{fmtPct(p.dayChange)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Geographic allocation bar */}
      {data && (
        <div style={{ marginTop: "4px" }}>
          <div className="bb-section-bar" style={{ marginBottom: "4px" }}>GEOGRAPHIC ALLOCATION</div>
          <div style={{ display: "flex", height: "20px", borderRadius: "2px", overflow: "hidden", gap: "1px" }}>
            {data.allocationByGeo.map((g, i) => (
              <div key={g.name} title={`${g.name}: ${g.pct.toFixed(1)}%`}
                style={{
                  flex: g.pct, background: ["#f5a623", "#4d9eff", "#00d45a", "#a569db", "#00c7db", "#ff6b35"][i % 6],
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "9px", color: "#000", fontWeight: 700, overflow: "hidden",
                  minWidth: g.pct > 8 ? "auto" : "0px",
                }}>
                {g.pct > 8 ? `${g.name.split(" ")[0]} ${g.pct.toFixed(0)}%` : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
