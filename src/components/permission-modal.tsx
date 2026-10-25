import { useEffect, useRef } from "react";
import { RECOVERY_DNS } from "@/lib/engine/thresholds";
import type { RecoveryAction } from "@/lib/engine/types";

export function PermissionModal({
  open,
  action,
  lab,
  onAllow,
  onDeny,
  onReview,
}: {
  open: boolean;
  action: RecoveryAction;
  lab: boolean;
  onAllow: () => void;
  onDeny: () => void;
  onReview: () => void;
}) {
  const denyRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) denyRef.current?.focus();
  }, [open]);
  if (!open) return null;

  const steps =
    action === "FIX_DNS"
      ? [
          "VERIFY_DNS — confirm the fresh lookup is still failing.",
          "Save the current resolver list.",
          `Set resolvers to ${RECOVERY_DNS[0]} and ${RECOVERY_DNS[1]}.`,
          "Flush the resolver cache.",
          "RETEST — run all four measurements again.",
          "Keep the new resolvers only if every check passes.",
          "Otherwise RESTORE_DNS.",
        ]
      : [
          "VERIFY_GATEWAY — confirm the gateway still answered 0 probes.",
          "RENEW_DHCP — request a new lease. This is not a demonstrated cause.",
          "RETEST — run all four measurements again.",
          "Mark Resolved only if every check passes.",
          "There is no lease rollback in this console.",
        ];

  return (
    <div className="fixed inset-0 z-30 grid place-items-end bg-bg/80 p-4 sm:place-items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="permit-title"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto border border-line bg-surface p-5 shadow-none"
      >
        <p className="font-mono text-xs tracking-widest text-accent">{lab ? "LAB SIMULATION" : "LOCAL AGENT"}</p>
        <h2 id="permit-title" className="mt-2 text-xl font-medium text-balance">
          {action === "FIX_DNS" ? "Allow a reversible DNS change?" : "Allow a DHCP renew attempt?"}
        </h2>
        <p className="mt-3 text-sm text-pretty text-muted">
          {lab
            ? "No request will be sent to 127.0.0.1. No DNS or DHCP setting on this device will change. The later numbers come from the stored retest capture."
            : "The next calls go only to the allowlisted agent on 127.0.0.1:8765. This page will not send a shell command."}
        </p>
        <ol className="mt-4 space-y-2">
          {steps.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm">
              <span className="font-mono text-xs text-faint">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-pretty">
          Resolved is used only if the retest passes every check. Declining leaves the result Unresolved and changes nothing.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            ref={denyRef}
            type="button"
            className="h-11 flex-1 border border-line bg-bg px-4 text-sm"
            onClick={onDeny}
          >
            Do not change anything
          </button>
          <button type="button" className="h-11 flex-1 bg-accent px-4 text-sm text-accent-ink" onClick={onAllow}>
            {lab ? "Run lab simulation" : `Allow ${action}`}
          </button>
        </div>
        <button type="button" className="mt-3 h-11 w-full text-sm text-muted" onClick={onReview}>
          Review evidence first
        </button>
      </div>
    </div>
  );
}
