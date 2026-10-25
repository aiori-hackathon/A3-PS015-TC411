import type { Phase, PermissionChoice } from "@/lib/session";
import type { Diagnosis } from "@/lib/engine/types";
import { cn } from "@/lib/utils";

const STEPS = [
  ["measure", "Measure"],
  ["diagnose", "Diagnose"],
  ["permission", "Permission"],
  ["recover", "Recover"],
  ["retest", "Retest"],
] as const;

type Tone = "pending" | "active" | "done" | "skipped" | "denied";

export function FlowTimeline({
  phase,
  diagnosis,
  permission,
  hasAfter,
}: {
  phase: Phase;
  diagnosis: Diagnosis | null;
  permission: PermissionChoice;
  hasAfter: boolean;
}) {
  const tones = tonesFor(phase, diagnosis, permission, hasAfter);
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {STEPS.map(([id, label], index) => {
        const tone = tones[id];
        return (
          <li key={id} className={cn("border px-3 py-3", toneClass(tone))} aria-current={tone === "active" ? "step" : undefined}>
            <p className="font-mono text-xs text-faint">0{index + 1}</p>
            <p className="mt-1 text-sm font-medium">{label}</p>
            <p className="font-mono text-xs uppercase text-muted">{tone}</p>
          </li>
        );
      })}
    </ol>
  );
}

function tonesFor(
  phase: Phase,
  diagnosis: Diagnosis | null,
  permission: PermissionChoice,
  hasAfter: boolean,
): Record<(typeof STEPS)[number][0], Tone> {
  const idle = phase === "idle";
  const measure: Tone = idle ? "pending" : phase === "measuring" ? "active" : "done";
  const diagnose: Tone = !diagnosis
    ? phase === "diagnosing"
      ? "active"
      : "pending"
    : phase === "diagnosing"
      ? "active"
      : "done";
  const offered = Boolean(diagnosis?.recovery);
  let perm: Tone = "pending";
  if (diagnosis && !offered) perm = "skipped";
  else if (phase === "awaiting_permission") perm = "active";
  else if (permission === "denied") perm = "denied";
  else if (permission === "allowed") perm = "done";
  else if (phase === "complete" && !offered) perm = "skipped";

  let recover: Tone = "pending";
  if (!offered && diagnosis) recover = "skipped";
  else if (permission === "denied") recover = "skipped";
  else if (phase === "recovering") recover = "active";
  else if (permission === "allowed" && (phase === "retesting" || phase === "complete")) recover = "done";
  else if (phase === "complete" && !offered) recover = "skipped";

  let retest: Tone = "pending";
  if ((!offered && diagnosis) || permission === "denied") retest = "skipped";
  else if (phase === "retesting") retest = "active";
  else if (hasAfter || (permission === "allowed" && phase === "complete")) retest = "done";
  else if (phase === "complete" && !offered) retest = "skipped";

  return { measure, diagnose, permission: perm, recover, retest };
}

function toneClass(tone: Tone): string {
  if (tone === "active") return "border-accent bg-surface-2";
  if (tone === "done") return "border-pass/40 bg-surface";
  if (tone === "denied") return "border-fail/40 bg-surface";
  if (tone === "skipped") return "border-line bg-bg text-muted";
  return "border-line bg-surface";
}
