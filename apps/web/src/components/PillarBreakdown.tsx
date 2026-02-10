import type { PillarScores } from "@agentability/shared";
import { useEffect, useState } from "react";
import { Activity, BookOpen, Link2, Search, ShieldCheck } from "lucide-react";
import type { ComponentType } from "react";

const PILLARS: {
  key: keyof PillarScores;
  label: string;
  hint: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { key: "discovery", label: "Can agents find you?", hint: "Entrypoints + crawlable docs", Icon: Search },
  { key: "callableSurface", label: "Can agents call you?", hint: "OpenAPI + tool surfaces", Icon: Link2 },
  { key: "llmIngestion", label: "Can AI read your docs?", hint: "Text-first docs + llms.txt", Icon: BookOpen },
  { key: "trust", label: "Should agents trust you?", hint: "Legal + contact + verification", Icon: ShieldCheck },
  { key: "reliability", label: "Are responses consistent?", hint: "Stable behavior across retries", Icon: Activity },
];

function toneForScore(score: number): { bar: string; ring: string } {
  if (score >= 90) {
    return { bar: "bg-emerald-500", ring: "ring-emerald-200/50" };
  }
  if (score >= 50) {
    return { bar: "bg-amber-500", ring: "ring-amber-200/50" };
  }
  return { bar: "bg-rose-500", ring: "ring-rose-200/50" };
}

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
          <div className="flex items-start justify-between gap-3 text-sm font-medium">
            <div className="flex items-start gap-2">
              <pillar.Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <span>{pillar.label}</span>
                <p className="mt-1 text-xs text-muted-foreground">{pillar.hint}</p>
              </div>
            </div>
            <span>{pillarScores[pillar.key]}</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="relative h-full w-full">
              <div
                className={`${toneForScore(pillarScores[pillar.key]).bar} h-full rounded-full transition-all duration-700 ease-out`}
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
