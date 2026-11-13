# ProbeSpeak — local agent (Python / FastAPI)

The measuring-and-recovery backend for ProbeSpeak (PS-015, AIORI-3).  
Listens on **`127.0.0.1:8765`** — the address the console's Live mode already expects.

```
Measure → Explain with evidence → Ask permission → Safe recovery → Retest → Verify
```

If evidence is missing, contradictory, or insufficient → **Inconclusive**.  
**Resolved** only after a retest where every check passes.

---

## Quick start (macOS / Linux)

```bash
cd agent
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# read-only (measures, never changes the device)
python3 -m probespeak_agent serve

# permits FIX_DNS, RENEW_DHCP, RECONNECT_NETWORK
python3 -m probespeak_agent serve --allow-changes
```

Then open the console (`npm install && npm run dev` from the repo root, port 8080) and switch to **Live mode**.

---

## What it measures

| Check | Instrument | Min samples |
|---|---|---|
| Gateway | ICMP echos to default gateway (system `ping`) | 3 of 5 |
| DNS | Direct UDP A query for `cloudflare.com` (dnspython, bypasses OS cache) | 1 |
| Packet loss | ICMP echos to `1.1.1.1` | 20 of 25 |
| Congestion | TCP connect RTT idle vs during a 4-stream bulk download | 5 each side |

---

## Safety layers (what no competitor has)

1. **Read-only by default** — `--allow-changes` required to touch the device
2. **Evidence guards** — FIX_DNS needs a DNS failure confirmed by THIS agent in the last 120 s; RENEW_DHCP needs 0 gateway replies
3. **DNS snapshot first** — original resolvers saved to `~/.probespeak/dns_snapshot.json` BEFORE any change
4. **Read-back, not intent** — `applied` in the response is what was read back after the change
5. **120 s watchdog** — auto-restores DNS if no passing RETEST arrives
6. **RESTORE_DNS always works** — even in read-only mode (undo only)
7. **No arbitrary shell** — fixed argv, executable allowlist, nothing from HTTP reaches argv

---

## CLI commands

```bash
python3 -m probespeak_agent scenarios          # list all 12 lab scenarios
python3 -m probespeak_agent scenario <id>      # run one with full rule trace
python3 -m probespeak_agent lab-all            # all 12, check expected verdicts
python3 -m probespeak_agent live               # one live read-only RETEST
```

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health document (matches console's `probeAgent()` contract) |
| POST | `/action` | Run one allowlisted action |
| POST | `/diagnose` | Feed any measurement document, get the rule engine's verdict |
| GET | `/thresholds` | Decision thresholds (matches `thresholds.ts`) |
| GET | `/scenarios` | List all 12 lab scenarios |
| GET | `/lab/run/{id}` | Run one lab scenario (no device changes) |
