import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { URLInputCard } from "@/components/URLInputCard";
import { evaluateOrigin, fetchDiscoveryAudit } from "@/lib/api";
import { useSeo } from "@/lib/seo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function HomePage() {
  useSeo({
    title: "Agentability Standard for AI-Native Web Apps",
    description:
      "Agentability is the standard for AI-native web surfaces: discovery, callability, ingestion, trust, and reliability.",
    path: "/",
  });

  const navigate = useNavigate();
  const auditQuery = useQuery({
    queryKey: ["discovery-audit"],
    queryFn: fetchDiscoveryAudit,
  });
  const mutation = useMutation({
    mutationFn: (origin: string) => evaluateOrigin(origin),
    onSuccess: (data) => {
      navigate(`/runs/${data.runId}`);
    },
  });

  const audit = auditQuery.data;
  const status = audit?.discoverability_health?.status ?? "unknown";
  const statusLabel = status.toUpperCase();
  const statusTone =
    status === "pass"
      ? "border-emerald-200/70 bg-emerald-50 text-emerald-700"
      : status === "degraded"
        ? "border-amber-200/70 bg-amber-50 text-amber-700"
        : status === "fail"
          ? "border-rose-200/70 bg-rose-50 text-rose-700"
          : "border-border/60 bg-white/80 text-muted-foreground";
  const sourcesCount = audit?.live_sources?.length ?? 0;
  const surfacesCount = audit?.files?.length ?? 0;
  const missingCount = audit?.discoverability_health?.missing?.length ?? 0;
  const unreachableCount = audit?.discoverability_health?.unreachable?.length ?? 0;
  const driftRequired = audit?.discoverability_health?.hash_mismatch_required?.length ?? 0;
  const driftOptional = audit?.discoverability_health?.hash_mismatch_optional?.length ?? 0;
  const driftTotal = driftRequired + driftOptional;

  const lastCheckedLabel = (() => {
    if (!audit?.live_checked_at) return "n/a";
    const parsed = new Date(audit.live_checked_at);
    return Number.isNaN(parsed.getTime()) ? audit.live_checked_at : parsed.toLocaleString();
  })();

  return (
    <div className="space-y-10 animate-fade-up">
      <section className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-white/70 px-3 py-1 text-xs font-medium uppercase tracking-wider">
            Agentability · Authority Mode
          </div>
          <h1 className="text-4xl leading-tight md:text-5xl">
            Agentability Standard for AI‑Native Web Apps
          </h1>
          <p className="max-w-xl text-base text-muted-foreground">
            Publish verifiable discovery surfaces, callable tools, and evidence‑backed trust signals. Agentability
            grades how ready your web app is for autonomous agents.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <a href="/spec.md">Read the Spec</a>
            </Button>
            <Button asChild variant="outline">
              <a href="/discovery/audit">See Verification</a>
            </Button>
            <Button asChild variant="secondary">
              <a href="/reports/aistatusdashboard.com">View showcase report</a>
            </Button>
          </div>
          <URLInputCard
            onSubmit={(origin) => mutation.mutate(origin)}
            loading={mutation.isPending}
            error={mutation.isError ? (mutation.error instanceof Error ? mutation.error.message : "Request failed") : null}
          />
        </div>

        <Card className="border-border/60 bg-white/70">
          <CardHeader>
            <CardTitle>Verification proof</CardTitle>
            <CardDescription>Live discovery audit across apex + hosting mirrors.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            {auditQuery.isLoading ? <p>Loading audit…</p> : null}
            {auditQuery.isError ? <p>Audit unavailable.</p> : null}
            {audit ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-white/80 px-3 py-2 text-xs uppercase tracking-wide">
                  <span>Status</span>
                  <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusTone}`}>
                    {statusLabel}
                  </span>
                </div>
                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  <div className="rounded-xl border border-border/60 bg-white/80 p-3">
                    <p className="uppercase tracking-wide text-muted-foreground">Sources verified</p>
                    <p className="text-lg font-semibold text-foreground">{sourcesCount || "—"}</p>
                    <p className="text-[0.7rem] text-muted-foreground">Apex + hosting mirrors</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-white/80 p-3">
                    <p className="uppercase tracking-wide text-muted-foreground">Surfaces checked</p>
                    <p className="text-lg font-semibold text-foreground">{surfacesCount || "—"}</p>
                    <p className="text-[0.7rem] text-muted-foreground">Required + optional</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-white/80 p-3">
                    <p className="uppercase tracking-wide text-muted-foreground">Hash drift</p>
                    <p className="text-lg font-semibold text-foreground">{driftTotal}</p>
                    <p className="text-[0.7rem] text-muted-foreground">
                      req {driftRequired} · opt {driftOptional}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-white/80 p-3">
                    <p className="uppercase tracking-wide text-muted-foreground">Live errors</p>
                    <p className="text-lg font-semibold text-foreground">{missingCount + unreachableCount}</p>
                    <p className="text-[0.7rem] text-muted-foreground">
                      missing {missingCount} · unreachable {unreachableCount}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">
                    Last checked: <span className="font-medium text-foreground">{lastCheckedLabel}</span> · Spec v
                    {audit.spec_version ?? "1.2"}
                  </span>
                  <a className="text-emerald-700 hover:text-emerald-900" href="/discovery/audit/latest.pretty.json">
                    View latest.pretty.json →
                  </a>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <Card className="border-border/60 bg-white/70">
        <CardContent className="flex flex-wrap items-center gap-3 py-5 text-xs uppercase tracking-wider text-muted-foreground">
          <span>Open source</span>
          <span>Evidence‑based</span>
          <span>Versioned methodology</span>
          <span>Hash drift enforcement</span>
        </CardContent>
      </Card>

      <Alert className="border-border/60 bg-white/70">
        <AlertTitle>Public mode only</AlertTitle>
        <AlertDescription>
          We currently evaluate public-facing endpoints and documentation. Authenticated and private surfaces are not yet
          scored.
        </AlertDescription>
      </Alert>

      <Card className="border-border/60 bg-white/70">
        <CardHeader>
          <CardTitle>AI Integration</CardTitle>
          <CardDescription>Stable machine surfaces for agents and crawlers.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <a className="text-muted-foreground hover:text-foreground" href="/.well-known/air.json">
              /.well-known/air.json
            </a>
            <a className="text-muted-foreground hover:text-foreground" href="/.well-known/openapi.json">
              /.well-known/openapi.json
            </a>
            <a className="text-muted-foreground hover:text-foreground" href="/llms.txt">
              /llms.txt
            </a>
            <a className="text-muted-foreground hover:text-foreground" href="/discovery/audit/latest.json">
              /discovery/audit/latest.json
            </a>
            <a
              className="text-muted-foreground hover:text-foreground"
              href="https://github.com/khalidsaidi/agentability"
            >
              GitHub repo
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
