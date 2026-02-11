import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getConsentStatus,
  setConsentDecision,
  subscribeConsentChange,
  subscribeCookieSettingsOpen,
  type ConsentDecision,
  type ConsentStatus,
} from "@/lib/consent";
import { trackEvent } from "@/lib/analytics";

export function CookieConsentBanner() {
  const [status, setStatus] = useState<ConsentStatus>(() => getConsentStatus());
  const [open, setOpen] = useState<boolean>(() => getConsentStatus() === "unknown");

  useEffect(() => {
    return subscribeConsentChange((record) => {
      const nextStatus = record?.decision ?? "unknown";
      setStatus(nextStatus);
      if (nextStatus !== "unknown") {
        setOpen(false);
      }
    });
  }, []);

  useEffect(() => {
    return subscribeCookieSettingsOpen(() => {
      setStatus(getConsentStatus());
      setOpen(true);
    });
  }, []);

  const applyDecision = (decision: ConsentDecision) => {
    setConsentDecision(decision);
    setStatus(decision);
    setOpen(false);
    if (decision === "accepted") {
      trackEvent("cookie_consent_updated", { decision });
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] px-4 pb-4 sm:px-6 sm:pb-6" role="dialog" aria-live="polite">
      <div className="mx-auto max-w-4xl rounded-2xl border border-border/70 bg-white/95 p-5 shadow-xl backdrop-blur">
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Cookie preferences</h2>
          <p className="text-sm text-muted-foreground">
            We use essential storage to keep core features working. Optional analytics cookies help us improve
            Agentability. Choose whether to allow analytics cookies.
          </p>
          <p className="text-xs text-muted-foreground">
            Read our{" "}
            <a href="/legal/privacy.md" className="font-medium text-primary hover:text-primary/80">
              Privacy Policy
            </a>{" "}
            and{" "}
            <a href="/legal/cookies.md" className="font-medium text-primary hover:text-primary/80">
              Cookie Policy
            </a>
            .
          </p>
          {status !== "unknown" ? (
            <p className="text-xs text-muted-foreground">
              Current choice: <span className="font-medium text-foreground">{status}</span>
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => applyDecision("rejected")}>
            Reject optional cookies
          </Button>
          <Button type="button" onClick={() => applyDecision("accepted")}>
            Accept all cookies
          </Button>
        </div>
      </div>
    </div>
  );
}
