import { AGENT_ORIGIN, ALLOWED_ACTIONS, RECOVERY_DNS, type AllowedAction } from "../engine/thresholds";
import type { MeasurementSet } from "../engine/types";

export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

export interface AgentActionResult {
  ok: boolean;
  action: AllowedAction;
  error: string | null;
  log: string[];
  measurement: MeasurementSet | null;
  applied: string[] | null;
  saved: string[] | null;
  flushed: boolean | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isNumArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Reject anything that is not a complete measurement document. Never fill gaps. */
export function parseMeasurementSet(input: unknown): MeasurementSet | null {
  if (!isRecord(input)) return null;
  const g = input.gateway;
  const d = input.dns;
  const p = input.packetLoss;
  const c = input.congestion;
  if (!isRecord(g) || !isRecord(d) || !isRecord(p) || !isRecord(c)) return null;
  if (input.source !== "local_agent" && input.source !== "lab" && input.source !== "browser") return null;
  if (typeof input.id !== "string" || typeof input.capturedAt !== "string" || typeof input.label !== "string") {
    return null;
  }
  if (g.check !== "gateway" || d.check !== "dns" || p.check !== "packet_loss" || c.check !== "congestion") {
    return null;
  }
  const source = input.source;
  const gatewayRaw = isNumArray(g.rawRttsMs) ? g.rawRttsMs : null;
  const answers = isStringArray(d.answers) ? d.answers : null;
  const rawUnloaded = isNumArray(c.rawUnloadedMs) ? c.rawUnloadedMs : null;
  const rawLoaded = isNumArray(c.rawLoadedMs) ? c.rawLoadedMs : null;
  const lossRaw = isNumArray(p.rawRttsMs) ? p.rawRttsMs : null;
  if (!gatewayRaw || !answers || !rawUnloaded || !rawLoaded || !lossRaw) return null;
  if (typeof g.capturedAt !== "string" || typeof d.capturedAt !== "string") return null;
  if (typeof p.capturedAt !== "string" || typeof c.capturedAt !== "string") return null;

  return {
    id: input.id,
    label: input.label,
    source,
    capturedAt: input.capturedAt,
    gateway: {
      check: "gateway",
      capturedAt: g.capturedAt,
      source,
      method: str(g.method) ?? "unspecified",
      insufficientReason: g.insufficientReason === null ? null : str(g.insufficientReason),
      gatewayIp: g.gatewayIp === null ? null : str(g.gatewayIp),
      attempts: num(g.attempts),
      successes: num(g.successes),
      rttMs: g.rttMs === null ? null : num(g.rttMs),
      rawRttsMs: gatewayRaw,
    },
    dns: {
      check: "dns",
      capturedAt: d.capturedAt,
      source,
      method: str(d.method) ?? "unspecified",
      insufficientReason: d.insufficientReason === null ? null : str(d.insufficientReason),
      freshLookup: bool(d.freshLookup),
      queryName: d.queryName === null ? null : str(d.queryName),
      resolver: d.resolver === null ? null : str(d.resolver),
      resolved: bool(d.resolved),
      timeMs: d.timeMs === null ? null : num(d.timeMs),
      answers,
      error: d.error === null ? null : str(d.error),
    },
    packetLoss: {
      check: "packet_loss",
      capturedAt: p.capturedAt,
      source,
      method: str(p.method) ?? "unspecified",
      insufficientReason: p.insufficientReason === null ? null : str(p.insufficientReason),
      target: p.target === null ? null : str(p.target),
      sent: num(p.sent),
      received: num(p.received),
      lossPct: p.lossPct === null ? null : num(p.lossPct),
      rawRttsMs: lossRaw,
    },
    congestion: {
      check: "congestion",
      capturedAt: c.capturedAt,
      source,
      method: str(c.method) ?? "unspecified",
      insufficientReason: c.insufficientReason === null ? null : str(c.insufficientReason),
      target: c.target === null ? null : str(c.target),
      unloadedAttempts: num(c.unloadedAttempts),
      loadedAttempts: num(c.loadedAttempts),
      unloadedSamples: num(c.unloadedSamples),
      loadedSamples: num(c.loadedSamples),
      unloadedTimeouts: num(c.unloadedTimeouts),
      loadedTimeouts: num(c.loadedTimeouts),
      unloadedRttMs: c.unloadedRttMs === null ? null : num(c.unloadedRttMs),
      loadedRttMs: c.loadedRttMs === null ? null : num(c.loadedRttMs),
      rawUnloadedMs: rawUnloaded,
      rawLoadedMs: rawLoaded,
    },
  };
}

export function appliedDnsIsExpected(applied: string[] | null): boolean {
  if (!applied || applied.length !== RECOVERY_DNS.length) return false;
  return RECOVERY_DNS.every((ip, i) => applied[i] === ip);
}

export async function callAgent(action: AllowedAction, timeoutMs = 8000): Promise<AgentActionResult> {
  if (!(ALLOWED_ACTIONS as readonly string[]).includes(action)) {
    throw new AgentError("Refused: action is not allowlisted.");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${AGENT_ORIGIN}/action`, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
      signal: ctrl.signal,
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AgentError(`Agent returned a non-JSON body for ${action}.`);
    }
    if (!isRecord(body) || body.action !== action || typeof body.ok !== "boolean") {
      throw new AgentError(`Agent response for ${action} did not match the protocol.`);
    }
    const measurement = body.measurement == null ? null : parseMeasurementSet(body.measurement);
    if (body.measurement != null && !measurement) {
      throw new AgentError(`Agent measurement for ${action} failed validation. It was discarded.`);
    }
    return {
      ok: body.ok,
      action,
      error: body.error == null ? null : str(body.error),
      log: isStringArray(body.log) ? body.log : [],
      measurement,
      applied: isStringArray(body.applied) ? body.applied : null,
      saved: isStringArray(body.saved) ? body.saved : null,
      flushed: bool(body.flushed),
    };
  } catch (error) {
    if (error instanceof AgentError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AgentError(`${action} timed out.`);
    }
    throw new AgentError(`${action} could not be completed. The browser did not return an agent document.`);
  } finally {
    clearTimeout(timer);
  }
}
