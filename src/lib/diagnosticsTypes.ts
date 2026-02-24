export type DiagnosticGate = {
  name: string;
  ok: boolean;
  detail?: string;
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
