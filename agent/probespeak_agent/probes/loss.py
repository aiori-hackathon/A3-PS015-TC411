import os, time
from typing import Optional
from ..models import PacketLossMeasurement
from ..runner import Runner, RunnerError
from ..stats import js_round, loss_percent
from . import ping
from .gateway import _iso
from .ping import ProbeError

TARGET = os.environ.get("PROBESPEAK_LOSS_TARGET", "1.1.1.1")
SENT = 25; TIMEOUT_S = 1.0

def blank(reason):
    return PacketLossMeasurement(_iso(), "local_agent", f"ICMP echo to {TARGET}", reason, TARGET, None, None, None, [])

def measure(runner, system=None, sent=SENT):
    try: ping.self_check(runner, system)
    except (ProbeError, RunnerError) as e: return blank(str(e))
    at = _iso(); raw = []
    try:
        for i in range(sent):
            r = ping.ping_once(runner, TARGET, TIMEOUT_S, system)
            if r.ok: raw.append(r.rtt_ms)
            if i < sent - 1: time.sleep(0.1)
    except (ProbeError, RunnerError) as e: return blank(str(e))
    received = len(raw)
    return PacketLossMeasurement(
        at, "local_agent", f"ICMP echo to {TARGET} ({sent} probes, system ping)",
        None, TARGET, sent, received,
        js_round(loss_percent(sent, received) * 100) / 100, raw)
