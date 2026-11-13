import shutil
from .dns_backends import BackendError, _IFACE, _check, default_iface_linux

def renew_dhcp(runner, system):
    if system == "Windows":
        res = runner.run(["ipconfig", "/renew"], 60); _check(res, "ipconfig /renew")
        return True, ["ipconfig /renew returned success. Retest decides."]
    if system == "Linux":
        iface = default_iface_linux(runner)
        if not iface or not _IFACE.match(iface): raise BackendError("No default interface for renew.")
        if shutil.which("networkctl"):
            res = runner.run(["networkctl", "renew", iface], 30)
            if not res.timed_out and res.returncode == 0:
                return True, [f"networkctl renew {iface} returned success. Retest decides."]
        if shutil.which("nmcli"):
            res = runner.run(["nmcli", "connection", "up", "ifname", iface], 45)
            _check(res, "nmcli connection up")
            return True, [f"nmcli re-activated {iface}. Retest decides."]
        raise BackendError("Neither networkctl nor nmcli available.")
    raise BackendError(f"RENEW_DHCP not implemented for {system}.")

def reconnect(runner, system):
    if system == "Linux" and shutil.which("nmcli"):
        iface = default_iface_linux(runner)
        if not iface: raise BackendError("No default interface.")
        _check(runner.run(["nmcli", "device", "disconnect", iface], 20), "nmcli disconnect")
        _check(runner.run(["nmcli", "device", "connect", iface], 45), "nmcli connect")
        return True, [f"nmcli disconnected and reconnected {iface}."]
    raise BackendError(f"RECONNECT_NETWORK not implemented for {system}.")
