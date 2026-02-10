import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildA2ABenchSearchUrl, fetchCommunityFix } from "@/lib/api";
import { trackError, trackEvent, trackLinkClick } from "@/lib/analytics";

type Props = {
  runId: string;
  issueId: string;
};

export function CommunityFixPanel({ runId, issueId }: Props) {
  const query = useQuery({
    queryKey: ["community-fix", runId, issueId],
    queryFn: () => fetchCommunityFix(runId, issueId),
    enabled: Boolean(runId && issueId),
    staleTime: 1000 * 60 * 30,
  });

  useEffect(() => {
    if (query.isError) {
      trackError("community_fix_error", query.error, { run_id: runId, issue_id: issueId });
    }
  }, [query.isError, query.error, runId, issueId]);

  useEffect(() => {
    if (!query.data) return;
    trackEvent("community_fix_loaded", {
      run_id: runId,
      issue_id: issueId,
      status: query.data.status,
      mode: query.data.mode,
      cached: query.data.cached,
      citations: query.data.citations?.length ?? 0,
      has_answer: Boolean(query.data.answerMd),
    });
  }, [query.data, runId, issueId]);

  if (query.isLoading) {
    return (
      <div className="mt-4 rounded-xl border border-border/60 bg-white/80 p-3 text-xs text-muted-foreground">
        Loading community fixes…
      </div>
    );
  }

  const data = query.data;
  if (!data) {
    return null;
  }

  const fallbackSearch = data.searchUrl ?? buildA2ABenchSearchUrl(data.query);
  const hasSources = Boolean(data.citations && data.citations.length);

  if (data.status !== "ok") {
    return (
      <div className="mt-4 space-y-2 rounded-xl border border-border/60 bg-white/80 p-3 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
            Community fixes
          </span>
          <span className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
            Coming soon
          </span>
        </div>
        <div className="text-sm text-muted-foreground">
          We’re building a library of real-world implementation recipes. For now, you can{" "}
          <a
            className="text-primary hover:text-primary/80"
            href={fallbackSearch}
            target="_blank"
            rel="noreferrer"
            onClick={() =>
              trackLinkClick("community_fix_search", fallbackSearch, { run_id: runId, issue_id: issueId })
            }
          >
            search public examples
          </a>
          .
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-border/60 bg-white/80 p-3 text-xs text-muted-foreground">
      <div className="flex items-center justify-between">
        <span className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
          Community fixes
        </span>
        <span className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">A2ABench</span>
      </div>
      {data.answerMd ? (
        <div className="whitespace-pre-wrap text-sm text-foreground">{data.answerMd}</div>
      ) : (
        <div className="text-sm text-muted-foreground">
          No community recipe found yet.{" "}
          <a
            className="text-primary hover:text-primary/80"
            href={fallbackSearch}
            target="_blank"
            rel="noreferrer"
            onClick={() =>
              trackLinkClick("community_fix_search", fallbackSearch, { run_id: runId, issue_id: issueId })
            }
          >
            Search A2ABench
          </a>
          .
        </div>
      )}
      <div>
        <div className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">Sources</div>
        {hasSources ? (
          <ul className="mt-2 space-y-1">
            {data.citations?.map((citation) => (
              <li key={citation.url}>
                <a
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-words text-primary hover:text-primary/80"
                  onClick={() => trackLinkClick("community_fix_source", citation.url, { issue_id: issueId })}
                >
                  {citation.title ?? citation.url}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2 text-xs text-muted-foreground">
            Sources unavailable.{" "}
            <a
              className="text-primary hover:text-primary/80"
              href={fallbackSearch}
              target="_blank"
              rel="noreferrer"
              onClick={() =>
                trackLinkClick("community_fix_search", fallbackSearch, { run_id: runId, issue_id: issueId })
              }
            >
              Search A2ABench
            </a>
            .
          </div>
        )}
      </div>
    </div>
  );
}
