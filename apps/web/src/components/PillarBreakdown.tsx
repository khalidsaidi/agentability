import type { PillarScores } from "@agentability/shared";

const PILLARS: { key: keyof PillarScores; label: string }[] = [
  { key: "discovery", label: "Discovery" },
  { key: "callableSurface", label: "Callable Surface" },
  { key: "llmIngestion", label: "LLM Ingestion" },
  { key: "trust", label: "Trust" },
  { key: "reliability", label: "Reliability" },
];

export function PillarBreakdown({ pillarScores }: { pillarScores: PillarScores }) {
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
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${pillarScores[pillar.key]}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
