import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";

const STORAGE_KEY = "agentability.tour.v1";

const STEPS = [
  {
    title: "Start with a URL",
    body: "Paste your domain or full URL. We scan public entrypoints, docs, and tools.",
  },
  {
    title: "Watch the audit run",
    body: "We show live progress across discovery, callability, docs, trust, and reliability.",
  },
  {
    title: "Get a score + fixes",
    body: "You’ll see a plain‑language summary, top fixes, and a shareable badge.",
  },
];

export function OnboardingTour({ forceOpen }: { forceOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      setStep(0);
      trackEvent("tour_open", { source: "manual" });
      return;
    }
    const seen = window.localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      setOpen(true);
      setStep(0);
      trackEvent("tour_open", { source: "auto" });
    }
  }, [forceOpen]);

  const close = () => {
    window.localStorage.setItem(STORAGE_KEY, "seen");
    setOpen(false);
    trackEvent("tour_close", { step });
  };

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-3xl border border-border/60 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Quick tour</p>
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              trackEvent("tour_skip", { step });
              close();
            }}
          >
            Skip
          </button>
        </div>
        <h3 className="mt-3 text-2xl font-semibold text-foreground">{current.title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{current.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-2">
            {STEPS.map((_, index) => (
              <span
                key={index}
                className={`h-2 w-2 rounded-full ${index === step ? "bg-emerald-500" : "bg-muted"}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  trackEvent("tour_back", { step });
                  setStep(step - 1);
                }}
              >
                Back
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => {
                if (isLast) {
                  trackEvent("tour_complete", { step });
                  close();
                } else {
                  trackEvent("tour_next", { step });
                  setStep(step + 1);
                }
              }}
            >
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
