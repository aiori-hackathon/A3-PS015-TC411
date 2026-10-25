import { createFileRoute } from "@tanstack/react-router";
import { ChartPanel } from "@/components/charts";
import { EvidenceGrid } from "@/components/evidence";
import { PermissionModal } from "@/components/permission-modal";
import { FlowTimeline } from "@/components/timeline";
import { VerdictPanel } from "@/components/verdict";
import { AGENT_STATE_LABEL } from "@/lib/agent/probe";
import { FINDING_LABEL } from "@/lib/engine/types";
import { SCENARIOS } from "@/lib/scenarios";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const s = useSession();
  const scenario = SCENARIOS.find((item) => item.id === s.scenarioId) ?? SCENARIOS[0]!;

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <section className="border border-line bg-surface p-4">
          <h2 className="text-sm font-medium">Run</h2>
          <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Measurement mode">
            <button
              type="button"
              className={cn("h-11 border text-sm", s.mode === "lab" ? "border-accent bg-accent text-accent-ink" : "border-line")}
              onClick={() => s.setMode("lab")}
              disabled={s.busy || (s.phase !== "idle" && s.phase !== "complete")}
            >
              Lab capture
            </button>
            <button
              type="button"
              className={cn("h-11 border text-sm", s.mode === "live" ? "border-accent bg-accent text-accent-ink" : "border-line")}
              onClick={() => s.setMode("live")}
              disabled={s.busy || (s.phase !== "idle" && s.phase !== "complete")}
            >
              Live agent
            </button>
          </div>
          <p className="mt-3 text-sm text-pretty text-muted">
            {s.mode === "lab"
              ? "Lab mode uses stored numbers and the same rule engine. It never claims this device was tested or repaired."
              : "Live mode sends allowlisted calls to 127.0.0.1:8765. If the agent is not connected, the result is Inconclusive."}
          </p>
          {s.mode === "lab" ? (
            <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
              {SCENARIOS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`scenario-${item.id}`}
                  disabled={s.busy || (s.phase !== "idle" && s.phase !== "complete")}
                  onClick={() => s.selectScenario(item.id)}
                  className={cn(
                    "block w-full border px-3 py-3 text-left",
                    item.id === s.scenarioId ? "border-accent bg-surface-2" : "border-line",
                  )}
                >
                  <span className="block text-sm font-medium">{item.title}</span>
                  <span className="mt-1 block text-sm text-pretty text-muted">{item.situation}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-3 font-mono text-xs text-muted">
              Agent: {AGENT_STATE_LABEL[s.agent.state]}. Hints from the browser, if any, are stored and ignored by the rules.
            </p>
          )}
          <button
            type="button"
            data-testid="run-test"
            className="mt-3 h-11 w-full bg-accent text-sm text-accent-ink disabled:opacity-60"
            onClick={() => void s.run()}
          >
            {s.busy ? "Running" : s.mode === "lab" ? "Run lab capture" : "Run live test"}
          </button>
        </section>
        {s.phase === "awaiting_permission" ? (
          <button
            type="button"
            className="h-11 w-full border border-accent text-sm text-accent"
            onClick={() => s.setModal(true)}
          >
            Recovery is waiting for permission
          </button>
        ) : null}
      </aside>

      <div className="min-w-0 space-y-6">
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="text-sm font-medium">Flow</h2>
            <p className="font-mono text-xs text-muted">{s.runId ?? "No run"}</p>
          </div>
          <FlowTimeline
            phase={s.phase}
            diagnosis={s.diagnosis}
            permission={s.permissionChoice}
            hasAfter={Boolean(s.after)}
          />
        </section>

        {s.verdict ? <VerdictPanel /> : null}

        <section className="space-y-3">
          <h2 className="text-sm font-medium">Evidence before recovery</h2>
          {s.mode === "lab" && s.phase === "idle" ? (
            <p className="text-sm text-muted">
              Selected capture: {scenario.title}. Numbers stay hidden until you run it.
            </p>
          ) : null}
          <EvidenceGrid set={s.before} checks={s.diagnosis?.checks ?? null} revealed={s.revealed} />
        </section>

        {s.after && s.afterDiagnosis ? (
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Evidence after retest</h2>
            <p className="text-sm text-muted">
              This is a separate measurement. Resolved is allowed only when every check in this set passes.
            </p>
            <EvidenceGrid
              set={s.after}
              checks={s.afterDiagnosis.checks}
              revealed={{ gateway: true, dns: true, packet_loss: true, congestion: true }}
            />
          </section>
        ) : null}

        <section className="border border-line bg-surface p-4">
          <h2 className="text-sm font-medium">Diagnosis</h2>
          {!s.diagnosis ? (
            <p className="mt-2 text-sm text-muted">The rule trace appears after the four records are in.</p>
          ) : (
            <>
              <p className="mt-2 font-mono text-xs text-accent">{FINDING_LABEL[s.diagnosis.finding]}</p>
              <p className="mt-2 max-w-3xl text-sm text-pretty">{s.diagnosis.summary}</p>
              {s.diagnosis.reasons.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm text-muted">
                  {s.diagnosis.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
              <ol className="mt-4 space-y-2">
                {s.diagnosis.trace.map((entry) => (
                  <li key={entry.id} className="border border-line bg-bg px-3 py-2">
                    <p className="font-mono text-xs text-muted">
                      {entry.outcome} · {entry.title}
                    </p>
                    <p className="mt-1 text-sm text-pretty">{entry.detail}</p>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">Before and after</h2>
          <p className="text-sm text-muted">
            After values are plotted only when a retest measurement exists. Timeouts and rejected samples are omitted, not drawn as zero.
          </p>
          <ChartPanel
            before={s.phase === "idle" ? null : s.before}
            after={s.after}
            beforeDiagnosis={s.diagnosis}
            afterDiagnosis={s.afterDiagnosis}
          />
        </section>

        {s.hints ? (
          <section className="border border-line bg-bg p-4">
            <h2 className="text-sm font-medium">Browser hints</h2>
            <p className="mt-1 text-sm text-muted">Not used by the rule engine.</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 font-mono text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted">onLine</dt>
                <dd>{s.hints.onLine ? "true" : "false"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">effectiveType</dt>
                <dd>{s.hints.effectiveType ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">rtt</dt>
                <dd>{s.hints.rttMs == null ? "—" : `${s.hints.rttMs} ms`}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">downlink</dt>
                <dd>{s.hints.downlinkMbps == null ? "—" : `${s.hints.downlinkMbps} Mb/s`}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section className="border border-line bg-bg p-4">
          <h2 className="text-sm font-medium">Event log</h2>
          {s.events.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Empty.</p>
          ) : (
            <ol className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {s.events.map((event) => (
                <li key={event.id} className="font-mono text-xs leading-relaxed">
                  <span className="text-faint">{event.at.slice(11, 19)} </span>
                  {event.message}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <PermissionModal
        open={s.modalOpen && Boolean(s.diagnosis?.recovery)}
        action={s.diagnosis?.recovery ?? "FIX_DNS"}
        lab={s.mode === "lab"}
        onAllow={() => void s.allow()}
        onDeny={s.deny}
        onReview={() => s.setModal(false)}
      />
    </div>
  );
}
