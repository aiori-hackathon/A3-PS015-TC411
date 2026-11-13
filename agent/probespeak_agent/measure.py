from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional
from .models import MeasurementSet, blank_congestion, blank_dns, blank_gateway, blank_loss
from .probes import congestion, dns_probe, gateway, loss
from .runner import Runner

NOT_MEASURED = "Not measured by this action. No number was invented."

def _now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def _partial(label, **parts):
    at = _now(); s = "local_agent"
    return MeasurementSet(f"agent-{at}", label, s, at,
        parts.get("gateway")     or blank_gateway(at, s, NOT_MEASURED),
        parts.get("dns")         or blank_dns(at, s, NOT_MEASURED),
        parts.get("packet_loss") or blank_loss(at, s, NOT_MEASURED),
        parts.get("congestion")  or blank_congestion(at, s, NOT_MEASURED))

def verify_dns(runner):         return _partial("VERIFY_DNS",         dns=dns_probe.measure())
def verify_gateway(runner, system=None): return _partial("VERIFY_GATEWAY",  gateway=gateway.measure(runner, system))
def verify_packet_loss(runner, system=None): return _partial("VERIFY_PACKET_LOSS", packet_loss=loss.measure(runner, system))

def full(runner, system=None, label="RETEST"):
    """Gateway, DNS and loss run concurrently; congestion runs last (bulk transfer)."""
    with ThreadPoolExecutor(3) as ex:
        fg = ex.submit(gateway.measure, runner, system)
        fd = ex.submit(dns_probe.measure)
        fp = ex.submit(loss.measure, runner, system)
        g, d, p = fg.result(), fd.result(), fp.result()
    c = congestion.measure()
    return _partial(label, gateway=g, dns=d, packet_loss=p, congestion=c)
