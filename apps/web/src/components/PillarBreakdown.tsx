import type { PillarScores } from "@agentability/shared";
import { useEffect, useState } from "react";

const PILLARS: { key: keyof PillarScores; label: string; hint: string }[] = [
  { key: "discovery", label: "Can agents find you?", hint: "Entrypoints + crawlable docs" },
  { key: "callableSurface", label: "Can agents call you?", hint: "OpenAPI + tool surfaces" },
  { key: "llmIngestion", label: "Can AI read your docs?", hint: "Text-first docs + llms.txt" },
  { key: "trust", label: "Should agents trust you?", hint: "Legal + contact + verification" },
  { key: "reliability", label: "Are responses consistent?", hint: "Stable behavior across retries" },
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
          <p className="mt-1 text-xs text-muted-foreground">{pillar.hint}</p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="relative h-full w-full">
              <div
                className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
                style={{ width: `${animated[pillar.key]}%` }}
              />
              <div
                className="absolute top-0 h-full w-0.5 bg-foreground/20"
                style={{ left: "95%" }}
                aria-hidden="true"
              />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-[0.7rem] text-muted-foreground">
            <span>You</span>
            <span>Target: 95</span>
          </div>
        </div>
      ))}
    </div>
  );
}
