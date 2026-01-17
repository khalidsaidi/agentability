import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { URLInputCard } from "@/components/URLInputCard";
import { evaluateOrigin } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function HomePage() {
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: (origin: string) => evaluateOrigin(origin),
    onSuccess: (data) => {
      navigate(`/runs/${data.runId}`);
    },
  });

  return (
    <div className="space-y-10 animate-fade-up">
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-white/70 px-3 py-1 text-xs font-medium uppercase tracking-wider">
            Agentability · Public Mode
          </div>
          <h1 className="text-4xl leading-tight md:text-5xl">
            Agent readiness, scored in minutes.
          </h1>
          <p className="max-w-xl text-base text-muted-foreground">
            Agentability audits machine entrypoints, doc clarity, and repeatability to show how ready your surface is for
            autonomous agents.
          </p>
        </div>
        <div className="rounded-3xl border border-border/60 bg-white/60 p-6 shadow-sm">
          <p className="text-sm text-muted-foreground">
            Public mode focuses on discoverability, callability signals, and LLM ingestion hygiene. No credentials or
            private endpoints required.
          </p>
          <div className="mt-6 grid gap-4 text-sm">
            <div className="rounded-2xl border border-border/60 bg-white/70 p-4">
              <h3 className="font-semibold">Discovery</h3>
              <p className="text-muted-foreground">Find manifests, service descriptors, and canonical docs.</p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-white/70 p-4">
              <h3 className="font-semibold">Reliability</h3>
              <p className="text-muted-foreground">Validate stability across repeated requests.</p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-white/70 p-4">
              <h3 className="font-semibold">Ingestion</h3>
              <p className="text-muted-foreground">Measure the clarity and depth of published documentation.</p>
            </div>
          </div>
        </div>
      </section>

      <URLInputCard
        onSubmit={(origin) => mutation.mutate(origin)}
        loading={mutation.isPending}
        error={mutation.isError ? (mutation.error instanceof Error ? mutation.error.message : "Request failed") : null}
      />

      <Alert className="border-border/60 bg-white/70">
        <AlertTitle>Public mode only</AlertTitle>
        <AlertDescription>
          We currently evaluate public-facing endpoints and documentation. Authenticated and private surfaces are not yet
          scored.
        </AlertDescription>
      </Alert>
    </div>
  );
}
