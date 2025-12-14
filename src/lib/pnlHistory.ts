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
