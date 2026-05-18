import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard, BarChart3, Table2, ShieldAlert, Upload, RefreshCw,
  ChevronDown, ChevronRight, Pencil, Check, X, Plus, Trash2, Globe, Target,
} from "lucide-react";
import {
  addPortfolioRoot, renamePortfolioRoot, deletePortfolioRoot,
  syncAllGSheets, refreshLivePrices, getLastLiveUpdate,
} from "../lib/localStore";
import type { PortfolioRoot } from "@shared/schema";

interface Props {
  portfolio: string;
  setPortfolio: (p: string) => void;
}

const NAV = [
  { href: "/",          label: "Overview",  icon: LayoutDashboard },
  { href: "/positions", label: "Positions", icon: Table2         },
  { href: "/charts",    label: "Charts",    icon: BarChart3      },
  { href: "/risk",      label: "Risk",      icon: ShieldAlert    },
  { href: "/macro",     label: "Macro",     icon: Globe          },
  { href: "/goals",     label: "Goals",     icon: Target         },
  { href: "/import",    label: "Import",    icon: Upload         },
];

export default function Sidebar({ portfolio, setPortfolio }: Props) {
  const [location] = useLocation();
  const qc = useQueryClient();

  const [expandedRoots, setExpandedRoots] = useState<Record<string, boolean>>({});
  const [editingRoot, setEditingRoot] = useState<string | null>(null);
  const [editValue, setEditValue]     = useState("");
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName]         = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [liveStatus, setLiveStatus] = useState<{ updated: number; failed: string[]; ts: string } | null>(null);
  const [lastUpdate] = useState(() => getLastLiveUpdate());

  const { data: roots = [] } = useQuery<PortfolioRoot[]>({
    queryKey: ["/api/portfolios"],
  });

  // ── Mutations via localStore ─────────────────────────────────────────────

  function handleCreate() {
    if (!newName.trim()) return;
    addPortfolioRoot(newName.trim());
    qc.invalidateQueries({ queryKey: ["/api/portfolios"] });
    setExpandedRoots(p => ({ ...p, [newName.trim()]: true }));
    setPortfolio(newName.trim());
    setCreatingNew(false);
    setNewName("");
  }

  function handleRename(oldName: string) {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === oldName) { setEditingRoot(null); return; }
    renamePortfolioRoot(oldName, trimmed);
    if (portfolio === oldName || portfolio.startsWith(`${oldName}::`)) {
      setPortfolio(portfolio.replace(oldName, trimmed));
    }
    qc.invalidateQueries();
    setEditingRoot(null);
  }

  function handleDelete(name: string) {
    deletePortfolioRoot(name);
    if (portfolio === name || portfolio.startsWith(`${name}::`)) setPortfolio("Global");
    qc.invalidateQueries();
    setConfirmDelete(null);
  }

  async function handleRefresh() {
    setSyncing(true);
    // 1. Sync Google Sheets (if any URL configured)
    await syncAllGSheets();
    // 2. Fetch live prices from Yahoo Finance via Netlify Function
    const result = await refreshLivePrices();
    setLiveStatus({ ...result, ts: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) });
    qc.invalidateQueries();
    setSyncing(false);
  }

  const isGlobal = portfolio === "Global";

  return (
    <aside className="sidebar" style={{ userSelect: "none", display: "flex", flexDirection: "column" }}>

      {/* ── Logo ────────────────────────────────────────── */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-mark">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M3 14L7 7L11 11L14 7.5L17 14" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div>
          <div className="sidebar-logo-text">ECI Dashboard</div>
          <div className="sidebar-logo-sub">ESSEC Capital Investments</div>
        </div>
      </div>

      {/* ── Portfolios ──────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px 4px" }}>
          <span className="bb-label">Portfolios</span>
          <button
            onClick={() => { setCreatingNew(true); setNewName(""); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", padding: "2px", borderRadius: "4px", display: "flex", alignItems: "center" }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--primary)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--text-faint)")}
            title="New portfolio"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Global */}
        <button
          data-testid="portfolio-Global"
          onClick={() => setPortfolio("Global")}
          className={`portfolio-item ${isGlobal ? "active" : ""}`}
        >
          <span style={{ fontSize: "12px" }}>All portfolios</span>
          <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--text-faint)", background: "var(--surface-offset)", padding: "1px 6px", borderRadius: "var(--r-full)" }}>ALL</span>
        </button>

        {/* Nouveau portfolio inline */}
        {creatingNew && (
          <div style={{ padding: "4px 10px", display: "flex", gap: "4px", alignItems: "center" }}>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") { setCreatingNew(false); setNewName(""); }
              }}
              placeholder="Portfolio name…"
              className="field-input"
              style={{ fontSize: "12px", padding: "4px 8px" }}
            />
            <button onClick={handleCreate} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--positive)", padding: "2px" }}>
              <Check size={13} />
            </button>
            <button onClick={() => { setCreatingNew(false); setNewName(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--negative)", padding: "2px" }}>
              <X size={13} />
            </button>
          </div>
        )}

        {/* Portfolio roots */}
        {roots.map(root => {
          const isRootActive = portfolio === root.name;
          const expanded     = expandedRoots[root.name] ?? true;
          const isRenaming   = editingRoot === root.name;

          return (
            <div key={root.name}>
              {/* Root header */}
              <div style={{ display: "flex", alignItems: "center", padding: "0 8px", gap: "2px" }}>
                <button
                  onClick={() => setExpandedRoots(p => ({ ...p, [root.name]: !p[root.name] }))}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", padding: "3px", borderRadius: "4px", display: "flex", alignItems: "center", flexShrink: 0 }}
                >
                  {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>

                {isRenaming ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") handleRename(root.name);
                      if (e.key === "Escape") setEditingRoot(null);
                    }}
                    className="field-input"
                    style={{ flex: 1, fontSize: "12px", padding: "3px 8px" }}
                  />
                ) : (
                  <button
                    data-testid={`portfolio-${root.name}`}
                    onClick={() => setPortfolio(root.name)}
                    className={`portfolio-item ${isRootActive ? "active" : ""}`}
                    style={{ flex: 1, padding: "5px 8px", margin: "1px 0" }}
                  >
                    <span style={{ fontSize: "12px", fontWeight: 600 }}>{root.name}</span>
                    <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--text-faint)" }}>ALL</span>
                  </button>
                )}

                {/* Actions (rename, delete, confirm) */}
                {!isRenaming && confirmDelete !== root.name && (
                  <>
                    <button
                      onClick={() => { setEditingRoot(root.name); setEditValue(root.name); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", padding: "2px", borderRadius: "3px", flexShrink: 0, display: "flex", alignItems: "center" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "var(--primary)")}
                      onMouseLeave={e => (e.currentTarget.style.color = "var(--text-faint)")}
                    >
                      <Pencil size={10} />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(root.name)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", padding: "2px", borderRadius: "3px", flexShrink: 0, display: "flex", alignItems: "center" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "var(--negative)")}
                      onMouseLeave={e => (e.currentTarget.style.color = "var(--text-faint)")}
                    >
                      <Trash2 size={10} />
                    </button>
                  </>
                )}
                {isRenaming && (
                  <>
                    <button onClick={() => handleRename(root.name)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--positive)", padding: "2px", display: "flex" }}>
                      <Check size={12} />
                    </button>
                    <button onClick={() => setEditingRoot(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--negative)", padding: "2px", display: "flex" }}>
                      <X size={12} />
                    </button>
                  </>
                )}
                {confirmDelete === root.name && (
                  <>
                    <span style={{ fontSize: "10px", color: "var(--negative)", flexShrink: 0 }}>Delete?</span>
                    <button onClick={() => handleDelete(root.name)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--negative)", padding: "1px", fontSize: "10px", fontWeight: 700 }}>
                      Yes
                    </button>
                    <button onClick={() => setConfirmDelete(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "1px", fontSize: "10px" }}>
                      No
                    </button>
                  </>
                )}
              </div>

              {/* Sub-accounts */}
              {expanded && root.subAccounts.length > 0 && (
                <div style={{ marginLeft: "28px", borderLeft: "2px solid var(--divider)", paddingLeft: "4px", marginBottom: "4px" }}>
                  {root.subAccounts.map(sub => {
                    const key = `${root.name}::${sub}`;
                    return (
                      <button
                        key={sub}
                        data-testid={`portfolio-${root.name}-${sub}`}
                        onClick={() => setPortfolio(key)}
                        className={`portfolio-item ${portfolio === key ? "active" : ""}`}
                        style={{ fontSize: "11px", padding: "4px 8px" }}
                      >
                        {sub}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* ── Navigation ──────────────────────────────────── */}
        <div className="sidebar-section-label" style={{ marginTop: "8px" }}>Navigation</div>
        <nav>
          {NAV.map(item => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <button
                  data-testid={`nav-${item.label.toLowerCase().replace(/ /g, "-")}`}
                  className={`nav-item ${isActive ? "active" : ""}`}
                >
                  <Icon size={14} />
                  <span>{item.label}</span>
                </button>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* ── Refresh + Footer ────────────────────────────── */}
      <div style={{ padding: "12px", borderTop: "1px solid var(--border)" }}>
        <button
          data-testid="btn-refresh"
          onClick={handleRefresh}
          disabled={syncing}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
            gap: "6px", padding: "8px 12px", background: "var(--primary-dim)",
            border: "1px solid var(--border)", borderRadius: "var(--r-md)",
            cursor: syncing ? "wait" : "pointer", color: "var(--primary)",
            fontSize: "12px", fontWeight: 600, fontFamily: "inherit",
            transition: "all var(--t) var(--ease)",
          }}
          onMouseEnter={e => { if (!syncing) { (e.currentTarget as HTMLButtonElement).style.background = "var(--primary)"; (e.currentTarget as HTMLButtonElement).style.color = "white"; } }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--primary-dim)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--primary)"; }}
        >
          <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Fetching live prices…" : "Sync & Live Prices"}
        </button>

        {/* Live price status */}
        {liveStatus && (
          <div style={{ marginTop: "6px", fontSize: "10px", lineHeight: 1.5 }}>
            {liveStatus.updated > 0 ? (
              <div style={{ color: "var(--positive)", display: "flex", alignItems: "center", gap: "4px" }}>
                <span>●</span>
                <span>{liveStatus.updated} prices updated · {liveStatus.ts}</span>
              </div>
            ) : (
              <div style={{ color: "var(--warning)", fontSize: "9px" }}>
                Live prices unavailable (deploy to Netlify or run <code>netlify dev</code>)
              </div>
            )}
            {liveStatus.failed.length > 0 && (
              <div style={{ color: "var(--text-faint)", fontSize: "9px", marginTop: "2px" }}>
                Not found: {liveStatus.failed.slice(0, 4).join(", ")}{liveStatus.failed.length > 4 ? "…" : ""}
              </div>
            )}
          </div>
        )}
        {!liveStatus && lastUpdate && (
          <div style={{ marginTop: "4px", fontSize: "9px", color: "var(--text-faint)" }}>
            Last live update: {new Date(lastUpdate).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}

        <div style={{ marginTop: "6px", textAlign: "center", fontSize: "10px", color: "var(--text-faint)" }}>
          ECI Portfolio Dashboard v2
        </div>
      </div>
    </aside>
  );
}
