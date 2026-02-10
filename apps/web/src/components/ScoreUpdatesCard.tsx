import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { subscribeEmail } from "@/lib/api";
import { trackError, trackEvent } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Mail } from "lucide-react";

function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return false;
  if (trimmed.length > 254) return false;
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(trimmed);
}

export function ScoreUpdatesCard({ domain, runId }: { domain: string; runId: string }) {
  const [email, setEmail] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: (value: string) => subscribeEmail(value, domain, runId),
    onSuccess: (data) => {
      setSuccess(true);
      trackEvent("subscribe_success", { run_id: runId, domain, email_domain: data.email.split("@")[1] });
    },
    onError: (error) => {
      trackError("subscribe_error", error, { run_id: runId, domain });
    },
  });

  return (
    <Card className="border-border/60 bg-white/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          Track your score
        </CardTitle>
        <CardDescription>
          Optional: get emailed when {domain} improves or when new checks ship.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {success ? (
          <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50 p-4 text-sm text-emerald-900">
            Subscribed. We’ll send updates to <span className="font-medium">{email.trim()}</span>.
          </div>
        ) : (
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = email.trim();
              if (!isValidEmail(trimmed)) {
                setLocalError("Enter a valid email address.");
                trackEvent("subscribe_invalid", { run_id: runId, domain, email_length: trimmed.length });
                return;
              }
              setLocalError(null);
              trackEvent("subscribe_submit", { run_id: runId, domain });
              mutation.mutate(trimmed);
            }}
          >
            <input
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (localError) setLocalError(null);
              }}
              type="email"
              placeholder="you@company.com"
              className="h-12 w-full flex-1 rounded-2xl border border-input bg-white/80 px-4 text-sm shadow-sm transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:border-primary/60"
              autoComplete="email"
              inputMode="email"
              aria-invalid={Boolean(localError || mutation.isError)}
            />
            <Button type="submit" className="h-12 rounded-2xl" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mutation.isPending ? "Saving…" : "Get score updates"}
            </Button>
          </form>
        )}

        {localError ? <p className="text-sm text-destructive">{localError}</p> : null}
        {mutation.isError && !localError ? (
          <p className="text-sm text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : "Subscription failed"}
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          We store your email and audited domain to send updates. Unsubscribe anytime.
        </p>
      </CardContent>
    </Card>
  );
}

