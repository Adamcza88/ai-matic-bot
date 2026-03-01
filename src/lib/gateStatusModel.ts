import type {
  DiagnosticGate,
  GateBlockerItem,
  GateDisplayRow,
  GateDisplayStatus,
  SymbolDiagnostic,
} from "./diagnosticsTypes";

type ResolveGateDisplayStatusArgs = {
  gate?: DiagnosticGate | null;
  enabled: boolean;
  diag?: SymbolDiagnostic | null;
};

type BuildGateDisplayRowsArgs = {
  diag?: SymbolDiagnostic | null;
  profileGateNames: string[];
  checklistEnabled: Record<string, boolean>;
  waitingDetail?: string;
  noDetail?: string;
};

type BuildGateBlockersArgs = {
  diag?: SymbolDiagnostic | null;
  rows: GateDisplayRow[];
  waitingDetail?: string;
  noDetail?: string;
};

const isWaitingContext = (diag?: SymbolDiagnostic | null) => {
  if (!diag) return true;
  if (diag.relayState === "WAITING") return true;
  if (diag.executionAllowed == null) return true;
  if (diag.signalActive === false) return true;
  return false;
};

export const resolveGateDisplayStatus = ({
  gate,
  enabled,
  diag,
}: ResolveGateDisplayStatusArgs): GateDisplayStatus => {
  if (!enabled) return "DISABLED";
  if (gate?.pending === true) return "WAITING";
  if (gate?.ok === true) return "ALLOWED";
  if (gate?.ok === false) return "BLOCKED";
  if (isWaitingContext(diag)) return "WAITING";
  return "WAITING";
};

export const buildGateDisplayRows = ({
  diag,
  profileGateNames,
  checklistEnabled,
  waitingDetail = "čeká na vyhodnocení gate",
  noDetail = "bez detailu",
}: BuildGateDisplayRowsArgs): GateDisplayRow[] => {
  const gateMap = new Map<string, DiagnosticGate>();
  const diagGates = Array.isArray(diag?.gates) ? diag.gates : [];
  for (const gate of diagGates) {
    if (!gate?.name) continue;
    gateMap.set(gate.name, gate);
  }

  return profileGateNames.map((name) => {
    const enabled = checklistEnabled[name] ?? true;
    const gate = gateMap.get(name);
    const status = resolveGateDisplayStatus({ gate, enabled, diag });
    const detail = gate?.detail?.trim() || (status === "WAITING" ? waitingDetail : noDetail);
    return {
      name,
      status,
      detail,
      enabled,
    };
  });
};

const normalizeReason = (value?: string | null) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const isWaitingReason = (reason: string) =>
  reason.toLowerCase() === "čeká na signál";

export const buildGateBlockers = ({
  diag,
  rows,
  waitingDetail = "čeká na vyhodnocení gate",
  noDetail = "bez detailu",
}: BuildGateBlockersArgs): GateBlockerItem[] => {
  if (!diag) return [];

  const blockers: GateBlockerItem[] = [];
  const seen = new Set<string>();
  const pushBlocker = (item: GateBlockerItem) => {
    const reason = normalizeReason(item.reason);
    if (!reason) return;
    const key = reason.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    blockers.push({ ...item, reason });
  };

  const systemReasons: string[] = [];
  const entryBlockReasons = Array.isArray(diag.entryBlockReasons)
    ? diag.entryBlockReasons
    : [];
  for (const reason of entryBlockReasons) {
    const text = normalizeReason(reason);
    if (text) systemReasons.push(text);
  }
  const executionReason = normalizeReason(diag.executionReason);
  if (executionReason) systemReasons.push(executionReason);
  const relayReason = normalizeReason(diag.relayReason);
  if (relayReason) systemReasons.push(relayReason);

  for (const reason of systemReasons) {
    pushBlocker({
      kind: "SYSTEM",
      title: "Systém",
      reason,
      targetStatus: isWaitingReason(reason) ? "WAITING" : "BLOCKED",
    });
  }

  for (const row of rows) {
    if (row.status !== "BLOCKED") continue;
    const reason = normalizeReason(row.detail);
    pushBlocker({
      kind: "GATE_BLOCKED",
      title: "Gate blokace",
      reason: reason && reason !== noDetail ? reason : row.name,
      targetStatus: "BLOCKED",
      gateName: row.name,
    });
  }

  for (const row of rows) {
    if (row.status !== "WAITING") continue;
    const reason = normalizeReason(row.detail);
    pushBlocker({
      kind: "WAITING",
      title: "Čeká na signál",
      reason: reason && reason !== waitingDetail ? reason : row.name,
      targetStatus: "WAITING",
      gateName: row.name,
    });
  }

  return blockers;
};
