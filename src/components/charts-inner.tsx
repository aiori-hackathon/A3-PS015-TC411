import { lossPercent } from "@/lib/engine/stats";
import type { CheckId, Diagnosis, MeasurementSet } from "@/lib/engine/types";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function accepted(diagnosis: Diagnosis | null, id: CheckId, value: number | null): number | null {
  if (!diagnosis || value == null) return value;
  if (diagnosis.checks[id].band === "insufficient") return null;
  return value;
}

function lossValue(set: MeasurementSet | null, diagnosis: Diagnosis | null): number | null {
  if (!set || set.packetLoss.sent == null || set.packetLoss.received == null) return null;
  if (set.packetLoss.received > set.packetLoss.sent || set.packetLoss.sent <= 0) return null;
  return accepted(diagnosis, "packet_loss", Math.round(lossPercent(set.packetLoss.sent, set.packetLoss.received) * 10) / 10);
}

export function Charts({
  before,
  after,
  beforeDiagnosis,
  afterDiagnosis,
}: {
  before: MeasurementSet | null;
  after: MeasurementSet | null;
  beforeDiagnosis: Diagnosis | null;
  afterDiagnosis: Diagnosis | null;
}) {
  const dns = [
    { name: "Before", value: accepted(beforeDiagnosis, "dns", before?.dns.timeMs ?? null) },
    { name: "After", value: after ? accepted(afterDiagnosis, "dns", after.dns.timeMs) : null },
  ];
  const loss = [
    { name: "Before", value: lossValue(before, beforeDiagnosis) },
    { name: "After", value: lossValue(after, afterDiagnosis) },
  ];
  const latency = [
    {
      name: "Unloaded",
      before: accepted(beforeDiagnosis, "congestion", before?.congestion.unloadedRttMs ?? null),
      after: after ? accepted(afterDiagnosis, "congestion", after.congestion.unloadedRttMs) : null,
    },
    {
      name: "Loaded",
      before: accepted(beforeDiagnosis, "congestion", before?.congestion.loadedRttMs ?? null),
      after: after ? accepted(afterDiagnosis, "congestion", after.congestion.loadedRttMs) : null,
    },
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Chart title="DNS time" unit="ms" data={dns} />
      <Chart title="Packet loss" unit="%" data={loss} />
      <LatencyChart data={latency} />
    </div>
  );
}

function Chart({ title, unit, data }: { title: string; unit: string; data: { name: string; value: number | null }[] }) {
  const empty = data.every((d) => d.value == null);
  return (
    <section className="border border-line bg-surface p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mb-3 font-mono text-xs text-muted">{unit}. Missing bars were not accepted, not zero.</p>
      {empty ? (
        <p className="grid h-52 place-items-center text-sm text-muted">No accepted number.</p>
      ) : (
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--color-muted)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--color-muted)" fontSize={12} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                cursor={{ fill: "var(--color-surface-2)" }}
                contentStyle={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-line)",
                  borderRadius: 4,
                  color: "var(--color-fg)",
                }}
              />
              <Bar dataKey="value" fill="var(--color-accent)" maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function LatencyChart({
  data,
}: {
  data: { name: string; before: number | null; after: number | null }[];
}) {
  const empty = data.every((d) => d.before == null && d.after == null);
  return (
    <section className="border border-line bg-surface p-4">
      <h3 className="text-sm font-medium">Latency</h3>
      <p className="mb-3 font-mono text-xs text-muted">ms. After appears only when a retest exists.</p>
      {empty ? (
        <p className="grid h-52 place-items-center text-sm text-muted">No accepted number.</p>
      ) : (
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--color-muted)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--color-muted)" fontSize={12} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                cursor={{ fill: "var(--color-surface-2)" }}
                contentStyle={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-line)",
                  borderRadius: 4,
                  color: "var(--color-fg)",
                }}
              />
              <Bar dataKey="before" fill="var(--color-faint)" maxBarSize={28} />
              <Bar dataKey="after" fill="var(--color-accent)" maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
