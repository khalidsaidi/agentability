import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchRun } from "@/lib/api";
import { DEFAULT_DESCRIPTION, useSeo } from "@/lib/seo";
import { ScoreBadge } from "@/components/ScoreBadge";
import { PillarBreakdown } from "@/components/PillarBreakdown";
import { FailuresList } from "@/components/FailuresList";
import { CopyLinks } from "@/components/CopyLinks";
import { Badge } from "@/components/ui/badge";
import { trackError, trackEvent, trackLinkClick } from "@/lib/analytics";

const STEPS = [
  {
    title: "Discovery sweep",
    detail: "Finding entrypoints and manifests.",
  },
  {
    title: "Callable surface check",
    detail: "Validating OpenAPI and tool endpoints.",
  },
  {
    title: "Docs & ingestion",
    detail: "Checking docs and LLM entrypoints.",
  },
  {
    title: "Trust signals",
    detail: "Verifying legal, contact, and attestations.",
  },
  {
    title: "Reliability pass",
    detail: "Repeating key fetches for stability.",
  },
];

export function RunPage() {
  const params = useParams();
  const runId = params.runId ?? "";

  const query = useQuery({
    queryKey: ["run", runId],
    queryFn: () => fetchRun(runId),
    enabled: Boolean(runId),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 2000 : false,
  });
  const runTitle = query.data?.domain
    ? `Run status: ${query.data.domain}`
    : runId
    ? "Run status"
    : "Agentability run status";
  const runDescription = query.data?.domain
    ? `Live evaluation status for ${query.data.domain}.`
    : DEFAULT_DESCRIPTION;
  const runPath = runId ? `/runs/${encodeURIComponent(runId)}` : "/runs";
  useSeo({
    title: runTitle,
    description: runDescription,
    path: runPath,
    noIndex: true,
  });

  const [activeStep, setActiveStep] = useState(0);
  const runStatus = query.data?.status;
  const lastStatus = useRef<string | null>(null);
  const viewedRun = useRef<string | null>(null);

  useEffect(() => {
    if (runStatus !== "running") return;
    const timer = window.setInterval(() => {
      setActiveStep((prev) => {
        const next = (prev + 1) % STEPS.length;
        trackEvent("run_progress_step", { run_id: runId, step_index: next, step_title: STEPS[next]?.title });
        return next;
      });
    }, 1600);
    return () => window.clearInterval(timer);
  }, [runStatus]);

  useEffect(() => {
    if (query.isError) {
      trackError("run_fetch_error", query.error, { run_id: runId });
    }
  }, [query.isError, query.error, runId]);

  useEffect(() => {
    if (!query.data) return;
    if (viewedRun.current !== query.data.runId) {
      viewedRun.current = query.data.runId;
      trackEvent("run_view", {
        run_id: query.data.runId,
        domain: query.data.domain,
        status: query.data.status,
        score: query.data.score,
        grade: query.data.grade,
        profile: query.data.profile,
      });
    }
    const status = query.data.status;
    if (lastStatus.current !== status) {
      trackEvent("run_status", {
        run_id: query.data.runId,
        domain: query.data.domain,
        status,
        score: query.data.score,
        grade: query.data.grade,
        profile: query.data.profile,
      });
      lastStatus.current = status;
    }
    if (status === "complete") {
      trackEvent("run_complete", {
        run_id: query.data.runId,
        domain: query.data.domain,
        score: query.data.score,
        grade: query.data.grade,
        profile: query.data.profile,
        fail_count: query.data.checks.filter((check) => check.status === "fail").length,
        warn_count: query.data.checks.filter((check) => check.status === "warn").length,
      });
    }
    if (status === "failed") {
      trackEvent("run_failed", {
        run_id: query.data.runId,
        domain: query.data.domain,
        error: query.data.error,
      });
    }
  }, [query.data]);

  if (query.isLoading) {
    return <div className="animate-fade-up text-sm text-muted-foreground">Loading run…</div>;
  }

  if (query.isError || !query.data) {
    return (
      <div className="animate-fade-up">
        <p className="text-sm text-destructive">Run not found.</p>
        <Link className="text-sm text-emerald-700" to="/">
          Back to home
        </Link>
      </div>
    );
  }

  const run = query.data;

  return (
    <div className="space-y-8 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Run</p>
          <h1 className="text-3xl">{run.domain}</h1>
        </div>
        <Badge variant="outline">{run.status}</Badge>
      </div>

      {run.status === "running" ? (
        <div className="space-y-6 rounded-3xl border border-border/60 bg-white/70 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Evaluation in progress</p>
              <p className="text-lg font-semibold text-foreground">We’re scanning your public surfaces.</p>
              <p className="text-sm text-muted-foreground">
                Most audits finish in under a minute. We’ll refresh this page automatically.
              </p>
            </div>
            <div className="rounded-full border border-emerald-200/70 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              Live
            </div>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-emerald-100/60">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-500/70" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {STEPS.map((step, index) => {
              const isActive = index === activeStep;
              return (
                <div
                  key={step.title}
                  className={`rounded-2xl border px-4 py-3 transition ${
                    isActive
                      ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
                      : "border-border/60 bg-white/80 text-muted-foreground"
                  }`}
                >
                  <p className="text-sm font-semibold">{step.title}</p>
                  <p className="text-xs">{step.detail}</p>
                </div>
              );
            })}
          </div>
          <div className="rounded-2xl border border-border/60 bg-white/80 p-4 text-sm text-muted-foreground">
            Tip: Agentability only checks public surfaces and never needs credentials.
          </div>
        </div>
      ) : null}
      {run.status === "failed" ? (
        <div className="rounded-2xl border border-destructive/40 bg-white/70 p-6 text-sm text-destructive">
          Evaluation failed. Please retry or check the input URL.
        </div>
      ) : null}

      {run.status === "complete" ? (
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-border/60 bg-white/70 p-6">
              <ScoreBadge score={run.score} grade={run.grade} />
              <p className="mt-2 text-sm text-muted-foreground">Public mode score for {run.domain}.</p>
            </div>
            <FailuresList checks={run.checks} />
          </div>
          <div className="space-y-6">
            <PillarBreakdown pillarScores={run.pillarScores} />
            <div className="rounded-2xl border border-border/60 bg-white/70 p-4">
              <CopyLinks
                reportUrl={run.artifacts?.reportUrl}
                jsonUrl={run.artifacts?.jsonUrl}
                evidenceUrl={run.artifacts?.evidenceBundleUrl}
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="text-sm text-muted-foreground">
        <span>View report:</span>{" "}
        <Link
          className="text-emerald-700"
          to={`/reports/${run.domain}`}
          onClick={() => trackLinkClick("run_view_report", `/reports/${run.domain}`, { run_id: run.runId })}
        >
          /reports/{run.domain}
        </Link>
      </div>
    </div>
  );
}
