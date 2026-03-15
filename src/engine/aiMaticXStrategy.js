import {
    State,
    Trend,
    resampleCandles,
} from "./botEngine.js";
import { computeATR, computeEma } from "./ta.js";
const ACTIVE_MODE = "SCALPING";
const MODE_CONFIG = {
    SCALPING: {
        htfMinutes: 60,
        ltfMinutes: 5,
        toleranceAtrMult: 0.25,
        ttlBars: 7,
        m2WindowBars: 20,
        volumeSmaMult: 1.2,
        emaFilter: true,
    },
    INTRADAY: {
        htfMinutes: 240,
        ltfMinutes: 15,
        toleranceAtrMult: 0.2,
        ttlBars: 12,
        m2WindowBars: 40,
        volumeSmaMult: 1.1,
        emaFilter: true,
    },
};
export function resolveAiMaticXTimeframes() {
    const cfg = MODE_CONFIG[ACTIVE_MODE];
    return {
        ltfMinutes: cfg.ltfMinutes,
        htfMinutes: cfg.htfMinutes,
    };
}
const EMA_FAST_PERIOD = 50;
const EMA_SLOW_PERIOD = 200;
const ATR_PERIOD = 14;
const VOL_SMA_PERIOD = 20;
const REJECTION_WICK_BODY_MIN = 0.5;
const SL_ATR_MULT = 1.0;
const TP1_RR = 1.0;
const TP2_RR = 2.0;
const TRAIL_ATR_MULT = 0.5;
function mean(values) {
    const clean = values.filter((v) => Number.isFinite(v));
    if (!clean.length)
        return Number.NaN;
    return clean.reduce((sum, v) => sum + v, 0) / clean.length;
}
function toTrendLabel(value) {
    return value === "BULL" ? Trend.Bull : value === "BEAR" ? Trend.Bear : Trend.Range;
}
function resolveEmaBias(candles) {
    const closes = candles.map((c) => c.close);
    const emaFast = computeEma(closes, EMA_FAST_PERIOD).slice(-1)[0] ?? Number.NaN;
    const emaSlow = computeEma(closes, EMA_SLOW_PERIOD).slice(-1)[0] ?? Number.NaN;
    const lastClose = closes[closes.length - 1] ?? Number.NaN;
    if (Number.isFinite(lastClose) &&
        Number.isFinite(emaFast) &&
        Number.isFinite(emaSlow) &&
        lastClose > emaFast &&
        emaFast > emaSlow) {
        return { bias: "BULL", emaFast, emaSlow };
    }
    if (Number.isFinite(lastClose) &&
        Number.isFinite(emaFast) &&
        Number.isFinite(emaSlow) &&
        lastClose < emaFast &&
        emaFast < emaSlow) {
        return { bias: "BEAR", emaFast, emaSlow };
    }
    return { bias: "RANGE", emaFast, emaSlow };
}
function resolveHtfImpulse(candles, bias) {
    if (bias !== "BULL" && bias !== "BEAR")
        return null;
    const lookback = Math.min(20, candles.length);
    if (lookback < 2)
        return null;
    const slice = candles.slice(-lookback);
    const high = Math.max(...slice.map((c) => c.high));
    const low = Math.min(...slice.map((c) => c.low));
    if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low)
        return null;
    const mid = (high + low) / 2;
    return { high, low, mid };
}
function isM1Touch(c, m1, tolerance) {
    if (!Number.isFinite(m1) || !Number.isFinite(tolerance) || tolerance <= 0)
        return false;
    return c.low <= m1 + tolerance && c.high >= m1 - tolerance;
}
function resolveTouchBarsAgo(ltf, m1, tolerance, ttlBars) {
    const start = Math.max(0, ltf.length - ttlBars);
    for (let i = ltf.length - 1; i >= start; i -= 1) {
        if (isM1Touch(ltf[i], m1, tolerance)) {
            return ltf.length - 1 - i;
        }
    }
    return null;
}
function resolveM2Rejection(ltf, bias, windowBars) {
    const slice = ltf.slice(-windowBars);
    if (slice.length < 2 || (bias !== "BULL" && bias !== "BEAR")) {
        return { ok: false, mid: Number.NaN };
    }
    const high = Math.max(...slice.map((c) => c.high));
    const low = Math.min(...slice.map((c) => c.low));
    if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) {
        return { ok: false, mid: Number.NaN };
    }
    const mid = (high + low) / 2;
    const last = ltf[ltf.length - 1];
    const body = Math.max(Math.abs(last.close - last.open), 1e-8);
    const upperWick = last.high - Math.max(last.open, last.close);
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const bullOk = last.low <= mid &&
        last.close > mid &&
        lowerWick >= body * REJECTION_WICK_BODY_MIN;
    const bearOk = last.high >= mid &&
        last.close < mid &&
        upperWick >= body * REJECTION_WICK_BODY_MIN;
    return { ok: bias === "BULL" ? bullOk : bearOk, mid };
}
function resolveStopPrice(ltf, entry, bias, atr) {
    const micro = ltf.slice(-6);
    if (!micro.length || !Number.isFinite(entry) || entry <= 0)
        return Number.NaN;
    const atrOffset = Number.isFinite(atr) && atr > 0 ? atr * SL_ATR_MULT : Number.NaN;
    if (bias === "BULL") {
        const microLow = Math.min(...micro.map((c) => c.low));
        const atrStop = Number.isFinite(atrOffset) ? entry - atrOffset : Number.NaN;
        if (Number.isFinite(microLow) && Number.isFinite(atrStop))
            return Math.min(microLow, atrStop);
        return Number.isFinite(microLow) ? microLow : atrStop;
    }
    if (bias === "BEAR") {
        const microHigh = Math.max(...micro.map((c) => c.high));
        const atrStop = Number.isFinite(atrOffset) ? entry + atrOffset : Number.NaN;
        if (Number.isFinite(microHigh) && Number.isFinite(atrStop))
            return Math.max(microHigh, atrStop);
        return Number.isFinite(microHigh) ? microHigh : atrStop;
    }
    return Number.NaN;
}
function resolveLtfTrend(ltf) {
    const bias = resolveEmaBias(ltf).bias;
    return bias;
}
export function evaluateAiMaticXStrategyForSymbol(symbol, candles) {
    const cfg = MODE_CONFIG[ACTIVE_MODE];
    const ltf = resampleCandles(candles, cfg.ltfMinutes);
    const htf = resampleCandles(candles, cfg.htfMinutes);
    if (ltf.length < Math.max(VOL_SMA_PERIOD, cfg.m2WindowBars) + 2 || htf.length < 30) {
        return {
            state: State.Scan,
            trend: Trend.Range,
            trendH1: Trend.Range,
            trendScore: 0,
            trendAdx: Number.NaN,
            halted: true,
            xContext: {
                htfTrend: "RANGE",
                ltfTrend: "RANGE",
                mode: "CHAOS",
                setup: "NO_TRADE",
                strongTrendExpanse: false,
                riskOff: true,
                acceptanceCloses: 0,
                details: ["insufficient_data"],
            },
        };
    }
    const htfBias = resolveEmaBias(htf);
    const bias = htfBias.bias;
    const ltfTrend = resolveLtfTrend(ltf);
    const impulse = resolveHtfImpulse(htf, bias);
    const highs = ltf.map((c) => c.high);
    const lows = ltf.map((c) => c.low);
    const closes = ltf.map((c) => c.close);
    const atr = computeATR(highs, lows, closes, ATR_PERIOD).slice(-1)[0] ?? Number.NaN;
    const tolerance = Number.isFinite(atr) && atr > 0 ? atr * cfg.toleranceAtrMult : Number.NaN;
    const m1 = impulse?.mid ?? Number.NaN;
    const touchBarsAgo = Number.isFinite(m1) && Number.isFinite(tolerance)
        ? resolveTouchBarsAgo(ltf, m1, tolerance, cfg.ttlBars)
        : null;
    const touchOk = touchBarsAgo != null && touchBarsAgo <= cfg.ttlBars - 1;
    const m2 = resolveM2Rejection(ltf, bias, cfg.m2WindowBars);
    const volumeSma20 = mean(ltf.slice(-VOL_SMA_PERIOD).map((c) => Number(c.volume)));
    const volumeCurrent = Number(ltf[ltf.length - 1].volume);
    const volumeOk = Number.isFinite(volumeCurrent) &&
        Number.isFinite(volumeSma20) &&
        volumeSma20 > 0 &&
        volumeCurrent >= volumeSma20 * cfg.volumeSmaMult;
    const emaFilterOk = !cfg.emaFilter || (bias !== "RANGE" && Number.isFinite(htfBias.emaFast));
    const htfLast = htf[htf.length - 1];
    const htfCloseInvalid = Number.isFinite(m1) && bias === "BULL"
        ? htfLast.close < m1
        : Number.isFinite(m1) && bias === "BEAR"
            ? htfLast.close > m1
            : false;
    const mandatoryA = touchOk;
    const mandatoryB = m2.ok;
    const mandatoryC = volumeOk;
    const mustPassAll = mandatoryA && mandatoryB && mandatoryC;
    let signal = null;
    let setup = "NO_TRADE";
    let trailOffsetPct = Number.NaN;
    const riskOff = !emaFilterOk || htfCloseInvalid || !impulse || bias === "RANGE";
    if (!riskOff && mustPassAll) {
        const last = ltf[ltf.length - 1];
        const entry = last.close;
        const stop = resolveStopPrice(ltf, entry, bias, atr);
        const r = Number.isFinite(stop) ? Math.abs(entry - stop) : Number.NaN;
        const direction = bias === "BULL" ? 1 : -1;
        const tp = Number.isFinite(r) && r > 0 ? entry + direction * TP2_RR * r : Number.NaN;
        const tp1 = Number.isFinite(r) && r > 0 ? entry + direction * TP1_RR * r : Number.NaN;
        trailOffsetPct =
            Number.isFinite(atr) && Number.isFinite(entry) && entry > 0
                ? (TRAIL_ATR_MULT * atr) / entry
                : Number.NaN;
        if (Number.isFinite(stop) && Number.isFinite(tp) && stop > 0 && tp > 0 && stop !== entry) {
            signal = {
                id: `${symbol}-${Date.now()}`,
                symbol,
                intent: {
                    side: bias === "BULL" ? "buy" : "sell",
                    entry,
                    sl: stop,
                    tp,
                },
                kind: "PULLBACK",
                entryType: "LIMIT",
                risk: 0.6,
                message: `X ${ACTIVE_MODE} M1+M2+VOL | TP1 ${Number.isFinite(tp1) ? tp1.toFixed(6) : "na"} | TP2 2R | trail 0.5 ATR`,
                createdAt: new Date().toISOString(),
            };
            setup = "TREND_PULLBACK";
        }
    }
    const details = [
        `mode ${ACTIVE_MODE}`,
        `HTF ${cfg.htfMinutes}m LTF ${cfg.ltfMinutes}m`,
        `A M1 touch ${mandatoryA ? "ok" : "no"}`,
        `B M2 rejection ${mandatoryB ? "ok" : "no"}`,
        `C volume ${mandatoryC ? "ok" : "no"} (${Number.isFinite(volumeCurrent) ? volumeCurrent.toFixed(0) : "na"} / ${Number.isFinite(volumeSma20) ? volumeSma20.toFixed(0) : "na"})`,
        `TTL ${cfg.ttlBars} bars ${touchBarsAgo == null ? "miss" : `${touchBarsAgo} ago`}`,
        `M1 ${Number.isFinite(m1) ? m1.toFixed(6) : "na"} tol ${Number.isFinite(tolerance) ? tolerance.toFixed(6) : "na"}`,
        `HTF close invalid ${htfCloseInvalid ? "yes" : "no"}`,
        `EMA filter ${emaFilterOk ? "ok" : "no"}`,
        "BTC context via portfolio gate",
    ];
    const trend = toTrendLabel(bias);
    const context = {
        htfTrend: bias,
        ltfTrend,
        mode: bias === "RANGE" ? "RANGE" : "TREND",
        setup,
        strongTrendExpanse: mandatoryB && mandatoryC,
        riskOff,
        acceptanceCloses: 0,
        details,
    };
    return {
        state: State.Scan,
        trend,
        trendH1: trend,
        trendScore: 0,
        trendAdx: Number.NaN,
        signal,
        halted: false,
        xContext: context,
        trailOffsetPct,
    };
}
