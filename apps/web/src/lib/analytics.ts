export type AnalyticsParams = Record<string, string | number | boolean | null | undefined>;

function hasGtag(): boolean {
  return typeof window !== "undefined" && typeof window.gtag === "function";
}

function normalizeParams(params: AnalyticsParams = {}): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      normalized[key] = value;
    } else {
      normalized[key] = String(value);
    }
  }
  return normalized;
}

export function trackEvent(name: string, params: AnalyticsParams = {}): void {
  if (!hasGtag()) return;
  const gtag = window.gtag;
  if (!gtag) return;
  gtag("event", name, normalizeParams(params));
}

export function trackPageView(params: AnalyticsParams = {}): void {
  const location = typeof window !== "undefined" ? window.location.href : undefined;
  const path = typeof window !== "undefined" ? window.location.pathname : undefined;
  trackEvent("page_view", {
    page_location: location,
    page_path: path,
    page_title: typeof document !== "undefined" ? document.title : undefined,
    ...params,
  });
}

export function trackError(name: string, error: unknown, params: AnalyticsParams = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  trackEvent(name, { error_message: message, ...params });
}

export function trackLinkClick(label: string, href: string, params: AnalyticsParams = {}): void {
  trackEvent("link_click", { label, href, ...params });
}
