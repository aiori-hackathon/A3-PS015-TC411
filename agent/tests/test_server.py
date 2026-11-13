import pytest
from fastapi.testclient import TestClient
from probespeak_agent import measure
from probespeak_agent.actions import ActionHandler
from probespeak_agent.models import MeasurementSet, to_wire
from probespeak_agent.recovery.controller import RecoveryController
from probespeak_agent.recovery.dns_backends import BackendError, DnsBackend, DnsState
from probespeak_agent.recovery.state import SnapshotStore
from probespeak_agent.scenarios import scenario_by_id, dns, gw, healthy, loss, cong, IDLE, MILD, GW
from probespeak_agent.server import create_app
from probespeak_agent.thresholds import ALLOWED_ACTIONS, RECOVERY_DNS

ORIGINAL = ["192.168.1.1"]

class FakeBackend(DnsBackend):
    name = "fake"
    def __init__(self, servers=None): self.servers = list(servers or ORIGINAL); self.calls = []
    def read(self):                   self.calls.append("read"); return DnsState("eth0", list(self.servers), False)
    def apply(self, state, servers):  self.calls.append("apply"); self.servers = list(servers)
    def restore(self, state):         self.calls.append("restore"); self.servers = list(state.servers)
    def flush(self):                  self.calls.append("flush"); return True

def dns_fail_set():
    at = "2026-11-01T00:00:00.000Z"
    return MeasurementSet("m", "t", "local_agent", at,
                          gw(at, "192.168.1.1", 4, GW), dns(at, "192.168.1.1", False, 5000),
                          loss(at, 50, 50), cong(at, IDLE, MILD))

def healthy_set():
    s = healthy("m", "t", "2026-11-01T00:00:00.000Z", resolver="1.1.1.1")
    s.source = "local_agent"; return s

@pytest.fixture
def client(tmp_path):
    be = FakeBackend()
    ctl = RecoveryController(None, "Linux", True, SnapshotStore(tmp_path), lambda: be, watchdog_s=60)
    c = TestClient(create_app(ActionHandler(controller=ctl, runner=object()), port=8765),
                   base_url="http://127.0.0.1:8765")
    c.be, c.ctl = be, ctl
    return c

def test_health(client):
    b = client.get("/health").json()
    assert b["ok"] and b["name"] == "probespeak-agent"
    assert b["bind"] == "127.0.0.1:8765"
    assert set(ALLOWED_ACTIONS) <= set(b["actions"])

def test_action_shape(client, monkeypatch):
    monkeypatch.setattr(measure, "verify_dns",
                        lambda runner: measure._partial("VERIFY_DNS", dns=dns_fail_set().dns))
    r = client.post("/action", json={"action": "VERIFY_DNS"}).json()
    assert r["ok"] and r["action"] == "VERIFY_DNS"
    assert r["measurement"]["dns"]["check"] == "dns"
    assert r["measurement"]["gateway"]["insufficientReason"]  # unmeasured = explicit insufficient

def test_full_closed_loop(client, monkeypatch):
    monkeypatch.setattr(measure, "verify_dns",
                        lambda runner: measure._partial("VERIFY_DNS", dns=dns_fail_set().dns))
    monkeypatch.setattr(measure, "full",
                        lambda runner, system=None, label="RETEST": healthy_set())
    assert client.post("/action", json={"action": "VERIFY_DNS"}).json()["ok"]
    fix = client.post("/action", json={"action": "FIX_DNS"}).json()
    assert fix["ok"] and fix["applied"] == list(RECOVERY_DNS) and fix["saved"] == ORIGINAL
    retest = client.post("/action", json={"action": "RETEST"}).json()
    assert retest["ok"] and retest["measurement"]["dns"]["resolver"] == "1.1.1.1"

def test_bad_requests(client):
    assert client.post("/action", json={"action": "RUN_SHELL"}).status_code == 400
    assert client.get("/nope").status_code == 404

def test_host_guard(client):
    assert client.get("/health", headers={"host": "evil.example:8765"}).status_code == 403

def test_origin_guard(client):
    r = client.post("/action", json={"action": "FIX_DNS"},
                    headers={"origin": "https://evil.example"})
    assert r.status_code == 403 and client.be.calls == []

def test_read_only_mode(tmp_path):
    ctl = RecoveryController(None, "Linux", False, SnapshotStore(tmp_path), lambda: FakeBackend(), watchdog_s=60)
    c = TestClient(create_app(ActionHandler(controller=ctl, runner=object()), port=8765),
                   base_url="http://127.0.0.1:8765")
    ctl.note_measurement(dns_fail_set())
    assert "read-only" in c.post("/action", json={"action": "FIX_DNS"}).json()["error"]

def test_lab_and_diagnose(client):
    wire = to_wire(scenario_by_id("mid-loss").before)
    d = client.post("/diagnose", json=wire).json()
    assert d["diagnosis"]["finding"] == "SIGNIFICANT_PACKET_LOSS"
    r = client.get("/lab/run/dns-fix-rolls-back").json()
    assert r["verdict"] == "unresolved" and r["deviceChanged"] is False
    assert len(client.get("/scenarios").json()) >= 6
