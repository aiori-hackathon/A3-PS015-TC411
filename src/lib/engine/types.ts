export type CheckId = "gateway" | "dns" | "packet_loss" | "congestion";

export type MeasurementSource = "lab" | "local_agent" | "browser";

export type Band = "pass" | "degraded" | "fail" | "insufficient" | "timeout";

export type FindingId =
  | "NONE"
  | "NO_FAULT"
  | "DNS_RESOLVER_FAILURE"
  | "GATEWAY_UNREACHABLE"
  | "SIGNIFICANT_PACKET_LOSS"
  | "LOADED_LATENCY_INFLATION";

export type RecoveryAction = "FIX_DNS" | "RENEW_DHCP";

export type Verdict = "resolved" | "unresolved" | "inconclusive" | "no_fault_observed";

export interface GatewayMeasurement {
  check: "gateway";
  capturedAt: string;
  source: MeasurementSource;
  method: string;
  insufficientReason: string | null;
  gatewayIp: string | null;
  attempts: number | null;
  successes: number | null;
  /** Median RTT of successful replies, milliseconds. Null when none succeeded. */
  rttMs: number | null;
  rawRttsMs: number[];
}

export interface DnsMeasurement {
  check: "dns";
  capturedAt: string;
  source: MeasurementSource;
  method: string;
  insufficientReason: string | null;
  /** True only when the lookup bypassed the cache. Required for a conclusive DNS check. */
  freshLookup: boolean | null;
  queryName: string | null;
  resolver: string | null;
  resolved: boolean | null;
  timeMs: number | null;
  answers: string[];
  error: string | null;
}

export interface PacketLossMeasurement {
  check: "packet_loss";
  capturedAt: string;
  source: MeasurementSource;
  method: string;
  insufficientReason: string | null;
  target: string | null;
  sent: number | null;
  received: number | null;
  /** Reported by the instrument. The engine recomputes and rejects a mismatch. */
  lossPct: number | null;
  rawRttsMs: number[];
}

export interface CongestionMeasurement {
  check: "congestion";
  capturedAt: string;
  source: MeasurementSource;
  method: string;
  insufficientReason: string | null;
  target: string | null;
  unloadedAttempts: number | null;
  loadedAttempts: number | null;
  unloadedSamples: number | null;
  loadedSamples: number | null;
  unloadedTimeouts: number | null;
  loadedTimeouts: number | null;
  /** Median of completed unloaded probes. */
  unloadedRttMs: number | null;
  /** Median of completed loaded probes. */
  loadedRttMs: number | null;
  rawUnloadedMs: number[];
  rawLoadedMs: number[];
}

export interface MeasurementSet {
  id: string;
  label: string;
  source: MeasurementSource;
  capturedAt: string;
  gateway: GatewayMeasurement;
  dns: DnsMeasurement;
  packetLoss: PacketLossMeasurement;
  congestion: CongestionMeasurement;
}

export interface CheckAssessment {
  id: CheckId;
  band: Band;
  detail: string;
  /** Values the rule actually used. Null means the instrument did not supply it. */
  used: Record<string, string | number | boolean | null>;
}

export interface TraceEntry {
  id: string;
  title: string;
  detail: string;
  outcome: "fired" | "clear" | "blocked" | "skipped" | "note";
}

export interface Diagnosis {
  finding: FindingId;
  /** What diagnose() can say before any recovery. Never "resolved". */
  preliminary: Exclude<Verdict, "resolved">;
  recovery: RecoveryAction | null;
  summary: string;
  reasons: string[];
  checks: Record<CheckId, CheckAssessment>;
  trace: TraceEntry[];
}

export const FINDING_LABEL: Record<FindingId, string> = {
  NONE: "No isolated finding",
  NO_FAULT: "No fault observed",
  DNS_RESOLVER_FAILURE: "DNS resolver failure",
  GATEWAY_UNREACHABLE: "Gateway unreachable",
  SIGNIFICANT_PACKET_LOSS: "Significant packet loss",
  LOADED_LATENCY_INFLATION: "Loaded latency inflation",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  resolved: "Resolved",
  unresolved: "Unresolved",
  inconclusive: "Inconclusive",
  no_fault_observed: "No fault observed",
};

export const CHECK_LABEL: Record<CheckId, string> = {
  gateway: "Gateway reachability",
  dns: "DNS resolution",
  packet_loss: "Packet loss",
  congestion: "Congestion / loaded latency",
};
