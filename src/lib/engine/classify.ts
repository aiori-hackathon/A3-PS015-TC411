import { lossPercent, median } from "./stats.ts";
import { THRESHOLDS } from "./thresholds.ts";
import type {
  CheckAssessment,
  CongestionMeasurement,
  DnsMeasurement,
  GatewayMeasurement,
  MeasurementSet,
  PacketLossMeasurement,
} from "./types.ts";

const T = THRESHOLDS;

function close(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

export function classifyGateway(m: GatewayMeasurement): CheckAssessment {
  const used = {
    gatewayIp: m.gatewayIp,
    attempts: m.attempts,
    successes: m.successes,
    rttMs: m.rttMs,
    rawCount: m.rawRttsMs.length,
  };
  const base = { id: "gateway" as const, used };

  if (m.insufficientReason) {
    return { ...base, band: "insufficient", detail: m.insufficientReason };
  }
  if (m.attempts == null || m.successes == null) {
    return { ...base, band: "insufficient", detail: "Attempts or successes were not reported." };
  }
  if (m.attempts < T.gateway.minAttempts) {
    return {
      ...base,
      band: "insufficient",
      detail: `Only ${m.attempts} attempts. At least ${T.gateway.minAttempts} are required.`,
    };
  }
  if (m.successes > m.attempts) {
    return { ...base, band: "insufficient", detail: "Successes exceed attempts." };
  }
  if (m.successes === 0) {
    if (m.rttMs != null || m.rawRttsMs.length > 0) {
      return {
        ...base,
        band: "insufficient",
        detail: "Zero replies were reported together with RTT samples.",
      };
    }
    return {
      ...base,
      band: "fail",
      detail: `0 of ${m.attempts} replies from ${m.gatewayIp ?? "an unknown gateway"}. No RTT.`,
    };
  }
  if (m.rttMs == null) {
    return { ...base, band: "insufficient", detail: "Replies were counted but median RTT is missing." };
  }
  if (m.rawRttsMs.length > 0 && m.rawRttsMs.length !== m.successes) {
    return {
      ...base,
      band: "insufficient",
      detail: "Raw RTT count does not match the success count.",
    };
  }
  if (m.rawRttsMs.length === m.successes) {
    const med = median(m.rawRttsMs);
    if (med == null || !close(med, m.rttMs, 0.15)) {
      return {
        ...base,
        band: "insufficient",
        detail: "Reported median RTT does not match the raw samples.",
      };
    }
  }
  const ratio = m.successes / m.attempts;
  if (ratio < T.gateway.failSuccessRatioBelow || m.rttMs > T.gateway.failRttAboveMs) {
    return {
      ...base,
      band: "fail",
      detail: `${m.successes} of ${m.attempts} replies, median ${m.rttMs} ms. Past the fail line (success ratio below ${T.gateway.failSuccessRatioBelow} or RTT above ${T.gateway.failRttAboveMs} ms).`,
    };
  }
  if (m.rttMs > T.gateway.degradedRttAboveMs || ratio < 1) {
    return {
      ...base,
      band: "degraded",
      detail: `${m.successes} of ${m.attempts} replies, median ${m.rttMs} ms. Above the pass line, below the fail line.`,
    };
  }
  return {
    ...base,
    band: "pass",
    detail: `${m.successes} of ${m.attempts} replies, median ${m.rttMs} ms, gateway ${m.gatewayIp ?? "unspecified"}.`,
  };
}

export function classifyDns(m: DnsMeasurement): CheckAssessment {
  const used = {
    freshLookup: m.freshLookup,
    queryName: m.queryName,
    resolver: m.resolver,
    resolved: m.resolved,
    timeMs: m.timeMs,
    error: m.error,
    answers: m.answers.join(", ") || null,
  };
  const base = { id: "dns" as const, used };

  if (m.insufficientReason) {
    return { ...base, band: "insufficient", detail: m.insufficientReason };
  }
  if (m.freshLookup !== true) {
    return {
      ...base,
      band: "insufficient",
      detail: "Lookup was not marked cache-bypassing, so it cannot support a DNS decision.",
    };
  }
  if (m.resolved == null || m.queryName == null) {
    return { ...base, band: "insufficient", detail: "Resolver result or query name is missing." };
  }
  if (m.queryName !== T.dns.expectedQuery) {
    return {
      ...base,
      band: "insufficient",
      detail: `Query was ${m.queryName}. This engine only accepts a fresh lookup of ${T.dns.expectedQuery}.`,
    };
  }
  if (m.timeMs == null) {
    return { ...base, band: "insufficient", detail: "Lookup time was not reported." };
  }
  if (m.resolved) {
    if (m.answers.length === 0) {
      return { ...base, band: "insufficient", detail: "Lookup was marked resolved with no answers." };
    }
    if (m.timeMs > T.dns.failTimeAboveMs) {
      return {
        ...base,
        band: "fail",
        detail: `Resolved in ${m.timeMs} ms, above ${T.dns.failTimeAboveMs} ms.`,
      };
    }
    if (m.timeMs > T.dns.degradedTimeAboveMs) {
      return {
        ...base,
        band: "degraded",
        detail: `Resolved in ${m.timeMs} ms. Above ${T.dns.degradedTimeAboveMs} ms, not above ${T.dns.failTimeAboveMs} ms.`,
      };
    }
    return {
      ...base,
      band: "pass",
      detail: `Fresh lookup of ${m.queryName} via ${m.resolver ?? "unspecified resolver"} in ${m.timeMs} ms → ${m.answers.join(", ")}.`,
    };
  }
  return {
    ...base,
    band: "fail",
    detail: `Fresh lookup of ${m.queryName} via ${m.resolver ?? "unspecified resolver"} did not resolve (${m.error ?? "no error string"}) after ${m.timeMs} ms.`,
  };
}

export function classifyLoss(m: PacketLossMeasurement): CheckAssessment {
  const computed =
    m.sent != null && m.received != null && m.sent > 0 ? lossPercent(m.sent, m.received) : null;
  const used = {
    target: m.target,
    sent: m.sent,
    received: m.received,
    reportedLossPct: m.lossPct,
    computedLossPct: computed == null ? null : Math.round(computed * 100) / 100,
    method: m.method,
  };
  const base = { id: "packet_loss" as const, used };

  if (m.insufficientReason) {
    return { ...base, band: "insufficient", detail: m.insufficientReason };
  }
  if (m.sent == null || m.received == null || m.target == null) {
    return { ...base, band: "insufficient", detail: "Sent, received, or target was not reported." };
  }
  if (m.received > m.sent || m.sent <= 0) {
    return { ...base, band: "insufficient", detail: "Sent/received counts are impossible." };
  }
  if (m.sent < T.packetLoss.minSent) {
    return {
      ...base,
      band: "insufficient",
      detail: `Only ${m.sent} probes. At least ${T.packetLoss.minSent} are required.`,
    };
  }
  const loss = lossPercent(m.sent, m.received);
  if (m.lossPct != null && !close(m.lossPct, loss, 0.05)) {
    return {
      ...base,
      band: "insufficient",
      detail: `Reported loss ${m.lossPct}% does not match ${(Math.round(loss * 100) / 100).toFixed(2)}% from ${m.received}/${m.sent}.`,
    };
  }
  const shown = (Math.round(loss * 10) / 10).toFixed(1);
  if (loss > T.packetLoss.failAbovePct) {
    return {
      ...base,
      band: "fail",
      detail: `${shown}% loss to ${m.target} (${m.received} of ${m.sent} received). Fail line is above ${T.packetLoss.failAbovePct}%.`,
    };
  }
  if (loss > T.packetLoss.degradedAbovePct) {
    return {
      ...base,
      band: "degraded",
      detail: `${shown}% loss to ${m.target} (${m.received} of ${m.sent}). Above ${T.packetLoss.degradedAbovePct}%, not above ${T.packetLoss.failAbovePct}%.`,
    };
  }
  return {
    ...base,
    band: "pass",
    detail: `${shown}% loss to ${m.target} (${m.received} of ${m.sent} received).`,
  };
}

export function classifyCongestion(m: CongestionMeasurement): CheckAssessment {
  const used = {
    target: m.target,
    unloadedAttempts: m.unloadedAttempts,
    loadedAttempts: m.loadedAttempts,
    unloadedSamples: m.unloadedSamples,
    loadedSamples: m.loadedSamples,
    unloadedTimeouts: m.unloadedTimeouts,
    loadedTimeouts: m.loadedTimeouts,
    unloadedRttMs: m.unloadedRttMs,
    loadedRttMs: m.loadedRttMs,
  };
  const base = { id: "congestion" as const, used };

  if (m.insufficientReason) {
    return { ...base, band: "insufficient", detail: m.insufficientReason };
  }
  const fields = [
    m.unloadedAttempts,
    m.loadedAttempts,
    m.unloadedSamples,
    m.loadedSamples,
    m.unloadedTimeouts,
    m.loadedTimeouts,
  ];
  if (fields.some((v) => v == null) || m.target == null) {
    return { ...base, band: "insufficient", detail: "Loaded-latency counters are incomplete." };
  }
  const ua = m.unloadedAttempts!;
  const la = m.loadedAttempts!;
  const us = m.unloadedSamples!;
  const ls = m.loadedSamples!;
  const ut = m.unloadedTimeouts!;
  const lt = m.loadedTimeouts!;
  if (ua < T.congestion.minAttemptsEach || la < T.congestion.minAttemptsEach) {
    return {
      ...base,
      band: "insufficient",
      detail: `Need at least ${T.congestion.minAttemptsEach} attempts on each side. Got ${ua} unloaded and ${la} loaded.`,
    };
  }
  if (us + ut !== ua || ls + lt !== la || us < 0 || ls < 0) {
    return {
      ...base,
      band: "insufficient",
      detail: "Samples plus timeouts do not add up to attempts.",
    };
  }
  if (m.rawUnloadedMs.length > 0 && m.rawUnloadedMs.length !== us) {
    return { ...base, band: "insufficient", detail: "Raw unloaded samples do not match the sample count." };
  }
  if (m.rawLoadedMs.length > 0 && m.rawLoadedMs.length !== ls) {
    return { ...base, band: "insufficient", detail: "Raw loaded samples do not match the sample count." };
  }
  if (us === 0 && ls === 0) {
    return {
      ...base,
      band: "timeout",
      detail: `All ${ua} unloaded and ${la} loaded probes to ${m.target} timed out. No RTT was invented.`,
    };
  }
  if (m.rawUnloadedMs.length === us && us > 0) {
    const med = median(m.rawUnloadedMs);
    if (m.unloadedRttMs == null || med == null || !close(med, m.unloadedRttMs, 0.15)) {
      return { ...base, band: "insufficient", detail: "Reported unloaded median does not match raw samples." };
    }
  }
  if (m.rawLoadedMs.length === ls && ls > 0) {
    const med = median(m.rawLoadedMs);
    if (m.loadedRttMs == null || med == null || !close(med, m.loadedRttMs, 0.15)) {
      return { ...base, band: "insufficient", detail: "Reported loaded median does not match raw samples." };
    }
  }
  if (us === 0 || ls === 0 || m.unloadedRttMs == null || m.loadedRttMs == null) {
    return {
      ...base,
      band: "insufficient",
      detail: "One side completed and the other did not. That is not a loaded-latency pair and not a full timeout.",
    };
  }
  const delta = m.loadedRttMs - m.unloadedRttMs;
  const signature =
    delta >= T.congestion.failDeltaAtLeastMs &&
    m.unloadedRttMs <= T.congestion.failUnloadedAtMostMs &&
    m.loadedRttMs >= T.congestion.failLoadedAtLeastMs;
  if (signature) {
    return {
      ...base,
      band: "fail",
      detail: `Unloaded ${m.unloadedRttMs} ms, loaded ${m.loadedRttMs} ms, delta ${Math.round(delta)} ms. Matches the loaded-latency fail signature.`,
    };
  }
  const elevated =
    delta >= T.congestion.degradedDeltaAtLeastMs ||
    m.loadedRttMs >= T.congestion.passLoadedBelowMs ||
    m.unloadedRttMs > T.congestion.passUnloadedAtMostMs;
  if (elevated) {
    return {
      ...base,
      band: "degraded",
      detail: `Unloaded ${m.unloadedRttMs} ms, loaded ${m.loadedRttMs} ms, delta ${Math.round(delta)} ms. Elevated, but not the fail signature (delta ≥ ${T.congestion.failDeltaAtLeastMs} ms with unloaded ≤ ${T.congestion.failUnloadedAtMostMs} ms and loaded ≥ ${T.congestion.failLoadedAtLeastMs} ms).`,
    };
  }
  return {
    ...base,
    band: "pass",
    detail: `Unloaded ${m.unloadedRttMs} ms, loaded ${m.loadedRttMs} ms, delta ${Math.round(delta)} ms to ${m.target}.`,
  };
}

export function classifyAll(set: MeasurementSet): Record<CheckAssessment["id"], CheckAssessment> {
  return {
    gateway: classifyGateway(set.gateway),
    dns: classifyDns(set.dns),
    packet_loss: classifyLoss(set.packetLoss),
    congestion: classifyCongestion(set.congestion),
  };
}
