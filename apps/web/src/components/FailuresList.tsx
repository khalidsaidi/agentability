import type { CheckResult } from "@agentability/shared";
import { Badge } from "@/components/ui/badge";

const severityOrder = { high: 0, medium: 1, low: 2 } as const;

export function FailuresList({ checks }: { checks: CheckResult[] }) {
  const items = checks
    .filter((check) => check.status !== "pass")
    .sort((a, b) => {
      const severityDelta = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDelta !== 0) return severityDelta;
      return a.status.localeCompare(b.status);
    });

  if (!items.length) {
    return (
      <div className="rounded-xl border border-border/60 bg-white/70 p-4 text-sm">
        No failures detected in the current public-mode checks.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((check) => (
        <div key={check.id} className="rounded-xl border border-border/60 bg-white/70 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{check.id}</Badge>
            <Badge>{check.severity}</Badge>
            <span className="text-sm font-medium capitalize text-muted-foreground">
              {check.status}
            </span>
          </div>
          <p className="mt-3 text-sm text-foreground">{check.summary}</p>
          {check.evidence.length ? (
            <div className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground">
              {check.evidence.map((item) => (
                <a
                  key={item}
                  href={item}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate hover:text-foreground"
                >
                  {item}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
