import { useEffect, useState } from "react";
import type { Diagnosis, MeasurementSet } from "@/lib/engine/types";

type ChartsCmp = typeof import("./charts-inner").Charts;

export function ChartPanel(props: {
  before: MeasurementSet | null;
  after: MeasurementSet | null;
  beforeDiagnosis: Diagnosis | null;
  afterDiagnosis: Diagnosis | null;
}) {
  const [Charts, setCharts] = useState<ChartsCmp | null>(null);
  useEffect(() => {
    let live = true;
    void import("./charts-inner").then((mod) => {
      if (live) setCharts(() => mod.Charts);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!Charts) {
    return <div className="h-64 border border-line bg-surface" aria-hidden="true" />;
  }
  return <Charts {...props} />;
}
