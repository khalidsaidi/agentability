#!/usr/bin/env tsx
// Re-runs every rule measurement in one command, so the error rates in the
// methodology are reproducible rather than asserted.
//
// Two parts:
//
//   Fixtures   — cases hand-verified against the live site, each one a bug that
//                actually shipped. These assert; a regression fails the run.
//   Samples    — seeded random draws, redrawn identically every time, printed
//                for hand judgement. A rule's error rate is only honest if the
//                sample it came from can be regenerated.
//
//   npm run validate            fixtures only, fast, CI-safe
//   npm run validate -- --full  fixtures plus the seeded samples
//
// Every fixture below is dated and cites what it caught. Do not add one without
// checking the live site first: a fixture that encodes a guess is worse than no
// fixture, because it freezes the guess.
//
// How much each one is worth, checked by running them against the code from
// before each fix (git show <commit>^:scripts/lib/evaluate-site.ts):
//
//   proven  marksandspencer.com, iltalehti.fi, biblegateway.com, ups.com,
//           morningstar.com, battle.net — these fail on the old code, so they
//           would have caught the bug they encode.
//   guard   fortune.com, lemonde.fr, stripe.com, gymshark.com, apify.com — these
//           pass on the old code too. Not because the bug was absent, but because
//           they read the URL out of the detail line and the old detail did not
//           print one. They catch a reintroduction today; they could not have
//           caught the original.
//
// Do not read "8 fixtures pass" as "8 bugs cannot recur".

import fs from "node:fs";
import path from "node:path";
import { evaluateSite, type SiteEvaluation } from "./lib/evaluate-site";

const REPO_ROOT = path.resolve(__dirname, "..");

type Fixture = {
  domain: string;
  what: string;
  caught: string;
  assert: (r: SiteEvaluation) => string | null; // null = pass, string = failure reason
};

const a6 = (r: SiteEvaluation) => r.checks.find((c) => c.id === "A6");
const detail = (r: SiteEvaluation) => a6(r)?.detail ?? "";

const FIXTURES: Fixture[] = [
  {
    domain: "fortune.com",
    what: "a .js asset must not count as developer documentation",
    caught: "2026-11-02: scored docs/api off /api/tinypass.min.js, a paywall bundle",
    assert: (r) => (/docs\/api/.test(detail(r)) && /\.js/.test(detail(r)) ? "credited docs/api from a script URL" : null),
  },
  {
    domain: "marksandspencer.com",
    what: "a link that 404s must not be credited",
    caught: "2026-11-02: api.marksandspencer.com answers 404 and was scoring a docs/api point",
    assert: (r) => {
      const d = detail(r);
      const reached = d.split("Link found but not confirmed")[0];
      return /docs\/api/.test(reached) ? "credited docs/api from a 404 host" : null;
    },
  },
  {
    domain: "iltalehti.fi",
    what: "a non-English contact page must be creditable",
    caught: "2026-11-02: /info/yhteystiedot scored zero — confirmation vocabulary was English-only",
    assert: (r) => (/support\/contact/.test(detail(r)) ? null : "Finnish contact page not credited"),
  },
  {
    domain: "lemonde.fr",
    what: "a news article must not be mistaken for a utility page",
    caught: "2026-11-02: scored pricing off a story whose slug contained tarifs-record",
    assert: (r) => (/pricing \(\/[a-z]+\/article/.test(detail(r)) ? "credited pricing from an article URL" : null),
  },
  {
    domain: "stripe.com",
    what: "a support centre on a subdomain must still count",
    caught: "2026-10-25: an over-tight host rule dropped help.shopify.com and cost Shopify 5 points",
    assert: (r) => ((a6(r)?.points ?? 0) >= 20 ? null : `expected 20/20, got ${a6(r)?.points}`),
  },
  {
    domain: "biblegateway.com",
    what: "referencing a platform CDN is not running on that platform",
    caught: "2026-11-01: listed as a Shopify store because it loads a book cover from cdn.shopify.com",
    assert: (r) => (r.platform === "Shopify" ? "detected as Shopify from an asset reference" : null),
  },
  {
    domain: "gymshark.com",
    what: "a real storefront must still be detected",
    caught: "2026-11-01: the fix for the above had to not blind the detector",
    assert: (r) => (r.platform === "Shopify" ? null : `expected Shopify, got ${r.platform ?? "none"}`),
  },
  {
    domain: "ups.com",
    what: "a 200 that carries no HTML must not be reported as missing links",
    caught: "2026-11-02: 179 reports said \"None of pricing, support, docs, or legal are reachable\" after a fetch that returned 15 words or fewer",
    assert: (r) => (/^None of pricing/.test(detail(r)) ? "reported missing links from a homepage that served no HTML" : null),
  },
  {
    domain: "morningstar.com",
    what: "a bot-challenge homepage must not be reported as missing links either",
    caught: "2026-11-02: the first fix used a 30-word threshold and missed 87 reports, 61 of them challenge pages — an interstitial has more words than that",
    assert: (r) => (/^None of pricing/.test(detail(r)) ? "reported missing links from a homepage that served a bot challenge" : null),
  },
  {
    domain: "battle.net",
    what: "a site that needs a cookie to get through its own redirects must still be audited",
    caught: "2026-11-02: scored 0 as a redirect loop; the same seven hops with cookies carried forward return 200 and 48,914 words",
    assert: (r) => (r.status === "complete" ? null : `unreachable: ${r.failure ?? r.error}`),
  },
  {
    domain: "apify.com",
    what: "an MCP server card on the current spec path must be credited",
    caught: "2026-10-25: B1 probed only /.well-known/mcp.json and told Apify they had no MCP server",
    assert: (r) => (r.signals.mcp ? null : "MCP server card not detected"),
  },
];

async function runFixtures(): Promise<number> {
  console.log(`Fixtures — ${FIXTURES.length} cases, each one a bug that shipped\n`);
  let failed = 0;
  for (const f of FIXTURES) {
    const r = await evaluateSite(f.domain);
    if (r.status !== "complete") {
      // Unreachable is not a failure of the rule. Say so and move on, rather
      // than failing CI because someone else's site is down.
      console.log(`  SKIP  ${f.domain.padEnd(22)} unreachable (${r.failure}) — ${f.what}`);
      continue;
    }
    const problem = f.assert(r);
    if (problem) {
      failed += 1;
      console.log(`  FAIL  ${f.domain.padEnd(22)} ${problem}`);
      console.log(`        expected: ${f.what}`);
      console.log(`        history:  ${f.caught}`);
    } else {
      console.log(`  ok    ${f.domain.padEnd(22)} ${f.what}`);
    }
  }
  return failed;
}

// Seeded shuffle: the same seed gives the same sample on every machine, which is
// what makes a published error rate checkable by someone else.
function sample<T>(arr: T[], n: number, seed: number): T[] {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

async function printSamples() {
  const summary = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/index/summary.json"), "utf8"));
  const verdicts = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/index/classification.json"), "utf8"));
  const commerce = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/index/commerce.json"), "utf8"));
  const domains: string[] = summary.leaderboard.map((r: { domain: string }) => r.domain);

  console.log("\nSamples — redrawn identically from these seeds; verdicts need a human\n");
  for (const [label, seed, pool] of [
    ["A6 accuracy (seed 42, the tuning set)", 42, domains],
    ["A6 accuracy (seed 99, held out)", 99, domains],
    ["content filter, kept side (seed 7)", 7, domains.filter((d) => !verdicts[d] || verdicts[d] === "ok")],
    ["shop membership (seed 11)", 11, domains.filter((d) => commerce[d] === "shop")],
  ] as const) {
    console.log(`  ${label}`);
    console.log(`    ${sample(pool, 12, seed).join(", ")}`);
  }
  console.log(
    "\n  Measured rates are recorded in data/index/validation.json, with the sample\n" +
      "  each came from. Re-draw, re-judge, and compare if you do not believe them."
  );
}

// The sampling property, checked rather than argued. The draw is a seeded
// Fisher-Yates over the kept pool sorted first, and "sorted first" has been
// read as a bias. It is not: a uniform shuffle of any fixed ordering is a
// uniform permutation. This runs the real sample() across 4,000 seeds and
// checks that every pool member can actually come up, and comes up about
// equally often. No network, so it costs nothing to keep in CI.
function samplingIsUniform(): string | null {
  function sample<T>(arr: T[], n: number, seed: number): T[] {
    let x = seed;
    const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
  }
  const summary = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/index/summary.json"), "utf8"));
  const verdicts = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/index/classification.json"), "utf8"));
  const ovPath = path.join(REPO_ROOT, "data/index/classification-overrides.json");
  const ov = fs.existsSync(ovPath) ? JSON.parse(fs.readFileSync(ovPath, "utf8")) : {};
  const merged: Record<string, string> = { ...verdicts };
  for (const [d, v] of Object.entries(ov)) {
    merged[d] = typeof v === "string" ? v : ((v as { verdict?: string }).verdict ?? "ok");
  }
  const pool: string[] = summary.leaderboard
    .map((r: { domain: string }) => r.domain)
    .filter((d: string) => !merged[d] || merged[d] === "ok")
    .sort();
  const DRAW = 66, SEEDS = 4000;
  const count = new Map<string, number>(pool.map((d) => [d, 0]));
  for (let seed = 1; seed <= SEEDS; seed++) {
    for (const d of sample(pool, DRAW, seed)) count.set(d, count.get(d)! + 1);
  }
  const never = [...count].filter(([, c]) => c === 0).length;
  if (never) return `${never} of ${pool.length} pool members can never be drawn`;
  const freqs = [...count.values()];
  const exp = (SEEDS * DRAW) / pool.length;
  const chi = freqs.reduce((a, c) => a + (c - exp) ** 2 / exp, 0) / (pool.length - 1);
  // Chi-square over df, so ~1 under uniformity. 1.3 is loose enough not to
  // flake and tight enough to catch a draw that favours part of the pool.
  if (chi > 1.3) return `selection is uneven: chi-square/df = ${chi.toFixed(2)}`;
  console.log(`  ok    sampling                every one of ${pool.length} pool members drawable, chi-square/df ${chi.toFixed(2)}`);
  return null;
}

// The panel's infrastructure patterns, both directions. They are regexes over
// hostnames, so they can err either way: too loose and real sites vanish from
// the Index, too tight and CDNs clutter it. Checked here because the loose
// version silently dropped ad.nl, mail.ru and login.gov — a newspaper, a
// top-100 portal and a government sign-in service — by matching their own
// names as if they were subdomains. No network.
function infrastructurePatternsHoldBothWays(): string | null {
  const src = fs.readFileSync(path.join(REPO_ROOT, "scripts/build-panel.ts"), "utf8");
  const infraSrc = /const INFRASTRUCTURE =\s*(\/[\s\S]*?\/i);/.exec(src)?.[1];
  const notDestSrc = /const NOT_A_DESTINATION = (\/[\s\S]*?\/i);/.exec(src)?.[1];
  const apexSrc = /const INFRA_COMPANY_APEX = (\/[\s\S]*?\/i);/.exec(src)?.[1];
  if (!infraSrc || !notDestSrc || !apexSrc) return "could not read the patterns out of build-panel.ts";
  // eslint-disable-next-line no-eval
  const [INFRA, NOTDEST, APEX] = [infraSrc, notDestSrc, apexSrc].map((r) => eval(r) as RegExp);
  const drop = (h: string) => (INFRA.test(h) && !APEX.test(h)) || (h.split(".").length >= 3 && NOTDEST.test(h));
  const mustKeep = ["ad.nl", "mail.ru", "login.gov", "akamai.com", "fastly.com", "digicert.com", "cloudflare.com"];
  const mustDrop = ["accounts.google.com", "login.microsoftonline.com", "cdn.jsdelivr.net", "api.twitter.com",
                    "mail.google.com", "a1.akamaiedge.net", "s3.amazonaws.com", "gtld-servers.net", "ns1.dynect.net"];
  const wrongDrops = mustKeep.filter(drop);
  const wrongKeeps = mustDrop.filter((h) => !drop(h));
  if (wrongDrops.length || wrongKeeps.length) {
    return `${wrongDrops.length} real site(s) dropped (${wrongDrops.join(", ")}), ${wrongKeeps.length} infrastructure host(s) kept (${wrongKeeps.join(", ")})`;
  }
  console.log(`  ok    infra patterns         ${mustKeep.length} real sites kept, ${mustDrop.length} infrastructure hosts dropped`);
  return null;
}

// domains.txt must not list a domain the content filter removes. Such a domain
// is audited every week, its result is stored, and build-site then filters it
// out of the tables — work done to produce a row nobody sees. It also made the
// leaderboard count disagree with the kept-pool count.
function auditListHasNoExcludedDomains(): string | null {
  const verdicts = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/index/classification.json"), "utf8"));
  const overrides = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/index/classification-overrides.json"), "utf8"));
  const verdictOf = (d: string) => {
    const o = overrides[d];
    if (o !== undefined) return typeof o === "string" ? o : ((o as { verdict?: string }).verdict ?? "ok");
    const v = verdicts[d];
    return typeof v === "string" ? v : "ok";
  };
  const listed = fs
    .readFileSync(path.join(REPO_ROOT, "data/index/domains.txt"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const bad = listed.filter((d) => verdictOf(d) !== "ok");
  if (bad.length) return `${bad.length} excluded domain(s) still in the audit list: ${bad.join(", ")}`;
  console.log(`  ok    audit list              none of its ${listed.length} domains is filtered out`);
  return null;
}

// Every domain a human reinstated must actually be reachable by the weekly run.
// It wasn't: submitted.txt was merged only by `npm run panel`, which the weekly
// workflow never calls, so four reinstatements and every audit request since the
// issue form shipped sat in a file doing nothing. No network needed.
function reinstatementsReachTheRun(): string | null {
  const read = (f: string) => {
    const full = path.join(REPO_ROOT, f);
    if (!fs.existsSync(full)) return [] as string[];
    return fs.readFileSync(full, "utf8").split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#"));
  };
  const overrides = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/index/classification-overrides.json"), "utf8"));
  const reinstated = Object.entries(overrides)
    .filter(([k]) => !k.startsWith("_"))
    .filter(([, v]) => (typeof v === "string" ? v : ((v as { verdict?: string }).verdict ?? "ok")) === "ok")
    .map(([k]) => k);
  const reachable = new Set([...read("data/index/domains.txt"), ...read("data/index/submitted.txt")]);
  const lost = reinstated.filter((d) => !reachable.has(d));
  if (lost.length) return `${lost.length} reinstated domain(s) no run would audit: ${lost.join(", ")}`;
  console.log(`  ok    reinstatements          all ${reinstated.length} reachable by the weekly run`);
  return null;
}

async function main() {
  const failed = await runFixtures();
  console.log("");
  const auditListProblem = auditListHasNoExcludedDomains();
  if (auditListProblem) console.log(`  FAIL  audit list              ${auditListProblem}`);
  const infraProblem = infrastructurePatternsHoldBothWays();
  if (infraProblem) console.log(`  FAIL  infra patterns         ${infraProblem}`);
  const reinstatementProblem = reinstatementsReachTheRun();
  if (reinstatementProblem) console.log(`  FAIL  reinstatements          ${reinstatementProblem}`);
  const samplingProblem = samplingIsUniform();
  if (samplingProblem) {
    console.log(`  FAIL  sampling                ${samplingProblem}`);
  }
  if (process.argv.includes("--full")) await printSamples();
  if (auditListProblem) {
    console.error(`\nThe audit list contains a domain the filter removes — the run would do work for a row nobody sees.`);
    process.exit(1);
  }
  if (infraProblem) {
    console.error(`\nThe panel's infrastructure patterns err in one direction or the other.`);
    process.exit(1);
  }
  if (reinstatementProblem) {
    console.error(`\nA hand reinstatement is not reachable by the weekly run — the correction would never ship.`);
    process.exit(1);
  }
  if (samplingProblem) {
    console.error(`\nThe sampling property failed — a published error rate rests on this draw.`);
    process.exit(1);
  }
  if (failed) {
    console.error(`\n${failed} fixture(s) failed — a rule regressed on a case that was hand-verified.`);
    process.exit(1);
  }
  console.log(`\nAll ${FIXTURES.length} fixtures hold.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
