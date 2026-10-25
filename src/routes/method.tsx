import { createFileRoute } from "@tanstack/react-router";
import { ALLOWED_ACTIONS, AGENT_ORIGIN, RECOVERY_DNS } from "@/lib/engine/thresholds";

export const Route = createFileRoute("/method")({ component: MethodPage });

function MethodPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 text-sm leading-relaxed">
      <header>
        <p className="font-mono text-xs tracking-widest text-accent">README</p>
        <h2 className="mt-2 text-2xl font-medium text-balance">How ProbeSpeak decides</h2>
        <p className="mt-3 text-pretty text-muted">
          PS-015 is a last-mile diagnosis console. It measures four things, explains the rule that fired, asks before any change, retries a safe action, retests, and only then uses the word Resolved.
        </p>
      </header>

      <section className="space-y-2">
        <h3 className="text-lg font-medium">The order</h3>
        <p>Measure. Explain with evidence. Ask permission. Attempt a safe recovery. Retest. Verify.</p>
        <p className="text-muted">
          If a record is missing, too small, internally inconsistent, or in conflict with another record, the result is Inconclusive. The console does not pick a likely cause to fill the gap.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-medium">What is measured</h3>
        <ul className="space-y-2 text-muted">
          <li>Gateway reachability — replies and median RTT to the default gateway.</li>
          <li>DNS resolution — a cache-bypassing lookup of cloudflare.com, with time and answers.</li>
          <li>Packet loss — sent and received counts. The loss percentage is recomputed. A mismatch is rejected.</li>
          <li>Congestion — unloaded and loaded median RTT, with attempt and timeout counts.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-medium">Two modes</h3>
        <p>
          <span className="text-fg">Lab capture</span> replays twelve stored records through that engine, including scripted later captures. The page says so in the log. It does not probe this computer and it does not change DNS.
        </p>
        <p className="text-muted">
          <span className="text-fg">Live agent</span> calls {AGENT_ORIGIN}. Without a validated health document the four checks are recorded as unavailable and the status is Inconclusive. Browser online hints are shown separately and are not inputs.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-medium">Recovery</h3>
        <p>Only two findings offer an action, and only after permission:</p>
        <ul className="space-y-2 text-muted">
          <li>
            Isolated DNS failure → FIX_DNS. Verify the failure, save the current resolvers, apply {RECOVERY_DNS[0]} and {RECOVERY_DNS[1]}, flush, retest. Keep them only when the retest passes every check. Otherwise RESTORE_DNS and mark Unresolved.
          </li>
          <li>
            Gateway-unreachable pattern → RENEW_DHCP. The evidence does not show that the lease is the cause. There is no lease rollback. Resolved still requires a clean retest.
          </li>
        </ul>
        <p className="text-muted">Packet loss and loaded latency can be reported without a repair. A number is not a location.</p>
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-medium">Agent contract</h3>
        <p className="text-muted">Bind 127.0.0.1:8765. Expose GET /health. POST /action accepts only:</p>
        <p className="font-mono text-xs leading-relaxed text-fg">{ALLOWED_ACTIONS.join(" · ")}</p>
        <p className="text-muted">
          The reference file on the Agent page implements the protocol, measures DNS for real, and refuses to change system settings or invent the other three measurements. A full agent may perform the DNS procedure; this website will still ignore a response that does not match the allowlist or the expected resolver pair.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-medium">What it will not do</h3>
        <ul className="space-y-2 text-muted">
          <li>It will not mark Connected because a request failed in an encouraging way.</li>
          <li>It will not mark Resolved because an action was attempted, or because a lab story sounds finished, unless the retest document itself passes every check.</li>
          <li>It will not send a shell string. There is no field for one.</li>
          <li>It will not treat a web page as a packet generator. From the browser, those instruments are missing.</li>
        </ul>
      </section>
    </article>
  );
}
