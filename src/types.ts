// src/types.ts

// ===== UI TYPY (Theme / Language / Settings) =====

export type Theme = "dark" | "light";

export type Language = "en" | "cs";

export interface AISettings {
  strictRiskAdherence: boolean;
  pauseOnHighVolatility: boolean;
  avoidLowLiquidity: boolean;
  useTrendFollowing: boolean;
  smcScalpMode: boolean;
  useLiquiditySweeps: boolean;
  useVolatilityExpansion: boolean;
  haltOnDailyLoss: boolean;
  haltOnDrawdown: boolean;
  useDynamicPositionSizing: boolean;
  lockProfitsWithTrail: boolean;
  maxDailyLossPercent: number;
  maxDailyProfitPercent: number;
  maxDrawdownPercent: number;
  baseRiskPerTrade: number;
  maxAllocatedCapitalPercent: number;
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

// ===== TRADING MODES =====

export enum TradingMode {
  AUTO_ON = "AUTO_ON",
  SIGNAL_ONLY = "SIGNAL_ONLY",
  BACKTEST = "BACKTEST",
  OFF = "OFF",
  PAPER = "PAPER",
}

// ===== ENGINE / SIGNÁLY =====

export interface TradeIntent {
  side: "buy" | "sell";
  entry: number;
  sl: number;
  tp: number;
}

export type PendingSignal = {
  id: string;
  symbol: string;
  intent: TradeIntent;
  risk: number;
  message: string;
  createdAt: string;   // ← přidáno
};

// Aktivní (otevřená) pozice – simulovaná uvnitř appky
export interface ActivePosition {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  entryPrice: number;
  sl: number;
  tp: number;
  size: number;

  // čas otevření
  openedAt: string;

  // živý PnL
  unrealizedPnl: number; // plovoucí PnL v USD
  pnl: number; // zrcadlově = unrealizedPnl (pro konzistenci)
  pnlValue: number; // totéž, aby šlo snadno sčítat v analytice

  // risk / RRR
  rrr: number; // risk-reward ratio (|TP-Entry| / |Entry-SL|)

  // trailing stop + dynamika
  peakPrice: number; // nejlepší dosažená cena (pro trailing)
  currentTrailingStop?: number; // aktuální trailing SL
  volatilityFactor?: number;
  lastUpdateReason?: string;

  // timestamp poslední aktualizace (volitelný)
  timestamp?: string;
}

// Uzavřená pozice – rozšíření ActivePosition o exit
export interface ClosedPosition extends ActivePosition {
  exitPrice: number;
  closedAt: string;
}

// ===== PORTFOLIO / SYSTÉM =====

export interface PortfolioState {
  totalCapital: number;
  allocatedCapital: number;
  maxAllocatedCapital: number;
  dailyPnl: number;
  maxDailyLoss: number;
  maxDailyProfit: number;
  peakCapital: number;
  currentDrawdown: number;
  maxDrawdown: number;
  openPositions: number;
  maxOpenPositions: number;
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
    | "SIGNAL"
    | "ERROR"
    | "RISK_HALT"
    | "RISK_BLOCK"
    | "SETTINGS"
    | "RESET"
    | "SYSTEM"
    | "MODEL_RETRAIN_START"
    | "MODEL_RETRAIN_COMPLETE"
    | "REJECT";
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