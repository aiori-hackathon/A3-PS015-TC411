import os, socket, threading, time, urllib.request
from typing import List, Optional, Tuple
from ..models import CongestionMeasurement
from ..stats import median
from .gateway import _iso

TARGET   = os.environ.get("PROBESPEAK_CONG_TARGET", "1.1.1.1")
PORT     = 443
LOAD_URL = os.environ.get("PROBESPEAK_LOAD_URL", "https://speed.cloudflare.com/__down?bytes=100000000")
ATTEMPTS = 6; CONNECT_TIMEOUT_S = 1.0; SPACING_S = 0.2
LOAD_STREAMS = 4; RAMP_S = 1.2; MIN_LOAD_BYTES = 1_000_000; MAX_LOAD_S = 15

def tcp_rtt(host=TARGET, port=PORT, timeout_s=CONNECT_TIMEOUT_S):
    t0 = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout_s): pass
    except ConnectionRefusedError: pass
    except OSError: return None
    return round((time.perf_counter() - t0) * 1000, 1)

def _series(n, probe=tcp_rtt):
    got, timeouts = [], 0
    for i in range(n):
        v = probe()
        if v is None: timeouts += 1
        else: got.append(v)
        if i < n - 1: time.sleep(SPACING_S)
    return got, timeouts

class Load:
    def __init__(self, url=LOAD_URL, streams=LOAD_STREAMS):
        self.url, self.streams, self.bytes = url, streams, 0
        self._lock = threading.Lock(); self._stop = threading.Event(); self._threads = []
    def _run(self):
        deadline = time.monotonic() + MAX_LOAD_S
        try:
            req = urllib.request.Request(self.url, headers={"User-Agent": "probespeak-agent"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                while not self._stop.is_set() and time.monotonic() < deadline:
                    chunk = resp.read(65536)
                    if not chunk: break
                    with self._lock: self.bytes += len(chunk)
        except Exception: pass
    def __enter__(self):
        for _ in range(self.streams):
            t = threading.Thread(target=self._run, daemon=True); t.start(); self._threads.append(t)
        return self
    def __exit__(self, *a):
        self._stop.set(); [t.join(2) for t in self._threads]

def blank(reason):
    return CongestionMeasurement(_iso(), "local_agent", "TCP connect RTT to 1.1.1.1:443",
                                 reason, TARGET, None, None, None, None, None, None, None, None, [], [])

def measure(probe=tcp_rtt, load_factory=Load, attempts=ATTEMPTS):
    at = _iso(); unloaded, ut = _series(attempts, probe)
    load = load_factory()
    with load:
        time.sleep(RAMP_S); loaded, lt = _series(attempts, probe); moved = load.bytes
    all_timed_out = not unloaded and not loaded
    if moved < MIN_LOAD_BYTES and not all_timed_out:
        return blank(f"Load generator moved only {moved} bytes (needs {MIN_LOAD_BYTES}). Loaded samples not valid.")
    method = (f"TCP connect RTT to {TARGET}:{PORT}, idle then during a {LOAD_STREAMS}-stream download "
              f"({moved/1e6:.1f} MB; downlink only)")
    return CongestionMeasurement(at, "local_agent", method, None, TARGET,
                                 attempts, attempts, len(unloaded), len(loaded), ut, lt,
                                 median(unloaded) if unloaded else None,
                                 median(loaded) if loaded else None, unloaded, loaded)
