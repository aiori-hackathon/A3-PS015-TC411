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
  connected: "text-pass",
  starting: "text-warn",
  permission_blocked: "text-warn",
  unavailable: "text-fail",
  not_installed: "text-muted",
  checking: "text-muted",
  unchecked: "text-muted",
};

export function Shell({ children }: { children: ReactNode }) {
  const agent = useSession((s) => s.agent);
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-dvh bg-bg">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-bg">
        <div className="flex w-full items-center gap-4 px-4 py-3 lg:gap-8 lg:px-6">
          <Link to="/" className="flex shrink-0 items-center gap-3">
            <span className="grid size-8 place-items-center rounded-sm bg-fg font-mono text-xs font-medium text-bg">
              PS
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-medium tracking-tight">ProbeSpeak</span>
              <span className="block font-mono text-xs text-muted">PS-015</span>
            </span>
          </Link>
          <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label="Primary">
            {NAV.map((item) => {
              const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center rounded-sm px-3 text-sm transition-colors duration-150",
                    active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <Link
            to="/agent"
            className={cn(
              "inline-flex h-9 shrink-0 items-center rounded-sm border border-line px-3 font-mono text-xs",
              TONE[agent.state] ?? TONE.unchecked,
            )}
          >
            {agent.state === "checking" ? "Checking agent" : AGENT_STATE_LABEL[agent.state]}
          </Link>
        </div>
      </header>
      <main className="w-full px-4 py-6 lg:px-6 lg:py-8">{children}</main>
    </div>
  );
}
