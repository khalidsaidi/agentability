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
//   proven  marksandspencer.com, iltalehti.fi, biblegateway.com, ups.com — these
//           fail on the old code, so they would have caught the bug they encode.
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

async function main() {
  const failed = await runFixtures();
  if (process.argv.includes("--full")) await printSamples();
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
