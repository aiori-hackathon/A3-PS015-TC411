"""Deterministic diagnosis. Never invents a cause. Never returns 'resolved'."""
from ..stats import loss_percent
from ..thresholds import THRESHOLDS
from .classify import classify_all

P = THRESHOLDS["packetLoss"]

def _loss_of(s):
    sent, recv = s.packet_loss.sent, s.packet_loss.received
    if sent is None or recv is None or sent <= 0 or recv > sent: return None
    return loss_percent(sent, recv)

def _contradictions(s, ck):
    out = []; g, d, loss = s.gateway, s.dns, _loss_of(s)
    gk = ck["gateway"]["band"] != "insufficient" and g.successes is not None
    dk = ck["dns"]["band"] != "insufficient" and d.resolved is not None
    lk = ck["packet_loss"]["band"] != "insufficient" and loss is not None
    if gk and g.successes == 0 and dk and d.resolved is True and d.fresh_lookup is True:
        out.append("A fresh DNS lookup succeeded while the gateway answered 0 probes.")
    if gk and g.successes == 0 and lk and loss < P["constellationAtLeastPct"] and s.packet_loss.received > 0:
        out.append("External probes received replies while the gateway answered 0 probes. Those records disagree.")
    if ck["congestion"]["band"] == "timeout" and ck["packet_loss"]["band"] == "pass":
        out.append("Every latency probe timed out while packet loss was inside the pass band.")
    if (lk and loss >= P["ambiguousWithHealthyPathPct"] and ck["dns"]["band"] == "pass"
            and ck["congestion"]["band"] == "pass" and ck["gateway"]["band"] == "pass"):
        out.append(f"Loss is {loss:.1f}% while gateway, DNS, and latency samples succeeded. ICMP filtering can look like this.")
    return out

def _is_const(s, ck):
    loss = _loss_of(s)
    return (ck["gateway"]["band"] == "fail" and s.gateway.successes == 0
            and ck["dns"]["band"] == "fail" and s.dns.resolved is False
            and ck["packet_loss"]["band"] == "fail" and loss is not None
            and loss >= P["constellationAtLeastPct"] and ck["congestion"]["band"] == "timeout")

def _r(finding, preliminary, recovery, summary, reasons, checks, trace):
    return {"finding": finding, "preliminary": preliminary, "recovery": recovery,
            "summary": summary, "reasons": reasons, "checks": checks, "trace": trace}

def diagnose(s):
    ck = classify_all(s)
    trace = [{"id": f"classify.{c['id']}", "title": f"Classify {c['id']}", "detail": c["detail"],
               "outcome": "clear" if c["band"] == "pass" else "note" if c["band"] == "degraded" else "blocked"}
             for c in ck.values()]

    def skip(id_, title, detail):
        trace.append({"id": id_, "title": title, "detail": detail, "outcome": "skipped"})

    missing = [f"{c['id']}: {c['detail']}" for c in ck.values() if c["band"] == "insufficient"]
    conflicts = _contradictions(s, ck)

    if missing or conflicts:
        reasons = missing + conflicts
        msg = "Not evaluated. Evidence is incomplete or in conflict."
        for id_, title in [("rule.healthy","All four pass"),("rule.gateway","Gateway-unreachable constellation"),
                           ("rule.dns","Isolated DNS resolver failure"),("rule.loss","Isolated packet loss"),
                           ("rule.latency","Isolated loaded-latency inflation")]:
            skip(id_, title, msg)
        trace.append({"id": "rule.stop", "title": "Stop without a cause", "detail": " ".join(reasons), "outcome": "fired"})
        return _r("NONE", "inconclusive", None,
                  "At least one instrument is missing, too small, or internally inconsistent. No cause is named." if missing
                  else "The records disagree or admit more than one explanation. No cause is named.",
                  reasons, ck, trace)

    if all(c["band"] == "pass" for c in ck.values()):
        trace.append({"id": "rule.healthy", "title": "All four pass",
                      "detail": "Gateway, DNS, loss, and loaded latency are all inside the pass band.", "outcome": "fired"})
        for id_, title in [("rule.gateway","Gateway-unreachable constellation"),("rule.dns","Isolated DNS resolver failure"),
                           ("rule.loss","Isolated packet loss"),("rule.latency","Isolated loaded-latency inflation")]:
            skip(id_, title, "Not reached.")
        return _r("NO_FAULT", "no_fault_observed", None,
                  "All four checks passed their thresholds. Nothing was repaired, so this is not a Resolved result.",
                  [], ck, trace)

    skip("rule.healthy", "All four pass", "At least one check is outside the pass band.")

    if _is_const(s, ck):
        trace.append({"id": "rule.gateway", "title": "Gateway-unreachable constellation", "outcome": "fired",
                      "detail": "Gateway answered 0 probes, fresh DNS lookup failed, external loss >= 80%, and both latency sides timed out."})
        for id_, t in [("rule.dns","Isolated DNS resolver failure"),("rule.loss","Isolated packet loss"),
                       ("rule.latency","Isolated loaded-latency inflation")]:
            skip(id_, t, "Gateway pattern already matched.")
        return _r("GATEWAY_UNREACHABLE", "unresolved", "RENEW_DHCP",
                  "The gateway did not answer, and DNS, loss, and latency failed in the same way. "
                  "DHCP renew is an allowlisted attempt. Resolved only if a later retest passes every check.",
                  [], ck, trace)
    skip("rule.gateway", "Gateway-unreachable constellation", "The four-way outage pattern was not present.")

    b = {k: v["band"] for k, v in ck.items()}
    if b["dns"] == "fail" and b["gateway"] == "pass" and b["packet_loss"] == "pass" and b["congestion"] == "pass":
        trace.append({"id": "rule.dns", "title": "Isolated DNS resolver failure", "outcome": "fired",
                      "detail": "The fresh lookup failed while gateway, loss, and loaded latency all passed."})
        skip("rule.loss", "Isolated packet loss", "DNS pattern already matched.")
        skip("rule.latency", "Isolated loaded-latency inflation", "DNS pattern already matched.")
        return _r("DNS_RESOLVER_FAILURE", "unresolved", "FIX_DNS",
                  "A fresh lookup failed and the other three checks passed. "
                  "A reversible resolver change can be attempted. Kept only if a full retest passes.",
                  [], ck, trace)
    skip("rule.dns", "Isolated DNS resolver failure", "DNS is not a lone fail against three passing checks.")

    loss = _loss_of(s)
    if (b["packet_loss"] == "fail" and loss is not None and loss < P["ambiguousWithHealthyPathPct"]
            and b["gateway"] == "pass" and b["dns"] == "pass" and b["congestion"] == "pass"):
        trace.append({"id": "rule.loss", "title": "Isolated packet loss", "outcome": "fired",
                      "detail": f"Loss is above {P['failAbovePct']}% and below {P['ambiguousWithHealthyPathPct']}%, with the other three checks passing."})
        skip("rule.latency", "Isolated loaded-latency inflation", "Loss pattern already matched.")
        return _r("SIGNIFICANT_PACKET_LOSS", "unresolved", None,
                  f"Packet loss is {loss:.1f}% to {s.packet_loss.target or 'the target'}. Status stays Unresolved.",
                  [], ck, trace)
    skip("rule.loss", "Isolated packet loss", "Loss is not a lone mid-range fail against three passing checks.")

    if b["congestion"] == "fail" and b["gateway"] == "pass" and b["dns"] == "pass" and b["packet_loss"] == "pass":
        trace.append({"id": "rule.latency", "title": "Isolated loaded-latency inflation", "outcome": "fired",
                      "detail": "Unloaded RTT stayed low and loaded RTT jumped by the fail signature."})
        return _r("LOADED_LATENCY_INFLATION", "unresolved", None,
                  "Loaded latency is inflated relative to the unloaded baseline. Status stays Unresolved.",
                  [], ck, trace)
    skip("rule.latency", "Isolated loaded-latency inflation", "The bufferbloat signature was not isolated.")

    signals = [k for k, v in b.items() if v in ("fail", "timeout")]
    degraded = [k for k, v in b.items() if v == "degraded"]
    reasons = []
    if len(signals) >= 2:
        summary = "More than one fault signal is present and they do not form the gateway-unreachable pattern."
        reasons.append(f"Fault signals: {', '.join(signals)}.")
    elif len(signals) == 1 and degraded:
        summary = "One check failed and another is only degraded. That is not clean enough to name a cause."
        reasons.append(f"Fault signal: {signals[0]}. Degraded: {', '.join(degraded)}.")
    elif len(signals) == 1:
        summary = "One check is outside spec, but the pattern is not one this engine is willing to name."
        reasons.append(f"Fault signal: {signals[0]}.")
    else:
        summary = "Some checks are elevated and none crossed a fail threshold. No cause is named."
        reasons.append(f"Degraded: {', '.join(degraded) or 'none'}.")
    trace.append({"id": "rule.stop", "title": "Stop without a cause", "detail": summary, "outcome": "fired"})
    return _r("NONE", "inconclusive", None, summary, reasons, ck, trace)
