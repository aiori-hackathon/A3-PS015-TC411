import { classifyAll } from "./classify.ts";
import { lossPercent } from "./stats.ts";
import { THRESHOLDS } from "./thresholds.ts";
import type {
  CheckAssessment,
  Diagnosis,
  FindingId,
  MeasurementSet,
  RecoveryAction,
  TraceEntry,
} from "./types.ts";

const T = THRESHOLDS;

function lossOf(set: MeasurementSet): number | null {
  const { sent, received } = set.packetLoss;
  if (sent == null || received == null || sent <= 0 || received > sent) return null;
  return lossPercent(sent, received);
}

function contradictions(set: MeasurementSet, checks: Record<CheckAssessment["id"], CheckAssessment>): string[] {
  const reasons: string[] = [];
  const g = set.gateway;
  const d = set.dns;
  const loss = lossOf(set);
  const gwKnown = checks.gateway.band !== "insufficient" && g.successes != null;
  const dnsKnown = checks.dns.band !== "insufficient" && d.resolved != null;
  const lossKnown = checks.packet_loss.band !== "insufficient" && loss != null;

  if (gwKnown && g.successes === 0 && dnsKnown && d.resolved === true && d.freshLookup === true) {
    reasons.push("A fresh DNS lookup succeeded while the gateway answered 0 probes.");
  }
  if (gwKnown && g.successes === 0 && lossKnown && loss! < T.packetLoss.constellationAtLeastPct && set.packetLoss.received! > 0) {
    reasons.push(
      "External probes received replies while the gateway answered 0 probes. Those records disagree.",
    );
  }
  if (checks.congestion.band === "timeout" && checks.packet_loss.band === "pass") {
    reasons.push("Every latency probe timed out while packet loss was inside the pass band.");
  }
  if (
    lossKnown &&
    loss! >= T.packetLoss.ambiguousWithHealthyPathPct &&
    checks.dns.band === "pass" &&
    checks.congestion.band === "pass" &&
    checks.gateway.band === "pass"
  ) {
    reasons.push(
      `Loss is ${loss!.toFixed(1)}% while gateway, DNS, and latency samples succeeded. ICMP filtering can look like this. It is not isolated as packet loss.`,
    );
  }
  return reasons;
}

function insufficientReasons(checks: Record<CheckAssessment["id"], CheckAssessment>): string[] {
  return (Object.values(checks) as CheckAssessment[])
    .filter((c) => c.band === "insufficient")
    .map((c) => `${c.id}: ${c.detail}`);
}

function faultSignals(checks: Record<CheckAssessment["id"], CheckAssessment>): string[] {
  const out: string[] = [];
  for (const c of Object.values(checks) as CheckAssessment[]) {
    if (c.band === "fail" || c.band === "timeout") out.push(c.id);
  }
  return out;
}

function isConstellation(set: MeasurementSet, checks: Record<CheckAssessment["id"], CheckAssessment>): boolean {
  const loss = lossOf(set);
  return (
    checks.gateway.band === "fail" &&
    set.gateway.successes === 0 &&
    checks.dns.band === "fail" &&
    set.dns.resolved === false &&
    checks.packet_loss.band === "fail" &&
    loss != null &&
    loss >= T.packetLoss.constellationAtLeastPct &&
    checks.congestion.band === "timeout"
  );
}

function build(partial: {
  finding: FindingId;
  preliminary: Diagnosis["preliminary"];
  recovery: RecoveryAction | null;
  summary: string;
  reasons: string[];
  checks: Diagnosis["checks"];
  trace: TraceEntry[];
}): Diagnosis {
  return partial;
}

/**
 * Deterministic diagnosis. Does not invent a cause.
 * Never returns a "resolved" verdict — that exists only after a retest.
 */
export function diagnose(set: MeasurementSet): Diagnosis {
  const checks = classifyAll(set);
  const trace: TraceEntry[] = (Object.values(checks) as CheckAssessment[]).map((c) => ({
    id: `classify.${c.id}`,
    title: `Classify ${c.id}`,
    detail: c.detail,
    outcome:
      c.band === "pass" ? "clear" : c.band === "degraded" ? "note" : "blocked",
  }));

  const missing = insufficientReasons(checks);
  const conflicts = contradictions(set, checks);

  const skip = (id: string, title: string, detail: string) => {
    trace.push({ id, title, detail, outcome: "skipped" });
  };

  if (missing.length > 0 || conflicts.length > 0) {
    const reasons = [...missing, ...conflicts];
    skip("rule.healthy", "All four pass", "Not evaluated. Evidence is incomplete or in conflict.");
    skip("rule.gateway", "Gateway-unreachable constellation", "Not evaluated. Evidence is incomplete or in conflict.");
    skip("rule.dns", "Isolated DNS resolver failure", "Not evaluated. Evidence is incomplete or in conflict.");
    skip("rule.loss", "Isolated packet loss", "Not evaluated. Evidence is incomplete or in conflict.");
    skip("rule.latency", "Isolated loaded-latency inflation", "Not evaluated. Evidence is incomplete or in conflict.");
    trace.push({
      id: "rule.stop",
      title: "Stop without a cause",
      detail: reasons.join(" "),
      outcome: "fired",
    });
    return build({
      finding: "NONE",
      preliminary: "inconclusive",
      recovery: null,
      summary: missing.length
        ? "At least one instrument is missing, too small, or internally inconsistent. No cause is named."
        : "The records disagree or admit more than one explanation. No cause is named.",
      reasons,
      checks,
      trace,
    });
  }

  const allPass = (Object.values(checks) as CheckAssessment[]).every((c) => c.band === "pass");
  if (allPass) {
    trace.push({
      id: "rule.healthy",
      title: "All four pass",
      detail: "Gateway, DNS, loss, and loaded latency are all inside the pass band.",
      outcome: "fired",
    });
    skip("rule.gateway", "Gateway-unreachable constellation", "Not reached.");
    skip("rule.dns", "Isolated DNS resolver failure", "Not reached.");
    skip("rule.loss", "Isolated packet loss", "Not reached.");
    skip("rule.latency", "Isolated loaded-latency inflation", "Not reached.");
    return build({
      finding: "NO_FAULT",
      preliminary: "no_fault_observed",
      recovery: null,
      summary:
        "All four checks passed their thresholds. Nothing was repaired, so this is not a Resolved result.",
      reasons: [],
      checks,
      trace,
    });
  }

  skip("rule.healthy", "All four pass", "At least one check is outside the pass band.");

  if (isConstellation(set, checks)) {
    trace.push({
      id: "rule.gateway",
      title: "Gateway-unreachable constellation",
      detail:
        "Gateway answered 0 probes, the fresh DNS lookup failed, external loss is at least 80%, and both latency sides timed out. That is one pattern, not four causes. It does not prove the fault is the local router rather than the link beyond it.",
      outcome: "fired",
    });
    skip("rule.dns", "Isolated DNS resolver failure", "Gateway pattern already matched.");
    skip("rule.loss", "Isolated packet loss", "Gateway pattern already matched.");
    skip("rule.latency", "Isolated loaded-latency inflation", "Gateway pattern already matched.");
    return build({
      finding: "GATEWAY_UNREACHABLE",
      preliminary: "unresolved",
      recovery: "RENEW_DHCP",
      summary:
        "The gateway did not answer, and DNS, loss, and latency failed in the same way. DHCP renew is an allowlisted attempt, not a demonstrated cause. Resolved is possible only if a later retest passes every check.",
      reasons: [],
      checks,
      trace,
    });
  }
  skip("rule.gateway", "Gateway-unreachable constellation", "The four-way outage pattern was not present.");

  const dnsIsolated =
    checks.dns.band === "fail" &&
    checks.gateway.band === "pass" &&
    checks.packet_loss.band === "pass" &&
    checks.congestion.band === "pass";
  if (dnsIsolated) {
    trace.push({
      id: "rule.dns",
      title: "Isolated DNS resolver failure",
      detail:
        "The fresh lookup failed while gateway, loss, and loaded latency all passed. The path measurements do not explain the lookup. This does not identify whether the resolver process, the configured server, or a filter is responsible.",
      outcome: "fired",
    });
    skip("rule.loss", "Isolated packet loss", "DNS pattern already matched.");
    skip("rule.latency", "Isolated loaded-latency inflation", "DNS pattern already matched.");
    return build({
      finding: "DNS_RESOLVER_FAILURE",
      preliminary: "unresolved",
      recovery: "FIX_DNS",
      summary:
        "A fresh lookup failed and the other three checks passed. A reversible resolver change can be attempted. It is kept only if a full retest passes.",
      reasons: [],
      checks,
      trace,
    });
  }
  skip(
    "rule.dns",
    "Isolated DNS resolver failure",
    "DNS is not a lone fail against three passing checks.",
  );

  const loss = lossOf(set)!;
  const lossIsolated =
    checks.packet_loss.band === "fail" &&
    loss < T.packetLoss.ambiguousWithHealthyPathPct &&
    checks.gateway.band === "pass" &&
    checks.dns.band === "pass" &&
    checks.congestion.band === "pass";
  if (lossIsolated) {
    trace.push({
      id: "rule.loss",
      title: "Isolated packet loss",
      detail: `Loss is above ${T.packetLoss.failAbovePct}% and below ${T.packetLoss.ambiguousWithHealthyPathPct}%, with the other three checks passing. The measurements do not locate the loss on Wi-Fi, the modem, or upstream. No safe local recovery is offered.`,
      outcome: "fired",
    });
    skip("rule.latency", "Isolated loaded-latency inflation", "Loss pattern already matched.");
    return build({
      finding: "SIGNIFICANT_PACKET_LOSS",
      preliminary: "unresolved",
      recovery: null,
      summary: `Packet loss is ${loss.toFixed(1)}% to ${set.packetLoss.target ?? "the target"}. The other checks passed, so a single local fix is not justified. Status stays Unresolved.`,
      reasons: [],
      checks,
      trace,
    });
  }
  skip("rule.loss", "Isolated packet loss", "Loss is not a lone mid-range fail against three passing checks.");

  const latencyIsolated =
    checks.congestion.band === "fail" &&
    checks.gateway.band === "pass" &&
    checks.dns.band === "pass" &&
    checks.packet_loss.band === "pass";
  if (latencyIsolated) {
    trace.push({
      id: "rule.latency",
      title: "Isolated loaded-latency inflation",
      detail:
        "Unloaded RTT stayed low and loaded RTT jumped by the fail signature, with gateway, DNS, and loss passing. This matches bufferbloat or a downstream queue. It does not name the device. No recovery is offered.",
      outcome: "fired",
    });
    return build({
      finding: "LOADED_LATENCY_INFLATION",
      preliminary: "unresolved",
      recovery: null,
      summary:
        "Loaded latency is inflated relative to the unloaded baseline. That is a supported observation, not a located cause, and it is not a DNS or DHCP fix. Status stays Unresolved.",
      reasons: [],
      checks,
      trace,
    });
  }
  skip("rule.latency", "Isolated loaded-latency inflation", "The bufferbloat signature was not isolated.");

  const signals = faultSignals(checks);
  const degraded = (Object.values(checks) as CheckAssessment[])
    .filter((c) => c.band === "degraded")
    .map((c) => c.id);
  let summary: string;
  const reasons: string[] = [];
  if (signals.length >= 2) {
    summary = "More than one fault signal is present and they do not form the gateway-unreachable pattern. A single cause is not isolated.";
    reasons.push(`Fault signals: ${signals.join(", ")}.`);
  } else if (signals.length === 1 && degraded.length > 0) {
    summary = "One check failed and another is only degraded. That is not clean enough to name a cause.";
    reasons.push(`Fault signal: ${signals[0]}. Degraded: ${degraded.join(", ")}.`);
  } else if (signals.length === 1) {
    summary = "One check is outside spec, but the pattern is not one this engine is willing to name.";
    reasons.push(`Fault signal: ${signals[0]}.`);
  } else {
    summary = "Some checks are elevated and none crossed a fail threshold. No cause is named.";
    reasons.push(`Degraded: ${degraded.join(", ") || "none"}.`);
  }
  trace.push({ id: "rule.stop", title: "Stop without a cause", detail: summary, outcome: "fired" });
  return build({
    finding: "NONE",
    preliminary: "inconclusive",
    recovery: null,
    summary,
    reasons,
    checks,
    trace,
  });
}
