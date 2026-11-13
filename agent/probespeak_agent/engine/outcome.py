"""Resolved is allowed only when the retest itself shows no fault."""

def decide_recovery_outcome(action, after):
    if after["finding"] == "NO_FAULT" and after["preliminary"] == "no_fault_observed":
        return {
            "verdict": "resolved", "rollback": False,
            "detail": ("Retest passed every check. The new resolvers are kept. Resolved refers only to that retest."
                       if action == "FIX_DNS"
                       else "Retest passed every check after DHCP renew. Resolved refers only to the retest."),
        }
    if action == "FIX_DNS":
        return {"verdict": "unresolved", "rollback": True,
                "detail": "Retest did not pass every check. Previous resolvers must be restored. Status is Unresolved."}
    return {"verdict": "unresolved", "rollback": False,
            "detail": "Retest did not pass every check. Status is Unresolved."}
