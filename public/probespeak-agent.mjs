/**
 * ProbeSpeak reference agent.
 * Binds 127.0.0.1:8765 only.
 * Measures DNS with node:dns. Does not invent gateway, loss, or latency numbers.
 * Refuses FIX_DNS, RENEW_DHCP, and RECONNECT_NETWORK. Never runs a shell command.
 *
 *   node probespeak-agent.mjs
 */
import http from "node:http";
import dns from "node:dns/promises";

const HOST = "127.0.0.1";
const PORT = 8765;
const ACTIONS = [
  "VERIFY_DNS",
  "FIX_DNS",
  "RESTORE_DNS",
  "VERIFY_GATEWAY",
  "RENEW_DHCP",
  "RECONNECT_NETWORK",
  "VERIFY_PACKET_LOSS",
  "RETEST",
];

function blank(check, reason) {
  const now = new Date().toISOString();
  const common = {
    capturedAt: now,
    source: "local_agent",
    method: "not measured",
    insufficientReason: reason,
  };
  if (check === "gateway") {
    return { ...common, check, gatewayIp: null, attempts: null, successes: null, rttMs: null, rawRttsMs: [] };
  }
  if (check === "dns") {
    return {
      ...common,
      check,
      freshLookup: null,
      queryName: null,
      resolver: null,
      resolved: null,
      timeMs: null,
      answers: [],
      error: null,
    };
  }
  if (check === "packet_loss") {
    return { ...common, check, target: null, sent: null, received: null, lossPct: null, rawRttsMs: [] };
  }
  return {
    ...common,
    check: "congestion",
    target: null,
    unloadedAttempts: null,
    loadedAttempts: null,
    unloadedSamples: null,
    loadedSamples: null,
    unloadedTimeouts: null,
    loadedTimeouts: null,
    unloadedRttMs: null,
    loadedRttMs: null,
    rawUnloadedMs: [],
    rawLoadedMs: [],
  };
}

async function dnsMeasurement() {
  const started = Date.now();
  const now = new Date().toISOString();
  try {
    const answers = await dns.resolve4("cloudflare.com");
    return {
      check: "dns",
      capturedAt: now,
      source: "local_agent",
      method: "node:dns.resolve4",
      insufficientReason: null,
      freshLookup: true,
      queryName: "cloudflare.com",
      resolver: "system",
      resolved: answers.length > 0,
      timeMs: Date.now() - started,
      answers,
      error: null,
    };
  } catch (error) {
    return {
      check: "dns",
      capturedAt: now,
      source: "local_agent",
      method: "node:dns.resolve4",
      insufficientReason: null,
      freshLookup: true,
      queryName: "cloudflare.com",
      resolver: "system",
      resolved: false,
      timeMs: Date.now() - started,
      answers: [],
      error: error && error.code ? String(error.code) : "lookup failed",
    };
  }
}

async function measurement(includeDns) {
  const now = new Date().toISOString();
  const reason = "Reference agent has no packet socket and will not invent this number.";
  return {
    id: `agent-${now}`,
    label: "Reference agent",
    source: "local_agent",
    capturedAt: now,
    gateway: blank("gateway", reason),
    dns: includeDns ? await dnsMeasurement() : blank("dns", reason),
    packetLoss: blank("packet_loss", reason),
    congestion: blank("congestion", reason),
  };
}

function send(req, res, status, body) {
  const origin = req.headers.origin || "*";
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    Vary: "Origin",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(req, res, 204, {});
    return;
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    send(req, res, 200, {
      ok: true,
      ready: true,
      name: "probespeak-agent",
      version: "0.1.0",
      bind: "127.0.0.1:8765",
      actions: ACTIONS,
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/action") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      send(req, res, 400, { ok: false, error: "Body is not JSON." });
      return;
    }
    const action = body && body.action;
    if (!ACTIONS.includes(action)) {
      send(req, res, 400, { ok: false, action: action ?? null, error: "Action is not allowlisted." });
      return;
    }
    if (action === "FIX_DNS" || action === "RENEW_DHCP" || action === "RECONNECT_NETWORK") {
      send(req, res, 200, {
        ok: false,
        action,
        error: `${action} refused. This reference agent does not change system settings.`,
        log: ["Refused. No resolver, lease, or interface was modified."],
        measurement: null,
        applied: null,
        saved: null,
        flushed: null,
      });
      return;
    }
    if (action === "RESTORE_DNS") {
      send(req, res, 200, {
        ok: true,
        action,
        error: null,
        log: ["No resolver was saved by this process. Nothing to restore."],
        measurement: null,
        applied: null,
        saved: null,
        flushed: null,
      });
      return;
    }
    const includeDns = action === "VERIFY_DNS" || action === "RETEST";
    send(req, res, 200, {
      ok: true,
      action,
      error: null,
      log: includeDns
        ? ["Queried cloudflare.com with node:dns.resolve4. Other instruments were not measured."]
        : ["No packet socket. Measurement left insufficient on purpose."],
      measurement: await measurement(includeDns),
      applied: null,
      saved: null,
      flushed: null,
    });
    return;
  }
  send(req, res, 404, { ok: false, error: "Not found." });
});

server.listen(PORT, HOST, () => {
  console.log(`probespeak-agent listening on http://${HOST}:${PORT}`);
});
