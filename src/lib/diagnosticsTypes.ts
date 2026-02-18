export type DiagnosticGate = {
  name: string;
  ok: boolean;
  detail?: string;
};

export type SymbolDiagnostic = {
  executionAllowed?: boolean;
  symbolState?: string;
  trendBias?: string;
  signalActive?: boolean;
  feedAgeMs?: number;
  feedAgeOk?: boolean;
  qualityScore?: number | null;
  entryBlockReasons?: string[];
  executionReason?: string;
  manageReason?: string;
  lastScanTs?: number;
  gates?: DiagnosticGate[];
};

export type ScanDiagnostics = Record<string, SymbolDiagnostic>;

