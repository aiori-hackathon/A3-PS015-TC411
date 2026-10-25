import { createFileRoute } from "@tanstack/react-router";
import { AGENT_STATE_LABEL } from "@/lib/agent/probe";
import { ALLOWED_ACTIONS, AGENT_ORIGIN, RECOVERY_DNS } from "@/lib/engine/thresholds";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/agent")({ component: AgentPage });

const STATES = [
  ["Not installed", "This page is already on localhost and the health request was not accepted."],
  ["Starting", "A valid health document arrived with ready: false."],
  ["Connected", "Health document matched the name, loopback bind, and the full allowlist."],
  ["Unavailable", "A response arrived that was not a healthy agent, or the request timed out."],
  ["Browser permission blocked", "This page is not a local origin, so the browser hides loopback. A missing agent looks the same, and is not labeled Connected or Not installed."],
] as const;

function AgentPage() {
  const agent = useSession((s) => s.agent);
  const probe = useSession((s) => s.probe);
  const busy = agent.state === "checking";

  return (
    <article className="max-w-3xl space-y-8">
      <header>
        <p className="font-mono text-xs tracking-widest text-accent">LOCAL AGENT</p>
        <h2 className="mt-2 text-2xl font-medium text-balance">Loopback only</h2>
        <p className="mt-3 text-pretty text-muted">
          The console talks to {AGENT_ORIGIN} and nowhere else. Connected is shown only after a health document passes validation.
        </p>
      </header>

      <section className="border border-line bg-surface p-4">
        <p className="font-mono text-xs text-muted">CURRENT STATUS</p>
        <p className="mt-2 text-2xl font-medium">{busy ? "Checking" : AGENT_STATE_LABEL[agent.state]}</p>
        <p className="mt-2 text-sm text-pretty text-muted">{agent.detail}</p>
        <p className="mt-2 font-mono text-xs text-faint">{agent.checkedAt ?? "Not checked"}</p>
        <button
          type="button"
          data-testid="test-agent"
          className="mt-4 h-11 border border-accent px-4 text-sm text-accent disabled:opacity-60"
          disabled={busy}
          onClick={() => void probe()}
        >
          Test agent connection
        </button>
        {agent.health ? (
          <pre className="mt-4 overflow-x-auto border border-line bg-bg p-3 font-mono text-xs leading-relaxed">
            {JSON.stringify(agent.health, null, 2)}
          </pre>
        ) : null}
      </section>

      <section>
        <h3 className="text-lg font-medium">States</h3>
        <ul className="mt-3 space-y-2">
          {STATES.map(([name, detail]) => (
            <li key={name} className="border border-line px-3 py-3">
              <p className="text-sm font-medium">{name}</p>
              <p className="mt-1 text-sm text-muted">{detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-lg font-medium">Allowlist</h3>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {ALLOWED_ACTIONS.map((action) => (
            <li key={action} className="border border-line bg-surface px-3 py-3 font-mono text-sm">
              {action}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          FIX_DNS, when an agent accepts it, must save the current resolvers, apply {RECOVERY_DNS[0]} and {RECOVERY_DNS[1]}, flush, and leave the keep-or-rollback decision to the retest. The page rejects any other applied list. There is no action for an arbitrary command.
        </p>
      </section>

      <section className="border border-line bg-bg p-4">
        <h3 className="text-lg font-medium">Reference agent</h3>
        <p className="mt-2 text-sm text-pretty text-muted">
          The downloadable reference process binds to 127.0.0.1:8765, answers /health, and performs a real DNS lookup. It refuses FIX_DNS, RENEW_DHCP, and RECONNECT_NETWORK, and it does not invent gateway, loss, or latency numbers. Running it will not mark a recovery Resolved.
        </p>
        <a
          className="mt-4 inline-flex h-11 items-center border border-line px-4 text-sm"
          href="/probespeak-agent.mjs"
          download="probespeak-agent.mjs"
        >
          Download reference agent
        </a>
      </section>
    </article>
  );
}
