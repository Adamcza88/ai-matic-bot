import { AssetPnlRecord } from "../types";

const STORAGE_KEY = "ai-matic:pnl-history";
const MAX_RECORDS_PER_SYMBOL = 100;

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export type AssetPnlMap = Record<string, AssetPnlRecord[]>;

export function loadPnlHistory(): AssetPnlMap {
  const store = getStorage();
  if (!store) return {};
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

export function persistPnlHistory(map: AssetPnlMap) {
  const store = getStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function addPnlRecord(record: AssetPnlRecord): AssetPnlMap {
  const current = loadPnlHistory();
  const list = current[record.symbol] || [];
  const nextList = [record, ...list].slice(0, MAX_RECORDS_PER_SYMBOL);
  const next: AssetPnlMap = { ...current, [record.symbol]: nextList };
  persistPnlHistory(next);
  return next;
}

export function clearPnlHistory(): AssetPnlMap {
  const empty: AssetPnlMap = {};
  persistPnlHistory(empty);
  return empty;
}

export function mergePnlRecords(records: AssetPnlRecord[]): AssetPnlMap {
  const current = loadPnlHistory();
  const next: AssetPnlMap = { ...current };
  const seenBySymbol = new Map<string, Set<string>>();

  for (const [symbol, list] of Object.entries(current)) {
    seenBySymbol.set(
      symbol,
      new Set(list.map((r) => `${r.timestamp}:${r.pnl}`))
    );
  }

  for (const record of records) {
    if (!record.symbol) continue;
    const key = `${record.timestamp}:${record.pnl}`;
    const seen = seenBySymbol.get(record.symbol) ?? new Set<string>();
    if (!seen.has(key)) {
      const list = next[record.symbol] ?? [];
      list.push(record);
      next[record.symbol] = list;
      seen.add(key);
      seenBySymbol.set(record.symbol, seen);
    }
  }

  for (const [symbol, list] of Object.entries(next)) {
    list.sort(
      (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
    );
    if (list.length > MAX_RECORDS_PER_SYMBOL) {
      next[symbol] = list.slice(0, MAX_RECORDS_PER_SYMBOL);
    }
  }

  persistPnlHistory(next);
  return next;
}

export function resetPnlHistoryMap(symbols: string[]): AssetPnlMap {
  const now = new Date().toISOString();
  const next: AssetPnlMap = {};
  const unique = Array.from(new Set(symbols.filter(Boolean)));
  for (const symbol of unique) {
    next[symbol] = [{ symbol, pnl: 0, timestamp: now }];
  }
  persistPnlHistory(next);
  return next;
}
