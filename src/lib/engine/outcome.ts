import type { Diagnosis, RecoveryAction, Verdict } from "./types.ts";

export interface RecoveryDecision {
  verdict: Extract<Verdict, "resolved" | "unresolved">;
  rollback: boolean;
  detail: string;
}

/**
 * Resolved is allowed only when the retest itself shows no fault.
 * DNS changes roll back unless that bar is cleared. DHCP renew cannot be undone here.
 */
export function decideRecoveryOutcome(action: RecoveryAction, after: Diagnosis): RecoveryDecision {
  if (after.finding === "NO_FAULT" && after.preliminary === "no_fault_observed") {
    return {
      verdict: "resolved",
      rollback: false,
      detail:
        action === "FIX_DNS"
          ? "Retest passed every check. The new resolvers are kept. Resolved refers only to that retest, not to a proven root cause."
          : "Retest passed every check after DHCP renew. The lease change cannot be attributed as the cause. Resolved refers only to the retest.",
    };
  }
  if (action === "FIX_DNS") {
    return {
      verdict: "unresolved",
      rollback: true,
      detail:
        "Retest did not pass every check. Previous resolvers must be restored. Status is Unresolved, not Resolved.",
    };
  }
  return {
    verdict: "unresolved",
    rollback: false,
    detail:
      "Retest did not pass every check. DHCP renew is not rolled back by this console because the previous lease is not restored. Status is Unresolved.",
  };
}
