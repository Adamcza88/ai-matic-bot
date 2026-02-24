export type DiagnosticGate = {
  name: string;
  ok: boolean;
  detail?: string;
  pending?: boolean;
};

export type GateDisplayStatus =
  | "ALLOWED"
  | "WAITING"
  | "BLOCKED"
  | "DISABLED";

export type GateDisplayRow = {
  name: string;
  status: GateDisplayStatus;
  detail: string;
  enabled: boolean;
};

export type EntryGateState = "READY" | "WAITING" | "BLOCKED";

export type EntryGateRule = {
  name: string;
  passed: boolean;
  pending?: boolean;
};

export type EntryGateProgress = {
  profile: string;
  valid: boolean;
  state: EntryGateState;
  passed: number;
  required: number;
  total: number;
  pct: number;
  label: string;
  reason?: string;
};

export type SymbolDiagnostic = {
  executionAllowed?: boolean;
  relayState?: "READY" | "BLOCKED" | "PAUSED" | "WAITING" | "IDLE";
  relayReason?: string;
  symbolState?: string;
  trendBias?: string;
  signalActive?: boolean;
  feedAgeMs?: number;
  feedAgeOk?: boolean;
  qualityScore?: number | null;
  entryBlockReasons?: string[];
  skipCode?: string;
  skipReason?: string;
  executionReason?: string;
  manageReason?: string;
  lastScanTs?: number;
  gates?: DiagnosticGate[];
  entryGateProgress?: EntryGateProgress;
  entryGateRules?: EntryGateRule[];
  decisionTrace?: Array<{
    gate: string;
    result: {
      ok: boolean;
      code: string;
      reason: string;
      ttlMs?: number;
    };
  }>;
};

export type ScanDiagnostics = Record<string, SymbolDiagnostic>;
