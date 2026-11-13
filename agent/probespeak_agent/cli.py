import argparse, sys
from .actions import ActionHandler
from .engine.diagnose import diagnose
from .scenarios import SCENARIOS, run_scenario, scenario_by_id
from .thresholds import AGENT_HOST, AGENT_PORT

def main(argv=None):
    ap = argparse.ArgumentParser(prog="probespeak-agent")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sv = sub.add_parser("serve", help="run the local agent")
    sv.add_argument("--allow-changes", action="store_true",
                    help="permit FIX_DNS / RENEW_DHCP / RECONNECT_NETWORK (default: read-only)")
    sv.add_argument("--port", type=int, default=AGENT_PORT)
    sub.add_parser("scenarios", help="list all lab scenarios")
    sc = sub.add_parser("scenario", help="run one lab scenario")
    sc.add_argument("id")
    sub.add_parser("lab-all", help="run every scenario and check expected verdicts")
    sub.add_parser("live", help="one read-only live RETEST with rule trace")
    a = ap.parse_args(argv)

    if a.cmd == "serve":
        import uvicorn
        from .server import create_app
        handler = ActionHandler(allow_changes=a.allow_changes)
        print(f"probespeak-agent  http://{AGENT_HOST}:{a.port}  mode={'changes_allowed' if a.allow_changes else 'read_only'}")
        if handler.controller.pending_snapshot():
            print("WARNING: unrestored DNS snapshot exists. Send RESTORE_DNS.")
        uvicorn.run(create_app(handler, port=a.port), host=AGENT_HOST, port=a.port, log_level="warning")
        return 0

    if a.cmd == "scenarios":
        for s in SCENARIOS:
            print(f"{s.id:<24} {s.fault_class:<20} {s.title}")
        return 0

    if a.cmd == "scenario":
        s = scenario_by_id(a.id)
        if not s: print(f"Unknown scenario: {a.id}", file=sys.stderr); return 2
        r = run_scenario(s); d = r["diagnosis"]
        print(f"Finding   : {d['finding']}")
        print(f"Preliminary: {d['preliminary']}   Recovery: {d['recovery']}")
        print(f"Summary   : {d['summary']}\n")
        for c in d["checks"].values():
            print(f"  [{c['band']:<12}] {c['id']:<14} {c['detail']}")
        print()
        for t in d["trace"]:
            if t["id"].startswith("rule."):
                print(f"  {t['outcome']:<8} {t['id']}")
        if r.get("afterDiagnosis"):
            print(f"\n--- retest ---  finding: {r['afterDiagnosis']['finding']}")
        print(f"\nVERDICT: {r['verdict']}")
        return 0

    if a.cmd == "lab-all":
        bad = 0
        for s in SCENARIOS:
            r = run_scenario(s)
            ok = (r["diagnosis"]["finding"] == s.expected_finding and r["verdict"] == s.expected_verdict)
            bad += not ok
            print(f"{'PASS' if ok else 'FAIL'}  {s.id:<24} {r['diagnosis']['finding']:<28} -> {r['verdict']}")
        print(f"\n{len(SCENARIOS)} scenarios, {bad} failures")
        return 1 if bad else 0

    if a.cmd == "live":
        h = ActionHandler()
        res = h.handle("RETEST")
        from .models import measurement_from_wire
        d = diagnose(measurement_from_wire(res["measurement"]))
        print(f"Finding: {d['finding']}  Preliminary: {d['preliminary']}")
        for c in d["checks"].values():
            print(f"  [{c['band']:<12}] {c['id']:<14} {c['detail']}")
        return 0

    return 2
