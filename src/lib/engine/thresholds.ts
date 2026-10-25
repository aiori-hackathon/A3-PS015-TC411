/**
 * Single source of truth for the rule engine and the Rules page.
 * Changing a number here changes both the decision and the published threshold.
 */
export const THRESHOLDS = {
  gateway: {
    minAttempts: 3,
    /** Fail when successes/attempts is strictly below this. */
    failSuccessRatioBelow: 0.8,
    failRttAboveMs: 100,
    /** Degraded when RTT is strictly above this and not already a fail. */
    degradedRttAboveMs: 30,
  },
  dns: {
    expectedQuery: "cloudflare.com",
    /** Fail when lookup time is strictly above this, or the name does not resolve. */
    failTimeAboveMs: 500,
    degradedTimeAboveMs: 150,
  },
  packetLoss: {
    minSent: 20,
    /** Fail when loss percent is strictly above this. */
    failAbovePct: 5,
    degradedAbovePct: 1,
    /**
     * At or above this loss, a still-healthy DNS and latency path is treated as
     * ambiguous (ICMP filter can look like total loss). Not used as a cause.
     */
    ambiguousWithHealthyPathPct: 50,
    /** Required loss for the gateway-unreachable constellation. */
    constellationAtLeastPct: 80,
  },
  congestion: {
    minAttemptsEach: 5,
    failDeltaAtLeastMs: 150,
    failUnloadedAtMostMs: 80,
    failLoadedAtLeastMs: 200,
    degradedDeltaAtLeastMs: 40,
    passLoadedBelowMs: 150,
    passUnloadedAtMostMs: 80,
  },
} as const;

export const RECOVERY_DNS = ["1.1.1.1", "1.0.0.1"] as const;

export const AGENT_ORIGIN = "http://127.0.0.1:8765";

export const ALLOWED_ACTIONS = [
  "VERIFY_DNS",
  "FIX_DNS",
  "RESTORE_DNS",
  "VERIFY_GATEWAY",
  "RENEW_DHCP",
  "RECONNECT_NETWORK",
  "VERIFY_PACKET_LOSS",
  "RETEST",
] as const;

export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];
