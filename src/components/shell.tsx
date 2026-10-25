import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AGENT_STATE_LABEL } from "@/lib/agent/probe";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Console" },
  { to: "/rules", label: "Rules" },
  { to: "/agent", label: "Agent" },
  { to: "/report", label: "Report" },
  { to: "/method", label: "Method" },
] as const;

const TONE: Record<string, string> = {
  connected: "text-pass border-pass/40",
  starting: "text-accent border-accent/40",
  permission_blocked: "text-accent border-accent/40",
  unavailable: "text-fail border-fail/40",
  not_installed: "text-muted border-line",
  checking: "text-muted border-line",
  unchecked: "text-muted border-line",
};

export function Shell({ children }: { children: ReactNode }) {
  const agent = useSession((s) => s.agent);
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="grid-fade min-h-dvh">
      <header className="no-print border-b border-line bg-bg/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center border border-accent/50 font-mono text-xs text-accent">
                  PS
                </span>
                <div>
                  <p className="font-mono text-xs tracking-widest text-accent">PS-015</p>
                  <h1 className="text-lg font-medium leading-tight tracking-tight">ProbeSpeak</h1>
                </div>
              </div>
              <p className="mt-2 max-w-xl text-sm text-muted text-pretty">
                Measure, explain with evidence, ask permission, attempt a safe recovery, retest, verify.
              </p>
            </div>
            <Link
              to="/agent"
              className={cn(
                "inline-flex h-11 shrink-0 items-center border px-3 font-mono text-xs",
                TONE[agent.state] ?? TONE.unchecked,
              )}
            >
              {agent.state === "checking" ? "Checking agent" : AGENT_STATE_LABEL[agent.state]}
            </Link>
          </div>
          <nav className="flex gap-2 overflow-x-auto" aria-label="Primary">
            {NAV.map((item) => {
              const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "inline-flex h-11 items-center border px-3 text-sm",
                    active ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-fg",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
