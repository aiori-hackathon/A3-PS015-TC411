import assert from "node:assert/strict";
import test from "node:test";
import { diagnose } from "./diagnose.ts";
import { decideRecoveryOutcome } from "./outcome.ts";
import { SCENARIOS } from "../scenarios.ts";

const expectFinding: Record<string, string> = {
  "clean-fiber": "NO_FAULT",
  "dns-fix-verifies": "DNS_RESOLVER_FAILURE",
  "dns-fix-rolls-back": "DNS_RESOLVER_FAILURE",
  "mid-loss": "SIGNIFICANT_PACKET_LOSS",
  "loaded-latency": "LOADED_LATENCY_INFLATION",
  "gateway-dhcp-clears": "GATEWAY_UNREACHABLE",
  "gateway-dhcp-fails": "GATEWAY_UNREACHABLE",
  contradictory: "NONE",
  "short-sample": "NONE",
  "dns-and-loss": "NONE",
  "under-line": "NONE",
  "icmp-filter": "NONE",
};

test("every lab scenario gets the finding the evidence supports", () => {
  for (const scenario of SCENARIOS) {
    const d = diagnose(scenario.before);
    assert.equal(d.finding, expectFinding[scenario.id], scenario.id);
    assert.notEqual(d.preliminary, "resolved");
    if (d.finding === "NONE") assert.equal(d.recovery, null);
    if (d.finding === "DNS_RESOLVER_FAILURE") assert.equal(d.recovery, "FIX_DNS");
    if (d.finding === "GATEWAY_UNREACHABLE") assert.equal(d.recovery, "RENEW_DHCP");
    if (d.finding === "SIGNIFICANT_PACKET_LOSS" || d.finding === "LOADED_LATENCY_INFLATION") {
      assert.equal(d.recovery, null);
    }
  }
});

test("resolved is impossible unless the retest is clean", () => {
  const dns = SCENARIOS.find((s) => s.id === "dns-fix-verifies")!;
  const ok = diagnose(dns.retest!);
  const kept = decideRecoveryOutcome("FIX_DNS", ok);
  assert.equal(kept.verdict, "resolved");
  assert.equal(kept.rollback, false);

  const badScenario = SCENARIOS.find((s) => s.id === "dns-fix-rolls-back")!;
  const rolled = decideRecoveryOutcome("FIX_DNS", diagnose(badScenario.retest!));
  assert.equal(rolled.verdict, "unresolved");
  assert.equal(rolled.rollback, true);

  const gw = SCENARIOS.find((s) => s.id === "gateway-dhcp-clears")!;
  const gwOk = decideRecoveryOutcome("RENEW_DHCP", diagnose(gw.retest!));
  assert.equal(gwOk.verdict, "resolved");
  assert.equal(gwOk.rollback, false);

  const gwBad = SCENARIOS.find((s) => s.id === "gateway-dhcp-fails")!;
  const gwFail = decideRecoveryOutcome("RENEW_DHCP", diagnose(gwBad.retest!));
  assert.equal(gwFail.verdict, "unresolved");
  assert.equal(gwFail.rollback, false);
});

test("a tampered loss percentage is not diagnosed", () => {
  const scenario = SCENARIOS.find((s) => s.id === "mid-loss")!;
  const tampered = structuredClone(scenario.before);
  tampered.packetLoss.lossPct = 0;
  const d = diagnose(tampered);
  assert.equal(d.finding, "NONE");
  assert.equal(d.preliminary, "inconclusive");
});
