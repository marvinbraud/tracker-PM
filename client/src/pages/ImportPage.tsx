import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../hooks/use-toast";
import { Upload, Download, Plus, RefreshCw, Link as LinkIcon, Check, AlertCircle, X } from "lucide-react";
import {
  importHoldings, addHolding, getAllGSheetSettings, setGSheetUrl, syncGSheet,
  parseCSV, type InsertHoldingLocal,
} from "../lib/localStore";
import type { PortfolioRoot } from "@shared/schema";

interface Props {
  portfolio: string;
  setPortfolio: (p: string) => void;
}

const CSV_TEMPLATE = `portfolio,ticker,name,assetClass,sector,geography,quantity,costPrice,currentPrice,currency,isin
PEA,AIR.PA,Air Liquide,Action,Industrie,France,10,145,162,EUR,FR0000120073
PEA,MC.PA,LVMH,Action,Luxe,France,3,680,710,EUR,FR0000121014
CTO,MSFT,Microsoft,Action,Tech,USA,5,340,415,USD,US5949181045
Crypto,BTC-USD,Bitcoin,Crypto,Crypto,Global,0.12,42000,67000,USD,
`;

const ASSET_CLASSES = ["Action", "ETF", "Crypto", "Obligation", "Cash"];

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="import-section">
      <div className="import-section-icon">{icon}</div>
      <span className="import-section-title">{title}</span>
    </div>
  );
}

// ─── Google Sheet row ─────────────────────────────────────────────────────────

interface GSheetRowProps {
  root: PortfolioRoot;
  settings: { url: string | null; lastSyncAt: string | null };
  onSaved: () => void;
}

function GSheetRow({ root, settings, onSaved }: GSheetRowProps) {
  const { toast } = useToast();
  const [editing, setEditing]   = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [syncing, setSyncing]   = useState(false);

  const hasUrl = !!settings.url;

  async function handleSave() {
    const url = inputVal.trim();
    if (!url) return;
    setGSheetUrl(root.name, url);
    toast({ title: `URL saved for ${root.name}` });
    setEditing(false);
    setInputVal("");
    onSaved();
  }

  async function handleSync() {
    if (!hasUrl) return;
    setSyncing(true);
    const result = await syncGSheet(root.name);
    setSyncing(false);
    if (result.error) {
      toast({ title: `Sync error ${root.name}`, description: result.error, variant: "destructive" });
    } else {
      toast({ title: `✅ Sync ${root.name}`, description: `${result.imported} positions imported` });
      onSaved();
    }
  }

  const lastSyncFormatted = settings.lastSyncAt
    ? new Date(settings.lastSyncAt).toLocaleString("fr-FR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <div className="gsheet-row">
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span className="gsheet-portfolio-name">{root.name}</span>
        <span style={{ fontSize: "10px", color: "var(--text-faint)" }}>
          {root.subAccounts.join(" · ")}
        </span>
      </div>

      {/* URL */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
        <LinkIcon size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
        {editing || !hasUrl ? (
          <>
            <input
              autoFocus={editing}
              value={inputVal || settings.url || ""}
              onChange={e => setInputVal(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              className="field-input"
              style={{ flex: 1, minWidth: "220px", fontSize: "11px" }}
              onKeyDown={e => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") { setEditing(false); setInputVal(""); }
              }}
            />
            <button
              onClick={handleSave}
              disabled={!inputVal.trim()}
              className="btn btn-primary btn-sm"
              style={{ display: "flex", alignItems: "center", gap: "4px" }}
            >
              <Check size={11} /> Save
            </button>
            {editing && (
              <button onClick={() => { setEditing(false); setInputVal(""); }} className="btn btn-ghost btn-sm">
                <X size={11} />
              </button>
            )}
          </>
        ) : (
          <>
            <span style={{ flex: 1, fontSize: "10px", color: "var(--accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {settings.url}
            </span>
            <button onClick={() => { setEditing(true); setInputVal(settings.url ?? ""); }} className="btn btn-ghost btn-sm">
              Edit
            </button>
          </>
        )}
      </div>

      {/* Sync */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <button
          onClick={handleSync}
          disabled={!hasUrl || syncing}
          className="btn btn-primary btn-sm"
          style={{ display: "flex", alignItems: "center", gap: "5px", opacity: hasUrl ? 1 : 0.5 }}
        >
          <RefreshCw size={11} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Sync…" : "Sync"}
        </button>
        {lastSyncFormatted && (
          <span style={{ fontSize: "10px", color: "var(--positive)", display: "flex", alignItems: "center", gap: "3px" }}>
            <Check size={10} /> {lastSyncFormatted}
          </span>
        )}
        {!hasUrl && (
          <span style={{ fontSize: "10px", color: "var(--text-faint)", display: "flex", alignItems: "center", gap: "3px" }}>
            <AlertCircle size={10} /> No sheet configured
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ImportPage({ portfolio }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [parsedRows, setParsedRows] = useState<InsertHoldingLocal[]>([]);
  const [csvRootPortfolio, setCsvRootPortfolio] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);
  const [newRow, setNewRow] = useState<InsertHoldingLocal>({
    portfolio, ticker: "", name: "", assetClass: "Action",
    sector: "", geography: "", quantity: 0, costPrice: 0, currentPrice: undefined, currency: "EUR", isin: "",
  });

  const { data: roots = [], refetch: refetchRoots } = useQuery<PortfolioRoot[]>({
    queryKey: ["/api/portfolios"],
  });
  const { data: allGSheetSettings = {}, refetch: refetchGSheet } = useQuery<
    Record<string, { url: string | null; lastSyncAt: string | null }>
  >({
    queryKey: ["/api/settings/gsheet"],
  });

  const portfolioOptions: { value: string; label: string }[] = [
    { value: "Global", label: "Global (tous)" },
    ...roots.flatMap(root => [
      { value: root.name, label: root.name },
      ...root.subAccounts.map(sub => ({
        value: `${root.name}::${sub}`,
        label: `  ${root.name} › ${sub}`,
      })),
    ]),
  ];

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      setParsedRows(rows);
      toast({ title: `${rows.length} rows parsed` });
    };
    reader.readAsText(file, "utf-8");
    // Reset input so same file can be re-uploaded
    e.target.value = "";
  }

  async function handleImport() {
    setIsImporting(true);
    const result = importHoldings(parsedRows, csvRootPortfolio || undefined);
    qc.invalidateQueries();
    setParsedRows([]);
    setIsImporting(false);
    toast({ title: `✅ Import successful`, description: `${result.imported} positions imported${result.skipped ? `, ${result.skipped} skipped` : ""}` });
  }

  function handleAddRow() {
    if (!newRow.ticker || !newRow.quantity) return;
    addHolding(newRow);
    qc.invalidateQueries();
    toast({ title: "Position added" });
    setNewRow({ portfolio, ticker: "", name: "", assetClass: "Action", sector: "", geography: "", quantity: 0, costPrice: 0, currentPrice: undefined, currency: "EUR", isin: "" });
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "eci_portfolio_template.csv";
    a.click();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* ── Google Sheets ──────────────────────────────── */}
      <div className="bb-card">
        <SectionHeader
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" /><line x1="8" y1="12" x2="16" y2="12" /></svg>}
          title="Google Sheets — Direct Sync"
        />

        <div className="info-box" style={{ marginBottom: "14px" }}>
          <strong style={{ color: "var(--primary)" }}>Serverless:</strong> Sync happens directly from your browser.
          The sheet must be <strong>shared as publicly readable</strong> ("Anyone with the link").
          <br />
          <strong>Expected format:</strong>{" "}
          <code style={{ fontSize: "10px", color: "var(--accent)" }}>
            portfolio, ticker, name, assetClass, sector, geography, quantity, costPrice, <strong>currentPrice</strong>, currency, isin
          </code>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {roots.length === 0 && (
            <div style={{ fontSize: "12px", color: "var(--text-faint)", padding: "12px", textAlign: "center" }}>
              No portfolio yet. Create one in the sidebar.
            </div>
          )}
          {roots.map(root => (
            <GSheetRow
              key={root.name}
              root={root}
              settings={allGSheetSettings[root.name] ?? { url: null, lastSyncAt: null }}
              onSaved={() => { refetchGSheet(); qc.invalidateQueries(); }}
            />
          ))}
        </div>
      </div>

      {/* ── Import CSV ─────────────────────────────────── */}
      <div className="bb-card">
        <SectionHeader
          icon={<Upload size={14} />}
          title="Import CSV / Excel"
        />

        <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "12px" }}>
          <div className="field" style={{ minWidth: "160px" }}>
            <label className="field-label">Import into</label>
            <select
              value={csvRootPortfolio}
              onChange={e => setCsvRootPortfolio(e.target.value)}
              className="field-input"
              data-testid="select-csv-root"
            >
              <option value="">— choose a portfolio —</option>
              {roots.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          </div>

          <button
            data-testid="btn-upload-csv"
            onClick={() => fileRef.current?.click()}
            className="btn btn-secondary"
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <Upload size={13} /> Load CSV
          </button>

          <button
            data-testid="btn-download-template"
            onClick={downloadTemplate}
            className="btn btn-ghost"
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <Download size={13} /> Download template
          </button>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            style={{ display: "none" }}
            onChange={handleFileUpload}
          />
        </div>

        <div className="info-box" style={{ marginBottom: "12px" }}>
          <strong>Required columns:</strong>{" "}
          <code style={{ fontSize: "10px", color: "var(--accent)" }}>
            portfolio · ticker · name · assetClass · sector · geography · quantity · costPrice · currentPrice · currency · isin
          </code>
          <br />
          The <code style={{ color: "var(--accent)" }}>currentPrice</code> column is <strong>optional</strong> — if absent, current price = purchase price (P&L = 0).
          Comma or semicolon separator accepted.
        </div>

        {parsedRows.length > 0 && (
          <div>
            <div style={{ fontSize: "12px", color: "var(--positive)", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
              <Check size={14} /> {parsedRows.length} rows parsed
            </div>
            <div style={{ maxHeight: "220px", overflowY: "auto", marginBottom: "12px", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}>
              <table className="bb-table" style={{ fontSize: "11px" }}>
                <thead>
                  <tr>
                    <th>Portfolio</th><th>Ticker</th><th>Name</th><th>Class</th>
                    <th>Qty</th><th>Cost</th><th>Price</th><th>Currency</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((row, i) => (
                    <tr key={i}>
                      <td style={{ color: "var(--accent)" }}>{row.portfolio}</td>
                      <td><span className="ticker-badge">{row.ticker}</span></td>
                      <td style={{ textAlign: "left" }}>{row.name}</td>
                      <td>{row.assetClass}</td>
                      <td className="tabnum">{row.quantity}</td>
                      <td className="tabnum">{row.costPrice}</td>
                      <td className="tabnum" style={{ color: row.currentPrice ? "var(--positive)" : "var(--text-faint)" }}>
                        {row.currentPrice ?? "—"}
                      </td>
                      <td>{row.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              data-testid="btn-confirm-import"
              onClick={handleImport}
              disabled={isImporting}
              className="btn btn-primary"
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <Check size={14} />
              {isImporting ? "Importing…" : `Import ${parsedRows.length} positions`}
            </button>
          </div>
        )}
      </div>

      {/* ── Ajouter manuellement ───────────────────────── */}
      <div className="bb-card" style={{ width: "100%" }}>
        <SectionHeader
          icon={<Plus size={14} />}
          title="Add a position manually"
        />

        {/* Full-width grid — 12 equal columns */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr 1.8fr 1.2fr 1.3fr 1fr 1fr 1fr 1fr 0.9fr 1.8fr auto",
          gap: "8px",
          alignItems: "end",
          width: "100%",
        }}>
          {/* Portfolio */}
          <div className="field">
            <label className="field-label">Portfolio</label>
            <select
              value={newRow.portfolio}
              onChange={e => setNewRow(r => ({ ...r, portfolio: e.target.value }))}
              className="field-input"
              data-testid="select-new-portfolio"
            >
              {portfolioOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Ticker */}
          <div className="field">
            <label className="field-label">Ticker</label>
            <input
              type="text"
              value={newRow.ticker}
              onChange={e => setNewRow(r => ({ ...r, ticker: e.target.value }))}
              className="field-input"
              data-testid="input-new-ticker"
            />
          </div>

          {/* Name */}
          <div className="field">
            <label className="field-label">Name</label>
            <input
              type="text"
              value={newRow.name}
              onChange={e => setNewRow(r => ({ ...r, name: e.target.value }))}
              className="field-input"
              data-testid="input-new-name"
            />
          </div>

          {/* Class */}
          <div className="field">
            <label className="field-label">Class</label>
            <select
              value={newRow.assetClass}
              onChange={e => setNewRow(r => ({ ...r, assetClass: e.target.value }))}
              className="field-input"
              data-testid="select-new-class"
            >
              {ASSET_CLASSES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {/* Sector */}
          <div className="field">
            <label className="field-label">Sector</label>
            <input
              type="text"
              value={newRow.sector}
              onChange={e => setNewRow(r => ({ ...r, sector: e.target.value }))}
              className="field-input"
              data-testid="input-new-sector"
            />
          </div>

          {/* Geo */}
          <div className="field">
            <label className="field-label">Geo</label>
            <input
              type="text"
              value={newRow.geography}
              onChange={e => setNewRow(r => ({ ...r, geography: e.target.value }))}
              className="field-input"
              data-testid="input-new-geography"
            />
          </div>

          {/* Quantity */}
          <div className="field">
            <label className="field-label">Quantity</label>
            <input
              type="number"
              value={newRow.quantity || ""}
              onChange={e => setNewRow(r => ({ ...r, quantity: parseFloat(e.target.value) || 0 }))}
              className="field-input"
              data-testid="input-new-quantity"
            />
          </div>

          {/* Cost */}
          <div className="field">
            <label className="field-label">Cost</label>
            <input
              type="number"
              value={newRow.costPrice || ""}
              onChange={e => setNewRow(r => ({ ...r, costPrice: parseFloat(e.target.value) || 0 }))}
              className="field-input"
              data-testid="input-new-costPrice"
            />
          </div>

          {/* Price */}
          <div className="field">
            <label className="field-label">Price</label>
            <input
              type="number"
              value={newRow.currentPrice ?? ""}
              onChange={e => setNewRow(r => ({ ...r, currentPrice: e.target.value === "" ? undefined : parseFloat(e.target.value) }))}
              className="field-input"
              data-testid="input-new-currentPrice"
            />
          </div>

          {/* Currency */}
          <div className="field">
            <label className="field-label">Currency</label>
            <input
              type="text"
              value={newRow.currency}
              onChange={e => setNewRow(r => ({ ...r, currency: e.target.value }))}
              className="field-input"
              data-testid="input-new-currency"
            />
          </div>

          {/* ISIN */}
          <div className="field">
            <label className="field-label">ISIN</label>
            <input
              type="text"
              value={newRow.isin ?? ""}
              onChange={e => setNewRow(r => ({ ...r, isin: e.target.value }))}
              className="field-input"
              data-testid="input-new-isin"
            />
          </div>

          {/* Add button — aligned to bottom of row */}
          <button
            data-testid="btn-add-position"
            onClick={handleAddRow}
            disabled={!newRow.ticker || !newRow.quantity}
            className="btn btn-primary"
            style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap", height: "32px" }}
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </div>

    </div>
  );
}
