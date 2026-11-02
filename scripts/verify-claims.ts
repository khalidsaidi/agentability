#!/usr/bin/env tsx
// Prints every published claim next to the evidence for it, each under a stable
// name. Written because the evidence for these numbers lived in commit messages
// and chat, where a reader has to take the account on trust and a citation goes
// stale the moment a file moves.
//
//   npm run verify-claims
//
// Each line is CLAIM <name> | <value> | <source>, where source is a file and
// line, a live URL, or another command. Exits non-zero if a source is missing.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const EV = path.join(ROOT, "data/index/evidence");
const SITE = process.env.SITE ?? "https://agentability.org";

let missing = 0;

function lineOf(file: string, needle: string): string {
  const full = path.join(EV, file);
  if (!fs.existsSync(full)) { missing += 1; return `${file} MISSING`; }
  const lines = fs.readFileSync(full, "utf8").split("\n");
  const i = lines.findIndex((l) => l.includes(needle));
  if (i < 0) { missing += 1; return `${file} has no line matching "${needle}"`; }
  return `data/index/evidence/${file}:${i + 1}`;
}

function countIn(file: string, re: RegExp): { n: number; where: string } {
  const full = path.join(EV, file);
  if (!fs.existsSync(full)) { missing += 1; return { n: -1, where: `${file} MISSING` }; }
  const lines = fs.readFileSync(full, "utf8").split("\n").filter((l) => re.test(l));
  return { n: lines.length, where: `data/index/evidence/${file}` };
}

function claim(name: string, value: string, source: string) {
  console.log(`CLAIM ${name.padEnd(28)} | ${value.padEnd(46)} | ${source}`);
}

async function main() {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, "data/index/validation.json"), "utf8"));
  const hc = v.contentFilter.underExclusion.handCensus;
  const cf = v.contentFilter;

  const census = countIn("kept-census-2026-11-02.tsv", /\t/);
  const walls = countIn("kept-census-walls.tsv", /\tWALL\t/);
  const overturned = countIn("kept-census-walls.tsv", /OVERTURNED/);
  const unresolved = countIn("kept-census-archive.tsv", /NO SNAPSHOT|snapshot had no title|\tAccess Denied\t|\tLoading\.\.\.\t|\t&nbsp;\t/);

  console.log(`Published claims and the evidence for each — ${new Date().toISOString().slice(0, 10)}\n`);
  claim("kept-side-error-rate", `${hc.errors} of ${hc.n} = ${(hc.rate * 100).toFixed(1)}% CI ${(hc.ci95[0] * 100).toFixed(1)}-${(hc.ci95[1] * 100).toFixed(1)}%`, `${SITE}/data/validation.json`);
  claim("kept-side-the-one-error", "netkeiba.com, horse-racing odds and tips", lineOf("kept-census-2026-11-02.tsv", "netkeiba.com"));
  claim("kept-side-census-size", `${census.n} domains drawn and read`, census.where);
  claim("kept-side-walls-handled", `${walls.n} walls, ${overturned.n} overturned by our own audit`, walls.where);
  const cdxUnresolved = countIn("kept-census-cdx.tsv", /NOT HAND-READ/);
  claim("kept-side-unresolved", `${cdxUnresolved.n} that no person could read on any of six surfaces`, cdxUnresolved.where);
  claim("kept-side-archive-pass", `${unresolved.n} after four surfaces, ${unresolved.n - cdxUnresolved.n} resolved by surfaces five and six`, `${unresolved.where} and data/index/evidence/kept-census-cdx.tsv`);
  claim("kept-side-far-edge", `${hc.farEdge.errors} of ${hc.farEdge.n} = up to ${(hc.farEdge.ci95[1] * 100).toFixed(1)}%`, "the line above, counted as wrong keeps by assumption");
  claim("removed-side-error-rate", `${cf.overExclusion.errors} of ${cf.overExclusion.n} = ${(cf.overExclusion.rate * 100).toFixed(1)}% (a census)`, `${SITE}/data/validation.json`);
  claim("premise-filtered-sites-wall", "NOT SUPPORTED, Fisher p = 0.737", lineOf("probe-withdrawn-census357.txt", "Readability of domains"));
  claim("draw-seed-2026", "53 body, 8 machine, 5 nothing", lineOf("probe-final-rule.txt", "Evidence:"));
  claim("draw-seed-1337", "52 body, 7 machine, 7 nothing", lineOf("probe-live-1337.txt", "Evidence:"));
  claim("draw-seed-5150", "49 body, 13 machine, 4 nothing", lineOf("probe-live-5150.txt", "Evidence:"));
  claim("a6-held-out", `0 errors in ${v.a6.heldOutPostFix.n} decisions`, `${SITE}/data/validation.json`);
  // The boundary rule for "unreadable" is code, and code moves. Resolve its
  // location at run time rather than citing a line number that rots: three
  // such citations went stale in one session.
  const probeSrc = fs.readFileSync(path.join(ROOT, "scripts/probe-filter-sample.ts"), "utf8").split("\n");
  const ruleLine = probeSrc.findIndex((l) => l.includes('Rule for "unreadable"')) + 1;
  const readableLine = probeSrc.findIndex((l) => l.startsWith("async function readable")) + 1;
  if (!ruleLine || !readableLine) missing += 1;
  claim("boundary-rule-printed", "four surfaces, prose vs token thresholds", `scripts/probe-filter-sample.ts:${ruleLine} (prints it on every run)`);
  claim("boundary-rule-applied", "the procedure the rule describes", `scripts/probe-filter-sample.ts:${readableLine}`);
  claim("census-boundary-applied", `${walls.n} wall decisions, deciding text in each row`, `${walls.where} and data/index/evidence/kept-census-archive.tsv`);
  claim("draw-method", "seeded Fisher-Yates over the whole sorted pool", `scripts/probe-filter-sample.ts:${probeSrc.findIndex((l) => l.startsWith("function sample")) + 1}`);
  claim("draw-every-member-drawable", "0 of the pool never drawn, chi-square/df 1.05", "npm run validate");
  claim("rules-regression-tested", "10 fixtures, 5 proven against the buggy code", "npm run validate");
  // Counted from the checker rather than typed, so the two cannot drift: the
  // hardcoded "11" was already stale by one the first time this ran.
  const checkerSrc = fs.readFileSync(path.join(ROOT, "scripts/check-published.ts"), "utf8");
  const figures = (checkerSrc.match(/\{ what: "/g) ?? []).length + (checkerSrc.match(/\["[a-z][^"]*", \w/g) ?? []).length;
  claim("page-matches-record", `${figures} figures compared`, "npm run check-published");

  // The remaining misleading report pages, counted from the stored audits.
  const dir = path.join(ROOT, "data/index/results");
  const bad: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const cs = Object.fromEntries((r.checks ?? []).map((c: { id: string }) => [c.id, c]));
    const a3 = cs.A3 as { points: number } | undefined;
    const a6 = cs.A6 as { detail: string } | undefined;
    if (a3 && a6 && /^None of pricing/.test(a6.detail) && a3.points === 0) bad.push(r.domain);
  }
  claim("reports-still-overstating", `${bad.length}: ${bad.sort().join(", ")}`, "data/index/results/*.json");

  if (missing) {
    console.error(`\n${missing} source(s) missing or unmatched — a claim here cannot be checked.`);
    process.exit(1);
  }
  console.log(`\nEvery claim above names a file and line, a live URL, or a command.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
