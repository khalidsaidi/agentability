import { Routes, Route, Link } from "react-router-dom";
import { HomePage } from "@/pages/HomePage";
import { ReportPage } from "@/pages/ReportPage";
import { RunPage } from "@/pages/RunPage";
import { CertificatePage } from "@/pages/CertificatePage";
import { Badge } from "@/components/ui/badge";

function App() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -left-32 top-10 h-64 w-64 rounded-full bg-amber-200/40 blur-3xl animate-float" />
      <div className="pointer-events-none absolute right-0 top-40 h-80 w-80 rounded-full bg-emerald-200/40 blur-3xl animate-float" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-teal-200/30 blur-3xl" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-foreground text-background">
              A
            </div>
            <div>
              <div className="text-lg font-semibold">Agentability</div>
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Readiness Lab</div>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Badge variant="outline">Public Beta</Badge>
            <a
              href="https://github.com/khalidsaidi/agentability"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              GitHub
            </a>
          </div>
        </header>

        <main className="flex-1 py-10">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/reports/:domain" element={<ReportPage />} />
            <Route path="/cert/:domain" element={<CertificatePage />} />
            <Route path="/runs/:runId" element={<RunPage />} />
          </Routes>
        </main>

        <footer className="border-t border-border/50 pt-6 text-xs text-muted-foreground">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              Built for public-mode audits. Evidence bundles are stored in Cloud Storage for traceability.
            </div>
            <div>
              <div className="text-[0.65rem] uppercase tracking-[0.3em] text-muted-foreground">AI Integration</div>
              <div className="mt-2 flex flex-wrap gap-3">
                <a className="hover:text-foreground" href="/.well-known/air.json">
                  air.json
                </a>
                <a className="hover:text-foreground" href="/.well-known/openapi.json">
                  openapi.json
                </a>
                <a className="hover:text-foreground" href="/llms.txt">
                  llms.txt
                </a>
                <a className="hover:text-foreground" href="/discovery/audit/latest.json">
                  audit
                </a>
                <a className="hover:text-foreground" href="https://github.com/khalidsaidi/agentability">
                  GitHub
                </a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
