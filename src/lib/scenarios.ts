import { lossPercent, median } from "./engine/stats.ts";
import type {
  CongestionMeasurement,
  DnsMeasurement,
  GatewayMeasurement,
  MeasurementSet,
  PacketLossMeasurement,
} from "./engine/types.ts";

export interface Scenario {
  id: string;
  title: string;
  situation: string;
  before: MeasurementSet;
  /** Present only when a recovery attempt has a scripted retest capture. */
  retest: MeasurementSet | null;
}

const SRC = "lab" as const;

function gw(
  at: string,
  ip: string | null,
  attempts: number,
  raw: number[],
): GatewayMeasurement {
  return {
    check: "gateway",
    capturedAt: at,
    source: SRC,
    method: "ICMP echo to the default gateway",
    insufficientReason: null,
    gatewayIp: ip,
    attempts,
    successes: raw.length,
    rttMs: raw.length ? median(raw) : null,
    rawRttsMs: raw,
  };
}

function dns(
  at: string,
  opts: {
    resolver: string;
    resolved: boolean;
    timeMs: number;
    answers?: string[];
    error?: string | null;
  },
): DnsMeasurement {
  return {
    check: "dns",
    capturedAt: at,
    source: SRC,
    method: "Fresh lookup of cloudflare.com, cache bypassed",
    insufficientReason: null,
    freshLookup: true,
    queryName: "cloudflare.com",
    resolver: opts.resolver,
    resolved: opts.resolved,
    timeMs: opts.timeMs,
    answers: opts.answers ?? [],
    error: opts.resolved ? null : (opts.error ?? "timeout"),
  };
}

function loss(at: string, sent: number, received: number): PacketLossMeasurement {
  const raw = Array.from({ length: received }, (_, i) => 11 + (i % 5) * 0.4);
  return {
    check: "packet_loss",
    capturedAt: at,
    source: SRC,
    method: "ICMP echo to 1.1.1.1",
    insufficientReason: null,
    target: "1.1.1.1",
    sent,
    received,
    lossPct: Math.round(lossPercent(sent, received) * 100) / 100,
    rawRttsMs: raw,
  };
}

function cong(at: string, unloaded: number[], loaded: number[]): CongestionMeasurement {
  return {
    check: "congestion",
    capturedAt: at,
    source: SRC,
    method: "TCP RTT to 1.1.1.1, idle then during a bulk transfer",
    insufficientReason: null,
    target: "1.1.1.1",
    unloadedAttempts: unloaded.length,
    loadedAttempts: loaded.length,
    unloadedSamples: unloaded.length,
    loadedSamples: loaded.length,
    unloadedTimeouts: 0,
    loadedTimeouts: 0,
    unloadedRttMs: median(unloaded),
    loadedRttMs: median(loaded),
    rawUnloadedMs: unloaded,
    rawLoadedMs: loaded,
  };
}

function congTimeout(at: string, n: number): CongestionMeasurement {
  return {
    check: "congestion",
    capturedAt: at,
    source: SRC,
    method: "TCP RTT to 1.1.1.1, idle then during a bulk transfer",
    insufficientReason: null,
    target: "1.1.1.1",
    unloadedAttempts: n,
    loadedAttempts: n,
    unloadedSamples: 0,
    loadedSamples: 0,
    unloadedTimeouts: n,
    loadedTimeouts: n,
    unloadedRttMs: null,
    loadedRttMs: null,
    rawUnloadedMs: [],
    rawLoadedMs: [],
  };
}

const IDLE = [12, 13, 12.5, 14, 13.5, 12.8, 13.2, 14.1];
const MILD = [24, 26, 25, 28, 27, 26.5, 29, 27.4];
const GW = [1.8, 2.0, 2.1, 2.4];

function set(
  id: string,
  label: string,
  at: string,
  parts: Pick<MeasurementSet, "gateway" | "dns" | "packetLoss" | "congestion">,
): MeasurementSet {
  return { id, label, source: SRC, capturedAt: at, ...parts };
}

function healthy(id: string, label: string, at: string): MeasurementSet {
  return set(id, label, at, {
    gateway: gw(at, "192.168.1.1", 4, GW),
    dns: dns(at, { resolver: "192.168.1.1", resolved: true, timeMs: 18, answers: ["104.16.132.229"] }),
    packetLoss: loss(at, 50, 50),
    congestion: cong(at, IDLE, MILD),
  });
}

function dnsDown(id: string, label: string, at: string): MeasurementSet {
  return set(id, label, at, {
    gateway: gw(at, "192.168.1.1", 4, GW),
    dns: dns(at, { resolver: "192.168.1.1", resolved: false, timeMs: 5000, error: "timeout" }),
    packetLoss: loss(at, 50, 50),
    congestion: cong(at, IDLE, MILD),
  });
}

function gatewayDown(id: string, label: string, at: string): MeasurementSet {
  return set(id, label, at, {
    gateway: gw(at, "192.168.1.1", 4, []),
    dns: dns(at, { resolver: "192.168.1.1", resolved: false, timeMs: 5000, error: "timeout" }),
    packetLoss: loss(at, 50, 0),
    congestion: congTimeout(at, 8),
  });
}

const clean = healthy("clean-before", "Clean fiber capture", "2026-10-25T08:00:00.000Z");

const dnsBefore = dnsDown("dns-before", "Resolver timeout capture", "2026-10-25T08:10:00.000Z");
const dnsAfterOk = healthy("dns-after-ok", "Retest after FIX_DNS", "2026-10-25T08:12:00.000Z");
dnsAfterOk.dns = dns("2026-10-25T08:12:00.000Z", {
  resolver: "1.1.1.1",
  resolved: true,
  timeMs: 21,
  answers: ["104.16.132.229"],
});

const dnsAfterBad = dnsDown("dns-after-bad", "Retest after FIX_DNS still failing", "2026-10-25T08:22:00.000Z");
dnsAfterBad.dns = dns("2026-10-25T08:22:00.000Z", {
  resolver: "1.1.1.1",
  resolved: false,
  timeMs: 5000,
  error: "timeout",
});

const lossBefore = set("loss-before", "Mid-range loss capture", "2026-10-25T08:30:00.000Z", {
  gateway: gw("2026-10-25T08:30:00.000Z", "192.168.1.1", 4, GW),
  dns: dns("2026-10-25T08:30:00.000Z", {
    resolver: "192.168.1.1",
    resolved: true,
    timeMs: 21,
    answers: ["104.16.132.229"],
  }),
  packetLoss: loss("2026-10-25T08:30:00.000Z", 50, 44),
  congestion: cong("2026-10-25T08:30:00.000Z", IDLE, MILD),
});

const bloatUnloaded = [14, 15, 16, 16, 17, 18, 18, 19];
const bloatLoaded = [580, 600, 610, 620, 640, 660, 690, 720];
const bloat = set("bloat-before", "Loaded latency capture", "2026-10-25T08:40:00.000Z", {
  gateway: gw("2026-10-25T08:40:00.000Z", "192.168.1.1", 4, GW),
  dns: dns("2026-10-25T08:40:00.000Z", {
    resolver: "192.168.1.1",
    resolved: true,
    timeMs: 19,
    answers: ["104.16.132.229"],
  }),
  packetLoss: loss("2026-10-25T08:40:00.000Z", 50, 50),
  congestion: cong("2026-10-25T08:40:00.000Z", bloatUnloaded, bloatLoaded),
});

const gwBefore = gatewayDown("gw-before", "Gateway silent capture", "2026-10-25T08:50:00.000Z");
const gwAfterOk = healthy("gw-after-ok", "Retest after RENEW_DHCP", "2026-10-25T08:52:00.000Z");
const gwAfterBad = gatewayDown("gw-after-bad", "Retest after RENEW_DHCP still silent", "2026-10-25T09:02:00.000Z");

const contradiction = set("contra-before", "Disagreeing captures", "2026-10-25T09:10:00.000Z", {
  gateway: gw("2026-10-25T09:10:00.000Z", "192.168.1.1", 4, []),
  dns: dns("2026-10-25T09:10:00.000Z", {
    resolver: "192.168.1.1",
    resolved: true,
    timeMs: 12,
    answers: ["104.16.132.229"],
  }),
  packetLoss: loss("2026-10-25T09:10:00.000Z", 50, 50),
  congestion: cong("2026-10-25T09:10:00.000Z", IDLE, MILD),
});

const shortAt = "2026-10-25T09:20:00.000Z";
const shortSample = set("short-before", "Short loss counter", shortAt, {
  gateway: gw(shortAt, "192.168.1.1", 4, GW),
  dns: dns(shortAt, { resolver: "192.168.1.1", resolved: true, timeMs: 16, answers: ["104.16.132.229"] }),
  packetLoss: loss(shortAt, 8, 8),
  congestion: cong(shortAt, IDLE, MILD),
});

const bothAt = "2026-10-25T09:30:00.000Z";
const both = set("both-before", "DNS timeout with loss", bothAt, {
  gateway: gw(bothAt, "192.168.1.1", 4, GW),
  dns: dns(bothAt, { resolver: "192.168.1.1", resolved: false, timeMs: 5000, error: "timeout" }),
  packetLoss: loss(bothAt, 50, 41),
  congestion: cong(bothAt, IDLE, MILD),
});

const elevAt = "2026-10-25T09:40:00.000Z";
const elevated = set("elev-before", "Elevated but under the fail lines", elevAt, {
  gateway: gw(elevAt, "192.168.1.1", 4, [42, 44, 46, 48]),
  dns: dns(elevAt, { resolver: "192.168.1.1", resolved: true, timeMs: 220, answers: ["104.16.132.229"] }),
  packetLoss: loss(elevAt, 50, 49),
  congestion: cong(elevAt, [18, 19, 20, 20, 21, 21, 22, 22], [88, 90, 91, 92, 92, 94, 95, 96]),
});

const filterAt = "2026-10-25T09:50:00.000Z";
const filter = set("filter-before", "Total ICMP miss beside healthy path samples", filterAt, {
  gateway: gw(filterAt, "192.168.1.1", 4, GW),
  dns: dns(filterAt, { resolver: "192.168.1.1", resolved: true, timeMs: 20, answers: ["104.16.132.229"] }),
  packetLoss: loss(filterAt, 50, 0),
  congestion: cong(filterAt, IDLE, MILD),
});

export const SCENARIOS: Scenario[] = [
  {
    id: "clean-fiber",
    title: "Clean fiber path",
    situation: "Four complete instruments on an idle fiber last mile.",
    before: clean,
    retest: null,
  },
  {
    id: "dns-fix-verifies",
    title: "Resolver timeout, retest passes",
    situation: "Fresh lookup times out. Gateway, loss, and latency look quiet. A later capture is clean.",
    before: dnsBefore,
    retest: dnsAfterOk,
  },
  {
    id: "dns-fix-rolls-back",
    title: "Resolver timeout, retest still fails",
    situation: "Fresh lookup times out. The later capture, taken as if resolvers were 1.1.1.1 and 1.0.0.1, still times out.",
    before: dnsDown("dns-rb-before", "Resolver timeout capture", "2026-10-25T08:20:00.000Z"),
    retest: dnsAfterBad,
  },
  {
    id: "mid-loss",
    title: "Loss beside a quiet path",
    situation: "12% ICMP loss to 1.1.1.1. Gateway, DNS, and loaded latency stay inside the pass band.",
    before: lossBefore,
    retest: null,
  },
  {
    id: "loaded-latency",
    title: "Loaded latency jump",
    situation: "Unloaded RTT stays low. Loaded RTT during a transfer jumps by several hundred milliseconds.",
    before: bloat,
    retest: null,
  },
  {
    id: "gateway-dhcp-clears",
    title: "Gateway silent, later capture is clean",
    situation: "Gateway, DNS, loss, and latency all fail together. A later capture after a DHCP attempt is clean.",
    before: gwBefore,
    retest: gwAfterOk,
  },
  {
    id: "gateway-dhcp-fails",
    title: "Gateway silent, later capture still silent",
    situation: "Same four-way silence. The later capture is still silent.",
    before: gatewayDown("gw-bad-before", "Gateway silent capture", "2026-10-25T09:00:00.000Z"),
    retest: gwAfterBad,
  },
  {
    id: "contradictory",
    title: "Gateway silent, path samples succeed",
    situation: "Gateway counter is 0 replies. A fresh DNS lookup and the loss counter both succeed.",
    before: contradiction,
    retest: null,
  },
  {
    id: "short-sample",
    title: "Loss counter stopped early",
    situation: "Loss counter has 8 probes. The other three instruments completed.",
    before: shortSample,
    retest: null,
  },
  {
    id: "dns-and-loss",
    title: "Lookup timeout and loss together",
    situation: "Fresh lookup times out and ICMP loss is 18% in the same window.",
    before: both,
    retest: null,
  },
  {
    id: "under-line",
    title: "Elevated, under the fail lines",
    situation: "Gateway RTT, DNS time, loss, and loaded delta are all somewhat high.",
    before: elevated,
    retest: null,
  },
  {
    id: "icmp-filter",
    title: "Total ICMP miss, other samples fine",
    situation: "Every ICMP probe to 1.1.1.1 is missing. DNS and latency samples to the same address succeeded.",
    before: filter,
    retest: null,
  },
];

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
}
