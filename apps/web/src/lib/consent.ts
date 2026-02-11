export type ConsentDecision = "accepted" | "rejected";
export type ConsentStatus = ConsentDecision | "unknown";

export type ConsentRecord = {
  version: number;
  decision: ConsentDecision;
  updatedAt: string;
};

const CONSENT_STORAGE_KEY = "agentability_cookie_consent_v1";
// Bump this when consent text/policy changes in a way that requires re-consent.
const CONSENT_STORAGE_VERSION = 2;
const CONSENT_CHANGE_EVENT = "agentability:consent-change";
const CONSENT_OPEN_EVENT = "agentability:consent-open";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function isConsentDecision(value: unknown): value is ConsentDecision {
  return value === "accepted" || value === "rejected";
}

function parseConsentRecord(raw: string | null): ConsentRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConsentRecord>;
    if (!isConsentDecision(parsed.decision)) return null;
    if (typeof parsed.updatedAt !== "string" || !parsed.updatedAt) return null;
    if (typeof parsed.version !== "number") return null;
    return {
      version: parsed.version,
      decision: parsed.decision,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

function dispatchConsentChange(record: ConsentRecord | null): void {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent<ConsentRecord | null>(CONSENT_CHANGE_EVENT, { detail: record }));
}

export function getConsentRecord(): ConsentRecord | null {
  if (!isBrowser()) return null;
  const parsed = parseConsentRecord(window.localStorage.getItem(CONSENT_STORAGE_KEY));
  if (!parsed) return null;
  if (parsed.version !== CONSENT_STORAGE_VERSION) {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
    return null;
  }
  return parsed;
}

export function getConsentStatus(): ConsentStatus {
  const record = getConsentRecord();
  return record?.decision ?? "unknown";
}

export function setConsentDecision(decision: ConsentDecision): ConsentRecord | null {
  if (!isBrowser()) return null;
  const record: ConsentRecord = {
    version: CONSENT_STORAGE_VERSION,
    decision,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  dispatchConsentChange(record);
  return record;
}

export function subscribeConsentChange(
  listener: (record: ConsentRecord | null) => void
): () => void {
  if (!isBrowser()) return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ConsentRecord | null>).detail;
    listener(detail ?? getConsentRecord());
  };
  window.addEventListener(CONSENT_CHANGE_EVENT, handler);
  return () => window.removeEventListener(CONSENT_CHANGE_EVENT, handler);
}

export function openCookieSettings(): void {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent(CONSENT_OPEN_EVENT));
}

export function subscribeCookieSettingsOpen(listener: () => void): () => void {
  if (!isBrowser()) return () => undefined;
  const handler = () => listener();
  window.addEventListener(CONSENT_OPEN_EVENT, handler);
  return () => window.removeEventListener(CONSENT_OPEN_EVENT, handler);
}
