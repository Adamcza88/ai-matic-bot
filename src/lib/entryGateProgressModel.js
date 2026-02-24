const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const safeNumber = (value) => (Number.isFinite(value) ? value : 0);
const safeRatio = (num, den) => {
    const n = safeNumber(num);
    const d = safeNumber(den);
    if (d <= 0)
        return 0;
    return clamp((n / d) * 100, 0, 100);
};
export const buildEntryState = ({ valid, signalActive, rules = [], }) => {
    if (valid)
        return "READY";
    if (signalActive === false)
        return "WAITING";
    if (rules.some((rule) => rule.pending === true))
        return "WAITING";
    return "BLOCKED";
};
export const buildEntryGateProgress = ({ profile, passed, required, total, label, reason, signalActive, rules = [], }) => {
    const passedSafe = Math.max(0, Math.round(safeNumber(passed)));
    const requiredSafe = Math.max(0, Math.round(safeNumber(required)));
    const totalSafe = Math.max(0, Math.round(safeNumber(total)));
    const valid = requiredSafe > 0 ? passedSafe >= requiredSafe : false;
    const state = buildEntryState({ valid, signalActive, rules });
    const pct = Math.round(safeRatio(passedSafe, requiredSafe));
    return {
        profile,
        valid,
        state,
        passed: passedSafe,
        required: requiredSafe,
        total: totalSafe,
        pct,
        label,
        reason,
    };
};
export const buildRingSegmentsFromRows = (rows) => {
    const counts = {
        ALLOWED: 0,
        WAITING: 0,
        BLOCKED: 0,
        DISABLED: 0,
    };
    for (const row of rows) {
        counts[row.status] += 1;
    }
    const total = rows.length;
    const order = [
        "ALLOWED",
        "WAITING",
        "BLOCKED",
        "DISABLED",
    ];
    return order.map((status) => ({
        status,
        count: counts[status],
        pct: total > 0 ? Math.round((counts[status] / total) * 10000) / 100 : 0,
    }));
};
