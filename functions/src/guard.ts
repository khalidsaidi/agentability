// The network guard for the public instant check.
//
// Anyone can submit a domain, so a domain is untrusted input that decides where
// this server connects. Without a guard, "localtest.me" (which resolves to
// 127.0.0.1) or a redirect to http://169.254.169.254 would point the auditor at
// the server's own machine or Google's metadata service.
//
// January's version resolved the name, checked the address, then let fetch
// resolve it again to connect. A domain that answers "public" to the first
// lookup and "private" to the second gets through that (DNS rebinding). Here the
// address is checked inside the connection itself, on the exact address being
// dialled, for every request and every redirect hop.

import dns from "node:dns";
import { AsyncLocalStorage } from "node:async_hooks";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";

export class BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedError";
  }
}

// Set per request, so a block can be reported as a block rather than as the site
// being unreachable. Several checks share one instance, hence not a global flag.
export const requestContext = new AsyncLocalStorage<{ blocked?: string }>();

function note(reason: string): BlockedError {
  const store = requestContext.getStore();
  if (store && !store.blocked) store.blocked = reason;
  return new BlockedError(reason);
}

// Only ordinary public unicast addresses. Everything else is refused, including
// ranges that can smuggle a private IPv4 address inside IPv6 (NAT64, 6to4,
// Teredo): ipaddr reports those as their own ranges, not "unicast".
export function isPublicAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  return ipaddr.process(ip).range() === "unicast";
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"];

export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || BLOCKED_SUFFIXES.some((s) => h.endsWith(s));
}

function checkUrl(raw: string | URL): URL {
  const url = new URL(String(raw));
  if (url.protocol !== "http:" && url.protocol !== "https:") throw note(`scheme ${url.protocol} is not allowed`);
  // Ordinary web ports only: a site's homepage and machine files are on 80 and 443.
  if (url.port !== "") throw note(`port ${url.port} is not allowed`);
  if (url.username || url.password) throw note("credentials in the URL are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(host)) throw note(`${host} is an internal name`);
  // An IP literal never goes through DNS, so the connection-time check below
  // would never see it. The URL parser has already turned forms like 2130706433
  // and 0x7f.1 into 127.0.0.1, so this catches those too.
  if (ipaddr.isValid(host) && !isPublicAddress(host)) throw note(`${host} is not a public address`);
  return url;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

// Called by the socket for the name it is about to connect to.
function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCb): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad || !list.length) {
      const e = note(`${hostname} resolves to ${bad ? bad.address : "nothing"}, not a public address`) as unknown as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return callback(e);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

const agent = new Agent({
  connect: { lookup: guardedLookup as never, timeout: 8000 },
  headersTimeout: 15000,
  bodyTimeout: 15000,
});

// Drop-in for fetch. The auditor follows redirects itself (redirect: "manual"),
// so every hop comes back through here and is checked again.
export const guardedFetch: typeof fetch = async (input, init) => {
  const url = checkUrl(input instanceof Request ? input.url : (input as string | URL));
  if (init?.redirect && init.redirect !== "manual") throw note("automatic redirects are not allowed");
  return (await undiciFetch(url, { ...(init as object), redirect: "manual", dispatcher: agent } as never)) as unknown as Response;
};

// What a person typed, reduced to a hostname we are willing to audit.
export function normalizeDomain(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (!s || s.length > 300) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.port !== "" || url.username || url.password) return null;
  const host = url.hostname.replace(/\.$/, "");
  if (ipaddr.isValid(host.replace(/^\[|\]$/g, ""))) return null;
  if (isBlockedHostname(host)) return null;
  if (host.length > 253) return null;
  // Labels of letters, digits and hyphens; a top-level label of letters, or punycode.
  if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(host)) return null;
  return host;
}
