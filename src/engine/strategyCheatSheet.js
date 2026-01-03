export const STRATEGY_CHEAT_SHEET = [
    {
        id: "ai-matic-core",
        name: "AI-MATIC Core Entry",
        description: "Baseline AI-MATIC entry based on HTF bias, LTF confirmation, and EMA pullback.",
        entryType: "LIMIT_MAKER_FIRST",
        side: "both",
        priority: 1,
        rules: [
            "HTF 15m bias aligned",
            "LTF 1m close confirms bias",
            "EMA20 pullback with RVOL >= 1.2",
            "PostOnly limit entry with short timeout",
        ],
    },
    {
        id: "ai-matic-x-smc",
        name: "AI-MATIC-X SMC Hierarchy",
        description: "HTF 4h/1h bias + POI with LTF 15m/1m CHOCH/MSS and displacement pullback entries.",
        entryType: "LIMIT_MAKER_FIRST",
        side: "both",
        priority: 2,
        rules: [
            "HTF 4h/1h structure defines bias (HH/HL vs LH/LL)",
            "HTF key swings + POI zones: OB, FVG, Breaker, Liquidity pools",
            "LTF 15m/1m displacement toward HTF bias",
            "LTF CHOCH confirms shift; MSS break + mitigation",
            "LTF OB/FVG aligns with HTF POI before entry",
            "Entry on pullback into HTF POI after inducement sweep",
            "Ignore LTF-only patterns without HTF context",
        ],
    },
    {
        id: "ai-matic-scalp-scalpera",
        name: "AI-MATIC-SCALP Scalpera v2",
        description: "Scalpera Bot AI Matic Edition v2.0 for mid-frequency intraday scalps (10-15 trades/day).",
        entryType: "LIMIT_MAKER_FIRST",
        side: "both",
        priority: 3,
        rules: [
            "TrendScore fusion: EMA alignment * 0.4 + OI gradient * 0.3 + AI cone slope * 0.3",
            "Bias: TrendScore > 0.65 => LONG, < 0.35 => SHORT, else WAIT",
            "Volatility filter: ATR14/ATR50 < 0.5 => WAIT; > 1.5 => enter only on BOS",
            "Micro-confirmation: 3/4 must pass (EMA8>21>50, FVG/OB + vol>SMA20*1.2, AI cone > 0.6, funding aligned)",
            "Session windows: 08:00-12:00 UTC and 13:00-17:00 UTC, else session_filter=false",
            "Cone-FVG overlay: if 60% MC paths end inside FVG => return bias; >70% outside => breakout bias",
            "SentimentScore = funding*0.4 + oi_delta*0.4 + social*0.2 (LONG > 0.55, SHORT < 0.45)",
            "Auto-learning: log EMA/FVG/OI/funding context and adjust weights every ~100 trades",
        ],
    },
];
export function getCheatSheetSetup(id) {
    return STRATEGY_CHEAT_SHEET.find((setup) => setup.id === id) ?? null;
}
export function getDefaultCheatSheetSetupId() {
    return STRATEGY_CHEAT_SHEET[0]?.id ?? null;
}
