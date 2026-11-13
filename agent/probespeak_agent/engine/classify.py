"""Per-check banding. Port of src/lib/engine/classify.ts."""
from ..stats import js_round, loss_percent, median
from ..thresholds import THRESHOLDS as T

def _close(a, b, eps): return abs(a - b) <= eps
def _a(id_, band, detail, used): return {"id": id_, "band": band, "detail": detail, "used": used}

def classify_gateway(m):
    g = T["gateway"]
    used = {"gatewayIp": m.gateway_ip, "attempts": m.attempts, "successes": m.successes,
            "rttMs": m.rtt_ms, "rawCount": len(m.raw_rtts_ms)}
    mk = lambda b, d: _a("gateway", b, d, used)
    if m.insufficient_reason: return mk("insufficient", m.insufficient_reason)
    if m.attempts is None or m.successes is None: return mk("insufficient", "Attempts or successes were not reported.")
    if m.attempts < g["minAttempts"]: return mk("insufficient", f"Only {m.attempts} attempts. At least {g['minAttempts']} are required.")
    if m.successes > m.attempts: return mk("insufficient", "Successes exceed attempts.")
    if m.successes == 0:
        if m.rtt_ms is not None or len(m.raw_rtts_ms) > 0:
            return mk("insufficient", "Zero replies were reported together with RTT samples.")
        return mk("fail", f"0 of {m.attempts} replies from {m.gateway_ip or 'an unknown gateway'}. No RTT.")
    if m.rtt_ms is None: return mk("insufficient", "Replies were counted but median RTT is missing.")
    if len(m.raw_rtts_ms) > 0 and len(m.raw_rtts_ms) != m.successes:
        return mk("insufficient", "Raw RTT count does not match the success count.")
    if len(m.raw_rtts_ms) == m.successes:
        med = median(m.raw_rtts_ms)
        if med is None or not _close(med, m.rtt_ms, 0.15):
            return mk("insufficient", "Reported median RTT does not match the raw samples.")
    ratio = m.successes / m.attempts
    if ratio < g["failSuccessRatioBelow"] or m.rtt_ms > g["failRttAboveMs"]:
        return mk("fail", f"{m.successes} of {m.attempts} replies, median {m.rtt_ms} ms. Past the fail line.")
    if m.rtt_ms > g["degradedRttAboveMs"] or ratio < 1:
        return mk("degraded", f"{m.successes} of {m.attempts} replies, median {m.rtt_ms} ms. Above the pass line, below the fail line.")
    return mk("pass", f"{m.successes} of {m.attempts} replies, median {m.rtt_ms} ms, gateway {m.gateway_ip or 'unspecified'}.")

def classify_dns(m):
    d = T["dns"]
    used = {"freshLookup": m.fresh_lookup, "queryName": m.query_name, "resolver": m.resolver,
            "resolved": m.resolved, "timeMs": m.time_ms, "error": m.error,
            "answers": ", ".join(m.answers) or None}
    mk = lambda b, det: _a("dns", b, det, used)
    if m.insufficient_reason: return mk("insufficient", m.insufficient_reason)
    if m.fresh_lookup is not True:
        return mk("insufficient", "Lookup was not marked cache-bypassing, so it cannot support a DNS decision.")
    if m.resolved is None or m.query_name is None:
        return mk("insufficient", "Resolver result or query name is missing.")
    if m.query_name != d["expectedQuery"]:
        return mk("insufficient", f"Query was {m.query_name}. This engine only accepts a fresh lookup of {d['expectedQuery']}.")
    if m.time_ms is None: return mk("insufficient", "Lookup time was not reported.")
    resolver = m.resolver or "unspecified resolver"
    if m.resolved:
        if not m.answers: return mk("insufficient", "Lookup was marked resolved with no answers.")
        if m.time_ms > d["failTimeAboveMs"]: return mk("fail", f"Resolved in {m.time_ms} ms, above {d['failTimeAboveMs']} ms.")
        if m.time_ms > d["degradedTimeAboveMs"]: return mk("degraded", f"Resolved in {m.time_ms} ms. Above {d['degradedTimeAboveMs']} ms.")
        return mk("pass", f"Fresh lookup of {m.query_name} via {resolver} in {m.time_ms} ms \u2192 {', '.join(m.answers)}.")
    return mk("fail", f"Fresh lookup of {m.query_name} via {resolver} did not resolve ({m.error or 'no error string'}) after {m.time_ms} ms.")

def classify_loss(m):
    p = T["packetLoss"]
    computed = loss_percent(m.sent, m.received) if (m.sent is not None and m.received is not None and m.sent > 0) else None
    used = {"target": m.target, "sent": m.sent, "received": m.received,
            "reportedLossPct": m.loss_pct,
            "computedLossPct": None if computed is None else js_round(computed * 100) / 100,
            "method": m.method}
    mk = lambda b, d: _a("packet_loss", b, d, used)
    if m.insufficient_reason: return mk("insufficient", m.insufficient_reason)
    if m.sent is None or m.received is None or m.target is None:
        return mk("insufficient", "Sent, received, or target was not reported.")
    if m.received > m.sent or m.sent <= 0: return mk("insufficient", "Sent/received counts are impossible.")
    if m.sent < p["minSent"]: return mk("insufficient", f"Only {m.sent} probes. At least {p['minSent']} are required.")
    loss = loss_percent(m.sent, m.received)
    if m.loss_pct is not None and not _close(m.loss_pct, loss, 0.05):
        return mk("insufficient", f"Reported loss {m.loss_pct}% does not match {js_round(loss*100)/100:.2f}% from {m.received}/{m.sent}.")
    shown = f"{js_round(loss * 10) / 10:.1f}"
    if loss > p["failAbovePct"]:
        return mk("fail", f"{shown}% loss to {m.target} ({m.received} of {m.sent} received). Fail line is above {p['failAbovePct']}%.")
    if loss > p["degradedAbovePct"]:
        return mk("degraded", f"{shown}% loss to {m.target} ({m.received} of {m.sent}). Above {p['degradedAbovePct']}%.")
    return mk("pass", f"{shown}% loss to {m.target} ({m.received} of {m.sent} received).")

def classify_congestion(m):
    c = T["congestion"]
    used = {"target": m.target, "unloadedAttempts": m.unloaded_attempts, "loadedAttempts": m.loaded_attempts,
            "unloadedSamples": m.unloaded_samples, "loadedSamples": m.loaded_samples,
            "unloadedTimeouts": m.unloaded_timeouts, "loadedTimeouts": m.loaded_timeouts,
            "unloadedRttMs": m.unloaded_rtt_ms, "loadedRttMs": m.loaded_rtt_ms}
    mk = lambda b, d: _a("congestion", b, d, used)
    if m.insufficient_reason: return mk("insufficient", m.insufficient_reason)
    counters = [m.unloaded_attempts, m.loaded_attempts, m.unloaded_samples,
                m.loaded_samples, m.unloaded_timeouts, m.loaded_timeouts]
    if any(v is None for v in counters) or m.target is None:
        return mk("insufficient", "Loaded-latency counters are incomplete.")
    ua, la, us, ls, ut, lt = counters
    if ua < c["minAttemptsEach"] or la < c["minAttemptsEach"]:
        return mk("insufficient", f"Need at least {c['minAttemptsEach']} attempts on each side. Got {ua} unloaded and {la} loaded.")
    if us + ut != ua or ls + lt != la or us < 0 or ls < 0:
        return mk("insufficient", "Samples plus timeouts do not add up to attempts.")
    if m.raw_unloaded_ms and len(m.raw_unloaded_ms) != us:
        return mk("insufficient", "Raw unloaded samples do not match the sample count.")
    if m.raw_loaded_ms and len(m.raw_loaded_ms) != ls:
        return mk("insufficient", "Raw loaded samples do not match the sample count.")
    if us == 0 and ls == 0:
        return mk("timeout", f"All {ua} unloaded and {la} loaded probes to {m.target} timed out. No RTT was invented.")
    if m.raw_unloaded_ms and len(m.raw_unloaded_ms) == us and us > 0:
        med = median(m.raw_unloaded_ms)
        if m.unloaded_rtt_ms is None or med is None or not _close(med, m.unloaded_rtt_ms, 0.15):
            return mk("insufficient", "Reported unloaded median does not match raw samples.")
    if m.raw_loaded_ms and len(m.raw_loaded_ms) == ls and ls > 0:
        med = median(m.raw_loaded_ms)
        if m.loaded_rtt_ms is None or med is None or not _close(med, m.loaded_rtt_ms, 0.15):
            return mk("insufficient", "Reported loaded median does not match raw samples.")
    if us == 0 or ls == 0 or m.unloaded_rtt_ms is None or m.loaded_rtt_ms is None:
        return mk("insufficient", "One side completed and the other did not.")
    delta = m.loaded_rtt_ms - m.unloaded_rtt_ms
    d_r = int(js_round(delta))
    if (delta >= c["failDeltaAtLeastMs"] and m.unloaded_rtt_ms <= c["failUnloadedAtMostMs"]
            and m.loaded_rtt_ms >= c["failLoadedAtLeastMs"]):
        return mk("fail", f"Unloaded {m.unloaded_rtt_ms} ms, loaded {m.loaded_rtt_ms} ms, delta {d_r} ms. Matches the loaded-latency fail signature.")
    if (delta >= c["degradedDeltaAtLeastMs"] or m.loaded_rtt_ms >= c["passLoadedBelowMs"]
            or m.unloaded_rtt_ms > c["passUnloadedAtMostMs"]):
        return mk("degraded", f"Unloaded {m.unloaded_rtt_ms} ms, loaded {m.loaded_rtt_ms} ms, delta {d_r} ms. Elevated.")
    return mk("pass", f"Unloaded {m.unloaded_rtt_ms} ms, loaded {m.loaded_rtt_ms} ms, delta {d_r} ms to {m.target}.")

def classify_all(s):
    return {"gateway": classify_gateway(s.gateway), "dns": classify_dns(s.dns),
            "packet_loss": classify_loss(s.packet_loss), "congestion": classify_congestion(s.congestion)}
