"""Guards against Python engine drifting from the TypeScript engine."""
import re
from pathlib import Path

import pytest

from probespeak_agent.thresholds import ALLOWED_ACTIONS, RECOVERY_DNS, THRESHOLDS

REPO = Path(__file__).resolve().parents[2]
TS_THRESHOLDS = REPO / "src/lib/engine/thresholds.ts"
pytestmark = pytest.mark.skipif(
    not TS_THRESHOLDS.exists(), reason="console sources not present")


def _ts_block(name):
    text = TS_THRESHOLDS.read_text()
    m = re.search(rf"\b{name}:\s*\{{(.*?)\n  \}}", text, re.S)
    assert m, f"block {name} not found"
    return m.group(1)


@pytest.mark.parametrize("group", list(THRESHOLDS))
def test_thresholds_match_typescript(group):
    found = {}
    for k, v in re.findall(r"^\s*(\w+):\s*(\"[^\"]*\"|[0-9.]+),", _ts_block(group), re.M):
        found[k] = v.strip('"') if v.startswith('"') else float(v)
    expected = {k: (v if isinstance(v, str) else float(v)) for k, v in THRESHOLDS[group].items()}
    assert found == expected, f"mismatch in {group}: {found} != {expected}"


def test_actions_match_typescript():
    text = TS_THRESHOLDS.read_text()
    ts_actions = tuple(re.findall(r'"([A-Z_]+)",', text.split("ALLOWED_ACTIONS")[1].split("] as const")[0]))
    assert ts_actions == ALLOWED_ACTIONS


def test_recovery_dns_match_typescript():
    text = TS_THRESHOLDS.read_text()
    ts_dns = tuple(re.findall(r'"([0-9.]+)"', text.split("RECOVERY_DNS")[1].split("] as const")[0]))
    assert ts_dns == RECOVERY_DNS
