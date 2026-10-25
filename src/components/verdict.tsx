import { FINDING_LABEL, VERDICT_LABEL, type Verdict } from "@/lib/engine/types";
import { downloadText, reportJson, reportText } from "@/lib/report";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const TONE: Record<Verdict, string> = {
  resolved: "border-pass/50 text-pass",
  unresolved: "border-fail/50 text-fail",
  inconclusive: "border-accent/50 text-accent",
  no_fault_observed: "border-pass/50 text-pass",
};

export function VerdictPanel() {
  const snap = useSession();
  if (!snap.verdict) {
    return (
      <section className="border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">Verification</h2>
        <p className="mt-2 text-sm text-muted">No result yet. Resolved is not shown before a retest passes.</p>
      </section>
    );
  }
  const file = snap.runId ?? "probespeak";
  return (
    <section className={cn("border bg-surface p-4", TONE[snap.verdict])} aria-live="polite">
      <p className="font-mono text-xs tracking-widest">FINAL STATUS</p>
      <h2 className="mt-1 text-2xl font-medium">{VERDICT_LABEL[snap.verdict]}</h2>
      <p className="mt-2 max-w-3xl text-sm text-pretty text-fg">{snap.verdictDetail}</p>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">Finding</dt>
          <dd>{snap.diagnosis ? FINDING_LABEL[snap.diagnosis.finding] : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Executor</dt>
          <dd>{snap.executor ?? "None"}</dd>
        </div>
        <div>
          <dt className="text-muted">Permission</dt>
          <dd>{snap.permissionChoice ?? "Not requested"}</dd>
        </div>
        <div>
          <dt className="text-muted">Rollback</dt>
          <dd>{snap.rollbackNote ?? "—"}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className="h-11 border border-line bg-bg px-4 text-sm text-fg"
          onClick={() => downloadText(`${file}.txt`, reportText(snap), "text/plain")}
        >
          Download text report
        </button>
        <button
          type="button"
          className="h-11 border border-line bg-bg px-4 text-sm text-fg"
          onClick={() => downloadText(`${file}.json`, reportJson(snap), "application/json")}
        >
          Download JSON report
        </button>
      </div>
    </section>
  );
}
