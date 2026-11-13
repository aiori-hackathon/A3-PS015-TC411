import time
from typing import List, Optional
import dns.exception, dns.resolver
from ..models import DnsMeasurement
from ..thresholds import THRESHOLDS
from .gateway import _iso

QUERY = THRESHOLDS["dns"]["expectedQuery"]
METHOD = "Direct UDP A query (dnspython). Bypasses OS cache."

def system_resolvers():
    try: r = dns.resolver.Resolver(configure=True); return [str(n) for n in r.nameservers]
    except Exception: return []

def _err(e):
    if isinstance(e, dns.resolver.NXDOMAIN): return "NXDOMAIN"
    if isinstance(e, (dns.resolver.LifetimeTimeout, dns.exception.Timeout)): return "timeout"
    if isinstance(e, dns.resolver.NoNameservers): return "SERVFAIL/REFUSED"
    return type(e).__name__

def query_once(server, timeout_s=3.0):
    r = dns.resolver.Resolver(configure=False)
    r.nameservers = [server]; r.timeout = timeout_s; r.lifetime = timeout_s; r.cache = None
    return [a.to_text() for a in r.resolve(QUERY, "A", raise_on_no_answer=True)]

def measure(resolvers: Optional[List[str]] = None):
    at = _iso(); servers = resolvers if resolvers is not None else system_resolvers()
    if not servers:
        return DnsMeasurement(at, "local_agent", METHOD, "No system resolver found.",
                              None, None, None, None, None, [], None)
    started = time.perf_counter(); last_err = "timeout"
    for server in servers:
        try:
            answers = query_once(server)
            ms = round((time.perf_counter() - started) * 1000, 1)
            return DnsMeasurement(at, "local_agent", METHOD, None, True, QUERY, server, True, ms, answers, None)
        except Exception as e: last_err = _err(e)
    ms = round((time.perf_counter() - started) * 1000, 1)
    return DnsMeasurement(at, "local_agent", METHOD, None, True, QUERY, ", ".join(servers), False, ms, [], last_err)
