import ipaddress, json, re
from dataclasses import dataclass
from typing import List, Optional
from ..runner import Runner

_IFACE = re.compile(r"^[A-Za-z0-9_.:-]{1,15}$")

class BackendError(Exception): pass

@dataclass
class DnsState:
    target: str; servers: List[str]; dhcp_supplied: bool

def _ips(values):
    out = []
    for v in values:
        try: out.append(str(ipaddress.ip_address(str(v).strip())))
        except ValueError: raise BackendError(f"Non-IP resolver value: {v!r}")
    return out

def _check(res, what):
    if res.timed_out: raise BackendError(f"{what} timed out.")
    if res.returncode != 0:
        raise BackendError(f"{what} failed (exit {res.returncode}): {(res.text.strip().splitlines() or [''])[0][:160]}")

class DnsBackend:
    name = "unsupported"
    def read(self):         raise BackendError("DNS changes unsupported on this platform.")
    def apply(self, s, v):  raise BackendError("DNS changes unsupported.")
    def restore(self, s):   raise BackendError("DNS changes unsupported.")
    def flush(self):        return False

class LinuxResolvedBackend(DnsBackend):
    name = "systemd-resolved"
    def __init__(self, runner, iface):
        if not _IFACE.match(iface): raise BackendError("Interface name failed validation.")
        self.r, self.iface = runner, iface
    def read(self):
        res = self.r.run(["resolvectl", "dns", self.iface], 8); _check(res, "resolvectl dns")
        m = re.search(r"\):(.*)$", res.stdout.strip(), re.S); servers = []
        for tok in (m.group(1).split() if m else []):
            try: servers.append(str(ipaddress.ip_address(tok)))
            except ValueError: raise BackendError(f"Could not parse resolver token {tok!r}.")
        return DnsState(self.iface, servers, False)
    def apply(self, state, servers):
        _check(self.r.run(["resolvectl", "dns", self.iface, *_ips(servers)], 10), "resolvectl dns apply")
    def restore(self, state):
        if state.servers: _check(self.r.run(["resolvectl", "dns", self.iface, *_ips(state.servers)], 10), "resolvectl restore")
        else: _check(self.r.run(["resolvectl", "revert", self.iface], 10), "resolvectl revert")
    def flush(self):
        res = self.r.run(["resolvectl", "flush-caches"], 8); return not res.timed_out and res.returncode == 0

class WindowsBackend(DnsBackend):
    name = "windows-dnsclient"
    def __init__(self, runner): self.r = runner
    def _ps(self, script, what, timeout=20):
        res = self.r.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], timeout)
        _check(res, what); return res
    def read(self):
        res = self._ps(
            "$r=Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0'|Sort-Object RouteMetric|Select-Object -First 1;"
            "$i=$r.InterfaceIndex;$s=@((Get-DnsClientServerAddress -InterfaceIndex $i -AddressFamily IPv4).ServerAddresses);"
            "$n=(Get-ItemProperty -Path \"HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\$((Get-NetAdapter -InterfaceIndex $i).InterfaceGuid)\" -Name NameServer -ErrorAction SilentlyContinue).NameServer;"
            "[pscustomobject]@{index=$i;servers=$s;static=[bool]$n}|ConvertTo-Json -Compress", "Get-DnsClientServerAddress")
        try: doc = json.loads(res.stdout.strip()); idx = int(doc["index"])
        except Exception as e: raise BackendError("Could not parse adapter DNS state.") from e
        servers = doc.get("servers") or []
        return DnsState(str(idx), _ips([servers] if isinstance(servers, str) else servers), not bool(doc.get("static")))
    def apply(self, state, servers):
        idx = int(state.target); q = ",".join(f"'{s}'" for s in _ips(servers))
        self._ps(f"Set-DnsClientServerAddress -InterfaceIndex {idx} -ServerAddresses ({q})", "Set DNS apply")
    def restore(self, state):
        idx = int(state.target)
        if state.dhcp_supplied or not state.servers:
            self._ps(f"Set-DnsClientServerAddress -InterfaceIndex {idx} -ResetServerAddresses", "Reset to DHCP")
        else: self.apply(state, state.servers)
    def flush(self):
        res = self.r.run(["ipconfig", "/flushdns"], 10); return not res.timed_out and res.returncode == 0

def default_iface_linux(runner):
    try:
        with open("/proc/net/route") as fh:
            best = None
            for line in fh.read().splitlines()[1:]:
                f = line.split()
                if len(f) >= 8 and f[1] == "00000000" and int(f[3], 16) & 2:
                    if best is None or int(f[6]) < best[0]: best = (int(f[6]), f[0])
            return best[1] if best else None
    except OSError:
        res = runner.run(["ip", "-4", "route", "show", "default"], 5)
        m = re.search(r"dev (\S+)", res.text); return m.group(1) if m else None

def pick_backend(runner, system):
    if system == "Linux":
        iface = default_iface_linux(runner)
        if not iface: return DnsBackend()
        try: res = runner.run(["resolvectl", "status", iface], 6)
        except Exception: return DnsBackend()
        return LinuxResolvedBackend(runner, iface) if res.returncode == 0 else DnsBackend()
    if system == "Windows": return WindowsBackend(runner)
    return DnsBackend()
