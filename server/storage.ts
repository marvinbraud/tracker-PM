import { Holding, InsertHolding } from "@shared/schema";

export interface IStorage {
  // Holdings
  getHoldings(portfolio?: string): Promise<Holding[]>;
  addHolding(holding: InsertHolding): Promise<Holding>;
  updateHolding(id: number, holding: Partial<InsertHolding>): Promise<Holding | undefined>;
  deleteHolding(id: number): Promise<void>;
  replacePortfolioHoldings(portfolio: string, holdings: InsertHolding[]): Promise<Holding[]>;

  // Portfolio management (dynamic)
  getPortfolioRoots(): Promise<PortfolioRoot[]>;
  addPortfolioRoot(name: string): Promise<PortfolioRoot>;
  renamePortfolioRoot(oldName: string, newName: string): Promise<void>;
  deletePortfolioRoot(name: string): Promise<void>;

  // Settings — per-portfolio Google Sheet
  getGSheetSettings(portfolioName: string): Promise<{ url: string | null; lastSyncAt: string | null }>;
  setGSheetUrl(portfolioName: string, url: string): Promise<void>;
  setLastSyncAt(portfolioName: string, ts: string): Promise<void>;
  getAllGSheetSettings(): Promise<Record<string, { url: string | null; lastSyncAt: string | null }>>;

  clearAll(): Promise<void>;
}

/** A top-level portfolio (e.g. "Marvin") with its sub-accounts */
export interface PortfolioRoot {
  name: string;         // display name, e.g. "Marvin"
  subAccounts: string[]; // e.g. ["PEA", "CTO", "Crypto", "Retraite"]
}

const DEFAULT_SUB_ACCOUNTS = ["PEA", "CTO", "Crypto", "Retraite"];

export class MemStorage implements IStorage {
  private holdings: Map<number, Holding> = new Map();
  private nextId = 1;

  // Dynamic portfolio roots — start with one default "Marvin"
  private roots: PortfolioRoot[] = [
    { name: "Marvin", subAccounts: [...DEFAULT_SUB_ACCOUNTS] },
  ];

  // Settings — per-portfolio Google Sheet URLs
  private gsheetSettings: Map<string, { url: string; lastSyncAt: string | null }> = new Map();

  // ─── Holdings ────────────────────────────────────────────────────────────

  async getHoldings(portfolio?: string): Promise<Holding[]> {
    const all = Array.from(this.holdings.values());
    if (!portfolio || portfolio === "Global") return all;

    // If it matches a root name → return all qualified sub-account holdings
    const root = this.roots.find(r => r.name === portfolio);
    if (root) {
      const qualifiedSubs = root.subAccounts.map(s => `${root.name}::${s}`);
      return all.filter(h =>
        qualifiedSubs.includes(h.portfolio) ||
        h.portfolio === root.name
      );
    }

    // "RootName::SubAccount" notation — exact match only
    if (portfolio.includes("::")) {
      return all.filter(h => h.portfolio === portfolio);
    }

    // Otherwise match by exact portfolio name
    return all.filter(h => h.portfolio === portfolio);
  }

  async addHolding(holding: InsertHolding): Promise<Holding> {
    const id = this.nextId++;
    const h: Holding = { ...holding, id, isin: holding.isin ?? "" };
    this.holdings.set(id, h);
    return h;
  }

  async updateHolding(id: number, data: Partial<InsertHolding>): Promise<Holding | undefined> {
    const existing = this.holdings.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.holdings.set(id, updated);
    return updated;
  }

  async deleteHolding(id: number): Promise<void> {
    this.holdings.delete(id);
  }

  async replacePortfolioHoldings(portfolio: string, newHoldings: InsertHolding[]): Promise<Holding[]> {
    // Only delete holdings with exact portfolio match (qualified names only)
    for (const [id, h] of this.holdings.entries()) {
      if (h.portfolio === portfolio) this.holdings.delete(id);
    }
    return Promise.all(newHoldings.map(h => this.addHolding(h)));
  }

  // ─── Portfolio roots ──────────────────────────────────────────────────────

  async getPortfolioRoots(): Promise<PortfolioRoot[]> {
    return this.roots;
  }

  async addPortfolioRoot(name: string): Promise<PortfolioRoot> {
    const trimmed = name.trim();
    if (this.roots.find(r => r.name === trimmed)) {
      throw new Error(`Portfolio "${trimmed}" already exists`);
    }
    const root: PortfolioRoot = { name: trimmed, subAccounts: [...DEFAULT_SUB_ACCOUNTS] };
    this.roots.push(root);
    return root;
  }

  async renamePortfolioRoot(oldName: string, newName: string): Promise<void> {
    const root = this.roots.find(r => r.name === oldName);
    if (!root) throw new Error(`Portfolio "${oldName}" not found`);
    const trimmed = newName.trim();
    if (this.roots.find(r => r.name === trimmed && r.name !== oldName)) {
      throw new Error(`Portfolio "${trimmed}" already exists`);
    }
    // Rename holdings that reference this root's sub-accounts
    const oldSubs = root.subAccounts.map(s => `${oldName}::${s}`);
    const newSubs = root.subAccounts.map(s => `${trimmed}::${s}`);
    for (const [id, h] of this.holdings.entries()) {
      const idx = oldSubs.indexOf(h.portfolio);
      if (idx !== -1) {
        this.holdings.set(id, { ...h, portfolio: newSubs[idx] });
      } else if (h.portfolio === oldName) {
        this.holdings.set(id, { ...h, portfolio: trimmed });
      }
    }
    root.name = trimmed;
  }

  async deletePortfolioRoot(name: string): Promise<void> {
    const idx = this.roots.findIndex(r => r.name === name);
    if (idx === -1) throw new Error(`Portfolio "${name}" not found`);
    const root = this.roots[idx];
    // Delete all holdings belonging to this root (qualified names only)
    const subs = root.subAccounts.map(s => `${name}::${s}`);
    for (const [id, h] of this.holdings.entries()) {
      if (subs.includes(h.portfolio) || h.portfolio === name) {
        this.holdings.delete(id);
      }
    }
    this.roots.splice(idx, 1);
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  async getGSheetSettings(portfolioName: string): Promise<{ url: string | null; lastSyncAt: string | null }> {
    const s = this.gsheetSettings.get(portfolioName);
    return s ? { url: s.url, lastSyncAt: s.lastSyncAt } : { url: null, lastSyncAt: null };
  }

  async setGSheetUrl(portfolioName: string, url: string): Promise<void> {
    const existing = this.gsheetSettings.get(portfolioName);
    this.gsheetSettings.set(portfolioName, { url, lastSyncAt: existing?.lastSyncAt ?? null });
  }

  async setLastSyncAt(portfolioName: string, ts: string): Promise<void> {
    const existing = this.gsheetSettings.get(portfolioName);
    if (existing) {
      this.gsheetSettings.set(portfolioName, { ...existing, lastSyncAt: ts });
    }
  }

  async getAllGSheetSettings(): Promise<Record<string, { url: string | null; lastSyncAt: string | null }>> {
    const result: Record<string, { url: string | null; lastSyncAt: string | null }> = {};
    for (const root of this.roots) {
      const s = this.gsheetSettings.get(root.name);
      result[root.name] = s ? { url: s.url, lastSyncAt: s.lastSyncAt } : { url: null, lastSyncAt: null };
    }
    return result;
  }

  // ─── Misc ─────────────────────────────────────────────────────────────────

  async clearAll(): Promise<void> {
    this.holdings.clear();
    this.nextId = 1;
  }
}

export const storage = new MemStorage();
