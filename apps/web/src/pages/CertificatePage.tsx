import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { fetchLatest } from "@/lib/api";
import { DEFAULT_DESCRIPTION, useSeo } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CertSeal } from "@/components/brand/CertSeal";
import { BadgeEmbed } from "@/components/share/BadgeEmbed";

export function CertificatePage() {
  const params = useParams();
  const domain = params.domain ?? "";

  const query = useQuery({
    queryKey: ["certificate", domain],
    queryFn: () => fetchLatest(domain),
    enabled: Boolean(domain),
  });

  const title = domain ? `Agentability Certificate — ${domain}` : "Agentability Certificate";
  useSeo({
    title,
    description: domain ? `Agentability certificate for ${domain}.` : DEFAULT_DESCRIPTION,
    path: domain ? `/cert/${encodeURIComponent(domain)}` : "/cert",
    type: "article",
  });

  if (query.isLoading) {
    return <div className="animate-fade-up text-sm text-muted-foreground">Loading certificate…</div>;
  }

  if (query.isError || !query.data) {
    return (
      <div className="animate-fade-up">
        <p className="text-sm text-destructive">Certificate not found.</p>
        <Link className="text-sm text-emerald-700" to="/">
          Back to home
        </Link>
      </div>
    );
  }

  const report = query.data;
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://agentability.org";
  const reportUrl = report.artifacts?.reportUrl ?? `${baseUrl}/reports/${report.domain}`;
  const jsonUrl = report.artifacts?.jsonUrl ?? `${baseUrl}/v1/evaluations/${report.domain}/latest.json`;
  const verifiedOn = (report.completedAt ?? report.createdAt).split("T")[0];
  const specVersion = report.engine?.specVersion ?? "1.2";

  return (
    <div className="space-y-8 animate-fade-up">
      <Card className="border-border/60 bg-white/70">
        <CardHeader>
          <CardTitle className="text-2xl">Agentability Certificate</CardTitle>
          <CardDescription>Verified AI-native readiness signal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="grid gap-6 md:grid-cols-[1.3fr_0.7fr] md:items-center">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Domain</p>
                  <p className="text-lg font-semibold text-foreground">{report.domain}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Score</p>
                  <p className="text-lg font-semibold text-foreground">
                    {report.score} ({report.grade})
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-border/60 bg-white/80 p-3">
                Verified on <span className="font-medium text-foreground">{verifiedOn}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-lg border border-border/60 bg-white/80 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Spec version</p>
                  <p className="font-medium text-foreground">{specVersion}</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-white/80 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Engine version</p>
                  <p className="font-medium text-foreground">{report.engine?.version ?? "0.1.0"}</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-white/80 p-3 md:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Ruleset hash</p>
                  <p className="break-all font-medium text-foreground">
                    {report.engine?.rulesetHash ?? "n/a"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="secondary" size="sm">
                  <a href={reportUrl}>View report</a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={jsonUrl}>View JSON</a>
                </Button>
                {report.artifacts?.evidenceBundleUrl ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={report.artifacts.evidenceBundleUrl}>View evidence</a>
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="text-foreground">
              <CertSeal specVersion={specVersion} dateISO={verifiedOn} className="mx-auto w-56" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-white/70">
        <CardHeader>
          <CardTitle>Embed the badge</CardTitle>
          <CardDescription>Share verification anywhere with a static badge.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <BadgeEmbed domain={report.domain} />
        </CardContent>
      </Card>
    </div>
  );
}
