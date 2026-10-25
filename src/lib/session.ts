import { create } from "zustand";
import { callAgent } from "./agent/client";
import { appliedDnsIsExpected } from "./agent/client";
import { probeAgent, type AgentSnapshot } from "./agent/probe";
import { classifyDns, classifyGateway } from "./engine/classify";
import { diagnose } from "./engine/diagnose";
import { decideRecoveryOutcome } from "./engine/outcome";
import { RECOVERY_DNS } from "./engine/thresholds";
import type { CheckId, Diagnosis, MeasurementSet, RecoveryAction, Verdict } from "./engine/types";
import { browserBlindSet, readBrowserHints, type BrowserHints } from "./measurements";
import { scenarioById } from "./scenarios";

export interface LogEvent {
  id: string;
  at: string;
  message: string;
}

export type Phase =
  | "idle"
  | "measuring"
  | "diagnosing"
  | "awaiting_permission"
  | "recovering"
  | "retesting"
  | "complete";

export type PermissionChoice = "allowed" | "denied" | "skipped" | null;
export type Executor = "lab-simulator" | "local-agent" | null;

export interface Session {
  phase: Phase;
  mode: "lab" | "live";
  scenarioId: string;
  /** Scenario captured when the run started. Later UI changes must not swap the retest. */
  activeScenarioId: string;
  runId: string | null;
  revealed: Record<CheckId, boolean>;
  before: MeasurementSet | null;
  after: MeasurementSet | null;
  diagnosis: Diagnosis | null;
  afterDiagnosis: Diagnosis | null;
  verdict: Verdict | null;
  verdictDetail: string;
  permissionChoice: PermissionChoice;
  executor: Executor;
  rollbackNote: string | null;
  events: LogEvent[];
  modalOpen: boolean;
  busy: boolean;
  hints: BrowserHints | null;
  agent: AgentSnapshot;
  setMode: (mode: "lab" | "live") => void;
  selectScenario: (id: string) => void;
  run: () => Promise<void>;
  allow: () => Promise<void>;
  deny: () => void;
  setModal: (open: boolean) => void;
  probe: () => Promise<void>;
}

const NONE: Record<CheckId, boolean> = {
  gateway: false,
  dns: false,
  packet_loss: false,
  congestion: false,
};

const INITIAL_AGENT: AgentSnapshot = {
  state: "unchecked",
  detail: "The loopback agent has not been checked yet.",
  checkedAt: null,
  health: null,
};

let seq = 0;

function wait(ms: number) {
  const reduce =
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return new Promise((resolve) => setTimeout(resolve, reduce ? 20 : ms));
}

function event(message: string, n: number): LogEvent {
  return { id: `${Date.now()}-${n}-${message.length}`, at: new Date().toISOString(), message };
}

export const useSession = create<Session>((set, get) => {
  let n = 0;
  const push = (my: number, message: string) => {
    if (seq !== my) return;
    n += 1;
    const entry = event(message, n);
    set((s) => ({ events: [...s.events, entry] }));
  };

  const finish = (my: number, verdict: Verdict, detail: string, phase: Phase = "complete") => {
    if (seq !== my) return;
    set({ verdict, verdictDetail: detail, phase, busy: false, modalOpen: false });
    push(my, `Final status: ${verdict}. ${detail}`);
  };

  return {
    phase: "idle",
    mode: "lab",
    scenarioId: "dns-fix-verifies",
    activeScenarioId: "dns-fix-verifies",
    runId: null,
    revealed: { ...NONE },
    before: null,
    after: null,
    diagnosis: null,
    afterDiagnosis: null,
    verdict: null,
    verdictDetail: "",
    permissionChoice: null,
    executor: null,
    rollbackNote: null,
    events: [],
    modalOpen: false,
    busy: false,
    hints: null,
    agent: INITIAL_AGENT,

    setMode: (mode) => {
      if (get().busy) return;
      set({ mode });
    },
    selectScenario: (scenarioId) => {
      if (get().busy) return;
      set({ scenarioId });
    },
    setModal: (modalOpen) => {
      if (get().phase !== "awaiting_permission") return;
      set({ modalOpen });
    },

    probe: async () => {
      set({ agent: { ...get().agent, state: "checking", detail: "Requesting http://127.0.0.1:8765/health." } });
      const agent = await probeAgent();
      set({ agent });
    },

    deny: () => {
      const my = seq;
      const { phase, diagnosis } = get();
      if (phase !== "awaiting_permission" || !diagnosis) return;
      set({
        permissionChoice: "denied",
        modalOpen: false,
        executor: null,
      });
      push(my, "Permission declined. No recovery action was sent.");
      finish(
        my,
        "unresolved",
        "A fault pattern was identified and recovery was declined. Nothing was changed. Status is Unresolved.",
      );
    },

    run: async () => {
      const my = ++seq;
      const mode = get().mode;
      const scenarioId = get().scenarioId;
      n = 0;
      set({
        phase: "measuring",
        busy: true,
        runId: `PS-${Date.now().toString(36).toUpperCase()}`,
        activeScenarioId: scenarioId,
        revealed: { ...NONE },
        before: null,
        after: null,
        diagnosis: null,
        afterDiagnosis: null,
        verdict: null,
        verdictDetail: "",
        permissionChoice: null,
        executor: null,
        rollbackNote: null,
        events: [],
        modalOpen: false,
        hints: mode === "live" ? readBrowserHints() : null,
      });

      if (mode === "lab") {
        const scenario = scenarioById(scenarioId);
        push(my, `Lab mode. Reading stored capture “${scenario.title}”. This is not a probe of this device.`);
        set({ before: scenario.before });
        const order: CheckId[] = ["gateway", "dns", "packet_loss", "congestion"];
        for (const id of order) {
          await wait(480);
          if (seq !== my) return;
          set((s) => ({ revealed: { ...s.revealed, [id]: true } }));
          push(my, `Record loaded: ${id}.`);
        }
        await wait(220);
        if (seq !== my) return;
        const diagnosis = diagnose(scenario.before);
        set({ phase: "diagnosing", diagnosis });
        push(my, diagnosis.summary);
        await wait(240);
        if (seq !== my) return;
        if (!diagnosis.recovery) {
          finish(my, diagnosis.preliminary, diagnosis.summary);
          return;
        }
        if (!scenario.retest) {
          finish(
            my,
            "unresolved",
            "The engine offered a recovery, but this capture has no retest record. The recovery was not simulated and nothing is marked Resolved.",
          );
          return;
        }
        set({ phase: "awaiting_permission", modalOpen: true, busy: false });
        push(my, `Recovery ${diagnosis.recovery} is available. Waiting for permission. Nothing has been changed.`);
        return;
      }

      push(my, "Live mode. A diagnosis is accepted only from an agent health document plus a valid measurement.");
      const agent = await probeAgent();
      if (seq !== my) return;
      set({ agent });
      push(my, `Agent status: ${agent.state}. ${agent.detail}`);
      if (agent.state !== "connected") {
        const blind = browserBlindSet();
        set({ before: blind, revealed: { gateway: true, dns: true, packet_loss: true, congestion: true } });
        const diagnosis = diagnose(blind);
        set({ diagnosis, phase: "diagnosing" });
        push(my, "No agent measurement was accepted. Browser limits were recorded as missing evidence.");
        if (get().hints) {
          push(my, "Browser connection hints were stored beside the run. They are not rule-engine inputs.");
        }
        finish(my, "inconclusive", diagnosis.summary);
        return;
      }

      push(my, "Sending allowlisted RETEST. This action must not change settings.");
      try {
        const result = await callAgent("RETEST");
        if (seq !== my) return;
        for (const line of result.log) push(my, `Agent: ${line}`);
        if (!result.ok || !result.measurement) {
          const blind = browserBlindSet();
          set({ before: blind, revealed: { gateway: true, dns: true, packet_loss: true, congestion: true } });
          const diagnosis = diagnose(blind);
          set({ diagnosis });
          finish(
            my,
            "inconclusive",
            result.error ?? "The agent did not return a usable measurement. No cause was named.",
          );
          return;
        }
        const order: CheckId[] = ["gateway", "dns", "packet_loss", "congestion"];
        set({ before: result.measurement });
        for (const id of order) {
          await wait(280);
          if (seq !== my) return;
          set((s) => ({ revealed: { ...s.revealed, [id]: true } }));
        }
        const diagnosis = diagnose(result.measurement);
        set({ diagnosis, phase: "diagnosing", executor: "local-agent" });
        push(my, diagnosis.summary);
        if (!diagnosis.recovery) {
          finish(my, diagnosis.preliminary, diagnosis.summary);
          return;
        }
        set({ phase: "awaiting_permission", modalOpen: true, busy: false });
        push(my, `Recovery ${diagnosis.recovery} is available. Waiting for permission.`);
      } catch (error) {
        if (seq !== my) return;
        const message = error instanceof Error ? error.message : "Agent request failed.";
        push(my, message);
        const blind = browserBlindSet();
        set({
          before: blind,
          revealed: { gateway: true, dns: true, packet_loss: true, congestion: true },
          diagnosis: diagnose(blind),
        });
        finish(my, "inconclusive", `${message} No cause was named.`);
      }
    },

    allow: async () => {
      const my = seq;
      const snap = get();
      if (snap.phase !== "awaiting_permission" || !snap.diagnosis?.recovery || !snap.before) return;
      const action = snap.diagnosis.recovery;
      set({
        permissionChoice: "allowed",
        modalOpen: false,
        phase: "recovering",
        busy: true,
        executor: snap.mode === "lab" ? "lab-simulator" : "local-agent",
      });
      push(my, `Permission granted for ${action}.`);

      if (snap.mode === "lab") {
        await labRecover(my, action, snap.before, push, finish, set, get);
        return;
      }
      await liveRecover(my, action, push, finish, set);
    },
  };
});

async function labRecover(
  my: number,
  action: RecoveryAction,
  before: MeasurementSet,
  push: (my: number, message: string) => void,
  finish: (my: number, verdict: Verdict, detail: string) => void,
  set: (partial: Partial<Session> | ((s: Session) => Partial<Session>)) => void,
  get: () => Session,
) {
  if (action === "FIX_DNS") {
    const check = classifyDns(before.dns);
    push(my, "VERIFY_DNS — re-reading the lab capture. No packet was sent.");
    if (check.band !== "fail") {
      finish(
        my,
        "inconclusive",
        "VERIFY_DNS did not confirm a resolver failure. No resolver change was simulated.",
      );
      return;
    }
    push(my, `VERIFY_DNS — failure still present. ${check.detail}`);
    const saved = before.dns.resolver ?? "unspecified";
    push(my, `Saved current resolver: ${saved}.`);
    push(my, `Applied ${RECOVERY_DNS.join(" and ")}.`);
    push(my, "Flushed resolver cache (lab simulation). This browser’s DNS settings were not changed.");
  } else {
    const check = classifyGateway(before.gateway);
    push(my, "VERIFY_GATEWAY — re-reading the lab capture. No packet was sent.");
    if (!(check.band === "fail" && before.gateway.successes === 0)) {
      finish(my, "inconclusive", "VERIFY_GATEWAY did not confirm 0 replies. DHCP renew was not simulated.");
      return;
    }
    push(my, `VERIFY_GATEWAY — ${check.detail}`);
    push(my, "RENEW_DHCP simulated. No DHCP lease on this device was touched.");
  }

  const scenario = scenarioById(get().activeScenarioId);
  if (!scenario.retest) {
    finish(my, "unresolved", "No retest capture exists. Nothing is marked Resolved.");
    return;
  }
  set({ phase: "retesting" });
  push(my, "RETEST — loading the capture’s later record.");
  await wait(500);
  if (seq !== my) return;
  const afterDiagnosis = diagnose(scenario.retest);
  set({ after: scenario.retest, afterDiagnosis });
  push(my, `Retest: ${afterDiagnosis.summary}`);
  const decision = decideRecoveryOutcome(action, afterDiagnosis);
  if (decision.rollback) {
    const saved = before.dns.resolver ?? "the saved resolver";
    push(my, `RESTORE_DNS — simulated restore of ${saved}. Lab mode did not edit this device.`);
    set({ rollbackNote: `Simulated restore to ${saved}. No device setting changed.` });
  }
  finish(my, decision.verdict, `${decision.detail} Executor: lab simulator.`);
}

async function liveRecover(
  my: number,
  action: RecoveryAction,
  push: (my: number, message: string) => void,
  finish: (my: number, verdict: Verdict, detail: string) => void,
  set: (partial: Partial<Session> | ((s: Session) => Partial<Session>)) => void,
) {
  try {
    if (action === "FIX_DNS") {
      push(my, "Sending VERIFY_DNS.");
      const verify = await callAgent("VERIFY_DNS");
      if (seq !== my) return;
      for (const line of verify.log) push(my, `Agent: ${line}`);
      const dns = verify.measurement ? classifyDns(verify.measurement.dns) : null;
      if (!verify.ok || !dns || dns.band !== "fail") {
        finish(
          my,
          "inconclusive",
          "VERIFY_DNS did not confirm a current resolver failure. FIX_DNS was not sent.",
        );
        return;
      }
      push(my, "Sending FIX_DNS.");
      const fix = await callAgent("FIX_DNS");
      if (seq !== my) return;
      for (const line of fix.log) push(my, `Agent: ${line}`);
      if (!fix.ok || !appliedDnsIsExpected(fix.applied) || fix.flushed !== true) {
        push(my, fix.error ?? "FIX_DNS did not apply 1.1.1.1 and 1.0.0.1 with a flush.");
        if (fix.saved && fix.saved.length > 0) {
          push(my, "Sending RESTORE_DNS because the apply step was not accepted.");
          try {
            const back = await callAgent("RESTORE_DNS");
            for (const line of back.log) push(my, `Agent: ${line}`);
            set({ rollbackNote: back.ok ? "RESTORE_DNS returned ok." : (back.error ?? "RESTORE_DNS failed.") });
          } catch (error) {
            const message = error instanceof Error ? error.message : "RESTORE_DNS failed.";
            push(my, message);
            set({ rollbackNote: message });
          }
        }
        finish(
          my,
          "unresolved",
          fix.error ?? "The agent did not complete the DNS procedure. Nothing is marked Resolved.",
        );
        return;
      }
      push(my, `Agent saved ${fix.saved?.join(", ") || "a resolver list"} and applied ${fix.applied!.join(" and ")}.`);
    } else {
      push(my, "Sending VERIFY_GATEWAY.");
      const verify = await callAgent("VERIFY_GATEWAY");
      if (seq !== my) return;
      for (const line of verify.log) push(my, `Agent: ${line}`);
      const gw = verify.measurement?.gateway;
      const band = gw ? classifyGateway(gw) : null;
      if (!verify.ok || !gw || !band || band.band !== "fail" || gw.successes !== 0) {
        finish(my, "inconclusive", "VERIFY_GATEWAY did not confirm 0 replies. RENEW_DHCP was not sent.");
        return;
      }
      push(my, "Sending RENEW_DHCP.");
      const renew = await callAgent("RENEW_DHCP");
      if (seq !== my) return;
      for (const line of renew.log) push(my, `Agent: ${line}`);
      if (!renew.ok) {
        finish(my, "unresolved", renew.error ?? "RENEW_DHCP was refused. Nothing is marked Resolved.");
        return;
      }
    }

    set({ phase: "retesting" });
    push(my, "Sending RETEST.");
    const retest = await callAgent("RETEST");
    if (seq !== my) return;
    for (const line of retest.log) push(my, `Agent: ${line}`);
    if (!retest.ok || !retest.measurement) {
      if (action === "FIX_DNS") {
        push(my, "Retest missing. Sending RESTORE_DNS.");
        try {
          const back = await callAgent("RESTORE_DNS");
          for (const line of back.log) push(my, `Agent: ${line}`);
          set({ rollbackNote: back.error ?? "RESTORE_DNS sent because the retest could not be verified." });
        } catch (error) {
          set({ rollbackNote: error instanceof Error ? error.message : "RESTORE_DNS failed." });
        }
      }
      finish(my, "unresolved", "Retest did not return a valid measurement. Not marked Resolved.");
      return;
    }
    const afterDiagnosis = diagnose(retest.measurement);
    set({ after: retest.measurement, afterDiagnosis });
    push(my, `Retest: ${afterDiagnosis.summary}`);
    const decision = decideRecoveryOutcome(action, afterDiagnosis);
    if (decision.rollback) {
      push(my, "Sending RESTORE_DNS.");
      const back = await callAgent("RESTORE_DNS");
      for (const line of back.log) push(my, `Agent: ${line}`);
      set({
        rollbackNote: back.ok
          ? "RESTORE_DNS returned ok. Confirm on the host if you need proof the previous resolvers are back."
          : (back.error ?? "RESTORE_DNS did not return ok."),
      });
    }
    finish(my, decision.verdict, `${decision.detail} Executor: local agent.`);
  } catch (error) {
    if (seq !== my) return;
    const message = error instanceof Error ? error.message : "Recovery failed.";
    push(my, message);
    finish(my, "unresolved", `${message} Nothing is marked Resolved.`);
  }
}
