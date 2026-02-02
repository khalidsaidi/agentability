import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trackEvent, trackLinkClick } from "@/lib/analytics";

type URLInputCardProps = {
  onSubmit: (origin: string) => void;
  loading?: boolean;
  error?: string | null;
};

export function URLInputCard({ onSubmit, loading, error }: URLInputCardProps) {
  const [origin, setOrigin] = useState("");
  const changeTimer = useRef<number | null>(null);

  const emitInputChange = (value: string) => {
    const trimmed = value.trim();
    const hasProtocol = /^https?:\/\//i.test(trimmed);
    const hasDot = trimmed.includes(".");
    trackEvent("audit_input_change", {
      origin_length: trimmed.length,
      has_protocol: hasProtocol,
      has_dot: hasDot,
      is_empty: trimmed.length === 0,
    });
  };

  return (
    <Card className="border-border/60 bg-white/70 backdrop-blur">
      <CardHeader>
        <CardTitle className="text-xl">Run a public-mode audit</CardTitle>
        <CardDescription>
          Paste a domain or full URL. We will discover entrypoints, validate docs, and score readiness.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Want a quick demo? Try{" "}
          <a
            className="font-medium text-emerald-700 hover:text-emerald-900"
            href="/reports/aistatusdashboard.com"
            onClick={() => trackLinkClick("showcase_report_inline", "/reports/aistatusdashboard.com")}
          >
            the showcase report
          </a>
          .
        </p>
        <form
          className="flex flex-col gap-4 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = origin.trim();
            if (!trimmed) {
              trackEvent("audit_submit_empty");
              return;
            }
            trackEvent("audit_submit", {
              origin_raw: origin,
              origin_trimmed: trimmed,
              origin_length: trimmed.length,
              has_protocol: /^https?:\/\//i.test(trimmed),
            });
            onSubmit(trimmed);
          }}
        >
          <Input
            value={origin}
            onChange={(event) => {
              const value = event.target.value;
              setOrigin(value);
              if (changeTimer.current) {
                window.clearTimeout(changeTimer.current);
              }
              changeTimer.current = window.setTimeout(() => emitInputChange(value), 500);
            }}
            placeholder="example.com"
            className="h-12 text-base"
            onFocus={() => trackEvent("audit_input_focus")}
            onBlur={() => emitInputChange(origin)}
          />
          <Button type="submit" className="h-12 px-6" disabled={loading}>
            {loading ? "Running…" : "Run Audit"}
          </Button>
        </form>
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
