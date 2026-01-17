import { createHash } from "crypto";
import dns from "dns/promises";
import ipaddr from "ipaddr.js";

export type RedirectHop = { url: string; status: number };

export type FetchResult = {
  url: string;
  status: number;
  headers: Record<string, string>;
  contentType?: string;
  contentLength?: number;
  bodyText?: string;
  sha256?: string;
  fetchedAt: string;
  redirectChain: RedirectHop[];
};

export type SafeFetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  connectTimeoutMs?: number;
};

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "local",
]);

const BLOCKED_RANGES = new Set([
  "unspecified",
  "loopback",
  "linkLocal",
  "uniqueLocal",
  "private",
  "carrierGradeNat",
  "broadcast",
  "multicast",
  "reserved",
]);

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

function isBlockedIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) {
    return false;
  }
  const addr = ipaddr.parse(ip);
  const range = addr.range();
  return BLOCKED_RANGES.has(range);
}

async function assertPublicHost(hostname: string): Promise<void> {
  const normalized = normalizeHostname(hostname);
  if (BLOCKED_HOSTNAMES.has(normalized) || normalized.endsWith(".local")) {
    throw new Error("Blocked hostname");
  }

  if (ipaddr.isValid(normalized)) {
    if (isBlockedIp(normalized)) {
      throw new Error("Blocked IP address");
    }
    return;
  }

  const records = await dns.lookup(normalized, { all: true });
  if (!records.length) {
    throw new Error("DNS resolution failed");
  }
  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw new Error("Blocked IP address");
    }
  }
}

function toHeaderRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

async function readBodyWithLimit(
  response: Response,
  maxBytes: number
): Promise<{ bodyText: string; sha256: string; contentLength: number }> {
  if (!response.body) {
    return { bodyText: "", sha256: "", contentLength: 0 };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) {
        throw new Error("Response too large");
      }
      chunks.push(value);
    }
  }
  const buffer = Buffer.concat(chunks);
  const hash = createHash("sha256").update(buffer).digest("hex");
  return {
    bodyText: buffer.toString("utf8"),
    sha256: hash,
    contentLength: buffer.length,
  };
}

function getRedirectUrl(currentUrl: string, location: string): string {
  const next = new URL(location, currentUrl);
  return next.toString();
}

export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
  redirectChain: RedirectHop[] = []
): Promise<FetchResult> {
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }

  await assertPublicHost(target.hostname);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  const controller = new AbortController();
  const connectTimer = setTimeout(() => controller.abort(), connectTimeoutMs);
  const totalTimer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(connectTimer);
    clearTimeout(totalTimer);
    throw error;
  }
  clearTimeout(connectTimer);

  if (
    [301, 302, 303, 307, 308].includes(response.status) &&
    response.headers.has("location")
  ) {
    if (maxRedirects <= 0) {
      clearTimeout(totalTimer);
      throw new Error("Too many redirects");
    }
    const location = response.headers.get("location");
    if (!location) {
      clearTimeout(totalTimer);
      throw new Error("Redirect without location");
    }
    const nextUrl = getRedirectUrl(url, location);
    const nextTarget = new URL(nextUrl);
    if (nextTarget.protocol !== "http:" && nextTarget.protocol !== "https:") {
      clearTimeout(totalTimer);
      throw new Error("Redirect to non-http(s) URL");
    }
    await assertPublicHost(nextTarget.hostname);
    const nextChain = [...redirectChain, { url, status: response.status }];
    clearTimeout(totalTimer);
    return safeFetch(nextUrl, { ...options, maxRedirects: maxRedirects - 1 }, nextChain);
  }

  const headers = toHeaderRecord(response.headers);
  const contentType = response.headers.get("content-type") ?? undefined;
  const lengthHeader = response.headers.get("content-length");
  const headerLength = lengthHeader ? Number(lengthHeader) : undefined;

  let bodyText: string | undefined;
  let sha256: string | undefined;
  let contentLength: number | undefined = headerLength;

  if (response.status !== 204 && response.status !== 304 && options.method !== "HEAD") {
    const bodyResult = await readBodyWithLimit(response, maxBytes);
    bodyText = bodyResult.bodyText;
    sha256 = bodyResult.sha256;
    if (!Number.isFinite(contentLength)) {
      contentLength = bodyResult.contentLength;
    }
  }

  clearTimeout(totalTimer);
  return {
    url,
    status: response.status,
    headers,
    contentType,
    contentLength,
    bodyText,
    sha256,
    fetchedAt: new Date().toISOString(),
    redirectChain,
  };
}
