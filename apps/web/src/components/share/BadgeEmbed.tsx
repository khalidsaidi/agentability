import { useMemo } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  domain: string;
};

function copy(text: string) {
  return navigator.clipboard.writeText(text);
}

export function BadgeEmbed({ domain }: Props) {
  const baseUrl = "https://agentability.org";
  const badgeUrl = useMemo(
    () => `${baseUrl}/badge/${encodeURIComponent(domain)}.svg`,
    [baseUrl, domain]
  );
  const reportUrl = useMemo(
    () => `${baseUrl}/reports/${encodeURIComponent(domain)}`,
    [baseUrl, domain]
  );
  const html = useMemo(
    () => `<a href="${reportUrl}"><img src="${badgeUrl}" alt="Agentability score" /></a>`,
    [badgeUrl, reportUrl]
  );
  const md = useMemo(
    () => `[![Agentability Score](${badgeUrl})](${reportUrl})`,
    [badgeUrl, reportUrl]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <img src={badgeUrl} alt="Agentability badge" className="h-6" />
        <a href={reportUrl} className="text-sm underline opacity-90">
          View report
        </a>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void copy(html)}>
          Copy HTML
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void copy(md)}>
          Copy Markdown
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void copy(badgeUrl)}>
          Copy badge URL
        </Button>
      </div>
    </div>
  );
}
