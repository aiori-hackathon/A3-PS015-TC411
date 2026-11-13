"""Allowlisted recovery with evidence guards, DNS snapshot, and 120 s watchdog.

Safety layers:
1. Agent started with --allow-changes (default is read-only)
2. Action on the allowlist
3. Fresh measurement (<= 120 s) by THIS agent confirming the targeted fault
4. For DNS: original resolvers saved to disk BEFORE change; read-back confirms applied value
5. 120 s watchdog restores original DNS unless a passing RETEST arrives
6. RESTORE_DNS always works, even in read-only mode (undo only)
"""
import threading, time
from typing import Callable, List, Optional
from ..engine.classify import classify_dns, classify_gateway
from ..thresholds import RECOVERY_DNS
from .dns_backends import BackendError, DnsBackend, DnsState, pick_backend
from .network_actions import reconnect, renew_dhcp
from .state import SnapshotStore

EVIDENCE_TTL_S = 120.0
WATCHDOG_S     = 120.0

class Refused(Exception): pass

class RecoveryController:
    def __init__(self, runner, system, allow_changes, store=None, backend_factory=None,
                 watchdog_s=WATCHDOG_S, clock=time.monotonic):
        self.runner, self.system, self.allow_changes = runner, system, allow_changes
        self.store = store or SnapshotStore()
        self._backend_factory = backend_factory or (lambda: pick_backend(runner, system))
        self.watchdog_s, self.clock = watchdog_s, clock
        self._timer = None; self._dns_fail_at = None; self._gateway_zero_at = None; self.log = []

    def note_measurement(self, m):
        now = self.clock()
        if classify_dns(m.dns)["band"] == "fail":        self._dns_fail_at = now
        elif m.dns.insufficient_reason is None:          self._dns_fail_at = None
        gw = classify_gateway(m.gateway)
        if gw["band"] == "fail" and m.gateway.successes == 0: self._gateway_zero_at = now
        elif m.gateway.insufficient_reason is None:           self._gateway_zero_at = None

    def _fresh(self, ts): return ts is not None and (self.clock() - ts) <= EVIDENCE_TTL_S
    def _need_changes(self, action):
        if not self.allow_changes:
            raise Refused(f"{action} refused. Agent is in read-only mode. Restart with --allow-changes.")
    def pending_snapshot(self): return self.store.load()

    # ── DNS fix ──────────────────────────────────────────────────────────────
    def fix_dns(self):
        self._need_changes("FIX_DNS")
        if not self._fresh(self._dns_fail_at):
            raise Refused("FIX_DNS refused. No DNS failure confirmed in the last 120 s. Run VERIFY_DNS first.")
        if self.store.load() is not None:
            raise Refused("FIX_DNS refused. An earlier DNS change has not been restored. Send RESTORE_DNS first.")
        backend = self._backend_factory(); log = []
        try: before = backend.read()
        except BackendError as e: raise Refused(f"FIX_DNS refused. {e}")
        self.store.save({"backend": backend.name, "target": before.target,
                         "servers": before.servers, "dhcp_supplied": before.dhcp_supplied,
                         "saved_at": time.time()})
        log.append(f"Saved current resolvers {before.servers or '[none]'} on {before.target} to disk before changing anything.")
        try: backend.apply(before, list(RECOVERY_DNS))
        except BackendError as e:
            self._restore_with(backend, before, log); self.store.clear()
            return {"ok": False, "error": f"Applying resolvers failed: {e}. Previous resolvers restored.",
                    "log": log, "applied": None, "saved": before.servers, "flushed": None}
        flushed = backend.flush()
        log.append(f"Applied {' and '.join(RECOVERY_DNS)}. Cache flush {'succeeded' if flushed else 'did not succeed'}.")
        try: applied = backend.read().servers
        except BackendError: applied = None; log.append("Read-back failed.")
        self._arm_watchdog()
        log.append(f"Watchdog armed: resolvers revert in {int(self.watchdog_s)} s unless a RETEST passes.")
        return {"ok": applied is not None,
                "error": None if applied is not None else "Could not confirm applied resolvers.",
                "log": log, "applied": applied, "saved": before.servers, "flushed": flushed}

    def restore_dns(self):
        self._cancel_watchdog(); snap = self.store.load()
        if snap is None:
            return {"ok": True, "error": None, "log": ["No saved resolvers. Nothing to restore."],
                    "applied": None, "saved": None, "flushed": None}
        # restore works even in read-only mode — it only undoes a previous change
        backend = self._backend_factory()
        state = DnsState(snap["target"], snap["servers"], snap["dhcp_supplied"]); log = []
        ok = self._restore_with(backend, state, log)
        if not ok:
            return {"ok": False, "error": "Restore did not complete. Snapshot kept.",
                    "log": log, "applied": None, "saved": state.servers, "flushed": None}
        flushed = backend.flush()
        try: now = backend.read().servers
        except BackendError: now = None
        verified = now is not None and (now == state.servers if state.servers else list(RECOVERY_DNS) != now)
        if verified: self.store.clear(); log.append(f"Restored and verified: {now or '[automatic]'}.")
        else: log.append(f"Read-back shows {now}. Snapshot kept; verify on host.")
        return {"ok": verified, "error": None if verified else "Restore could not be verified.",
                "log": log, "applied": None, "saved": state.servers, "flushed": flushed}

    def _restore_with(self, backend, state, log):
        try: backend.restore(state); return True
        except BackendError as e: log.append(f"Restore error: {e}"); return False

    def retest_passed(self): self._cancel_watchdog()

    def _arm_watchdog(self):
        self._cancel_watchdog()
        self._timer = threading.Timer(self.watchdog_s, self._watchdog_fire)
        self._timer.daemon = True; self._timer.start()

    def _cancel_watchdog(self):
        if self._timer: self._timer.cancel(); self._timer = None

    def _watchdog_fire(self):
        self.log.append("Watchdog: no passing retest. Restoring saved resolvers.")
        self.restore_dns()

    # ── DHCP / reconnect ─────────────────────────────────────────────────────
    def renew_dhcp(self):
        self._need_changes("RENEW_DHCP")
        if not self._fresh(self._gateway_zero_at):
            raise Refused("RENEW_DHCP refused. No 0 gateway replies confirmed in the last 120 s. Run VERIFY_GATEWAY first.")
        try: ok, log = renew_dhcp(self.runner, self.system)
        except BackendError as e:
            return {"ok": False, "error": str(e), "log": [str(e)], "applied": None, "saved": None, "flushed": None}
        return {"ok": ok, "error": None, "log": log, "applied": None, "saved": None, "flushed": None}

    def reconnect(self):
        self._need_changes("RECONNECT_NETWORK")
        if not self._fresh(self._gateway_zero_at):
            raise Refused("RECONNECT_NETWORK refused. No 0 gateway replies confirmed.")
        try: ok, log = reconnect(self.runner, self.system)
        except BackendError as e:
            return {"ok": False, "error": str(e), "log": [str(e)], "applied": None, "saved": None, "flushed": None}
        return {"ok": ok, "error": None, "log": log, "applied": None, "saved": None, "flushed": None}
