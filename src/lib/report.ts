import { lossPercent } from "./engine/stats";
import { FINDING_LABEL, VERDICT_LABEL, type MeasurementSet, type Verdict } from "./engine/types";
import type { Session } from "./session";

const LIMITATIONS = [
  "A cause is reported only when every check is sufficient and the pattern matches one rule.",
  "Missing, conflicting, or merely elevated numbers stay Inconclusive.",
  "Resolved is used only after a retest in which every check passes. It does not prove a root cause.",
  "Lab mode replays stored captures inside this page. It does not probe or change this device.",
  "Live mode accepts measurements only from a ProbeSpeak agent on 127.0.0.1:8765. The page does not invent agent data.",
  "Browser online/connection hints are never inputs to the rule engine.",
];

type Snap = Pick<
  Session,
  | "runId"
  | "mode"
  | "scenarioId"
  | "before"
  | "after"
  | "diagnosis"
  | "afterDiagnosis"
  | "verdict"
  | "verdictDetail"
  | "permissionChoice"
  | "executor"
  | "rollbackNote"
  | "events"
  | "hints"
  | "agent"
>;

function loss(set: MeasurementSet | null): string {
  if (!set || set.packetLoss.sent == null || set.packetLoss.received == null) return "not accepted";
  if (set.packetLoss.insufficientReason) return "not accepted";
  const pct = lossPercent(set.packetLoss.sent, set.packetLoss.received);
  return `${pct.toFixed(1)}% (${set.packetLoss.received}/${set.packetLoss.sent})`;
}

function ms(n: number | null | undefined): string {
  return n == null ? "not accepted" : `${n} ms`;
}

export function reportJson(s: Snap): string {
  return JSON.stringify(
    {
      product: "ProbeSpeak",
      case: "PS-015",
      runId: s.runId,
      mode: s.mode,
      scenarioId: s.mode === "lab" ? s.scenarioId : null,
      agentState: s.agent.state,
      executor: s.executor,
      verdict: s.verdict,
      verdictDetail: s.verdictDetail,
      permission: s.permissionChoice,
      rollback: s.rollbackNote,
      finding: s.diagnosis?.finding ?? null,
      retestFinding: s.afterDiagnosis?.finding ?? null,
      before: s.before,
      after: s.after,
      trace: s.diagnosis?.trace ?? [],
      retestTrace: s.afterDiagnosis?.trace ?? [],
      reasons: s.diagnosis?.reasons ?? [],
      hintsNotUsedByEngine: s.hints,
      log: s.events,
      limitations: LIMITATIONS,
    },
    null,
    2,
  );
}

export function reportText(s: Snap): string {
  const verdict = s.verdict ? VERDICT_LABEL[s.verdict as Verdict] : "No result";
  const lines = [
    "ProbeSpeak  ·  PS-015",
    "Last-mile fault diagnosis from evidence",
    "",
    `Run          ${s.runId ?? "—"}`,
    `Mode         ${s.mode === "lab" ? "Lab capture" : "Live agent"}`,
    `Scenario     ${s.mode === "lab" ? s.scenarioId : "—"}`,
    `Agent        ${s.agent.state}`,
    `Executor     ${s.executor ?? "none"}`,
    `Verdict      ${verdict}`,
    `Finding      ${s.diagnosis ? FINDING_LABEL[s.diagnosis.finding] : "—"}`,
    `Permission   ${s.permissionChoice ?? "not requested"}`,
    `Rollback     ${s.rollbackNote ?? "—"}`,
    "",
    s.verdictDetail || "No completed run.",
    "",
    "Before",
    `  Gateway     ${s.before?.gateway.successes ?? "—"} / ${s.before?.gateway.attempts ?? "—"}   rtt ${ms(s.before?.gateway.rttMs)}`,
    `  DNS         ${s.before?.dns.resolved == null ? "not accepted" : s.before.dns.resolved ? "resolved" : "failed"}   ${ms(s.before?.dns.timeMs)}`,
    `  Loss        ${loss(s.before)}`,
    `  Unloaded    ${ms(s.before?.congestion.unloadedRttMs)}`,
    `  Loaded      ${ms(s.before?.congestion.loadedRttMs)}`,
    `  Captured    ${s.before?.capturedAt ?? "—"}`,
    `  Source      ${s.before?.source ?? "—"}`,
    "",
    "After retest",
    `  Gateway     ${s.after ? `${s.after.gateway.successes} / ${s.after.gateway.attempts}   rtt ${ms(s.after.gateway.rttMs)}` : "no retest"}`,
    `  DNS         ${s.after ? `${s.after.dns.resolved ? "resolved" : "failed"}   ${ms(s.after.dns.timeMs)}` : "no retest"}`,
    `  Loss        ${s.after ? loss(s.after) : "no retest"}`,
    `  Unloaded    ${s.after ? ms(s.after.congestion.unloadedRttMs) : "no retest"}`,
    `  Loaded      ${s.after ? ms(s.after.congestion.loadedRttMs) : "no retest"}`,
    `  Captured    ${s.after?.capturedAt ?? "—"}`,
    "",
    "Rule trace",
    ...(s.diagnosis?.trace ?? []).map((t) => `  [${t.outcome}] ${t.title} — ${t.detail}`),
    "",
    "Log",
    ...s.events.map((e) => `  ${e.at}  ${e.message}`),
    "",
    "Limits",
    ...LIMITATIONS.map((l) => `  - ${l}`),
    "",
  ];
  return lines.join("\n");
}

export function downloadText(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { LIMITATIONS };
