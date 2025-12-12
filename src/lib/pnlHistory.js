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
