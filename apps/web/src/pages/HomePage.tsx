import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { URLInputCard } from "@/components/URLInputCard";
import { evaluateOrigin, fetchDiscoveryAudit, fetchLeaderboard } from "@/lib/api";
import { useSeo } from "@/lib/seo";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OnboardingTour } from "@/components/OnboardingTour";
import { trackError, trackEvent, trackLinkClick } from "@/lib/analytics";
import { Code2, FileSearch, ListChecks, ShieldCheck, Sparkles } from "lucide-react";

export function HomePage() {
  useSeo({
    title: "Agentability: Free AI Readiness Audit for Your Website & API",
    description:
      "Run a public AI-readiness audit in ~60 seconds. Get a score, ranked fixes, and copy-paste instructions to make your site usable by AI tools.",
    path: "/",
  });

  const navigate = useNavigate();
  const [tourOpen, setTourOpen] = useState(false);
  const [tourInstance, setTourInstance] = useState(0);
  const auditQuery = useQuery({
    queryKey: ["discovery-audit"],
    queryFn: fetchDiscoveryAudit,
  });
  const leaderboardQuery = useQuery({
    queryKey: ["leaderboard"],
    queryFn: fetchLeaderboard,
  });
  const mutation = useMutation({
    mutationFn: (origin: string) => evaluateOrigin(origin),
    onSuccess: (data) => {
      trackEvent("audit_start", {
        run_id: data.runId,
        status: data.status,
        report_url: data.reportUrl,
        json_url: data.jsonUrl,
        domain: data.domain,
      });
      navigate(`/runs/${data.runId}`);
    },
    onError: (error) => {
      trackError("audit_request_error", error);
    },
  });

  useEffect(() => {
    if (auditQuery.isError) {
      trackError("audit_proof_error", auditQuery.error);
    }
    if (auditQuery.data) {
      trackEvent("audit_proof_loaded", {
        status: auditQuery.data.discoverability_health?.status,
        sources_count: auditQuery.data.live_sources?.length ?? 0,
        surfaces_count: auditQuery.data.files?.length ?? 0,
      });
    }
  }, [auditQuery.isError, auditQuery.data]);

  useEffect(() => {
    if (leaderboardQuery.isError) {
      trackError("leaderboard_error", leaderboardQuery.error);
    }
    if (leaderboardQuery.data) {
      trackEvent("leaderboard_loaded", {
        entries: leaderboardQuery.data.entries?.length ?? 0,
        updated_at: leaderboardQuery.data.updatedAt,
      });
    }
  }, [leaderboardQuery.isError, leaderboardQuery.data]);

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
  const missingRequired = audit?.discoverability_health?.missing?.length ?? 0;
  const unreachableRequired = audit?.discoverability_health?.unreachable?.length ?? 0;
  const missingOptional = audit?.discoverability_health?.optional_missing?.length ?? 0;
  const unreachableOptional = audit?.discoverability_health?.optional_unreachable?.length ?? 0;
  const driftRequired = audit?.discoverability_health?.hash_mismatch_required?.length ?? 0;
  const driftOptional = audit?.discoverability_health?.hash_mismatch_optional?.length ?? 0;
  const driftTotal = driftRequired + driftOptional;
  const liveErrorsTotal = missingRequired + unreachableRequired + missingOptional + unreachableOptional;

  const sourceLabels =
    audit?.live_sources?.map((source) => {
      if (source.includes("agentability.org")) return "Apex domain";
      if (source.includes("web.app")) return "Hosting mirror (web.app)";
      if (source.includes("firebaseapp.com")) return "Hosting mirror (firebaseapp)";
      return "Hosting mirror";
    }) ?? [];

  const lastCheckedLabel = (() => {
    if (!audit?.live_checked_at) return "n/a";
    const parsed = new Date(audit.live_checked_at);
    return Number.isNaN(parsed.getTime()) ? audit.live_checked_at : parsed.toLocaleString();
  })();

  const exampleReport =
    leaderboardQuery.data?.entries.find((entry) => entry.domain === "aistatusdashboard.com") ??
    leaderboardQuery.data?.entries[0] ??
    null;
  const exampleDomain = exampleReport?.domain ?? "aistatusdashboard.com";
  const exampleScore = exampleReport?.score ?? 70.0;
  const exampleGrade = exampleReport?.grade ?? "C";
  const exampleReportUrl = exampleReport?.reportUrl ?? "/reports/aistatusdashboard.com";

  return (
    <div className="space-y-14 animate-fade-up">
      {tourOpen ? (
        <OnboardingTour key={tourInstance} onClose={() => setTourOpen(false)} />
      ) : null}

      <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <div className="space-y-7">
          <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-border/60 bg-white/80 px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground shadow-sm">
            <span className="text-primary">Audits in ~60s</span>
            <span className="opacity-50">•</span>
            <span>Copy‑paste fixes</span>
            <span className="opacity-50">•</span>
            <span>No sign-up</span>
          </div>

          <div className="space-y-4">
            <h1 className="text-5xl leading-[1.05] tracking-tight md:text-6xl">
              Get AI-ready in 60 seconds.
              <span className="block text-foreground/80">See what breaks automation, then fix it.</span>
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              Run a public audit that turns agent-readiness into a clear score, a ranked checklist, and code you can
              paste into your docs or APIs today.
            </p>
          </div>

          <URLInputCard
            onSubmit={(origin) => mutation.mutate(origin)}
            loading={mutation.isPending}
            error={mutation.isError ? (mutation.error instanceof Error ? mutation.error.message : "Request failed") : null}
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="text-sm font-medium text-muted-foreground transition hover:text-foreground"
              onClick={() => {
                trackEvent("tour_open_click");
                setTourInstance((prev) => prev + 1);
                setTourOpen(true);
              }}
            >
              Need a walkthrough? Take the 30s tour
            </button>
          </div>
        </div>

        <Card className="border-border/60 bg-white/80 shadow-sm backdrop-blur">
          <CardHeader>
            <CardTitle>Preview: score + ranked fixes</CardTitle>
            <CardDescription>3 min read · Real audit for {exampleDomain}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="rounded-2xl border border-border/60 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Example</p>
                  <p className="mt-2 text-lg font-semibold text-foreground">{exampleDomain}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Public-mode audit</p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Score</p>
                  <p className="mt-1 text-3xl font-semibold text-foreground">{exampleScore.toFixed(1)}</p>
                  <p className="text-xs text-muted-foreground">Grade {exampleGrade}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">What you’ll get</p>
              <div className="mt-3 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
                  <span>
                    An A–F grade and a shareable report URL
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
                  <span>
                    Ranked fixes (highest impact first)
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
                  <span>
                    Copy‑paste snippets + plain-language explanations
                  </span>
                </div>
              </div>
            </div>

            <Button asChild className="h-11 w-full rounded-xl">
              <a
                href={exampleReportUrl}
                onClick={() => trackLinkClick("home_example_report_preview_cta", exampleReportUrl)}
              >
                Open the example report →
              </a>
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-border/60 bg-white/80 p-5 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <p className="font-semibold text-foreground">AI readiness score (A–F)</p>
              <p className="mt-1 text-sm text-muted-foreground">A single number your team can track and improve.</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-white/80 p-5 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-start gap-3">
            <ListChecks className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <p className="font-semibold text-foreground">Ranked fixes</p>
              <p className="mt-1 text-sm text-muted-foreground">See the highest-impact gaps first, with evidence.</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-white/80 p-5 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-start gap-3">
            <Code2 className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <p className="font-semibold text-foreground">Copy‑paste implementation</p>
              <p className="mt-1 text-sm text-muted-foreground">Snippets and steps you can ship in minutes.</p>
            </div>
          </div>
        </div>
      </section>

      <Card className="border-border/60 bg-white/70">
        <CardHeader>
          <CardTitle>Perfect for</CardTitle>
          <CardDescription>Who gets the most value from Agentability today.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm text-muted-foreground md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
            <p className="text-sm font-semibold text-foreground">API & platform teams</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Make your API discoverable and callable by AI tools with a spec + examples.
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
            <p className="text-sm font-semibold text-foreground">SaaS founders</p>
            <p className="mt-1 text-sm text-muted-foreground">
              See what blocks automation, then ship the top 2–5 fixes quickly.
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
            <p className="text-sm font-semibold text-foreground">DevRel & docs owners</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Turn docs into agent-friendly entrypoints (llms.txt, canonical docs, stable links).
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-white/70">
        <CardHeader>
          <CardTitle>How it works</CardTitle>
          <CardDescription>Specific outputs, not vague promises.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm text-muted-foreground md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Step 1</p>
            <p className="mt-2 text-sm font-semibold text-foreground">Paste your URL</p>
            <p className="mt-1 text-sm text-muted-foreground">Domain or full URL. No credentials needed.</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Step 2</p>
            <p className="mt-2 text-sm font-semibold text-foreground">We scan</p>
            <p className="mt-1 text-sm text-muted-foreground">Entrypoints, docs, OpenAPI, and tool surfaces.</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Step 3</p>
            <p className="mt-2 text-sm font-semibold text-foreground">You get a report</p>
            <p className="mt-1 text-sm text-muted-foreground">Ranked fixes with evidence and copy‑paste code.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-white/70">
        <CardHeader>
          <CardTitle>How we verify</CardTitle>
          <CardDescription>Transparent checks you can reproduce.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm text-muted-foreground md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
            <p className="text-sm font-semibold text-foreground">Live checks</p>
            <p className="mt-1 text-sm text-muted-foreground">
              We run a discovery audit across the apex domain and hosting mirrors to catch drift and broken surfaces.
            </p>
            <a
              className="mt-3 inline-flex text-sm font-medium text-primary hover:text-primary/80"
              href="/discovery/audit"
              onClick={() => trackLinkClick("home_verification", "/discovery/audit")}
            >
              See verification log →
            </a>
          </div>
          <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
            <p className="text-sm font-semibold text-foreground">Evidence bundles</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Reports include evidence links so teams can review exactly what was fetched and why a check failed.
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
            <p className="text-sm font-semibold text-foreground">Open source methodology</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The checks and scoring are versioned and public, so you can verify the rules behind your score.
            </p>
            <a
              className="mt-3 inline-flex text-sm font-medium text-primary hover:text-primary/80"
              href="/spec.md"
              onClick={() => trackLinkClick("home_spec", "/spec.md")}
            >
              Read the spec →
            </a>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-white/70">
        <CardHeader>
          <CardTitle>What we check automatically</CardTitle>
          <CardDescription>Human-readable checks tied to concrete fixes.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 text-sm text-muted-foreground md:grid-cols-2">
            <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
              <div className="flex items-start gap-3">
                <FileSearch className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold text-foreground">API documentation</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    OpenAPI (/.well-known/openapi.json), endpoint discoverability, and examples.
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold text-foreground">Trust signals</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Contact + legal URLs, plus verification metadata (air.json, ai-plugin.json).
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
              <div className="flex items-start gap-3">
                <ListChecks className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold text-foreground">Live endpoint status</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Do the public surfaces respond consistently with the right types?
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-white/80 p-4">
              <div className="flex items-start gap-3">
                <Code2 className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold text-foreground">Response quality</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Structured output, clear errors, and stable content across retries.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-white/70">
        <CardHeader>
          <CardTitle>Example reports</CardTitle>
          <CardDescription>Real audits you can skim in a few minutes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Want your site featured?{" "}
            <a
              className="text-primary hover:text-primary/80"
              href="mailto:hello@agentability.org"
              onClick={() => trackLinkClick("leaderboard_submit", "mailto:hello@agentability.org")}
            >
              Submit your site
            </a>
            .
          </p>
          {leaderboardQuery.isLoading ? <p>Loading showcase…</p> : null}
          {leaderboardQuery.isError ? <p>Showcase unavailable.</p> : null}
          {leaderboardQuery.data ? (
            <div className="grid gap-3 md:grid-cols-2">
              {leaderboardQuery.data.entries.map((entry, index) => (
                <div key={entry.domain} className="rounded-2xl border border-border/60 bg-white/80 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    #{index + 1}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">{entry.domain}</span>
                    <span className="text-sm font-semibold text-foreground">
                      {entry.score.toFixed(1)} ({entry.grade})
                    </span>
                  </div>
                  <a
                    className="mt-2 block text-xs text-primary"
                    href={entry.reportUrl}
                    onClick={() =>
                      trackLinkClick("leaderboard_report", entry.reportUrl, { domain: entry.domain, rank: index + 1 })
                    }
                  >
                    View report →
                  </a>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-white/70">
        <CardHeader>
          <CardTitle>FAQ</CardTitle>
          <CardDescription>Quick answers before you run your first audit.</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="what">
              <AccordionTrigger>What exactly do you check?</AccordionTrigger>
              <AccordionContent>
                We check agent discoverability (manifests and docs), callable surfaces (OpenAPI and tooling
                endpoints), trust signals (contact and legal), and reliability (stable responses across retries).
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="privacy">
              <AccordionTrigger>Is my data private?</AccordionTrigger>
              <AccordionContent>
                Agentability only evaluates public-facing URLs and never requires credentials. We store the report
                and an evidence bundle so results are shareable and verifiable.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="nocode">
              <AccordionTrigger>Can I fix issues if I’m not a developer?</AccordionTrigger>
              <AccordionContent>
                Many fixes are copy‑paste (publishing small files like OpenAPI, air.json, or llms.txt). For deeper
                issues, we still describe the problem in plain language so you can hand it to an engineer.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="score">
              <AccordionTrigger>What’s an “agentability score”?</AccordionTrigger>
              <AccordionContent>
                It’s a public-mode score for how usable your site is for AI tools: can they find the right
                entrypoints, understand your docs, and call your APIs reliably.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-white/70">
        <CardHeader>
          <CardTitle>Verification (technical)</CardTitle>
          <CardDescription>Live discovery audit across apex + hosting mirrors.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          {auditQuery.isLoading ? <p>Loading verification…</p> : null}
          {auditQuery.isError ? <p>Verification unavailable.</p> : null}
          {audit ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-white/80 px-4 py-3 text-xs uppercase tracking-wide">
                <span>Status</span>
                <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusTone}`}>
                  {statusLabel}
                </span>
              </div>

              <div className="text-xs text-muted-foreground">
                Last checked: <span className="font-medium text-foreground">{lastCheckedLabel}</span> · Spec v
                {audit.spec_version ?? "1.2"}
              </div>

              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="details">
                  <AccordionTrigger>Show technical details</AccordionTrigger>
                  <AccordionContent>
                    <div className="grid gap-3 text-xs sm:grid-cols-2">
                      <div className="rounded-xl border border-border/60 bg-white/80 p-3">
                        <p className="uppercase tracking-wide text-muted-foreground">Sources verified</p>
                        <p className="text-lg font-semibold text-foreground">{sourcesCount || "—"}</p>
                        <p className="text-[0.7rem] text-muted-foreground">Apex + hosting mirrors</p>
                        {sourceLabels.length ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {sourceLabels.map((label, index) => (
                              <span
                                key={`${label}-${index}`}
                                className="rounded-full border border-border/60 bg-white/80 px-2 py-0.5 text-[0.65rem] text-muted-foreground"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        ) : null}
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
                        <p className="text-lg font-semibold text-foreground">{liveErrorsTotal}</p>
                        <p className="text-[0.7rem] text-muted-foreground">
                          req {missingRequired + unreachableRequired} · opt {missingOptional + unreachableOptional}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <a
                        className="text-primary hover:text-primary/80"
                        href="/discovery/audit/latest.pretty.json"
                        onClick={() =>
                          trackLinkClick("audit_latest_pretty", "/discovery/audit/latest.pretty.json", {
                            status: audit.discoverability_health?.status,
                          })
                        }
                      >
                        View latest.pretty.json →
                      </a>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
