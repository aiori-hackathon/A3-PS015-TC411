import { CHECK_LABEL, type Band, type CheckAssessment, type CheckId, type MeasurementSet } from "@/lib/engine/types";
import { lossPercent } from "@/lib/engine/stats";
import { cn } from "@/lib/utils";

const BAND_CLASS: Record<Band, string> = {
  pass: "text-pass border-pass/40",
  fail: "text-fail border-fail/40",
  degraded: "text-accent border-accent/40",
  insufficient: "text-muted border-line",
  timeout: "text-fail border-fail/40",
};

function Pill({ band }: { band: Band }) {
  const label = band === "timeout" ? "Timeout" : band[0]!.toUpperCase() + band.slice(1);
  return <span className={cn("border px-2 py-1 font-mono text-xs uppercase", BAND_CLASS[band])}>{label}</span>;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2 last:border-0">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-mono text-sm tabular-nums text-fg">{v}</dd>
    </div>
  );
}

function show(v: string | number | boolean | null | undefined): string {
  if (v == null || v === "") return "—";
  return String(v);
}

export function EvidenceGrid({
  set,
  checks,
  revealed,
}: {
  set: MeasurementSet | null;
  checks: Record<CheckId, CheckAssessment> | null;
  revealed: Record<CheckId, boolean>;
}) {
  const ids: CheckId[] = ["gateway", "dns", "packet_loss", "congestion"];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {ids.map((id) => (
        <article key={id} className="min-w-0 border border-line bg-surface p-4">
          <header className="mb-3 flex items-start justify-between gap-3">
            <h3 className="text-sm font-medium">{CHECK_LABEL[id]}</h3>
            {revealed[id] && checks ? <Pill band={checks[id].band} /> : null}
          </header>
          {!set || !revealed[id] ? (
            <p className="font-mono text-sm text-faint">Waiting for this record.</p>
          ) : (
            <CheckBody id={id} set={set} detail={checks?.[id].detail ?? ""} />
          )}
        </article>
      ))}
    </div>
  );
}

function CheckBody({ id, set, detail }: { id: CheckId; set: MeasurementSet; detail: string }) {
  const source =
    set.source === "lab" ? "Lab capture" : set.source === "local_agent" ? "Local agent" : "Browser limit";
  if (id === "gateway") {
    const g = set.gateway;
    return (
      <>
        <p className="mb-3 text-sm text-pretty text-muted">{detail || g.insufficientReason}</p>
        <dl>
          <Row k="Gateway" v={show(g.gatewayIp)} />
          <Row k="Replies" v={g.attempts == null ? "—" : `${g.successes ?? "—"} / ${g.attempts}`} />
          <Row k="Median RTT" v={g.rttMs == null ? "—" : `${g.rttMs} ms`} />
          <Row k="Method" v={g.method} />
          <Row k="Captured" v={g.capturedAt} />
          <Row k="Source" v={source} />
        </dl>
        <Raw value={{ rawRttsMs: g.rawRttsMs, insufficientReason: g.insufficientReason }} />
      </>
    );
  }
  if (id === "dns") {
    const d = set.dns;
    return (
      <>
        <p className="mb-3 text-sm text-pretty text-muted">{detail || d.insufficientReason}</p>
        <dl>
          <Row k="Query" v={show(d.queryName)} />
          <Row k="Resolver" v={show(d.resolver)} />
          <Row k="Fresh lookup" v={d.freshLookup == null ? "—" : d.freshLookup ? "yes" : "no"} />
          <Row k="Resolved" v={d.resolved == null ? "—" : d.resolved ? "yes" : "no"} />
          <Row k="Time" v={d.timeMs == null ? "—" : `${d.timeMs} ms`} />
          <Row k="Answers" v={d.answers.length ? d.answers.join(", ") : "—"} />
          <Row k="Error" v={show(d.error)} />
          <Row k="Captured" v={d.capturedAt} />
          <Row k="Source" v={source} />
        </dl>
        <Raw value={{ method: d.method, insufficientReason: d.insufficientReason }} />
      </>
    );
  }
  if (id === "packet_loss") {
    const p = set.packetLoss;
    const computed =
      p.sent != null && p.received != null && p.sent > 0 && p.received <= p.sent
        ? `${lossPercent(p.sent, p.received).toFixed(1)}%`
        : "—";
    return (
      <>
        <p className="mb-3 text-sm text-pretty text-muted">{detail || p.insufficientReason}</p>
        <dl>
          <Row k="Target" v={show(p.target)} />
          <Row k="Sent" v={show(p.sent)} />
          <Row k="Received" v={show(p.received)} />
          <Row k="Loss from counts" v={computed} />
          <Row k="Reported loss" v={p.lossPct == null ? "—" : `${p.lossPct}%`} />
          <Row k="Method" v={p.method} />
          <Row k="Captured" v={p.capturedAt} />
          <Row k="Source" v={source} />
        </dl>
        <Raw value={{ rawRttsMs: p.rawRttsMs, insufficientReason: p.insufficientReason }} />
      </>
    );
  }
  const c = set.congestion;
  const delta =
    c.unloadedRttMs != null && c.loadedRttMs != null ? `${Math.round(c.loadedRttMs - c.unloadedRttMs)} ms` : "—";
  return (
    <>
      <p className="mb-3 text-sm text-pretty text-muted">{detail || c.insufficientReason}</p>
      <dl>
        <Row k="Target" v={show(c.target)} />
        <Row k="Unloaded median" v={c.unloadedRttMs == null ? "—" : `${c.unloadedRttMs} ms`} />
        <Row k="Loaded median" v={c.loadedRttMs == null ? "—" : `${c.loadedRttMs} ms`} />
        <Row k="Delta" v={delta} />
        <Row
          k="Unloaded samples"
          v={c.unloadedAttempts == null ? "—" : `${c.unloadedSamples} ok, ${c.unloadedTimeouts} timeout / ${c.unloadedAttempts}`}
        />
        <Row
          k="Loaded samples"
          v={c.loadedAttempts == null ? "—" : `${c.loadedSamples} ok, ${c.loadedTimeouts} timeout / ${c.loadedAttempts}`}
        />
        <Row k="Method" v={c.method} />
        <Row k="Captured" v={c.capturedAt} />
        <Row k="Source" v={source} />
      </dl>
      <Raw
        value={{
          rawUnloadedMs: c.rawUnloadedMs,
          rawLoadedMs: c.rawLoadedMs,
          insufficientReason: c.insufficientReason,
        }}
      />
    </>
  );
}

function Raw({ value }: { value: unknown }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer font-mono text-xs text-muted">Raw values</summary>
      <pre className="mt-2 overflow-x-auto border border-line bg-bg p-3 font-mono text-xs leading-relaxed text-fg">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
