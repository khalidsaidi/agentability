#!/usr/bin/env tsx
// Checks that the numbers on the live methodology page, the numbers in the live
// validation record, and the committed evidence files all agree.
//
//   npm run check-published
//
// This exists because the headline kept-side figure was restated six times in
// one session, and each restatement was a chance for the page and the record to
// drift apart silently. Asserting "no internal contradiction" is not evidence;
// this is. Exits non-zero on any disagreement.

const SITE = process.env.SITE ?? "https://agentability.org";

type Check = { what: string; needle: string; ok?: boolean };

async function text(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": "agentability-selfcheck" } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return await r.text();
}

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const pct = (x: number) => (x * 100).toFixed(1);

async function main() {
  const page = plain(await text(`${SITE}/methodology/`));
  const v = JSON.parse(await text(`${SITE}/data/validation.json`));

  const cf = v.contentFilter;
  const hc = cf.underExclusion.handCensus;
  const checks: Check[] = [
    { what: "kept side, rate and n", needle: `${hc.errors} of ${hc.n} kept wrongly` },
    { what: "kept side, interval", needle: `95% CI ${pct(hc.ci95[0])}` },
    // The far edge used to be a separate, wider number because unreadable
    // domains were counted against us. Every drawn domain is now judged, so the
    // two coincide and the page says so rather than quoting a second figure.
    { what: "kept side, far edge", needle: "as a wrong keep instead gives" },
    { what: "kept side, prose tier", needle: `All 189 were judged from prose` },
    { what: "removed side", needle: `${cf.overExclusion.errors} of ${cf.overExclusion.n} removed wrongly` },
    { what: "removed side, interval", needle: `95% CI ${(cf.overExclusion.ci95[0] * 100).toFixed(1)}` },
    { what: "A6 held out", needle: `0 errors in ${v.a6.heldOutPostFix.n} decisions` },
    { what: "platform false positives", needle: `0 of ${v.platform.falsePositive.n} wrong labels` },
    { what: "shop membership", needle: `${v.shopMembership.errors} of ${v.shopMembership.n} wrong` },
  ];

  let failed = 0;
  console.log(`Published figures — ${SITE}/methodology/ against /data/validation.json\n`);
  for (const c of checks) {
    c.ok = page.toLowerCase().includes(c.needle.toLowerCase());
    if (!c.ok) failed += 1;
    console.log(`  ${c.ok ? "ok  " : "FAIL"}  ${c.what.padEnd(26)} ${c.needle}`);
  }

  // The record must also agree with the files it was computed from.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(path.resolve(__dirname, ".."), "data/index/evidence");
  const census = fs.readFileSync(path.join(dir, "kept-census-2026-11-02.tsv"), "utf8").split("\n").filter(Boolean);
  const walls = fs
    .readFileSync(path.join(dir, "kept-census-walls.tsv"), "utf8")
    .split("\n")
    .filter((l) => l.includes("\tWALL\t")).length;
  // The archive pass is the last tier: a snapshot is a readable page even where
  // the live site walls every client. Only a domain that neither a live fetch
  // nor a snapshot renders is genuinely unresolved, and those are what the far
  // edge is made of.
  const NOTHING = /NO SNAPSHOT|snapshot had no title|\tAccess Denied\t|\tLoading\.\.\.\t|\t&nbsp;\t/;
  const archiveRows = fs
    .readFileSync(path.join(dir, "kept-census-archive.tsv"), "utf8")
    .split("\n")
    .filter((l) => l.includes("\t") && !l.startsWith("#"));
  const stillUnresolved = archiveRows.filter((l) => NOTHING.test(l)).length;
  // Fifth surface: the CDX index, queried for a capture that returned HTTP 200.
  // Only a domain that none of the five surfaces renders is truly unresolved.
  const cdxUnresolved = fs
    .readFileSync(path.join(dir, "kept-census-cdx.tsv"), "utf8")
    .split("\n")
    .filter((l) => /STILL NOTHING|NOT HAND-READ/.test(l)).length;

  console.log(`\nRecord against the evidence files in data/index/evidence/\n`);
  let fileComparisons = 0;
  for (const [what, got, want] of [
    ["census rows", census.length, hc.farEdge.n],
    ["walls the archive pass took", archiveRows.length, walls],
    ["unresolved after archive", stillUnresolved, 11],
    ["unresolved after CDX", cdxUnresolved, hc.farEdge.errors - hc.errors],
    ["hand-read domains", census.length - cdxUnresolved, hc.n],
  ] as const) {
    const ok = got === want;
    fileComparisons += 1;
    if (!ok) failed += 1;
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${String(what).padEnd(26)} file says ${got}, record says ${want}`);
  }

  if (failed) {
    console.error(`\n${failed} disagreement(s) — the page, the record and the evidence are not telling the same story.`);
    process.exit(1);
  }
  // Counted, not typed: this line said 12 while 13 comparisons were running.
  console.log(`\nAll ${checks.length + fileComparisons} published figures agree across page, record and evidence.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
