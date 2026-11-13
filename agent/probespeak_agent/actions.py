import threading
from typing import Optional
from . import measure
from .engine.diagnose import diagnose
from .models import to_wire
from .probes import ping
from .recovery.controller import Refused, RecoveryController
from .runner import Runner
from .thresholds import ALLOWED_ACTIONS

def _result(action, ok, error=None, log=None, measurement=None, applied=None, saved=None, flushed=None):
    return {"ok": ok, "action": action, "error": error, "log": log or [],
            "measurement": to_wire(measurement) if measurement is not None else None,
            "applied": applied, "saved": saved, "flushed": flushed}

class ActionHandler:
    def __init__(self, runner=None, allow_changes=False, controller=None, system=None):
        self.runner = runner or Runner()
        self.system = system or ping.system_name()
        self.controller = controller or RecoveryController(self.runner, self.system, allow_changes)
        self._lock = threading.Lock()

    @property
    def allow_changes(self): return self.controller.allow_changes

    def handle(self, action):
        if action not in ALLOWED_ACTIONS:
            return _result(str(action), False, "Action is not allowlisted.")
        if not self._lock.acquire(blocking=False):
            return _result(action, False, "Another action is still running.")
        try: return self._dispatch(action)
        finally: self._lock.release()

    def _measured(self, action, m, extra_log=None):
        self.controller.note_measurement(m)
        return _result(action, True, None, extra_log or [], measurement=m)

    def _dispatch(self, action):
        c = self.controller
        try:
            if action == "VERIFY_DNS":
                return self._measured(action, measure.verify_dns(self.runner),
                                      ["Fresh cloudflare.com lookup."])
            if action == "VERIFY_GATEWAY":
                return self._measured(action, measure.verify_gateway(self.runner, self.system),
                                      ["ICMP probes to the default gateway."])
            if action == "VERIFY_PACKET_LOSS":
                return self._measured(action, measure.verify_packet_loss(self.runner, self.system),
                                      ["Counted ICMP series to the loss target."])
            if action == "RETEST":
                m = measure.full(self.runner, self.system)
                c.note_measurement(m); diag = diagnose(m)
                if diag["finding"] == "NO_FAULT": c.retest_passed()
                return _result(action, True, None,
                               ["All four instruments ran.",
                                f"Engine: {diag['summary']}"], measurement=m)
            if action == "FIX_DNS":
                r = c.fix_dns()
                return _result(action, r["ok"], r["error"], r["log"], None, r["applied"], r["saved"], r["flushed"])
            if action == "RESTORE_DNS":
                r = c.restore_dns()
                return _result(action, r["ok"], r["error"], r["log"], None, r["applied"], r["saved"], r["flushed"])
            if action == "RENEW_DHCP":
                r = c.renew_dhcp()
                return _result(action, r["ok"], r["error"], r["log"])
            if action == "RECONNECT_NETWORK":
                r = c.reconnect()
                return _result(action, r["ok"], r["error"], r["log"])
        except Refused as e:
            return _result(action, False, str(e), ["Refused. Nothing was modified."])
        except Exception as e:
            return _result(action, False,
                           f"{action} failed unexpectedly: {type(e).__name__}. Nothing is marked Resolved.",
                           ["Unexpected failure. Verify on host."])
        return _result(action, False, "Unhandled action.")
