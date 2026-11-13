"""12 lab scenarios. Same rule engine as live captures. No device changes."""
from dataclasses import dataclass
from typing import Optional
from .engine.diagnose import diagnose
from .engine.outcome import decide_recovery_outcome
from .models import (CongestionMeasurement, DnsMeasurement, GatewayMeasurement,
                     MeasurementSet, PacketLossMeasurement, to_wire)
from .stats import js_round, loss_percent, median

SRC = "lab"
IDLE = [12, 13, 12.5, 14, 13.5, 12.8, 13.2, 14.1]
MILD = [24, 26, 25, 28, 27, 26.5, 29, 27.4]
GW   = [1.8, 2.0, 2.1, 2.4]

def gw(at, ip, attempts, raw):
    return GatewayMeasurement(at, SRC, "ICMP echo to the default gateway", None,
                              ip, attempts, len(raw), median(raw) if raw else None, list(raw))

def dns(at, resolver, resolved, time_ms, answers=None, error="timeout"):
    return DnsMeasurement(at, SRC, "Fresh lookup of cloudflare.com, cache bypassed", None,
                          True, "cloudflare.com", resolver, resolved, time_ms,
                          answers or [], None if resolved else error)

def loss(at, sent, received):
    raw = [11 + (i % 5) * 0.4 for i in range(received)]
    return PacketLossMeasurement(at, SRC, "ICMP echo to 1.1.1.1", None,
                                 "1.1.1.1", sent, received,
                                 js_round(loss_percent(sent, received) * 100) / 100, raw)

def cong(at, unloaded, loaded):
    return CongestionMeasurement(at, SRC, "TCP RTT to 1.1.1.1, idle then during a bulk transfer", None,
                                 "1.1.1.1", len(unloaded), len(loaded), len(unloaded), len(loaded),
                                 0, 0, median(unloaded), median(loaded), list(unloaded), list(loaded))

def cong_timeout(at, n):
    return CongestionMeasurement(at, SRC, "TCP RTT to 1.1.1.1, idle then during a bulk transfer", None,
                                 "1.1.1.1", n, n, 0, 0, n, n, None, None, [], [])

def _set(id_, label, at, g, d, p, c):
    return MeasurementSet(id_, label, SRC, at, g, d, p, c)

def healthy(id_, label, at, resolver="192.168.1.1", dns_ms=18):
    return _set(id_, label, at, gw(at, "192.168.1.1", 4, GW),
                dns(at, resolver, True, dns_ms, ["104.16.132.229"]),
                loss(at, 50, 50), cong(at, IDLE, MILD))

def dns_down(id_, label, at, resolver="192.168.1.1"):
    return _set(id_, label, at, gw(at, "192.168.1.1", 4, GW),
                dns(at, resolver, False, 5000),
                loss(at, 50, 50), cong(at, IDLE, MILD))

def gateway_down(id_, label, at):
    return _set(id_, label, at, gw(at, "192.168.1.1", 4, []),
                dns(at, "192.168.1.1", False, 5000),
                loss(at, 50, 0), cong_timeout(at, 8))


@dataclass
class Scenario:
    id: str; title: str; situation: str
    before: MeasurementSet; retest: Optional[MeasurementSet]
    expected_finding: str; expected_verdict: str; fault_class: str


def _build():
    s = []
    s.append(Scenario("clean-fiber","Clean fiber path",
        "Four complete instruments on an idle fiber last mile.",
        healthy("clean-before","Clean fiber capture","2026-10-25T08:00:00.000Z"), None,
        "NO_FAULT","no_fault_observed","baseline"))

    s.append(Scenario("dns-fix-verifies","Resolver timeout, retest passes",
        "Fresh lookup times out. Retest after FIX_DNS is clean.",
        dns_down("dns-before","Resolver timeout capture","2026-10-25T08:10:00.000Z"),
        healthy("dns-after-ok","Retest after FIX_DNS","2026-10-25T08:12:00.000Z",resolver="1.1.1.1",dns_ms=21),
        "DNS_RESOLVER_FAILURE","resolved","dns_failure"))

    s.append(Scenario("dns-fix-rolls-back","Resolver timeout, retest still fails",
        "Retest still times out, so the change is rolled back.",
        dns_down("dns-rb-before","Resolver timeout capture","2026-10-25T08:20:00.000Z"),
        dns_down("dns-after-bad","Retest after FIX_DNS still failing","2026-10-25T08:22:00.000Z",resolver="1.1.1.1"),
        "DNS_RESOLVER_FAILURE","unresolved","dns_failure"))

    at = "2026-10-25T08:30:00.000Z"
    s.append(Scenario("mid-loss","Loss beside a quiet path","12% ICMP loss to 1.1.1.1.",
        _set("loss-before","Mid-range loss capture",at,gw(at,"192.168.1.1",4,GW),
             dns(at,"192.168.1.1",True,21,["104.16.132.229"]),loss(at,50,44),cong(at,IDLE,MILD)),
        None,"SIGNIFICANT_PACKET_LOSS","unresolved","packet_loss"))

    at = "2026-10-25T08:40:00.000Z"
    s.append(Scenario("loaded-latency","Loaded latency jump","Loaded RTT jumps by hundreds of ms.",
        _set("bloat-before","Loaded latency capture",at,gw(at,"192.168.1.1",4,GW),
             dns(at,"192.168.1.1",True,19,["104.16.132.229"]),loss(at,50,50),
             cong(at,[14,15,16,16,17,18,18,19],[580,600,610,620,640,660,690,720])),
        None,"LOADED_LATENCY_INFLATION","unresolved","congestion"))

    s.append(Scenario("gateway-dhcp-clears","Gateway silent, retest is clean",
        "Four-way outage. Retest after DHCP is clean.",
        gateway_down("gw-before","Gateway silent capture","2026-10-25T08:50:00.000Z"),
        healthy("gw-after-ok","Retest after RENEW_DHCP","2026-10-25T08:52:00.000Z"),
        "GATEWAY_UNREACHABLE","resolved","gateway_unreachable"))

    s.append(Scenario("gateway-dhcp-fails","Gateway silent, retest still silent",
        "Same four-way silence. Retest still silent.",
        gateway_down("gw-bad-before","Gateway silent capture","2026-10-25T09:00:00.000Z"),
        gateway_down("gw-after-bad","Retest still silent","2026-10-25T09:02:00.000Z"),
        "GATEWAY_UNREACHABLE","unresolved","gateway_unreachable"))

    at = "2026-10-25T09:10:00.000Z"
    s.append(Scenario("contradictory","Gateway silent, path samples succeed",
        "Gateway 0 replies but DNS and loss counter both succeed.",
        _set("contra-before","Disagreeing captures",at,gw(at,"192.168.1.1",4,[]),
             dns(at,"192.168.1.1",True,12,["104.16.132.229"]),loss(at,50,50),cong(at,IDLE,MILD)),
        None,"NONE","inconclusive","edge case"))

    at = "2026-10-25T09:20:00.000Z"
    s.append(Scenario("short-sample","Loss counter stopped early","Loss counter has only 8 probes.",
        _set("short-before","Short loss counter",at,gw(at,"192.168.1.1",4,GW),
             dns(at,"192.168.1.1",True,16,["104.16.132.229"]),loss(at,8,8),cong(at,IDLE,MILD)),
        None,"NONE","inconclusive","edge case"))

    at = "2026-10-25T09:30:00.000Z"
    s.append(Scenario("dns-and-loss","Lookup timeout and loss together","Two signals, no single cause.",
        _set("both-before","DNS timeout with loss",at,gw(at,"192.168.1.1",4,GW),
             dns(at,"192.168.1.1",False,5000),loss(at,50,41),cong(at,IDLE,MILD)),
        None,"NONE","inconclusive","edge case"))

    at = "2026-10-25T09:40:00.000Z"
    s.append(Scenario("under-line","Elevated, under the fail lines","All somewhat high but no fail threshold crossed.",
        _set("elev-before","Elevated under fail lines",at,gw(at,"192.168.1.1",4,[42,44,46,48]),
             dns(at,"192.168.1.1",True,220,["104.16.132.229"]),loss(at,50,49),
             cong(at,[18,19,20,20,21,21,22,22],[88,90,91,92,92,94,95,96])),
        None,"NONE","inconclusive","edge case"))

    at = "2026-10-25T09:50:00.000Z"
    s.append(Scenario("icmp-filter","Total ICMP miss, other samples fine",
        "Every ICMP probe missing. DNS and latency succeeded.",
        _set("filter-before","Total ICMP miss",at,gw(at,"192.168.1.1",4,GW),
             dns(at,"192.168.1.1",True,20,["104.16.132.229"]),loss(at,50,0),cong(at,IDLE,MILD)),
        None,"NONE","inconclusive","edge case"))

    return s

SCENARIOS = _build()

def scenario_by_id(id_): return next((x for x in SCENARIOS if x.id == id_), None)

def run_scenario(sc):
    before = diagnose(sc.before)
    out = {"id": sc.id, "title": sc.title, "situation": sc.situation, "faultClass": sc.fault_class,
           "mode": "lab", "deviceChanged": False, "before": to_wire(sc.before), "diagnosis": before,
           "after": None, "afterDiagnosis": None, "recovery": before["recovery"],
           "verdict": before["preliminary"], "outcomeDetail": before["summary"],
           "expected": {"finding": sc.expected_finding, "verdict": sc.expected_verdict}}
    if before["recovery"] and sc.retest is not None:
        after = diagnose(sc.retest); decision = decide_recovery_outcome(before["recovery"], after)
        out.update({"after": to_wire(sc.retest), "afterDiagnosis": after,
                    "verdict": decision["verdict"], "outcomeDetail": decision["detail"],
                    "rollbackNeeded": decision["rollback"]})
    return out
