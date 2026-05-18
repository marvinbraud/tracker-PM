import { useState, useMemo, useEffect } from "react";
import { Target, TrendingUp, Wallet, CalendarDays, Plus, Trash2, Pencil, Check, X, DollarSign, BarChart3 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { getHoldings } from "../lib/localStore";

// ─── Data Models ──────────────────────────────────────────────────────────────

type GoalCategory = "Retirement" | "Real Estate" | "Emergency Fund" | "Travel" | "Education" | "Other";
type DividendFrequency = "monthly" | "quarterly" | "semi-annual" | "annual";

interface Goal {
  id: string;
  name: string;
  category: GoalCategory;
  targetAmount: number;
  currentAmount: number;
  monthlyContribution: number;
  targetDate: string; // YYYY-MM-DD
  currency: string;
}

interface DividendSetting {
  annualDPS: number;        // annual dividend per share
  frequency: DividendFrequency;
  currency: string;
}

interface ReceivedDividend {
  id: string;
  ticker: string;
  amount: number;
  date: string; // YYYY-MM-DD
  currency: string;
  notes: string;
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const GOALS_KEY   = "eci_goals_v1";
const DIVSETT_KEY = "eci_div_settings_v1";
const DIVREC_KEY  = "eci_div_received_v1";

function loadGoals(): Goal[] {
  try { return JSON.parse(localStorage.getItem(GOALS_KEY) || "[]"); } catch { return []; }
}
function saveGoals(g: Goal[]) { localStorage.setItem(GOALS_KEY, JSON.stringify(g)); }

function loadDivSettings(): Record<string, DividendSetting> {
  try { return JSON.parse(localStorage.getItem(DIVSETT_KEY) || "{}"); } catch { return {}; }
}
function saveDivSettings(s: Record<string, DividendSetting>) {
  localStorage.setItem(DIVSETT_KEY, JSON.stringify(s));
}

function loadReceived(): ReceivedDividend[] {
  try { return JSON.parse(localStorage.getItem(DIVREC_KEY) || "[]"); } catch { return []; }
}
function saveReceived(r: ReceivedDividend[]) { localStorage.setItem(DIVREC_KEY, JSON.stringify(r)); }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, currency = "EUR") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
function fmtSmall(n: number, currency = "EUR") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

const CATEGORY_COLORS: Record<GoalCategory, string> = {
  Retirement:      "#5e7c9e",
  "Real Estate":   "#4aaa68",
  "Emergency Fund":"#d4923a",
  Travel:          "#7b68ee",
  Education:       "#e06060",
  Other:           "#8a9aab",
};

const FREQ_FACTOR: Record<DividendFrequency, number> = {
  monthly: 12, quarterly: 4, "semi-annual": 2, annual: 1,
};

function monthsUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now    = new Date();
  return Math.max(0, (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth()));
}

function estimatedCompletion(goal: Goal): { months: number; onTrack: boolean } | null {
  const gap = goal.targetAmount - goal.currentAmount;
  if (gap <= 0) return { months: 0, onTrack: true };
  if (goal.monthlyContribution <= 0) return null;
  const months = Math.ceil(gap / goal.monthlyContribution);
  const remaining = monthsUntil(goal.targetDate);
  return { months, onTrack: months <= remaining };
}

function goalStatus(goal: Goal): "done" | "on-track" | "at-risk" | "behind" {
  if (goal.currentAmount >= goal.targetAmount) return "done";
  const est = estimatedCompletion(goal);
  if (!est) return "behind";
  const remaining = monthsUntil(goal.targetDate);
  if (remaining <= 0) return "behind";
  if (est.months <= remaining) return "on-track";
  if (est.months <= remaining * 1.25) return "at-risk";
  return "behind";
}

const STATUS_COLORS = {
  done:       "var(--positive)",
  "on-track": "var(--positive)",
  "at-risk":  "var(--warning)",
  behind:     "var(--negative)",
};

const STATUS_LABELS = {
  done:       "Completed",
  "on-track": "On Track",
  "at-risk":  "At Risk",
  behind:     "Behind",
};

function uid() { return Math.random().toString(36).slice(2); }

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionBar({ title }: { title: string }) {
  return (
    <div className="bb-section-bar" style={{ marginBottom: "6px" }}>
      <span>{title}</span>
    </div>
  );
}

function KpiTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card" style={{ padding: "12px 16px", minWidth: 0 }}>
      <div style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 700, color: color ?? "var(--text)", fontFamily: "var(--font-mono)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: "10px", color: "var(--text-faint)", marginTop: "3px" }}>{sub}</div>}
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div style={{ height: "6px", background: "var(--border)", borderRadius: "3px", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${clamped}%`, background: color, borderRadius: "3px", transition: "width .4s ease" }} />
    </div>
  );
}

// ─── Goal Form ────────────────────────────────────────────────────────────────

const EMPTY_GOAL: Omit<Goal, "id"> = {
  name: "", category: "Other", targetAmount: 0, currentAmount: 0,
  monthlyContribution: 0, targetDate: "", currency: "EUR",
};

function GoalForm({ initial, onSave, onCancel }: {
  initial?: Partial<Goal>;
  onSave: (g: Omit<Goal, "id">) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Omit<Goal, "id">>({ ...EMPTY_GOAL, ...initial });
  const set = (k: keyof typeof form, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="card" style={{ padding: "16px", border: "1px solid var(--primary)", background: "var(--surface)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
        {/* Name */}
        <div style={{ gridColumn: "span 2" }}>
          <label style={labelStyle}>Goal Name</label>
          <input className="field-input" value={form.name} placeholder="e.g. Down payment, Retirement fund…"
            onChange={e => set("name", e.target.value)} style={inputStyle} />
        </div>
        {/* Category */}
        <div>
          <label style={labelStyle}>Category</label>
          <select className="field-input" value={form.category} onChange={e => set("category", e.target.value as GoalCategory)} style={inputStyle}>
            {(["Retirement","Real Estate","Emergency Fund","Travel","Education","Other"] as GoalCategory[]).map(c =>
              <option key={c} value={c}>{c}</option>
            )}
          </select>
        </div>
        {/* Currency */}
        <div>
          <label style={labelStyle}>Currency</label>
          <select className="field-input" value={form.currency} onChange={e => set("currency", e.target.value)} style={inputStyle}>
            {["EUR","USD","GBP","CHF","CAD","JPY"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {/* Target */}
        <div>
          <label style={labelStyle}>Target Amount</label>
          <input className="field-input" type="number" min="0" value={form.targetAmount || ""}
            placeholder="0" onChange={e => set("targetAmount", parseFloat(e.target.value) || 0)} style={inputStyle} />
        </div>
        {/* Current */}
        <div>
          <label style={labelStyle}>Current Savings</label>
          <input className="field-input" type="number" min="0" value={form.currentAmount || ""}
            placeholder="0" onChange={e => set("currentAmount", parseFloat(e.target.value) || 0)} style={inputStyle} />
        </div>
        {/* Monthly contribution */}
        <div>
          <label style={labelStyle}>Monthly Contribution</label>
          <input className="field-input" type="number" min="0" value={form.monthlyContribution || ""}
            placeholder="0" onChange={e => set("monthlyContribution", parseFloat(e.target.value) || 0)} style={inputStyle} />
        </div>
        {/* Target date */}
        <div>
          <label style={labelStyle}>Target Date</label>
          <input className="field-input" type="date" min={today} value={form.targetDate}
            onChange={e => set("targetDate", e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div style={{ display: "flex", gap: "8px", marginTop: "14px", justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={btnSecStyle}><X size={13} /> Cancel</button>
        <button onClick={() => form.name && form.targetAmount > 0 && onSave(form)} style={btnPrimStyle}><Check size={13} /> Save Goal</button>
      </div>
    </div>
  );
}

// ─── Goal Card ────────────────────────────────────────────────────────────────

function GoalCard({ goal, onEdit, onDelete }: { goal: Goal; onEdit: () => void; onDelete: () => void }) {
  const pct    = goal.targetAmount > 0 ? (goal.currentAmount / goal.targetAmount) * 100 : 0;
  const status = goalStatus(goal);
  const color  = STATUS_COLORS[status];
  const catCol = CATEGORY_COLORS[goal.category];
  const est    = estimatedCompletion(goal);
  const remaining = monthsUntil(goal.targetDate);
  const gap    = Math.max(0, goal.targetAmount - goal.currentAmount);

  return (
    <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--text)" }}>{goal.name}</span>
            <span style={{ fontSize: "10px", padding: "1px 7px", borderRadius: "10px", background: catCol + "22", color: catCol, fontWeight: 600, letterSpacing: ".04em" }}>
              {goal.category}
            </span>
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
            Target: {goal.targetDate ? new Date(goal.targetDate).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—"}
            {remaining > 0 && ` · ${remaining}mo remaining`}
          </div>
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          <button onClick={onEdit} style={iconBtnStyle} title="Edit"><Pencil size={12} /></button>
          <button onClick={onDelete} style={{ ...iconBtnStyle, color: "var(--negative)" }} title="Delete"><Trash2 size={12} /></button>
        </div>
      </div>

      {/* Progress */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "5px" }}>
          <span style={{ color: "var(--text)", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
            {fmt(goal.currentAmount, goal.currency)}
          </span>
          <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {fmt(goal.targetAmount, goal.currency)}
          </span>
        </div>
        <ProgressBar pct={pct} color={color} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", fontSize: "10px" }}>
          <span style={{ color, fontWeight: 600 }}>{pct.toFixed(1)}% — {STATUS_LABELS[status]}</span>
          <span style={{ color: "var(--text-faint)" }}>{fmt(gap, goal.currency)} left</span>
        </div>
      </div>

      {/* Footer stats */}
      <div style={{ display: "flex", gap: "16px", borderTop: "1px solid var(--border)", paddingTop: "8px" }}>
        <div>
          <div style={statLabelStyle}>Monthly</div>
          <div style={{ ...statValStyle, color: "var(--text)" }}>{fmt(goal.monthlyContribution, goal.currency)}</div>
        </div>
        {est && (
          <div>
            <div style={statLabelStyle}>Est. completion</div>
            <div style={{ ...statValStyle, color: est.onTrack ? "var(--positive)" : "var(--warning)" }}>
              {est.months < 1 ? "< 1 mo" : `${est.months} mo`}
            </div>
          </div>
        )}
        {!est && goal.targetAmount > goal.currentAmount && (
          <div>
            <div style={statLabelStyle}>Est. completion</div>
            <div style={{ ...statValStyle, color: "var(--negative)" }}>No contribution</div>
          </div>
        )}
        {goal.targetDate && (
          <div style={{ marginLeft: "auto" }}>
            <div style={statLabelStyle}>Deadline</div>
            <div style={{ ...statValStyle, color: remaining < 6 && status !== "done" ? "var(--negative)" : "var(--text)" }}>
              {remaining === 0 ? "Overdue" : `${remaining}mo`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

interface Props { portfolio: string; }

export default function GoalsPage({ portfolio }: Props) {
  // ── Goals state ──
  const [goals,    setGoals]    = useState<Goal[]>(loadGoals);
  const [showForm, setShowForm] = useState(false);
  const [editId,   setEditId]   = useState<string | null>(null);

  // ── Dividend state ──
  const [divSettings, setDivSettings] = useState<Record<string, DividendSetting>>(loadDivSettings);
  const [received,    setReceived]     = useState<ReceivedDividend[]>(loadReceived);
  const [editTicker,  setEditTicker]   = useState<string | null>(null);
  const [editDPS,     setEditDPS]      = useState("");
  const [editFreq,    setEditFreq]     = useState<DividendFrequency>("quarterly");
  const [editDivCur,  setEditDivCur]   = useState("EUR");
  const [showAddRec,  setShowAddRec]   = useState(false);
  const [recForm,     setRecForm]      = useState({ ticker: "", amount: "", date: "", currency: "EUR", notes: "" });

  // ── Holdings ──
  const holdings = useMemo(() => {
    const all = getHoldings(portfolio === "Global" ? "Global" : portfolio);
    const unique: Record<string, { ticker: string; name: string; qty: number; currency: string }> = {};
    for (const h of all) {
      if (!unique[h.ticker]) unique[h.ticker] = { ticker: h.ticker, name: h.name, qty: 0, currency: h.currency };
      unique[h.ticker].qty += h.quantity;
    }
    return Object.values(unique).sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [portfolio]);

  // ── Persist ──
  useEffect(() => { saveGoals(goals); },       [goals]);
  useEffect(() => { saveDivSettings(divSettings); }, [divSettings]);
  useEffect(() => { saveReceived(received); }, [received]);

  // ── Goal KPIs ──
  const goalKpis = useMemo(() => {
    const total   = goals.length;
    const onTrack = goals.filter(g => goalStatus(g) === "on-track" || goalStatus(g) === "done").length;
    const behind  = goals.filter(g => goalStatus(g) === "behind").length;
    const atRisk  = goals.filter(g => goalStatus(g) === "at-risk").length;
    const totalTarget  = goals.reduce((s, g) => s + g.targetAmount, 0);
    const totalCurrent = goals.reduce((s, g) => s + g.currentAmount, 0);
    return { total, onTrack, behind, atRisk, totalTarget, totalCurrent };
  }, [goals]);

  // ── Dividend KPIs ──
  const divKpis = useMemo(() => {
    let annualProjected = 0;
    for (const h of holdings) {
      const s = divSettings[h.ticker];
      if (s && s.annualDPS > 0) annualProjected += s.annualDPS * h.qty;
    }

    const now   = new Date();
    const ytdStart = new Date(now.getFullYear(), 0, 1);
    const ytdReceived = received
      .filter(r => new Date(r.date) >= ytdStart)
      .reduce((s, r) => s + r.amount, 0);

    const totalQty = holdings.reduce((s, h) => {
      const cost = getHoldings(portfolio === "Global" ? "Global" : portfolio)
        .filter(hh => hh.ticker === h.ticker)
        .reduce((ss, hh) => ss + hh.quantity * hh.costPrice, 0);
      return s + cost;
    }, 0);

    const yieldOnCost = totalQty > 0 ? (annualProjected / totalQty) * 100 : 0;

    return { annualProjected, monthly: annualProjected / 12, ytdReceived, yieldOnCost };
  }, [holdings, divSettings, received, portfolio]);

  // ── Monthly distribution chart ──
  const monthlyChart = useMemo(() => {
    const byMonth: Record<number, number> = {};
    for (let i = 0; i < 12; i++) byMonth[i] = 0;

    for (const h of holdings) {
      const s = divSettings[h.ticker];
      if (!s || s.annualDPS <= 0) continue;
      const annualIncome = s.annualDPS * h.qty;
      const freq = FREQ_FACTOR[s.frequency];
      const perPayment = annualIncome / freq;

      // distribute payments across months
      const months: number[] = [];
      if (s.frequency === "monthly") { for (let i = 0; i < 12; i++) months.push(i); }
      else if (s.frequency === "quarterly") { months.push(2, 5, 8, 11); }
      else if (s.frequency === "semi-annual") { months.push(5, 11); }
      else { months.push(11); }

      for (const m of months) byMonth[m] = (byMonth[m] ?? 0) + perPayment;
    }

    return MONTHS_SHORT.map((m, i) => ({ month: m, income: parseFloat(byMonth[i].toFixed(2)) }));
  }, [holdings, divSettings]);

  // ── Received YTD by month ──
  const receivedByMonth = useMemo(() => {
    const now = new Date();
    const byMonth: number[] = new Array(12).fill(0);
    received
      .filter(r => new Date(r.date).getFullYear() === now.getFullYear())
      .forEach(r => { byMonth[new Date(r.date).getMonth()] += r.amount; });
    return MONTHS_SHORT.map((m, i) => ({ month: m, received: parseFloat(byMonth[i].toFixed(2)) }));
  }, [received]);

  // ── Handlers ──
  function addGoal(g: Omit<Goal, "id">) {
    setGoals(prev => [...prev, { ...g, id: uid() }]);
    setShowForm(false);
  }
  function updateGoal(id: string, g: Omit<Goal, "id">) {
    setGoals(prev => prev.map(x => x.id === id ? { ...g, id } : x));
    setEditId(null);
  }
  function deleteGoal(id: string) { setGoals(prev => prev.filter(x => x.id !== id)); }

  function startEditDiv(ticker: string, currency: string) {
    const s = divSettings[ticker];
    setEditTicker(ticker);
    setEditDPS(s ? String(s.annualDPS) : "");
    setEditFreq(s?.frequency ?? "quarterly");
    setEditDivCur(s?.currency ?? currency);
  }
  function saveDiv() {
    if (!editTicker) return;
    const dps = parseFloat(editDPS);
    if (!isNaN(dps)) {
      setDivSettings(prev => ({ ...prev, [editTicker]: { annualDPS: dps, frequency: editFreq, currency: editDivCur } }));
    }
    setEditTicker(null);
  }
  function removeDiv(ticker: string) {
    setDivSettings(prev => { const next = { ...prev }; delete next[ticker]; return next; });
  }

  function addReceived() {
    const amt = parseFloat(recForm.amount);
    if (!recForm.ticker || isNaN(amt) || !recForm.date) return;
    setReceived(prev => [{ ...recForm, id: uid(), amount: amt }, ...prev]);
    setRecForm({ ticker: "", amount: "", date: "", currency: "EUR", notes: "" });
    setShowAddRec(false);
  }
  function deleteReceived(id: string) { setReceived(prev => prev.filter(r => r.id !== id)); }

  const editingGoal = goals.find(g => g.id === editId);

  return (
    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "14px", overflowY: "auto", height: "100%" }}>

      {/* ═══════════════ GOALS ═══════════════ */}
      <SectionBar title="🎯 Goal Tracker" />

      {/* Goal KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
        <KpiTile label="Total Goals"   value={String(goalKpis.total)}   sub={`${goalKpis.onTrack} on track`} />
        <KpiTile label="On Track"      value={String(goalKpis.onTrack)} color="var(--positive)" />
        <KpiTile label="At Risk / Behind" value={`${goalKpis.atRisk} / ${goalKpis.behind}`} color={goalKpis.behind > 0 ? "var(--negative)" : goalKpis.atRisk > 0 ? "var(--warning)" : "var(--text)"} />
        <KpiTile label="Total Saved" value={fmt(goalKpis.totalCurrent)} sub={`of ${fmt(goalKpis.totalTarget)} target`} />
      </div>

      {/* Add goal button / form */}
      {!showForm && !editId && (
        <button onClick={() => setShowForm(true)} style={{ ...btnPrimStyle, alignSelf: "flex-start", gap: "6px" }}>
          <Plus size={13} /> Add Goal
        </button>
      )}
      {showForm && <GoalForm onSave={addGoal} onCancel={() => setShowForm(false)} />}

      {/* Goals grid */}
      {goals.length === 0 && !showForm && (
        <div style={{ textAlign: "center", color: "var(--text-faint)", padding: "32px 16px", fontSize: "13px", border: "1px dashed var(--border)", borderRadius: "var(--r-lg)" }}>
          No goals yet — click "Add Goal" to get started.
        </div>
      )}
      {goals.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "10px" }}>
          {goals.map(g =>
            editId === g.id && editingGoal ? (
              <GoalForm key={g.id} initial={editingGoal}
                onSave={upd => updateGoal(g.id, upd)} onCancel={() => setEditId(null)} />
            ) : (
              <GoalCard key={g.id} goal={g}
                onEdit={() => setEditId(g.id)} onDelete={() => deleteGoal(g.id)} />
            )
          )}
        </div>
      )}

      {/* ═══════════════ DIVIDENDS ═══════════════ */}
      <SectionBar title="💰 Dividend Revenue Tracker" />

      {/* Dividend KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
        <KpiTile label="Annual Projected" value={fmtSmall(divKpis.annualProjected)} color="var(--positive)" />
        <KpiTile label="Monthly Avg"      value={fmtSmall(divKpis.monthly)} sub="projected" />
        <KpiTile label="YTD Received"     value={fmtSmall(divKpis.ytdReceived)} color="var(--primary)" />
        <KpiTile label="Yield on Cost"    value={divKpis.yieldOnCost.toFixed(2) + "%"} sub="portfolio avg" />
      </div>

      {/* Charts row */}
      {(divKpis.annualProjected > 0 || divKpis.ytdReceived > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          {/* Projected monthly */}
          <div className="card" style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: "10px" }}>
              Projected Monthly Income
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={monthlyChart} barSize={14} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: "var(--text-faint)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "var(--text-faint)" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "11px" }}
                  formatter={(v: number) => [fmtSmall(v), "Income"]}
                />
                <Bar dataKey="income" radius={[3,3,0,0]}>
                  {monthlyChart.map((_, i) => <Cell key={i} fill="var(--positive)" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* YTD received */}
          <div className="card" style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: "10px" }}>
              YTD Received by Month
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={receivedByMonth} barSize={14} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: "var(--text-faint)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "var(--text-faint)" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "11px" }}
                  formatter={(v: number) => [fmtSmall(v), "Received"]}
                />
                <Bar dataKey="received" radius={[3,3,0,0]}>
                  {receivedByMonth.map((_, i) => <Cell key={i} fill="var(--primary)" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Dividend settings table */}
      <div className="card" style={{ padding: "0", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Holdings — Dividend Settings</span>
          <span style={{ fontSize: "10px", color: "var(--text-faint)" }}>{holdings.length} tickers</span>
        </div>
        {holdings.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", color: "var(--text-faint)", fontSize: "12px" }}>
            No holdings found — import positions first.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Ticker","Name","Qty","Annual DPS","Frequency","Annual Income","Actions"].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map(h => {
                  const s = divSettings[h.ticker];
                  const annual = s ? s.annualDPS * h.qty : 0;
                  const isEdit = editTicker === h.ticker;
                  return (
                    <tr key={h.ticker} style={{ borderBottom: "1px solid var(--border)", background: isEdit ? "var(--primary-dim)" : "transparent" }}>
                      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--primary)" }}>{h.ticker}</td>
                      <td style={{ ...tdStyle, color: "var(--text-muted)", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</td>
                      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", textAlign: "right" }}>{h.qty.toLocaleString()}</td>
                      <td style={tdStyle}>
                        {isEdit ? (
                          <input type="number" min="0" step="0.01" value={editDPS} onChange={e => setEditDPS(e.target.value)}
                            style={{ ...inputStyle, width: "80px", padding: "3px 6px", fontSize: "12px" }} autoFocus />
                        ) : (
                          <span style={{ fontFamily: "var(--font-mono)", color: s ? "var(--positive)" : "var(--text-faint)" }}>
                            {s ? `${s.annualDPS.toFixed(2)} ${s.currency}` : "—"}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {isEdit ? (
                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <select value={editFreq} onChange={e => setEditFreq(e.target.value as DividendFrequency)}
                              style={{ ...inputStyle, padding: "3px 6px", fontSize: "12px" }}>
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                              <option value="semi-annual">Semi-annual</option>
                              <option value="annual">Annual</option>
                            </select>
                            <select value={editDivCur} onChange={e => setEditDivCur(e.target.value)}
                              style={{ ...inputStyle, padding: "3px 6px", fontSize: "12px", width: "70px" }}>
                              {["EUR","USD","GBP","CHF","CAD","JPY"].map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                            {s ? (s.frequency.charAt(0).toUpperCase() + s.frequency.slice(1)) : "—"}
                          </span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", textAlign: "right", color: annual > 0 ? "var(--positive)" : "var(--text-faint)" }}>
                        {annual > 0 ? fmtSmall(annual, s?.currency) : "—"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        {isEdit ? (
                          <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>
                            <button onClick={saveDiv} style={iconBtnStyle} title="Save"><Check size={12} /></button>
                            <button onClick={() => setEditTicker(null)} style={iconBtnStyle} title="Cancel"><X size={12} /></button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>
                            <button onClick={() => startEditDiv(h.ticker, h.currency)} style={iconBtnStyle} title="Edit">
                              <Pencil size={12} />
                            </button>
                            {s && <button onClick={() => removeDiv(h.ticker)} style={{ ...iconBtnStyle, color: "var(--negative)" }} title="Remove"><Trash2 size={12} /></button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Received dividends log */}
      <div className="card" style={{ padding: "0", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Received Dividends Log</span>
          <button onClick={() => setShowAddRec(v => !v)} style={{ ...btnPrimStyle, padding: "4px 10px", fontSize: "11px", gap: "4px" }}>
            <Plus size={11} /> Add Entry
          </button>
        </div>

        {/* Add received form */}
        {showAddRec && (
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", background: "var(--primary-dim)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: "8px", alignItems: "flex-end" }}>
              <div>
                <label style={labelStyle}>Ticker</label>
                <select className="field-input" value={recForm.ticker} onChange={e => setRecForm(f => ({ ...f, ticker: e.target.value }))} style={inputStyle}>
                  <option value="">— select —</option>
                  {holdings.map(h => <option key={h.ticker} value={h.ticker}>{h.ticker}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Amount</label>
                <input className="field-input" type="number" min="0" step="0.01" placeholder="0.00"
                  value={recForm.amount} onChange={e => setRecForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Date</label>
                <input className="field-input" type="date" value={recForm.date}
                  onChange={e => setRecForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Currency</label>
                <select className="field-input" value={recForm.currency} onChange={e => setRecForm(f => ({ ...f, currency: e.target.value }))} style={inputStyle}>
                  {["EUR","USD","GBP","CHF","CAD","JPY"].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", gap: "4px" }}>
                <button onClick={addReceived} style={btnPrimStyle}><Check size={13} /></button>
                <button onClick={() => setShowAddRec(false)} style={btnSecStyle}><X size={13} /></button>
              </div>
            </div>
            <div style={{ marginTop: "8px" }}>
              <label style={labelStyle}>Notes (optional)</label>
              <input className="field-input" placeholder="e.g. Q3 dividend, special distribution…"
                value={recForm.notes} onChange={e => setRecForm(f => ({ ...f, notes: e.target.value }))} style={{ ...inputStyle, width: "100%" }} />
            </div>
          </div>
        )}

        {received.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", color: "var(--text-faint)", fontSize: "12px" }}>
            No dividends logged yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto", maxHeight: "300px", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Date","Ticker","Amount","Currency","Notes",""].map((h, i) => (
                    <th key={i} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...received].sort((a, b) => b.date.localeCompare(a.date)).map(r => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontSize: "11px" }}>{r.date}</td>
                    <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--primary)" }}>{r.ticker}</td>
                    <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", textAlign: "right", color: "var(--positive)" }}>
                      {fmtSmall(r.amount, r.currency)}
                    </td>
                    <td style={{ ...tdStyle, color: "var(--text-muted)" }}>{r.currency}</td>
                    <td style={{ ...tdStyle, color: "var(--text-faint)", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.notes || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button onClick={() => deleteReceived(r.id)} style={{ ...iconBtnStyle, color: "var(--negative)" }} title="Delete"><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bottom padding */}
      <div style={{ height: "12px" }} />
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "10px", color: "var(--text-muted)",
  textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "4px",
};
const inputStyle: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: "var(--r-md)", padding: "6px 8px", fontSize: "12px",
  color: "var(--text)", width: "100%", outline: "none",
};
const btnPrimStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "5px",
  background: "var(--primary)", color: "#fff", border: "none",
  borderRadius: "var(--r-md)", padding: "6px 12px", fontSize: "12px",
  fontWeight: 600, cursor: "pointer",
};
const btnSecStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "5px",
  background: "var(--surface)", color: "var(--text-muted)",
  border: "1px solid var(--border)", borderRadius: "var(--r-md)",
  padding: "6px 12px", fontSize: "12px", cursor: "pointer",
};
const iconBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  color: "var(--text-muted)", padding: "3px", display: "inline-flex",
  alignItems: "center", borderRadius: "4px",
};
const thStyle: React.CSSProperties = {
  padding: "7px 12px", textAlign: "left", fontSize: "10px",
  color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em",
  fontWeight: 600, whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = {
  padding: "8px 12px", color: "var(--text)", verticalAlign: "middle",
};
const statLabelStyle: React.CSSProperties = {
  fontSize: "9px", color: "var(--text-faint)", textTransform: "uppercase",
  letterSpacing: ".05em", marginBottom: "2px",
};
const statValStyle: React.CSSProperties = {
  fontSize: "12px", fontWeight: 600, fontFamily: "var(--font-mono)",
};
