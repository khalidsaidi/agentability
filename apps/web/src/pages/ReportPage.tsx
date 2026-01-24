import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { fetchLatest } from "@/lib/api";
import { DEFAULT_DESCRIPTION, useSeo } from "@/lib/seo";
import { getFixIt } from "@agentability/shared";
import type { EvaluationProfile } from "@agentability/shared";
import { ScoreBadge } from "@/components/ScoreBadge";
import { PillarBreakdown } from "@/components/PillarBreakdown";
import { FailuresList } from "@/components/FailuresList";
import { EvidenceLinks } from "@/components/EvidenceLinks";
import { CopyLinks } from "@/components/CopyLinks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const PILLAR_LABELS = {
  discovery: "Discovery",
  callableSurface: "Callable Surface",
  llmIngestion: "LLM Ingestion",
  trust: "Trust",
  reliability: "Reliability",
} as const;

type PillarKey = keyof typeof PILLAR_LABELS;

const STATUS_RANK = {
  fail: 2,
  warn: 1,
  pass: 0,
} as const;

const SEVERITY_RANK = {
  high: 3,
  medium: 2,
  low: 1,
} as const;

const STATUS_SCORE = {
  pass: 1,
  warn: 0.5,
  fail: 0,
} as const;

const PILLAR_DETAILS: Record<
  PillarKey,
  { description: string; signals: string; fixes: string }
> = {
  discovery: {
    description: "How easy it is for an agent to find your public entrypoints and docs.",
    signals: "Machine entrypoint files, clear links, and crawlable paths.",
    fixes: "Publish /.well-known/air.json and link it to your docs and API.",
  },
  callableSurface: {
    description: "Whether your API is described clearly enough for tools to call.",
    signals: "A valid API description file with endpoints and examples.",
    fixes: "Publish an OpenAPI file with clear endpoints and examples.",
  },
  llmIngestion: {
    description: "Whether your docs are easy for AI to read and keep in memory.",
    signals: "A public docs page with real text and stable URLs.",
    fixes: "Keep docs text-first, stable, and linked from the manifest.",
  },
  trust: {
    description: "Signals that the site is official and safe to use.",
    signals: "Verification files, contact info, and legal links.",
    fixes: "Publish a simple verification file and contact info.",
  },
  reliability: {
    description: "Whether important pages respond consistently over time.",
    signals: "Same status, content type, and body on repeat requests.",
    fixes: "Remove flaky redirects and random output.",
  },
};

const PROFILE_WEIGHTS: Record<EvaluationProfile, Record<PillarKey, number>> = {
  auto: {
    discovery: 0.3,
    callableSurface: 0.2,
    llmIngestion: 0.2,
    trust: 0.1,
    reliability: 0.2,
  },
  api_product: {
    discovery: 0.35,
    callableSurface: 0.3,
    llmIngestion: 0.15,
    trust: 0.1,
    reliability: 0.1,
  },
  docs_platform: {
    discovery: 0.25,
    callableSurface: 0.15,
    llmIngestion: 0.35,
    trust: 0.1,
    reliability: 0.15,
  },
  content: {
    discovery: 0.3,
    callableSurface: 0.05,
    llmIngestion: 0.35,
    trust: 0.1,
    reliability: 0.2,
  },
  hybrid: {
    discovery: 0.3,
    callableSurface: 0.2,
    llmIngestion: 0.25,
    trust: 0.1,
    reliability: 0.15,
  },
};

const CHECK_DETAILS: Record<
  string,
  { title: string; why: string; impact: string; fix: string }
> = {
  D1: {
    title: "Machine entrypoints exist",
    why: "Agents need a clear place to start.",
    impact: "Without it, they may never find your API or docs.",
    fix: "Publish /.well-known/air.json and link to your API and docs.",
  },
  D2: {
    title: "Entrypoints are reachable and stable",
    why: "The entrypoints must load reliably every time.",
    impact: "Flaky responses confuse agents and break automation.",
    fix: "Make entrypoints return 200 with the right content type every time.",
  },
  D3: {
    title: "Discovery coherence",
    why: "All your files should point to the same places.",
    impact: "Conflicting links make agents give up or call the wrong thing.",
    fix: "Align URLs across air.json, OpenAPI, and docs.",
  },
  D4: {
    title: "Robots and crawling sanity",
    why: "Robots rules should not block important public files.",
    impact: "Agents might be blocked from reading your entrypoints.",
    fix: "Allow /.well-known, /openapi.*, and docs paths in robots.txt.",
  },
  C2: {
    title: "OpenAPI is parsable and callable",
    why: "Tools rely on a clear API description.",
    impact: "Incomplete specs cause bad requests.",
    fix: "Publish a valid OpenAPI file with endpoints, parameters, and examples.",
  },
  C3: {
    title: "MCP endpoint responds correctly",
    why: "Agents use MCP for tool discovery and calls.",
    impact: "Missing MCP responses block automated access.",
    fix: "Ensure /mcp returns an explainer on GET and a JSON-RPC initialize response on POST.",
  },
  L1: {
    title: "Canonical docs entrypoint exists",
    why: "Docs explain how to use the product safely.",
    impact: "Without docs, agents guess and get it wrong.",
    fix: "Publish a public /docs page and link it from air.json.",
  },
  L4: {
    title: "Docs link integrity",
    why: "Docs should not send agents to dead ends.",
    impact: "Broken links reduce confidence and completeness.",
    fix: "Fix or remove broken docs links.",
  },
  R3: {
    title: "Repeat-request consistency",
    why: "Agents expect the same input to return the same output.",
    impact: "Random changes reduce trust and break caching.",
    fix: "Remove random output (timestamps, IDs) from critical pages.",
  },
  T1: {
    title: "air.json completeness",
    why: "Agents need a complete manifest to trust and route correctly.",
    impact: "Missing fields block discovery, legal review, or tool routing.",
    fix: "Fill required fields in air.json, including contact and legal URLs.",
  },
  T2: {
    title: "AI plugin metadata is complete",
    why: "Legal and contact metadata helps agents and humans trust the surface.",
    impact: "Missing fields reduce trust and may block integrations.",
    fix: "Ensure ai-plugin.json includes contact_email and a legal_info_url with /terms.",
  },
};

const PILLAR_ACTIONS: Record<PillarKey, string[]> = {
  discovery: [
    "Add /.well-known/air.json with links to your API and docs.",
    "Mirror your API description at /.well-known/openapi.json and /openapi.json.",
  ],
  callableSurface: [
    "Publish a clear API description file (OpenAPI) with endpoints and examples.",
    "Add example requests and responses so tools can call correctly.",
    "Expose /mcp so agents can discover and initialize tools.",
  ],
  llmIngestion: [
    "Publish a stable docs page with clear headings and examples.",
    "Add llms.txt so agents can find the docs quickly.",
  ],
  trust: [
    "Complete air.json with contact, legal, and verification fields.",
    "Add contact and legal URLs in ai-plugin.json.",
  ],
  reliability: [
    "Keep critical pages stable for the same inputs.",
    "Avoid redirects that change behavior across retries.",
  ],
};

const CHECK_PILLAR_BY_ID: Record<string, PillarKey> = {
  D1: "discovery",
  D2: "discovery",
  D3: "discovery",
  D4: "discovery",
  C2: "callableSurface",
  C3: "callableSurface",
  L1: "llmIngestion",
  L4: "llmIngestion",
  T1: "trust",
  T2: "trust",
  R3: "reliability",
};

const CHECK_PILLAR_BY_PREFIX: Record<string, PillarKey> = {
  D: "discovery",
  C: "callableSurface",
  L: "llmIngestion",
  T: "trust",
  R: "reliability",
};

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function formatWeight(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatProfile(profile: EvaluationProfile): string {
  return profile.split("_").join(" ");
}

function inferPillar(checkId: string): PillarKey | undefined {
  if (CHECK_PILLAR_BY_ID[checkId]) return CHECK_PILLAR_BY_ID[checkId];
  const prefix = checkId.trim().charAt(0).toUpperCase();
  return CHECK_PILLAR_BY_PREFIX[prefix];
}

function formatPoints(value: number | undefined): string {
  if (!value || Number.isNaN(value)) return "n/a";
  return `${value.toFixed(1)} pts`;
}

export function ReportPage() {
  const params = useParams();
  const domain = params.domain ?? "";
  const normalizedDomain = domain.trim().toLowerCase();
  const isShowcase =
    normalizedDomain === "aistatusdashboard.com" || normalizedDomain === "www.aistatusdashboard.com";

  const query = useQuery({
    queryKey: ["report", domain],
    queryFn: () => fetchLatest(domain),
    enabled: Boolean(domain),
  });
  const reportTitle = query.data?.domain
    ? `Report: ${query.data.domain}`
    : domain
    ? `Report: ${domain}`
    : "Agentability report";
  const reportDescription = query.data
    ? `Agentability report for ${query.data.domain}. Score ${query.data.score}/100 in public mode.`
    : DEFAULT_DESCRIPTION;
  const reportPath = domain ? `/reports/${encodeURIComponent(domain)}` : "/reports";
  useSeo({
    title: reportTitle,
    description: reportDescription,
    path: reportPath,
    type: "article",
  });

  if (query.isLoading) {
    return <div className="animate-fade-up text-sm text-muted-foreground">Loading report…</div>;
  }

  if (query.isError || !query.data) {
    return (
      <div className="animate-fade-up">
        <p className="text-sm text-destructive">Report not found.</p>
        <Link className="text-sm text-emerald-700" to="/">
          Back to home
        </Link>
      </div>
    );
  }

  const report = query.data;
  const diff = report.diff;
  const previousSummary = report.previousSummary;
  const pillarEntries = Object.entries(report.pillarScores) as [PillarKey, number][];
  const sortedPillars = [...pillarEntries].sort((a, b) => b[1] - a[1]);
  const strongest = sortedPillars.slice(0, 2);
  const weakest = [...sortedPillars].reverse().slice(0, 2);

  const failCount = report.checks.filter((check) => check.status === "fail").length;
  const warnCount = report.checks.filter((check) => check.status === "warn").length;
  const fixItChecks = report.checks.filter((check) => check.status !== "pass");
  const scoreDelta = diff?.scoreDelta ?? 0;
  const scoreDeltaLabel = diff
    ? scoreDelta === 0
      ? "No change"
      : scoreDelta > 0
      ? `▲ +${scoreDelta.toFixed(1)}`
      : `▼ ${scoreDelta.toFixed(1)}`
    : null;

  const issueChecks = report.checks
    .filter((check) => check.status !== "pass")
    .sort((a, b) => {
      const statusDelta = STATUS_RANK[b.status] - STATUS_RANK[a.status];
      if (statusDelta !== 0) return statusDelta;
      return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    });
  const weights = PROFILE_WEIGHTS[report.profile];
  const weightSummary = (Object.entries(weights) as [PillarKey, number][])
    .map(([key, value]) => `${PILLAR_LABELS[key]} ${formatWeight(value)}`)
    .join(", ");
  const pillarCounts = pillarEntries.reduce(
    (acc, [key]) => {
      acc[key] = 0;
      return acc;
    },
    {
      discovery: 0,
      callableSurface: 0,
      llmIngestion: 0,
      trust: 0,
      reliability: 0,
    } as Record<PillarKey, number>
  );
  for (const check of report.checks) {
    const pillar = inferPillar(check.id);
    if (pillar) pillarCounts[pillar] += 1;
  }
  const issueInsights = issueChecks
    .map((check) => {
      const pillar = inferPillar(check.id);
      const max = pillar ? pillarCounts[pillar] : 0;
      const weight = pillar ? weights[pillar] : 0;
      const impact =
        pillar && max
          ? (1 - STATUS_SCORE[check.status]) * (100 / max) * weight
          : undefined;
      return {
        check,
        pillar,
        impact,
        detail: CHECK_DETAILS[check.id],
      };
    })
    .sort((a, b) => {
      const impactDelta = (b.impact ?? 0) - (a.impact ?? 0);
      if (impactDelta !== 0) return impactDelta;
      const statusDelta = STATUS_RANK[b.check.status] - STATUS_RANK[a.check.status];
      if (statusDelta !== 0) return statusDelta;
      return SEVERITY_RANK[b.check.severity] - SEVERITY_RANK[a.check.severity];
    });
  const priorityFixes = issueInsights.slice(0, 3);
  const estimatedLoss = issueInsights.reduce((sum, item) => sum + (item.impact ?? 0), 0);
  const scoreGap = Math.max(0, 100 - report.score);
  const coverageGaps = (Object.keys(weights) as PillarKey[]).filter(
    (pillar) => weights[pillar] > 0 && pillarCounts[pillar] === 0
  );
  const coverageLoss = coverageGaps.reduce((sum, pillar) => sum + weights[pillar] * 100, 0);
  const coverageSummary = coverageGaps
    .map((pillar) => `${PILLAR_LABELS[pillar]} (${formatWeight(weights[pillar])})`)
    .join(", ");
  const improvementActions = [
    ...priorityFixes.flatMap((item) => (item.detail?.fix ? [item.detail.fix] : [])),
    ...coverageGaps.flatMap((pillar) => PILLAR_ACTIONS[pillar] ?? []),
  ];
  const uniqueActions = Array.from(new Set(improvementActions)).slice(0, 6);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://agentability.org";
  const badgeUrl = `${baseUrl}/badge/${report.domain}.svg`;
  const certUrl = `${baseUrl}/cert/${report.domain}`;
  const reportUrl = report.artifacts?.reportUrl ?? `${baseUrl}/reports/${report.domain}`;
  const badgeEmbedSnippet = `<a href="${reportUrl}"><img src="${badgeUrl}" alt="Agentability score for ${report.domain}" /></a>`;

  return (
    <div className="space-y-8 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Report</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl">{report.domain}</h1>
            {isShowcase ? <Badge variant="outline">Showcase example</Badge> : null}
          </div>
        </div>
        <ScoreBadge score={report.score} grade={report.grade} />
      </div>

      {isShowcase ? (
        <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/70 p-4 text-sm text-emerald-900">
          This report is a public demo to showcase Agentability scoring and recommendations.
        </div>
      ) : null}

      <div className="rounded-2xl border border-border/60 bg-white/70 p-4">
        <CopyLinks
          reportUrl={report.artifacts?.reportUrl}
          jsonUrl={report.artifacts?.jsonUrl}
          evidenceUrl={report.artifacts?.evidenceBundleUrl}
        />
      </div>

      <Card className="border-border/60 bg-white/70">
        <CardHeader>
          <CardTitle>Badge & certificate</CardTitle>
          <CardDescription>Embed your Agentability score anywhere.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <img src={badgeUrl} alt={`Agentability badge for ${report.domain}`} className="h-10" />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" asChild>
                <a href={certUrl}>View certificate</a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void navigator.clipboard?.writeText(badgeEmbedSnippet)}
              >
                Copy embed HTML
              </Button>
            </div>
          </div>
          <code className="block rounded-lg border border-border/60 bg-white/70 p-3 text-xs text-foreground">
            {badgeEmbedSnippet}
          </code>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="bg-white/70">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-6">
          <Card className="border-border/60 bg-white/70">
            <CardHeader>
              <CardTitle>What changed since last run</CardTitle>
              <CardDescription>Run-to-run delta and stability signals.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              {!diff ? (
                <p>First run — no previous comparison.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-white/80 px-3 py-2">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Score delta</span>
                    <span className="font-semibold text-foreground">{scoreDeltaLabel}</span>
                  </div>
                  {previousSummary ? (
                    <p>
                      Previous:{" "}
                      <span className="font-medium text-foreground">
                        {previousSummary.score} ({previousSummary.grade})
                      </span>
                      {previousSummary.completedAt ? ` • ${previousSummary.completedAt}` : null}
                    </p>
                  ) : null}
                  <div className="grid gap-2 md:grid-cols-2">
                    {Object.entries(diff.pillarDelta).map(([pillar, delta]) => (
                      <div key={pillar} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                        <span className="text-xs uppercase tracking-wide">
                          {PILLAR_LABELS[pillar as PillarKey] ?? pillar}
                        </span>
                        <span className="font-semibold text-foreground">
                          {delta === 0 ? "0" : delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New issues</div>
                      {diff.newIssues.length ? (
                        <ul className="mt-2 space-y-1">
                          {diff.newIssues.map((issue) => (
                            <li key={`${issue.checkId}-${issue.to}`}>
                              <span className="font-semibold text-foreground">{issue.checkId}</span> →{" "}
                              {issue.to} ({issue.severity})
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2">No new issues detected.</p>
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fixed</div>
                      {diff.fixedIssues.length ? (
                        <ul className="mt-2 space-y-1">
                          {diff.fixedIssues.map((issue) => (
                            <li key={`${issue.checkId}-${issue.to}`}>
                              <span className="font-semibold text-foreground">{issue.checkId}</span> →{" "}
                              {issue.to} ({issue.severity})
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2">No fixes detected.</p>
                      )}
                    </div>
                  </div>
                  <Accordion type="single" collapsible>
                    <AccordionItem value="changed">
                      <AccordionTrigger>Changed details</AccordionTrigger>
                      <AccordionContent>
                        {diff.changed.length ? (
                          <ul className="space-y-1">
                            {diff.changed.map((issue) => (
                              <li key={`${issue.checkId}-${issue.to}`}>
                                <span className="font-semibold text-foreground">{issue.checkId}</span> → {issue.to}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>No additional changes.</p>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </>
              )}
            </CardContent>
          </Card>
          <PillarBreakdown pillarScores={report.pillarScores} />
          <Card className="border-border/60 bg-white/70">
            <CardHeader>
              <CardTitle>What this means</CardTitle>
              <CardDescription>Plain-language summary of the score and priorities.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Score {report.score} ({report.grade}).{" "}
                {failCount === 0 && warnCount === 0
                  ? "All public-mode checks passed."
                  : `${pluralize(failCount, "fail")} and ${pluralize(
                      warnCount,
                      "warning"
                    )} across ${report.checks.length} checks.`}
              </p>
              <p>
                <span className="font-medium text-foreground">Strongest pillars:</span>{" "}
                {strongest.map(([key, value]) => `${PILLAR_LABELS[key]} ${value}`).join(", ")}.
              </p>
              <p>
                <span className="font-medium text-foreground">Most to improve:</span>{" "}
                {weakest.map(([key, value]) => `${PILLAR_LABELS[key]} ${value}`).join(", ")}.
              </p>
              {priorityFixes.length ? (
                <div className="space-y-2">
                  <div className="font-medium text-foreground">Priority fixes</div>
                  <ul className="space-y-1">
                    {priorityFixes.map(({ check, impact, detail }) => (
                      <li key={check.id}>
                        <span className="font-semibold text-foreground">{check.id}</span> —{" "}
                        {detail?.fix ?? check.summary}
                        {impact ? (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            (est. -{impact.toFixed(1)} pts)
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p>Keep the current surfaces stable as you expand public documentation and entrypoints.</p>
              )}
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-white/70">
            <CardHeader>
              <CardTitle>How to reach 100</CardTitle>
              <CardDescription>Plain-language reasons and concrete next steps.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="space-y-1">
                <p>
                  Score gap: {scoreGap} points.{" "}
                  {issueInsights.length
                    ? `Failed or warned checks account for about ${estimatedLoss.toFixed(1)} points.`
                    : "All checks in this run passed."}{" "}
                  {coverageGaps.length
                    ? `Public mode v1 does not score ${coverageSummary} yet, so the highest possible score right now is about ${Math.round(
                        100 - coverageLoss
                      )}.`
                    : null}
                </p>
                <p className="text-xs">
                  We only count what can be verified from public URLs with strict safety limits.
                </p>
              </div>
              {issueInsights.length ? (
                <div className="space-y-3">
                  {issueInsights.map(({ check, pillar, impact, detail }) => (
                    <div
                      key={check.id}
                      className="rounded-lg border border-border/60 bg-white/60 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{check.id}</Badge>
                        <Badge>{check.severity}</Badge>
                        {pillar ? (
                          <Badge variant="outline">{PILLAR_LABELS[pillar]}</Badge>
                        ) : null}
                        <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          {check.status}
                        </span>
                        {impact !== undefined ? (
                          <span className="text-xs text-foreground">-{formatPoints(impact)}</span>
                        ) : null}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-foreground">
                        {detail?.title ?? check.summary}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Why it matters: {detail?.why ?? "This check verifies core agent access."}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Impact: {detail?.impact ?? "Agents may fail to discover or use the surface."}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        What to do: {detail?.fix ?? check.summary}
                      </p>
                      {check.evidence.length ? (
                        <div className="mt-2 flex flex-col gap-1 text-[0.7rem] text-muted-foreground">
                          {check.evidence.slice(0, 3).map((item) => (
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
              ) : null}
              {coverageGaps.length ? (
                <div className="space-y-3">
                  <div className="text-sm font-medium text-foreground">Unscored areas to prepare now</div>
                  {coverageGaps.map((pillar) => (
                    <div
                      key={pillar}
                      className="rounded-lg border border-border/60 bg-white/60 p-3 text-xs text-muted-foreground"
                    >
                      <div className="text-sm font-semibold text-foreground">
                        {PILLAR_LABELS[pillar]}
                      </div>
                      <p className="mt-1">{PILLAR_DETAILS[pillar].description}</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {PILLAR_ACTIONS[pillar].map((action) => (
                          <li key={action}>{action}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}
              {uniqueActions.length ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">Concrete recommendations</div>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {uniqueActions.map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {!issueInsights.length && !coverageGaps.length ? (
                <p>All checks passed. Maintain stability as you expand public surfaces.</p>
              ) : null}
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-white/70">
            <CardHeader>
              <CardTitle>Detailed explanation</CardTitle>
              <CardDescription>How the score was computed and why the issues matter.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 text-sm text-muted-foreground">
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">How scoring works</div>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Each check can pass, warn, or fail. Pass gets full credit, warn gets half.</li>
                  <li>Pillar scores are the average of checks inside that pillar.</li>
                  <li>Total score is a weighted average based on the profile used for this run.</li>
                  <li>Grades: A 90-100, B 80-89, C 70-79, below 70 is Not AI-Native.</li>
                  <li>Public mode uses only public URLs with strict time and size limits.</li>
                </ul>
                <p className="text-xs text-muted-foreground">
                  Profile: {formatProfile(report.profile)}. Focus: {weightSummary}.
                </p>
              </div>
              <div className="space-y-3">
                <div className="text-sm font-medium text-foreground">Pillars explained</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {(Object.entries(PILLAR_DETAILS) as [PillarKey, (typeof PILLAR_DETAILS)[PillarKey]][]).map(
                    ([key, detail]) => (
                      <div key={key} className="rounded-lg border border-border/60 bg-white/60 p-3">
                        <div className="text-sm font-semibold text-foreground">
                          {PILLAR_LABELS[key]}
                        </div>
                        <p className="mt-1 text-xs">{detail.description}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Signals: {detail.signals}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">Typical fix: {detail.fixes}</p>
                      </div>
                    )
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <div className="text-sm font-medium text-foreground">Why the flagged checks matter</div>
                <p className="text-xs">
                  Use the "Why not 100" section for per-check deductions, fixes, and evidence.
                </p>
              </div>
            </CardContent>
          </Card>
          <div className="rounded-2xl border border-border/60 bg-white/70 p-4 text-sm text-muted-foreground">
            Latest run completed {new Date(report.completedAt ?? report.createdAt).toLocaleString()}.
          </div>
        </TabsContent>
        <TabsContent value="findings">
          <FailuresList checks={report.checks} />
          <Card className="mt-6 border-border/60 bg-white/70">
            <CardHeader>
              <CardTitle>Fix-it snippets</CardTitle>
              <CardDescription>Copy/paste remediations for failed or warned checks.</CardDescription>
            </CardHeader>
            <CardContent>
              {fixItChecks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No fixes needed. All checks passed.</p>
              ) : (
                <Accordion type="multiple" className="space-y-3">
                  {fixItChecks.map((check) => {
                    const fix = getFixIt(check.id, check.recommendationId);
                    if (!fix) return null;
                    return (
                      <AccordionItem key={check.id} value={check.id} className="border border-border/60 px-4">
                        <AccordionTrigger>
                          {fix.title} ({check.id})
                        </AccordionTrigger>
                        <AccordionContent className="space-y-3 text-sm text-muted-foreground">
                          <p>{fix.whyItMatters}</p>
                          <ul className="list-disc space-y-1 pl-5">
                            {fix.steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ul>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                                Snippet
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void navigator.clipboard?.writeText(fix.snippet)}
                              >
                                Copy
                              </Button>
                            </div>
                            <pre className="whitespace-pre-wrap rounded-lg border border-border/60 bg-white/80 p-3 text-xs text-foreground">
                              {fix.snippet}
                            </pre>
                          </div>
                          {fix.links?.length ? (
                            <div className="space-y-1">
                              {fix.links.map((link) => (
                                <a key={link} className="text-emerald-700 hover:text-emerald-900" href={link}>
                                  {link}
                                </a>
                              ))}
                            </div>
                          ) : null}
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="evidence">
          <EvidenceLinks evidenceIndex={report.evidenceIndex} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
