import { pgTable, text, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Holdings table — each position in the portfolio
export const holdings = pgTable("holdings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  portfolio: text("portfolio").notNull().default("Global"),
  ticker: text("ticker").notNull(),
  name: text("name").notNull(),
  assetClass: text("asset_class").notNull(), // Action, ETF, Crypto, Obligation, Cash
  sector: text("sector").notNull().default("—"),
  geography: text("geography").notNull().default("—"),
  quantity: real("quantity").notNull(),
  costPrice: real("cost_price").notNull(),
  currency: text("currency").notNull().default("USD"),
  isin: text("isin").default(""),
});

export const insertHoldingSchema = createInsertSchema(holdings).omit({ id: true }).extend({
  sector:    z.string().optional().default("—"),
  geography: z.string().optional().default("—"),
  isin:      z.string().optional().default(""),
  currency:  z.string().optional().default("EUR"),
});
export type InsertHolding = z.infer<typeof insertHoldingSchema>;
export type Holding = typeof holdings.$inferSelect;

// Portfolio root — a top-level portfolio (e.g. "Marvin") with sub-accounts
export interface PortfolioRoot {
  name: string;          // display name, e.g. "Marvin"
  subAccounts: string[]; // e.g. ["PEA", "CTO", "Crypto", "Retraite"]
}

// Price snapshots stored in memory (not persisted to DB in this demo)
export interface PriceData {
  ticker: string;
  currentPrice: number;
  currency: string;
  // Historical series: array of { date: string, close: number }
  history: { date: string; close: number }[];
  dayChange: number; // % change from previous close
}

// Computed position — holding + current market data
export interface Position {
  id: number;
  portfolio: string;
  ticker: string;
  name: string;
  assetClass: string;
  sector: string;
  geography: string;
  quantity: number;
  costPrice: number;
  currency: string;      // user-entered currency (cost price currency)
  priceCurrency: string; // native currency of the Yahoo price
  isin: string;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  pnlAmount: number;
  pnlPct: number;
  weight: number;
  dayChange: number;
  history: { date: string; close: number }[];
}

// Risk metrics for a portfolio
export interface RiskMetrics {
  totalValue: number;
  totalCostBasis: number;
  totalPnlAmount: number;
  totalPnlPct: number;
  annualizedReturn: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  beta: number;
  trackingError: number;
  informationRatio: number;
  calmarRatio: number;
  var95: number;
  expectedShortfall: number;
  ytdReturn: number;
  oneMonthReturn: number;
  oneYearReturn: number;
}

// Portfolio summary
export interface PortfolioSummary {
  portfolios: string[];
  positions: Position[];
  metrics: RiskMetrics;
  allocationByClass: { name: string; value: number; pct: number }[];
  allocationBySector: { name: string; value: number; pct: number }[];
  allocationByCurrency: { name: string; value: number; pct: number }[];
  allocationByGeo: { name: string; value: number; pct: number }[];
  topGainers: Position[];
  topLosers: Position[];
  portfolioHistory: { date: string; value: number; benchmark: number }[];
}
