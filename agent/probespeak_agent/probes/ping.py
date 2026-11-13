import ipaddress, platform, re
from dataclasses import dataclass
from typing import Optional
from ..runner import Runner, RunnerError

_RTT = re.compile(r"[=<]\s*([0-9]+(?:[.,][0-9]+)?)\s*ms", re.I)
_TOOL_ERRORS = re.compile(
    r"not permitted|permission denied|operation not|unknown host|could not find|"
    r"usage:|invalid|general failure|transmit failed", re.I)

class ProbeError(Exception): pass

@dataclass
class PingReply:
    ok: bool; rtt_ms: Optional[float]

def system_name(): return platform.system()

def build_argv(host, timeout_s, system=None):
    ip = ipaddress.ip_address(host)
    if ip.version != 4: raise ValueError("Only IPv4 literals are accepted.")
    system = system or system_name()
    if system == "Windows": return ["ping", "-n", "1", "-w", str(int(timeout_s * 1000)), host]
    if system == "Darwin":  return ["ping", "-n", "-c", "1", "-W", str(int(timeout_s * 1000)), host]
    return ["ping", "-n", "-c", "1", "-W", str(max(1, int(round(timeout_s)))), host]

def parse_reply(text, returncode):
    low = text.lower(); has_ttl = "ttl=" in low
    if returncode == 0 and has_ttl:
        m = _RTT.search(text)
        if not m: raise ProbeError("Reply seen but RTT could not be parsed.")
        rtt = float(m.group(1).replace(",", "."))
        return PingReply(True, max(rtt, 1.0) if "<" in m.group(0) else rtt)
    if has_ttl: raise ProbeError("Reply text with non-zero exit code. Result not trusted.")
    if _TOOL_ERRORS.search(text):
        raise ProbeError("ping failed as a tool: " + text.strip().splitlines()[0][:120])
    return PingReply(False, None)

def ping_once(runner, host, timeout_s=1.0, system=None):
    argv = build_argv(host, timeout_s, system)
    try: res = runner.run(argv, timeout=timeout_s + 3)
    except RunnerError as e: raise ProbeError(str(e)) from e
    if res.timed_out: return PingReply(False, None)
    return parse_reply(res.text, res.returncode)

def self_check(runner, system=None):
    r = ping_once(runner, "127.0.0.1", 1.0, system)
    if not r.ok: raise ProbeError("Loopback ping failed. The ping tool is not usable on this host.")
