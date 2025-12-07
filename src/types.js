// src/types.ts
// ===== TRADING MODES =====
export var TradingMode;
(function (TradingMode) {
    TradingMode["AUTO_ON"] = "AUTO_ON";
    TradingMode["SIGNAL_ONLY"] = "SIGNAL_ONLY";
    TradingMode["BACKTEST"] = "BACKTEST";
    TradingMode["OFF"] = "OFF";
    TradingMode["PAPER"] = "PAPER";
})(TradingMode || (TradingMode = {}));
