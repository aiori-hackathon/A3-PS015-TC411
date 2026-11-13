import dataclasses
import pytest
from probespeak_agent.engine.diagnose import diagnose
from probespeak_agent.engine.outcome import decide_recovery_outcome
from probespeak_agent.models import measurement_from_wire, to_wire
from probespeak_agent.scenarios import SCENARIOS, run_scenario, scenario_by_id

FORBIDDEN = ("damaged", "cable fault", "isp-internal", "interference")

@pytest.mark.parametrize("sc", SCENARIOS, ids=lambda s: s.id)
def test_scenario_verdict(sc):
    r = run_scenario(sc)
    assert r["diagnosis"]["finding"] == sc.expected_finding
    assert r["verdict"] == sc.expected_verdict
    assert r["deviceChanged"] is False

def test_fault_classes_covered():
    assert {"gateway_unreachable", "dns_failure", "packet_loss", "congestion", "edge case"} \
           <= {s.fault_class for s in SCENARIOS}

def test_diagnose_never_says_resolved():
    for sc in SCENARIOS:
        assert diagnose(sc.before)["preliminary"] != "resolved"
        if sc.retest:
            assert diagnose(sc.retest)["preliminary"] != "resolved"

def test_resolved_requires_clean_retest():
    sc = scenario_by_id("dns-fix-rolls-back")
    assert decide_recovery_outcome("FIX_DNS", diagnose(sc.retest))["verdict"] == "unresolved"
    sc2 = scenario_by_id("dns-fix-verifies")
    assert decide_recovery_outcome("FIX_DNS", diagnose(sc2.retest))["verdict"] == "resolved"

def test_claims_policy_no_forbidden_words():
    for sc in SCENARIOS:
        r = run_scenario(sc)
        text = " ".join([r["diagnosis"]["summary"], *r["diagnosis"]["reasons"],
                         *(t["detail"] for t in r["diagnosis"]["trace"])]).lower()
        for bad in FORBIDDEN:
            assert bad not in text, f"{sc.id} contains '{bad}'"

def test_missing_instrument_gives_inconclusive():
    s = scenario_by_id("clean-fiber").before
    broken = dataclasses.replace(s, packet_loss=dataclasses.replace(s.packet_loss, insufficient_reason="ping unusable"))
    assert diagnose(broken)["preliminary"] == "inconclusive"

def test_wire_round_trip():
    s = scenario_by_id("mid-loss").before
    assert measurement_from_wire(to_wire(s)) == s

def test_wire_rejects_incomplete():
    w = to_wire(scenario_by_id("clean-fiber").before)
    del w["dns"]["resolved"]
    with pytest.raises(ValueError):
        measurement_from_wire(w)
