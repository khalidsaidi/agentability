import type { EvaluationResult } from "@agentability/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trackLinkClick } from "@/lib/analytics";

const emptyLabel = "No evidence captured.";

export function EvidenceLinks({ evidenceIndex }: { evidenceIndex: EvaluationResult["evidenceIndex"] }) {
  const sections = [
    { label: "Entrypoints", items: evidenceIndex.entrypoints },
    { label: "Callable Surface", items: evidenceIndex.callable ?? [] },
    { label: "Docs", items: evidenceIndex.docs ?? [] },
    { label: "Attestations", items: evidenceIndex.attestations ?? [] },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {sections.map((section) => (
        <Card key={section.label} className="bg-white/70">
          <CardHeader>
            <CardTitle className="text-base">{section.label}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {section.items.length ? (
              <ul className="space-y-2">
                {section.items.map((item) => (
                  <li key={item}>
                    <a
                      href={item}
                      target="_blank"
                      rel="noreferrer"
                      className="break-words text-foreground hover:text-primary"
                      onClick={() => trackLinkClick("evidence_link", item, { section: section.label })}
                    >
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              emptyLabel
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
