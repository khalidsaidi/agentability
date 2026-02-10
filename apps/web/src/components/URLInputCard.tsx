import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trackEvent } from "@/lib/analytics";

type URLInputCardProps = {
  onSubmit: (origin: string) => void;
  loading?: boolean;
  error?: string | null;
};

function tryNormalizeOrigin(raw: string): { origin: string; domain: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/\s/.test(trimmed)) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    const domain = parsed.hostname.toLowerCase();
    if (!domain.includes(".")) return null;
    const origin = `${parsed.protocol}//${parsed.host}`;
    return { origin, domain };
  } catch {
    return null;
  }
}

export function URLInputCard({ onSubmit, loading, error }: URLInputCardProps) {
  const [origin, setOrigin] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
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

  const trimmed = origin.trim();
  const normalized = useMemo(() => tryNormalizeOrigin(trimmed), [trimmed]);
  const liveHint = trimmed.length
    ? normalized
      ? `Looks good — we'll audit ${normalized.domain}.`
      : "That doesn't look like a valid public domain or URL."
    : null;

  const serverError = !localError && error ? error.trim() : null;
  const showAuditFailedHelp = Boolean(serverError && /evaluation failed/i.test(serverError));

  return (
    <Card className="border-border/60 bg-white/80 shadow-sm backdrop-blur transition-transform duration-200 hover:scale-[1.01]">
      <div className="p-5 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Live public audit
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Paste a website or API URL. You’ll get a score, ranked fixes, and copy-paste instructions.
            </p>
          </div>
        </div>

        <form
          className="flex flex-col gap-3 min-[1200px]:flex-row min-[1200px]:items-start"
          onSubmit={(event) => {
            event.preventDefault();
            if (loading) {
              trackEvent("audit_submit_while_loading");
              return;
            }
            const raw = origin.trim();
            if (!raw) {
              setLocalError("Paste a domain or URL (example: your-site.com).");
              trackEvent("audit_submit_empty");
              return;
            }
            const parsed = tryNormalizeOrigin(raw);
            if (!parsed) {
              setLocalError("That doesn't look like a valid public domain or URL.");
              trackEvent("audit_submit_invalid", { origin_trimmed: raw });
              return;
            }

            setLocalError(null);
            trackEvent("audit_submit", {
              origin_raw: origin,
              origin_trimmed: raw,
              origin_length: raw.length,
              has_protocol: /^https?:\/\//i.test(raw),
              normalized_origin: parsed.origin,
              normalized_domain: parsed.domain,
            });
            onSubmit(raw);
          }}
        >
          <div className="flex-1">
            <div className="group relative">
              <input
                id="audit-origin"
                value={origin}
                onChange={(event) => {
                  const value = event.target.value;
                  setOrigin(value);
                  if (localError) setLocalError(null);
                  if (changeTimer.current) {
                    window.clearTimeout(changeTimer.current);
                  }
                  changeTimer.current = window.setTimeout(() => emitInputChange(value), 500);
                }}
                placeholder="your-site.com or url/api"
                className="peer min-h-[76px] w-full rounded-2xl border border-input bg-white/80 px-4 pb-3 pt-7 text-lg shadow-sm transition-all duration-200 placeholder:text-muted-foreground/70 hover:border-primary/30 hover:shadow-md focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 md:text-2xl"
                inputMode="url"
                autoComplete="url"
                onFocus={() => trackEvent("audit_input_focus")}
                onBlur={() => emitInputChange(origin)}
                aria-invalid={Boolean(localError || error)}
                aria-describedby="audit-origin-help audit-origin-error"
              />
              <label
                htmlFor="audit-origin"
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground transition-all duration-200 peer-focus:top-3 peer-focus:translate-y-0 peer-focus:text-[0.7rem] peer-focus:text-primary peer-[&:not(:placeholder-shown)]:top-3 peer-[&:not(:placeholder-shown)]:translate-y-0 peer-[&:not(:placeholder-shown)]:text-[0.7rem]"
              >
                Website or API URL
              </label>

              {trimmed.length ? (
                normalized ? (
                  <CheckCircle2 className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
                ) : (
                  <AlertTriangle className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-amber-600" />
                )
              ) : null}
            </div>

            <div id="audit-origin-help" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Live report
              </span>
              <span className="opacity-50">•</span>
              <span>Public surfaces only</span>
              <span className="opacity-50">•</span>
              <span>No sign-up</span>
              <span className="opacity-50">•</span>
              <span>Usually done in 30–60s</span>
              <span className="opacity-50">•</span>
              <span>Free</span>
            </div>

            {!trimmed.length ? (
              <div className="mt-2 text-xs text-muted-foreground">
                Try:{" "}
                <button
                  type="button"
                  className="font-medium text-primary hover:text-primary/80"
                  onClick={() => setOrigin("aistatusdashboard.com")}
                >
                  aistatusdashboard.com
                </button>
                <span className="opacity-50">, </span>
                <button
                  type="button"
                  className="font-medium text-primary hover:text-primary/80"
                  onClick={() => setOrigin("agentability.org")}
                >
                  agentability.org
                </button>
              </div>
            ) : null}
          </div>

          <Button
            type="submit"
            className="h-[76px] w-full rounded-2xl bg-gradient-to-br from-primary to-primary/80 px-7 text-base shadow-md shadow-primary/20 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/30 active:translate-y-0 min-[1200px]:mt-0 min-[1200px]:w-auto"
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loading ? "Running..." : "Run free audit"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>

        {liveHint ? (
          <p className={`mt-3 text-sm ${normalized ? "text-primary" : "text-amber-700"}`}>{liveHint}</p>
        ) : null}

        {localError ? (
          <p id="audit-origin-error" className="mt-3 text-sm text-destructive">
            {localError}
          </p>
        ) : null}

        {!localError && serverError ? (
          showAuditFailedHelp ? (
            <div
              id="audit-origin-error"
              className="mt-3 space-y-2 rounded-2xl border border-destructive/30 bg-white/80 p-4 text-sm text-muted-foreground"
            >
              <p className="font-semibold text-destructive">We couldn’t complete this audit.</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>The domain may block automated checks (WAF/bot protection).</li>
                <li>The site may be timing out or returning oversized responses.</li>
                <li>A redirect may lead to a blocked or private destination.</li>
              </ul>
              <p className="text-xs text-muted-foreground">
                Try again, or try a known working example like{" "}
                <button
                  type="button"
                  className="font-medium text-primary hover:text-primary/80"
                  onClick={() => setOrigin("aistatusdashboard.com")}
                >
                  aistatusdashboard.com
                </button>
                .
              </p>
              <p className="text-xs text-muted-foreground">Details: {serverError}</p>
            </div>
          ) : (
            <p id="audit-origin-error" className="mt-3 text-sm text-destructive">
              {serverError}
            </p>
          )
        ) : null}
      </div>
    </Card>
  );
}
