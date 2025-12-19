// src/types.ts

// ===== UI TYPY (Theme / Language / Settings) =====

export type Theme = "dark" | "light";

export type Language = "en" | "cs";

export interface AISettings {
  riskMode: "ai-matic" | "ai-matic-x" | "ai-matic-scalp";
  strictRiskAdherence: boolean;
  pauseOnHighVolatility: boolean;
  avoidLowLiquidity: boolean;
  useTrendFollowing: boolean;
  smcScalpMode: boolean;
  useLiquiditySweeps: boolean;
  useVolatilityExpansion: boolean;
  entryStrictness: "base" | "relaxed" | "ultra" | "test";
  enforceSessionHours: boolean;
  haltOnDailyLoss: boolean;
  haltOnDrawdown: boolean;
  useDynamicPositionSizing: boolean;
  lockProfitsWithTrail: boolean;
  maxDailyLossPercent: number;
  maxDailyProfitPercent: number;
  maxDrawdownPercent: number;
  baseRiskPerTrade: number;
  maxAllocatedCapitalPercent: number;
  maxPortfolioRiskPercent: number;
  maxOpenPositions: number;
  requireConfirmationInAuto: boolean;
  positionSizingMultiplier: number;
  customInstructions: string;
  customStrategy: string;
  min24hVolume: number;
  minProfitFactor: number;
  minWinRate: number;
  tradingStartHour: number;
  tradingEndHour: number;
  tradingDays: number[];
}

// ===== API & COMMON TYPES (MIGRATION A1) =====

export type ApiMeta = {
  ts: string;
  latencyMs?: number;
  version?: string;
};

export type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  meta?: ApiMeta;
  env?: "mainnet" | "testnet"; // Added for FIX 8 consistency
  endpoint?: string;
};

// ===== TRADING MODES =====

export enum TradingMode {
  AUTO_ON = "AUTO_ON",
  SIGNAL_ONLY = "SIGNAL_ONLY",
  BACKTEST = "BACKTEST",
  OFF = "OFF",
  PAPER = "PAPER",
}

// ===== ENGINE / SIGNÁLY =====

export type TradeIntent = {
  symbol: string;         // New: Explicit symbol
  side: "Buy" | "Sell" | "buy" | "sell"; // Compat: support both cases
  qty: number;           // New: Explicit qty
  entry?: number;
  price?: number;        // Optional explicit limit price
  triggerPrice?: number; // Optional stop trigger price
  orderType?: "Market" | "Limit" | "Stop" | "StopLimit";
  sl?: number;
  tp?: number;
  trailingStopDistance?: number; // New: optional trailing stop
  reduceOnly?: boolean;  // New
}

export type PendingSignal = {
  id: string;
  symbol: string;
  intent: TradeIntent;
   profile?: "trend" | "scalp" | "swing" | "intraday" | "coach";
   kind?: "BREAKOUT" | "PULLBACK" | "MOMENTUM" | "MEAN_REVERSION" | "OTHER";
  risk: number;
  message: string;
  createdAt: string;
};

// Aktivní (otevřená) pozice – sjednocení FE/BE
export type ActivePosition = {
  // Identity
  positionId: string;    // New strict ID
  id?: string;           // Backward compat

  // Core info
  symbol: string;
  side: "Buy" | "Sell" | "buy" | "sell";
  qty: number;           // New standard
  size?: number;         // Backward compat

  // Price & PnL
  entryPrice: number;
  avgEntryPrice?: number;
  unrealizedPnl?: number;
  pnl?: number;          // Backward compat alias
  pnlValue?: number;     // Backward compat alias
  fees?: number;

  // Protection
  sl?: number;
  tp?: number;
  trailingStop?: number;
  currentTrailingStop?: number; // Legacy?

  // Meta
  openedAt: string;
  env: "testnet" | "mainnet";

  // Legacy analysis fields (keep for UI)
  rrr?: number;
  peakPrice?: number;
  volatilityFactor?: number;
  lastUpdateReason?: string;
  timestamp?: string;
}

// Uzavřená pozice – rozšíření ActivePosition o exit
export interface ClosedPosition extends ActivePosition {
  exitPrice: number;
  closedAt: string;
}

// ===== PORTFOLIO / SYSTÉM =====

export type PortfolioState = {
  totalEquity: number;        // Was totalCapital? Unifying.
  availableBalance: number;   // New
  dailyPnl: number;
  maxDailyLoss: number;
  maxDrawdown: number;
  openPositions: number;

  // Legacy fields kept for compatibility until full migration
  totalCapital?: number;
  allocatedCapital?: number;
  maxAllocatedCapital?: number;
  maxDailyProfit?: number;
  peakCapital?: number;
  currentDrawdown?: number;
  maxOpenPositions?: number;
}

export interface SystemState {
  bybitStatus: "Connecting..." | "Connected" | "Error" | "Disconnected";
  latency: number;
  lastError: string | null;
  recentErrors: string[];
}

export interface PortfolioHistoryPoint {
  timestamp: string;
  totalCapital: number;
}

// ===== LOG / NEWS / ALERTY =====

export interface LogEntry {
  id: string;
  timestamp: string;
  action:
  | "OPEN"
  | "CLOSE"
  | "AUTO_CLOSE"
  | "SIGNAL"
  | "ERROR"
  | "RISK_HALT"
  | "RISK_BLOCK"
  | "SETTINGS"
  | "RESET"
  | "SYSTEM"
  | "MODEL_RETRAIN_START"
  | "MODEL_RETRAIN_COMPLETE"
  | "REJECT"
  | "STATUS";
  message: string;
}

export interface NewsItem {
  id: string;
  time: string;
  headline: string;
  sentiment: "neutral" | "positive" | "negative";
  source: string;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  createdAt: string;
  triggered: boolean;
}

// ===== ENTRY HISTORY / ORDERS =====

export interface EntryHistoryRecord {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  entryPrice: number;
  sl?: number;
  tp?: number;
  size: number;
  createdAt: string;
  settingsNote: string;
  settingsSnapshot: AISettings;
}

export interface TestnetOrder {
  orderId: string;
  symbol: string;
  side: "Buy" | "Sell";
  qty: number;
  price: number | null;
  status: string;
  createdTime: string;
}

export interface AssetPnlRecord {
  symbol: string;
  pnl: number;
  timestamp: string;
  note?: string;
}

export interface TestnetTrade {
  id: string;
  symbol: string;
  side: "Buy" | "Sell";
  price: number;
  qty: number;
  value: number;
  fee: number;
  time: string;
}
