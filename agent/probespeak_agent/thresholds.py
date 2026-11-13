"""Numbers MUST equal src/lib/engine/thresholds.ts. tests/test_parity.py enforces this."""
THRESHOLDS = {
    "gateway": {"minAttempts": 3, "failSuccessRatioBelow": 0.8, "failRttAboveMs": 100, "degradedRttAboveMs": 30},
    "dns": {"expectedQuery": "cloudflare.com", "failTimeAboveMs": 500, "degradedTimeAboveMs": 150},
    "packetLoss": {"minSent": 20, "failAbovePct": 5, "degradedAbovePct": 1, "ambiguousWithHealthyPathPct": 50, "constellationAtLeastPct": 80},
    "congestion": {"minAttemptsEach": 5, "failDeltaAtLeastMs": 150, "failUnloadedAtMostMs": 80, "failLoadedAtLeastMs": 200, "degradedDeltaAtLeastMs": 40, "passLoadedBelowMs": 150, "passUnloadedAtMostMs": 80},
}
RECOVERY_DNS = ("1.1.1.1", "1.0.0.1")
AGENT_HOST = "127.0.0.1"
AGENT_PORT = 8765
ALLOWED_ACTIONS = ("VERIFY_DNS","FIX_DNS","RESTORE_DNS","VERIFY_GATEWAY","RENEW_DHCP","RECONNECT_NETWORK","VERIFY_PACKET_LOSS","RETEST")
