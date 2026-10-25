import { createFileRoute, Link } from "@tanstack/react-router";
import { VerdictPanel } from "@/components/verdict";
import { FINDING_LABEL } from "@/lib/engine/types";
import { LIMITATIONS } from "@/lib/report";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/report")({ component: ReportPage });

function ReportPage() {
  const s = useSession();
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="font-mono text-xs tracking-widest text-accent">VERIFICATION REPORT</p>
        <h2 className="mt-2 text-2xl font-medium">Latest run</h2>
        <p className="mt-2 text-sm text-muted">
          {s.runId ? s.runId : "No run in this session."}{" "}
          {s.mode === "lab" ? `Lab capture ${s.scenarioId}.` : "Live mode."}
        </p>
      </header>
      {!s.diagnosis ? (
        <p className="border border-line bg-surface p-4 text-sm">
          Nothing to report. <Link to="/" className="text-accent">Run a capture</Link> first. An empty page is not a pass.
        </p>
      ) : (
        <>
          <VerdictPanel />
          <section className="border border-line p-4">
            <h3 className="text-sm font-medium">Finding before any recovery</h3>
            <p className="mt-2 text-sm">{FINDING_LABEL[s.diagnosis.finding]}</p>
            <p className="mt-2 text-sm text-pretty text-muted">{s.diagnosis.summary}</p>
          </section>
          {s.afterDiagnosis ? (
            <section className="border border-line p-4">
              <h3 className="text-sm font-medium">Retest finding</h3>
              <p className="mt-2 text-sm">{FINDING_LABEL[s.afterDiagnosis.finding]}</p>
              <p className="mt-2 text-sm text-pretty text-muted">{s.afterDiagnosis.summary}</p>
            </section>
          ) : (
            <p className="text-sm text-muted">No retest measurement is attached to this run.</p>
          )}
        </>
      )}
      <section>
        <h3 className="text-sm font-medium">What this report will not claim</h3>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          {LIMITATIONS.map((item) => (
            <li key={item} className="border-l border-line pl-3">
              {item}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
