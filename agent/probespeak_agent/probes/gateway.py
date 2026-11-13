import ipaddress, re, time
from typing import Optional
from ..models import GatewayMeasurement
from ..runner import Runner, RunnerError
from ..stats import median
from . import ping
from .ping import ProbeError

ATTEMPTS = 5; TIMEOUT_S = 1.0

def _iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int((time.time() % 1) * 1000):03d}Z"

def default_gateway(runner, system=None):
    system = system or ping.system_name(); ip = None
    if system == "Linux":
        try:
            with open("/proc/net/route") as fh:
                best = None
                for line in fh.read().splitlines()[1:]:
                    f = line.split()
                    if len(f) >= 8 and f[1] == "00000000" and int(f[3], 16) & 2:
                        m = int(f[6]); g = ".".join(str(int(f[2][i:i+2], 16)) for i in (6,4,2,0))
                        if best is None or m < best[0]: best = (m, g)
                ip = best[1] if best else None
        except OSError: pass
        if ip is None:
            res = runner.run(["ip", "-4", "route", "show", "default"], 5)
            m = re.search(r"default via (\d+\.\d+\.\d+\.\d+)", res.text); ip = m.group(1) if m else None
    elif system == "Windows":
        res = runner.run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                          "(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0'"
                          "|Sort-Object RouteMetric|Select-Object -First 1).NextHop"], 15)
        ip = res.stdout.strip().splitlines()[0].strip() if res.stdout.strip() else None
    elif system == "Darwin":
        res = runner.run(["route", "-n", "get", "default"], 5)
        m = re.search(r"gateway:\s*(\d+\.\d+\.\d+\.\d+)", res.text); ip = m.group(1) if m else None
    if ip is None: return None
    try: ok = ipaddress.ip_address(ip)
    except ValueError: return None
    return ip if ok.version == 4 and not ok.is_unspecified else None

def blank(reason, ip=None):
    return GatewayMeasurement(_iso(), "local_agent", "ICMP echo to the default gateway", reason, ip, None, None, None, [])

def measure(runner, system=None):
    try: ping.self_check(runner, system); ip = default_gateway(runner, system)
    except (ProbeError, RunnerError) as e: return blank(str(e))
    if ip is None: return blank("No default IPv4 gateway found.")
    at = _iso(); raw = []
    try:
        for i in range(ATTEMPTS):
            r = ping.ping_once(runner, ip, TIMEOUT_S, system)
            if r.ok: raw.append(r.rtt_ms)
            if i < ATTEMPTS - 1: time.sleep(0.1)
    except (ProbeError, RunnerError) as e: return blank(str(e), ip)
    return GatewayMeasurement(at, "local_agent",
                              f"ICMP echo to the default gateway ({ATTEMPTS} probes, system ping)",
                              None, ip, ATTEMPTS, len(raw), median(raw) if raw else None, raw)
