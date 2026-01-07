const STORAGE_KEY = "ai-matic:pnl-history";
const MAX_RECORDS_PER_SYMBOL = 100;
function getStorage() {
    try {
        if (typeof localStorage === "undefined")
            return null;
        return localStorage;
    }
    catch {
        return null;
    }
}
export function loadPnlHistory() {
    const store = getStorage();
    if (!store)
        return {};
    try {
        const raw = store.getItem(STORAGE_KEY);
        if (!raw)
            return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return {};
        return parsed;
    }
    catch {
        return {};
    }
}
export function persistPnlHistory(map) {
    const store = getStorage();
    if (!store)
        return;
    try {
        store.setItem(STORAGE_KEY, JSON.stringify(map));
    }
    catch {
        // ignore
    }
}
export function addPnlRecord(record) {
    const current = loadPnlHistory();
    const list = current[record.symbol] || [];
    const nextList = [record, ...list].slice(0, MAX_RECORDS_PER_SYMBOL);
    const next = { ...current, [record.symbol]: nextList };
    persistPnlHistory(next);
    return next;
}
export function clearPnlHistory() {
    const empty = {};
    persistPnlHistory(empty);
    return empty;
}
export function mergePnlRecords(records) {
    const current = loadPnlHistory();
    const next = { ...current };
    const seenBySymbol = new Map();
    for (const [symbol, list] of Object.entries(current)) {
        seenBySymbol.set(symbol, new Set(list.map((r) => `${r.timestamp}:${r.pnl}`)));
    }
    for (const record of records) {
        if (!record.symbol)
            continue;
        const key = `${record.timestamp}:${record.pnl}`;
        const seen = seenBySymbol.get(record.symbol) ?? new Set();
        if (!seen.has(key)) {
            const list = next[record.symbol] ?? [];
            list.push(record);
            next[record.symbol] = list;
            seen.add(key);
            seenBySymbol.set(record.symbol, seen);
        }
    }
    for (const [symbol, list] of Object.entries(next)) {
        list.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
        if (list.length > MAX_RECORDS_PER_SYMBOL) {
            next[symbol] = list.slice(0, MAX_RECORDS_PER_SYMBOL);
        }
    }
    persistPnlHistory(next);
    return next;
}
export function resetPnlHistoryMap(symbols) {
    const now = new Date().toISOString();
    const next = {};
    const unique = Array.from(new Set(symbols.filter(Boolean)));
    for (const symbol of unique) {
        next[symbol] = [{ symbol, pnl: 0, timestamp: now, note: "RESET" }];
    }
    persistPnlHistory(next);
    return next;
}
