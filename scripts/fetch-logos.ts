#!/usr/bin/env tsx
// Fetches each brand's own favicon once and commits it under data/logos/, so the
// site build stays offline, deterministic, and free of third-party favicon
// services. Sites that block bots simply don't get a logo — the strip falls back
// to their name, which is honest: this is a show about who blocks agents.
//
//   npm run logos            refresh logos for every brand seen in an episode
//   npm run logos -- --all   include every audited domain too

import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { rootDomain, hostOf } from "./lib/domains";

const REPO_ROOT = path.resolve(__dirname, "..");
const EPISODES_DIR = path.join(REPO_ROOT, "data/fieldtest/episodes");
const SUMMARY_PATH = path.join(REPO_ROOT, "data/index/summary.json");
const LOGOS_DIR = path.join(REPO_ROOT, "data/logos");
const MANIFEST = path.join(LOGOS_DIR, "manifest.json");

const UA = "AgentabilityLogoFetch/1.0 (+https://agentability.org/methodology)";
const TIMEOUT_MS = 15000;
const MAX_BYTES = 120 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function get(url: string): Promise<{ ok: boolean; status: number; buf?: Buffer; type: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": UA, accept: "*/*" },
    });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!res.ok) return { ok: false, status: res.status, type };
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, status: res.status, buf, type };
  } catch {
    return { ok: false, status: 0, type: "" };
  } finally {
    clearTimeout(timer);
  }
}

// Pick the best <link rel="...icon..."> the homepage advertises.
function iconCandidates(html: string, baseUrl: string): string[] {
  const out: Array<{ href: string; score: number }> = [];
  const re = /<link\s([^>]+)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const rel = /rel=["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase() ?? "";
    if (!/\bicon\b/.test(rel)) continue;
    const href = /href=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href) continue;
    const sizes = /sizes=["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
    const px = Number.parseInt(sizes.split("x")[0], 10) || 0;
    // Prefer a crisp mark: svg first, then the largest raster, then anything.
    let score = px;
    if (/\.svg(\?|$)/i.test(href)) score = 1000;
    if (rel.includes("apple-touch")) score = Math.max(score, 180);
    try {
      out.push({ href: new URL(href, baseUrl).toString(), score });
    } catch {
      /* skip malformed href */
    }
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.href);
}

async function fetchLogo(domain: string): Promise<{ file: string; bytes: number } | null> {
  const home = await get(`https://${domain}/`);
  const candidates: string[] = [];
  if (home.ok && home.buf && home.type.startsWith("text/html")) {
    candidates.push(...iconCandidates(home.buf.toString("utf8").slice(0, 200_000), `https://${domain}/`));
  }
  candidates.push(`https://${domain}/favicon.ico`);

  for (const url of candidates.slice(0, 5)) {
    const res = await get(url);
    if (!res.ok || !res.buf) continue;
    const ext = EXT_BY_TYPE[res.type];
    if (!ext) continue;
    if (res.buf.length === 0 || res.buf.length > MAX_BYTES) continue;
    // An HTML error page served as an icon is worse than no icon.
    if (res.buf.subarray(0, 200).toString("utf8").trim().toLowerCase().startsWith("<!doctype html")) continue;
    const file = `${domain}.${ext}`;
    await fsp.writeFile(path.join(LOGOS_DIR, file), res.buf);
    return { file, bytes: res.buf.length };
  }
  return null;
}

async function main() {
  const all = process.argv.includes("--all");
  const domains = new Set<string>();

  if (fs.existsSync(EPISODES_DIR)) {
    for (const f of await fsp.readdir(EPISODES_DIR)) {
      if (!f.endsWith(".json")) continue;
      const ep = JSON.parse(await fsp.readFile(path.join(EPISODES_DIR, f), "utf8"));
      for (const run of ep.runs ?? []) {
        for (const step of run.steps ?? []) {
          const host = hostOf(step.finalUrl || step.url || "");
          if (host) domains.add(rootDomain(host));
        }
        for (const d of run.domainsVisited ?? []) domains.add(rootDomain(d));
      }
    }
  }
  if (all && fs.existsSync(SUMMARY_PATH)) {
    const summary = JSON.parse(await fsp.readFile(SUMMARY_PATH, "utf8"));
    for (const row of summary.leaderboard ?? []) domains.add(rootDomain(row.domain));
  }

  await fsp.mkdir(LOGOS_DIR, { recursive: true });
  const manifest: Record<string, string> = fs.existsSync(MANIFEST)
    ? JSON.parse(await fsp.readFile(MANIFEST, "utf8"))
    : {};

  const ordered = [...domains].sort();
  console.log(`Fetching logos for ${ordered.length} brands…`);
  let got = 0;
  let kept = 0;
  for (const domain of ordered) {
    const existing = manifest[domain];
    if (existing && fs.existsSync(path.join(LOGOS_DIR, existing))) {
      kept++;
      continue;
    }
    const res = await fetchLogo(domain);
    if (res) {
      manifest[domain] = res.file;
      got++;
      console.log(`  ✓ ${domain} → ${res.file} (${(res.bytes / 1024).toFixed(1)} kB)`);
    } else {
      delete manifest[domain];
      console.log(`  · ${domain} — no logo reachable (blocked, missing, or unsupported)`);
    }
  }

  // Drop manifest entries whose file vanished.
  for (const [domain, file] of Object.entries(manifest)) {
    if (!fs.existsSync(path.join(LOGOS_DIR, file))) delete manifest[domain];
  }

  await fsp.writeFile(MANIFEST, `${JSON.stringify(manifest, Object.keys(manifest).sort(), 1)}\n`, "utf8");
  console.log(`\n${got} fetched, ${kept} already cached, ${ordered.length - got - kept} unavailable.`);
  console.log(`Manifest: ${path.relative(REPO_ROOT, MANIFEST)} (${Object.keys(manifest).length} brands)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
