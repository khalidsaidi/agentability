import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { fetchLatest } from "@/lib/api";
import { ScoreBadge } from "@/components/ScoreBadge";
import { PillarBreakdown } from "@/components/PillarBreakdown";
import { FailuresList } from "@/components/FailuresList";
import { EvidenceLinks } from "@/components/EvidenceLinks";
import { CopyLinks } from "@/components/CopyLinks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ReportPage() {
  const params = useParams();
  const domain = params.domain ?? "";

  const query = useQuery({
    queryKey: ["report", domain],
    queryFn: () => fetchLatest(domain),
    enabled: Boolean(domain),
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

  return (
    <div className="space-y-8 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Report</p>
          <h1 className="text-3xl">{report.domain}</h1>
        </div>
        <ScoreBadge score={report.score} grade={report.grade} />
      </div>

      <div className="rounded-2xl border border-border/60 bg-white/70 p-4">
        <CopyLinks
          reportUrl={report.artifacts?.reportUrl}
          jsonUrl={report.artifacts?.jsonUrl}
          evidenceUrl={report.artifacts?.evidenceBundleUrl}
        />
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="bg-white/70">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-6">
          <PillarBreakdown pillarScores={report.pillarScores} />
          <div className="rounded-2xl border border-border/60 bg-white/70 p-4 text-sm text-muted-foreground">
            Latest run completed {new Date(report.completedAt ?? report.createdAt).toLocaleString()}.
          </div>
        </TabsContent>
        <TabsContent value="findings">
          <FailuresList checks={report.checks} />
        </TabsContent>
        <TabsContent value="evidence">
          <EvidenceLinks evidenceIndex={report.evidenceIndex} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
