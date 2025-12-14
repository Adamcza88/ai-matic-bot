import { EntryHistoryRecord } from "../types";

const STORAGE_KEY = "ai-matic:entry-history";
const MAX_RECORDS = 10;

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadEntryHistory(): EntryHistoryRecord[] {
  const store = getStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function persistEntryHistory(records: EntryHistoryRecord[]) {
  const store = getStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
  } catch {
    // ignore write errors
  }
}

export function addEntryToHistory(record: EntryHistoryRecord): EntryHistoryRecord[] {
  const current = loadEntryHistory();
  const next = [record, ...current].slice(0, MAX_RECORDS);
  persistEntryHistory(next);
  return next;
}

export function removeEntryFromHistory(id: string): EntryHistoryRecord[] {
  const current = loadEntryHistory();
  const next = current.filter((r) => r.id !== id);
  persistEntryHistory(next);
  return next;
}
