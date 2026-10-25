import { AGENT_ORIGIN } from "../engine/thresholds";

export type AgentStateName =
  | "unchecked"
  | "checking"
  | "not_installed"
  | "starting"
  | "connected"
  | "unavailable"
  | "permission_blocked";

export interface AgentSnapshot {
  state: AgentStateName;
  detail: string;
  checkedAt: string | null;
  health: unknown;
}

export const AGENT_STATE_LABEL: Record<AgentStateName, string> = {
  unchecked: "Not checked",
  checking: "Checking",
  not_installed: "Not installed",
  starting: "Starting",
  connected: "Connected",
  unavailable: "Unavailable",
  permission_blocked: "Browser permission blocked",
};

const ALLOW = [
  "VERIFY_DNS",
  "FIX_DNS",
  "RESTORE_DNS",
  "VERIFY_GATEWAY",
  "RENEW_DHCP",
  "RECONNECT_NETWORK",
  "VERIFY_PACKET_LOSS",
  "RETEST",
] as const;

function isHealth(body: unknown): body is {
  ok: boolean;
  ready: boolean;
  name: string;
  bind: string;
  actions: string[];
} {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    b.ok === true &&
    typeof b.ready === "boolean" &&
    b.name === "probespeak-agent" &&
    typeof b.bind === "string" &&
    Array.isArray(b.actions) &&
    b.actions.every((a) => typeof a === "string")
  );
}

function pageIsLocal(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export async function probeAgent(timeoutMs = 2500): Promise<AgentSnapshot> {
  const checkedAt = new Date().toISOString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${AGENT_ORIGIN}/health`, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return {
        state: "unavailable",
        detail: `The address answered HTTP ${res.status}. It is not a healthy ProbeSpeak agent.`,
        checkedAt,
        health: null,
      };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return {
        state: "unavailable",
        detail: "The address answered, but the body is not JSON.",
        checkedAt,
        health: null,
      };
    }
    if (!isHealth(body)) {
      return {
        state: "unavailable",
        detail: "JSON arrived, but it is not a ProbeSpeak health document. Not marked Connected.",
        checkedAt,
        health: body,
      };
    }
    const bind = body.bind;
    if (bind !== "127.0.0.1:8765" && bind !== "127.0.0.1") {
      return {
        state: "unavailable",
        detail: `Agent reports bind ${bind}. This console only accepts loopback.`,
        checkedAt,
        health: body,
      };
    }
    const missing = ALLOW.filter((a) => !body.actions.includes(a));
    if (missing.length > 0) {
      return {
        state: "unavailable",
        detail: `Health document is missing allowlisted actions: ${missing.join(", ")}.`,
        checkedAt,
        health: body,
      };
    }
    if (!body.ready) {
      return {
        state: "starting",
        detail: "Agent is bound to loopback and reports ready: false.",
        checkedAt,
        health: body,
      };
    }
    return {
      state: "connected",
      detail: "Health document matched. Loopback only. No settings were changed.",
      checkedAt,
      health: body,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError") {
      return {
        state: "unavailable",
        detail: "No health document within 2.5 seconds.",
        checkedAt,
        health: null,
      };
    }
    if (pageIsLocal()) {
      return {
        state: "not_installed",
        detail:
          "This page is already on localhost and nothing accepted the health request. The usual cause is that no agent is listening on 127.0.0.1:8765.",
        checkedAt,
        health: null,
      };
    }
    return {
      state: "permission_blocked",
      detail:
        "This page is not a local origin. Browsers hide loopback from public sites unless the agent sends CORS and Private Network Access headers. A missing agent looks the same from here, so this is not labeled Not installed and it is not Connected.",
      checkedAt,
      health: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
