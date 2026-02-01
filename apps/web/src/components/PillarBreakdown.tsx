import type { PillarScores } from "@agentability/shared";
import { useEffect, useState } from "react";

const PILLARS: { key: keyof PillarScores; label: string }[] = [
  { key: "discovery", label: "Discovery" },
  { key: "callableSurface", label: "Callable Surface" },
  { key: "llmIngestion", label: "LLM Ingestion" },
  { key: "trust", label: "Trust" },
  { key: "reliability", label: "Reliability" },
];

export function PillarBreakdown({ pillarScores }: { pillarScores: PillarScores }) {
  const [animated, setAnimated] = useState<Record<keyof PillarScores, number>>({
    discovery: 0,
    callableSurface: 0,
    llmIngestion: 0,
    trust: 0,
    reliability: 0,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAnimated(pillarScores);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [pillarScores]);

  return (
    <div className="grid gap-4">
      {PILLARS.map((pillar) => (
        <div key={pillar.key} className="rounded-xl border border-border/60 bg-white/70 p-4">
          <div className="flex items-center justify-between text-sm font-medium">
            <span>{pillar.label}</span>
            <span>{pillarScores[pillar.key]}</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-700 ease-out"
              style={{ width: `${animated[pillar.key]}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
