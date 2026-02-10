import { Routes, Route, Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { HomePage } from "@/pages/HomePage";
import { ReportPage } from "@/pages/ReportPage";
import { RunPage } from "@/pages/RunPage";
import { CertificatePage } from "@/pages/CertificatePage";
import { Badge } from "@/components/ui/badge";
import { trackEvent, trackLinkClick, trackPageView } from "@/lib/analytics";

function App() {
  const location = useLocation();

  useEffect(() => {
    trackPageView({ route: location.pathname });
    trackEvent("route_change", { route: location.pathname, search: location.search, hash: location.hash });
  }, [location]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      trackEvent("window_error", {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      trackEvent("window_unhandledrejection", {
        reason: event.reason instanceof Error ? event.reason.message : String(event.reason),
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="pointer-events-none absolute -left-32 top-10 h-64 w-64 rounded-full bg-primary/20 blur-3xl animate-float" />
      <div className="pointer-events-none absolute right-0 top-40 h-80 w-80 rounded-full bg-cyan-200/40 blur-3xl animate-float" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-orange-200/30 blur-3xl" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link
            to="/"
            className="flex items-center gap-3 text-foreground"
            onClick={() => trackLinkClick("nav_logo", "/")}
          >
            <img src="/logo-mark.svg" alt="Agentability" className="h-10 w-10" />
            <div>
              <div className="text-lg font-semibold italic tracking-tight">agentability</div>
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                AI readiness score
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Badge variant="outline">Open methodology</Badge>
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

        <footer className="border-t border-border/60 pt-8 text-xs text-muted-foreground">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="space-y-2 md:pr-8">
              <div className="text-sm font-semibold text-foreground">Agentability</div>
              <p>
                Public-mode audits for discoverability, callability, docs, trust, and reliability.
              </p>
              <p>Evidence bundles are stored in Cloud Storage for traceability.</p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 md:col-span-2">
              <div>
                <div className="text-[0.65rem] uppercase tracking-[0.3em] text-muted-foreground">
                  Technical resources
                </div>
                <div className="mt-3 space-y-3">
                  <a
                    className="group block"
                    href="/.well-known/openapi.json"
                    onClick={() => trackLinkClick("footer_openapi_json", "/.well-known/openapi.json")}
                  >
                    <span className="font-medium text-foreground group-hover:text-primary">OpenAPI spec</span>
                    <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                      See what our API can do (openapi.json)
                    </span>
                  </a>
                  <a
                    className="group block"
                    href="/.well-known/air.json"
                    onClick={() => trackLinkClick("footer_air_json", "/.well-known/air.json")}
                  >
                    <span className="font-medium text-foreground group-hover:text-primary">AI manifest</span>
                    <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                      Integration metadata (air.json)
                    </span>
                  </a>
                  <a
                    className="group block"
                    href="/llms.txt"
                    onClick={() => trackLinkClick("footer_llms_txt", "/llms.txt")}
                  >
                    <span className="font-medium text-foreground group-hover:text-primary">LLM entrypoint</span>
                    <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                      Docs discovery for agents (llms.txt)
                    </span>
                  </a>
                  <a
                    className="group block"
                    href="/discovery/audit/latest.json"
                    onClick={() => trackLinkClick("footer_audit", "/discovery/audit/latest.json")}
                  >
                    <span className="font-medium text-foreground group-hover:text-primary">Raw audit data</span>
                    <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                      Latest verification snapshot (latest.json)
                    </span>
                  </a>
                </div>
              </div>

              <div>
                <div className="text-[0.65rem] uppercase tracking-[0.3em] text-muted-foreground">
                  Project
                </div>
                <div className="mt-3 space-y-3">
                  <a
                    className="group block"
                    href="/spec.md"
                    onClick={() => trackLinkClick("footer_spec", "/spec.md")}
                  >
                    <span className="font-medium text-foreground group-hover:text-primary">Methodology spec</span>
                    <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                      Versioned checks and scoring (spec.md)
                    </span>
                  </a>
                  <a
                    className="group block"
                    href="/discovery/audit"
                    onClick={() => trackLinkClick("footer_verification", "/discovery/audit")}
                  >
                    <span className="font-medium text-foreground group-hover:text-primary">Verification log</span>
                    <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                      Evidence-backed self-audit (public)
                    </span>
                  </a>
                  <a
                    className="group block"
                    href="https://github.com/khalidsaidi/agentability"
                    onClick={() => trackLinkClick("footer_github", "https://github.com/khalidsaidi/agentability")}
                  >
                    <span className="font-medium text-foreground group-hover:text-primary">Source code</span>
                    <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                      Open source on GitHub
                    </span>
                  </a>
                  <a
                    className="group block"
                    href="mailto:hello@agentability.org"
                    onClick={() => trackLinkClick("footer_contact", "mailto:hello@agentability.org")}
                  >
                    <span className="font-medium text-foreground group-hover:text-primary">Contact</span>
                    <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                      Questions or submissions
                    </span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
