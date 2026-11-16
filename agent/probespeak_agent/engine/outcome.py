"""Resolved is allowed only when the retest itself shows no fault."""

def decide_recovery_outcome(action, after):
    if action == "FIX_DNS":
        if after["checks"]["dns"]["band"] == "pass":
            return {
                "verdict": "resolved", "rollback": False,
                "detail": "The later lookup succeeded. The new resolvers are kept. Resolved refers only to that lookup.",
            }
        return {
            "verdict": "unresolved", "rollback": True,
            "detail": "The later lookup still failed. Previous resolvers must be restored. Status is Unresolved.",
        }
    if after["finding"] == "NO_FAULT" and after["preliminary"] == "no_fault_observed":
        return {
            "verdict": "resolved", "rollback": False,
            "detail": ("Retest passed every check. The new resolvers are kept. Resolved refers only to that retest."
                       if action == "FIX_DNS"
                       else "Retest passed every check after DHCP renew. Resolved refers only to the retest."),
        }
    return {"verdict": "unresolved", "rollback": False,
            "detail": "Retest did not pass every check. Status is Unresolved."}
