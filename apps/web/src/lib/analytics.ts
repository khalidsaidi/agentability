import { getConsentStatus, type ConsentStatus } from "@/lib/consent";

export type AnalyticsParams = Record<string, string | number | boolean | null | undefined>;
type NormalizedAnalyticsParams = Record<string, string | number | boolean>;

type QueuedEvent = {
  name: string;
  params: NormalizedAnalyticsParams;
};

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID ?? "G-55RKNLGPNT";
const GA_SCRIPT_ID = "agentability-ga-script";
const MAX_QUEUED_EVENTS = 200;

const DENIED_CONSENT = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
} as const;

const GRANTED_CONSENT = {
  ...DENIED_CONSENT,
  analytics_storage: "granted",
} as const;

let gaLoadPromise: Promise<void> | null = null;
let gtagConfigured = false;
const queuedEvents: QueuedEvent[] = [];

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function hasGtag(): boolean {
  return hasWindow() && typeof window.gtag === "function";
}

function setGaDisabled(disabled: boolean): void {
  if (!hasWindow()) return;
  const windowRecord = window as unknown as Record<string, unknown>;
  windowRecord[`ga-disable-${GA_MEASUREMENT_ID}`] = disabled;
}

function normalizeParams(params: AnalyticsParams = {}): NormalizedAnalyticsParams {
  const normalized: NormalizedAnalyticsParams = {};
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

function bootstrapGtagStub(): void {
  if (!hasWindow()) return;
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== "function") {
    window.gtag = (...args: unknown[]) => {
      window.dataLayer?.push(args);
    };
  }
}

function loadGaScript(): Promise<void> {
  if (!hasWindow()) return Promise.resolve();
  if (gaLoadPromise) return gaLoadPromise;

  gaLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GA_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load GA script")), { once: true });
      return;
    }

    bootstrapGtagStub();

    const script = document.createElement("script");
    script.id = GA_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => {
      gaLoadPromise = null;
      reject(new Error("Failed to load GA script"));
    };
    document.head.appendChild(script);
  });

  return gaLoadPromise;
}

async function ensureAnalyticsReady(): Promise<boolean> {
  if (!hasWindow() || !GA_MEASUREMENT_ID) return false;
  try {
    await loadGaScript();
  } catch {
    return false;
  }
  if (!hasGtag()) return false;
  const gtag = window.gtag;
  if (!gtag) return false;

  if (!gtagConfigured) {
    gtag("consent", "default", DENIED_CONSENT);
    gtag("js", new Date());
    gtag("config", GA_MEASUREMENT_ID, { anonymize_ip: true, send_page_view: false });
    gtagConfigured = true;
  }
  return true;
}

function queueEvent(name: string, params: NormalizedAnalyticsParams): void {
  queuedEvents.push({ name, params });
  if (queuedEvents.length > MAX_QUEUED_EVENTS) {
    queuedEvents.shift();
  }
}

function flushQueuedEvents(): void {
  if (!hasGtag()) return;
  const gtag = window.gtag;
  if (!gtag) return;
  while (queuedEvents.length) {
    const event = queuedEvents.shift();
    if (!event) break;
    gtag("event", event.name, event.params);
  }
}

function getCookieDomains(hostname: string): string[] {
  if (!hostname) return [];
  const domains = new Set<string>([hostname, `.${hostname}`]);
  const parts = hostname.split(".").filter(Boolean);
  for (let index = 1; index < parts.length - 1; index += 1) {
    domains.add(`.${parts.slice(index).join(".")}`);
  }
  return Array.from(domains);
}

function expireCookie(name: string, domain?: string): void {
  if (!hasWindow()) return;
  const domainPart = domain ? `;domain=${domain}` : "";
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/${domainPart};SameSite=Lax;secure`;
}

function clearAnalyticsCookies(): void {
  if (!hasWindow()) return;
  const cookieNames = document.cookie
    .split(";")
    .map((cookie) => cookie.trim().split("=")[0])
    .filter((name) => name.startsWith("_ga") || name === "_gid" || name === "_gat");

  if (!cookieNames.length) return;
  const domains = getCookieDomains(window.location.hostname);

  for (const name of cookieNames) {
    expireCookie(name);
    for (const domain of domains) {
      expireCookie(name, domain);
    }
  }
}

export function syncAnalyticsConsent(status: ConsentStatus = getConsentStatus()): void {
  if (!hasWindow()) return;

  if (status === "accepted") {
    setGaDisabled(false);
    void ensureAnalyticsReady().then((ready) => {
      if (!ready || !hasGtag()) return;
      const gtag = window.gtag;
      if (!gtag) return;
      gtag("consent", "update", GRANTED_CONSENT);
      flushQueuedEvents();
    });
    return;
  }

  setGaDisabled(true);
  queuedEvents.length = 0;
  if (hasGtag()) {
    const gtag = window.gtag;
    if (gtag) {
      gtag("consent", "update", DENIED_CONSENT);
    }
  }
  if (status === "rejected") {
    clearAnalyticsCookies();
  }
}

export function trackEvent(name: string, params: AnalyticsParams = {}): void {
  if (getConsentStatus() !== "accepted") return;

  const normalized = normalizeParams(params);
  queueEvent(name, normalized);

  void ensureAnalyticsReady().then((ready) => {
    if (!ready || !hasGtag()) return;
    const gtag = window.gtag;
    if (!gtag) return;
    gtag("consent", "update", GRANTED_CONSENT);
    flushQueuedEvents();
  });
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
