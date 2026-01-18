import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type URLInputCardProps = {
  onSubmit: (origin: string) => void;
  loading?: boolean;
  error?: string | null;
};

export function URLInputCard({ onSubmit, loading, error }: URLInputCardProps) {
  const [origin, setOrigin] = useState("");

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
          <a className="font-medium text-emerald-700 hover:text-emerald-900" href="/reports/aistatusdashboard.com">
            the showcase report
          </a>
          .
        </p>
        <form
          className="flex flex-col gap-4 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!origin.trim()) return;
            onSubmit(origin.trim());
          }}
        >
          <Input
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
            placeholder="example.com"
            className="h-12 text-base"
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
