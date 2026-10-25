import type { MeasurementSet } from "./engine/types";

const BLANK = "A web page cannot measure this. No number was invented.";

export function browserBlindSet(now = new Date().toISOString()): MeasurementSet {
  return {
    id: `browser-${now}`,
    label: "Browser instrument limits",
    source: "browser",
    capturedAt: now,
    gateway: {
      check: "gateway",
      capturedAt: now,
      source: "browser",
      method: "unavailable",
      insufficientReason: `${BLANK} The page cannot read the default gateway or send ICMP.`,
      gatewayIp: null,
      attempts: null,
      successes: null,
      rttMs: null,
      rawRttsMs: [],
    },
    dns: {
      check: "dns",
      capturedAt: now,
      source: "browser",
      method: "unavailable",
      insufficientReason: `${BLANK} The page cannot time a cache-bypassing resolver lookup.`,
      freshLookup: null,
      queryName: null,
      resolver: null,
      resolved: null,
      timeMs: null,
      answers: [],
      error: null,
    },
    packetLoss: {
      check: "packet_loss",
      capturedAt: now,
      source: "browser",
      method: "unavailable",
      insufficientReason: `${BLANK} The page cannot send a counted ICMP series.`,
      target: null,
      sent: null,
      received: null,
      lossPct: null,
      rawRttsMs: [],
    },
    congestion: {
      check: "congestion",
      capturedAt: now,
      source: "browser",
      method: "unavailable",
      insufficientReason: `${BLANK} The page cannot pair idle and loaded RTTs without a local agent.`,
      target: null,
      unloadedAttempts: null,
      loadedAttempts: null,
      unloadedSamples: null,
      loadedSamples: null,
      unloadedTimeouts: null,
      loadedTimeouts: null,
      unloadedRttMs: null,
      loadedRttMs: null,
      rawUnloadedMs: [],
      rawLoadedMs: [],
    },
  };
}

export interface BrowserHints {
  onLine: boolean;
  effectiveType: string | null;
  rttMs: number | null;
  downlinkMbps: number | null;
}

export function readBrowserHints(): BrowserHints | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; rtt?: number; downlink?: number };
  };
  const c = nav.connection;
  return {
    onLine: navigator.onLine,
    effectiveType: c?.effectiveType ?? null,
    rttMs: typeof c?.rtt === "number" ? c.rtt : null,
    downlinkMbps: typeof c?.downlink === "number" ? c.downlink : null,
  };
}
