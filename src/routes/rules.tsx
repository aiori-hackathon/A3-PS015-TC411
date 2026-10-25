import { createFileRoute } from "@tanstack/react-router";
import { diagnose } from "@/lib/engine/diagnose";
import { THRESHOLDS } from "@/lib/engine/thresholds";
import { FINDING_LABEL } from "@/lib/engine/types";
import { SCENARIOS } from "@/lib/scenarios";

export const Route = createFileRoute("/rules")({ component: RulesPage });

function RulesPage() {
  const g = THRESHOLDS.gateway;
  const d = THRESHOLDS.dns;
  const p = THRESHOLDS.packetLoss;
  const c = THRESHOLDS.congestion;
  const example = SCENARIOS.find((s) => s.id === "dns-fix-verifies")!;
  const result = diagnose(example.before);

  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <header>
        <p className="font-mono text-xs tracking-widest text-accent">RULE ENGINE</p>
        <h2 className="mt-2 text-2xl font-medium text-balance">The same numbers, every time</h2>
        <p className="mt-3 text-pretty text-muted">
          Classification and diagnosis are pure functions of the measurement document. They do not call the network, and they never return Resolved. That word is reserved for a later retest that passes every check.
        </p>
      </header>

      <section className="space-y-3">
        <h3 className="text-lg font-medium">Thresholds</h3>
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-surface font-mono text-xs text-muted">
              <tr>
                <th className="px-3 py-3 font-medium">Check</th>
                <th className="px-3 py-3 font-medium">Pass</th>
                <th className="px-3 py-3 font-medium">Degraded</th>
                <th className="px-3 py-3 font-medium">Fail</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <td className="px-3 py-3">Gateway</td>
                <td className="px-3 py-3">All of at least {g.minAttempts} replies, RTT at or under {g.degradedRttAboveMs} ms</td>
                <td className="px-3 py-3">RTT above {g.degradedRttAboveMs} ms, or any miss, while still under the fail line</td>
                <td className="px-3 py-3">Success ratio below {g.failSuccessRatioBelow}, RTT above {g.failRttAboveMs} ms, or zero replies</td>
              </tr>
              <tr className="border-t border-line">
                <td className="px-3 py-3">DNS</td>
                <td className="px-3 py-3">Fresh lookup of {d.expectedQuery} in at most {d.degradedTimeAboveMs} ms</td>
                <td className="px-3 py-3">Resolved, time above {d.degradedTimeAboveMs} ms and at most {d.failTimeAboveMs} ms</td>
                <td className="px-3 py-3">Did not resolve, or time above {d.failTimeAboveMs} ms</td>
              </tr>
              <tr className="border-t border-line">
                <td className="px-3 py-3">Loss</td>
                <td className="px-3 py-3">At least {p.minSent} probes and loss at most {p.degradedAbovePct}%</td>
                <td className="px-3 py-3">Loss above {p.degradedAbovePct}% and at most {p.failAbovePct}%</td>
                <td className="px-3 py-3">Loss above {p.failAbovePct}%</td>
              </tr>
              <tr className="border-t border-line">
                <td className="px-3 py-3">Loaded latency</td>
                <td className="px-3 py-3">
                  At least {c.minAttemptsEach} attempts each side, delta under {c.degradedDeltaAtLeastMs} ms, loaded under {c.passLoadedBelowMs} ms, unloaded at most {c.passUnloadedAtMostMs} ms
                </td>
                <td className="px-3 py-3">Elevated, but not the fail signature</td>
                <td className="px-3 py-3">
                  Delta at least {c.failDeltaAtLeastMs} ms, unloaded at most {c.failUnloadedAtMostMs} ms, and loaded at least {c.failLoadedAtLeastMs} ms
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted">
          Fewer than the minimum samples, a median that disagrees with the raw list, or a lookup that is not cache-bypassing is Insufficient — not a quiet pass.
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-medium">Decision order</h3>
        <ol className="space-y-3 text-sm">
          <li className="border border-line bg-surface p-4">
            <span className="font-mono text-xs text-accent">1</span>
            <p className="mt-1">If any check is insufficient, or the records contradict each other, stop. Finding: none. Status: Inconclusive.</p>
          </li>
          <li className="border border-line bg-surface p-4">
            <span className="font-mono text-xs text-accent">2</span>
            <p className="mt-1">If all four pass: no fault observed. This is not Resolved.</p>
          </li>
          <li className="border border-line bg-surface p-4">
            <span className="font-mono text-xs text-accent">3</span>
            <p className="mt-1">
              Gateway answered nothing, fresh DNS failed, loss is at least {p.constellationAtLeastPct}%, and both latency sides timed out. One pattern: gateway unreachable. Optional attempt: RENEW_DHCP, which is not claimed as the cause.
            </p>
          </li>
          <li className="border border-line bg-surface p-4">
            <span className="font-mono text-xs text-accent">4</span>
            <p className="mt-1">DNS failed and the other three passed. Optional attempt: FIX_DNS, kept only if the retest is clean, otherwise rolled back.</p>
          </li>
          <li className="border border-line bg-surface p-4">
            <span className="font-mono text-xs text-accent">5</span>
            <p className="mt-1">
              Loss above {p.failAbovePct}% and below {p.ambiguousWithHealthyPathPct}%, with the other three passing. Report the loss. Do not offer a local fix, because the hop is not known.
            </p>
          </li>
          <li className="border border-line bg-surface p-4">
            <span className="font-mono text-xs text-accent">6</span>
            <p className="mt-1">Loaded-latency fail signature with the other three passing. Report it. Do not offer DNS or DHCP.</p>
          </li>
          <li className="border border-line bg-surface p-4">
            <span className="font-mono text-xs text-accent">7</span>
            <p className="mt-1">Anything else — two fault signals, a fail next to a degraded check, or only elevated values — is Inconclusive.</p>
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-medium">Worked capture</h3>
        <p className="text-sm text-muted">
          “{example.title}” evaluated in this page, not typed in by hand. Finding: {FINDING_LABEL[result.finding]}. Recovery: {result.recovery ?? "none"}.
        </p>
        <ol className="space-y-2">
          {result.trace.map((entry) => (
            <li key={entry.id} className="border border-line px-3 py-2">
              <p className="font-mono text-xs text-muted">
                {entry.outcome} · {entry.title}
              </p>
              <p className="mt-1 text-sm">{entry.detail}</p>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
