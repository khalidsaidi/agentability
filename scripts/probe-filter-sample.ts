#!/usr/bin/env tsx
// Re-measures the content filter's under-exclusion: how often a domain the
// filter kept should have been removed as porn, piracy or gambling.
//
//   npm run probe-filter
//
// The first version of this measurement discarded every domain it could not
// read and reported the rate for the rest, which bounded nothing about the
// third it threw away — and blocking correlates with the population being
// filtered, so the discarded third was the part most worth looking at.
//
// So a domain is only called unreadable after three surfaces give nothing:
//
//   1. homepage, auditor's bot UA   — the surface the Index itself scores on
//   2. homepage, browser UA         — same request, only the UA differs, so a
//                                     difference is the site's bot policy
//   3. robots.txt and sitemap.xml   — published for machines, and the URL paths
//                                     name what the site is made of
//
// plus the www host when the bare apex fails to connect at all.
//
// A 403 or an empty body at step 3 is NOT evidence: a Cloudflare interstitial
// has words in it and says nothing about the site. Those count as unresolved,
// and the unresolved count is what the whole-population bound is made of.
//
// The vocabulary scan is deliberately loose. It is a net, not a verdict: every
// hit is printed with its surrounding text for a human to judge, because the
// terms it looks for appear innocently (XXX is an ISO currency code, a PC has
// memory slots, a newspaper reports on bingo halls).

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const BOT_UA = "AgentabilityBot/2.0 (+https://agentability.org/methodology)";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SEED = Number(process.env.SEED ?? 2026);
const DRAW = Number(process.env.DRAW ?? 66);
// POOL=withdrawn runs the identical procedure over the domains the filter
// REMOVED. That is not a second error measurement — it is the control for the
// argument that justifies this whole pass: if sites in the filtered categories
// wall bots at the same rate as everyone else, then unreadability is not
// correlated with the thing being filtered and discarding unreadable domains
// was harmless after all. Measuring it is the only way to know.
const POOL = (process.env.POOL ?? "kept") as "kept" | "withdrawn";
const MIN_WORDS = 50;

const SIGNALS: [string, RegExp][] = [
  ["porn", /\b(porn|xxx|nsfw|camgirl|webcam girls|hentai|escort|onlyfans|adult video|sex cam|milf)\b/gi],
  ["gambling", /\b(casino|betting|bookmaker|sportsbook|poker|roulette|blackjack|slots?|jackpot|wager|bet now|free spins|baccarat|bingo)\b/gi],
  ["piracy", /\b(torrent|magnet:|watch free online|stream free|putlocker|123movies|keygen|warez|fmovies)\b/gi],
];

// Same seeded shuffle as validate-rules.ts, so the draw is the published one.
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

async function get(url: string, ua: string) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 20_000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": ua, Accept: "*/*" }, redirect: "follow", signal: c.signal });
    return { status: r.status, text: (await r.text()).slice(0, 400_000) };
  } catch {
    return { status: 0, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

const strip = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

// Counts prose words only. The tag stripper above leaks code — `<[^>]+>` is
// not a parser, and an attribute containing a ">" (a CSS child selector, a JS
// arrow) throws off its alignment, so CSS and minified JS survive into the
// text. That matters in the direction that hides errors: a homepage carrying
// 2,000 words of bundled JavaScript and no sentences would otherwise count as
// readable and be scanned clean, when in truth nothing was read. A token with
// braces, semicolons, equals signs or dots in it is not a word.
const prose = (s: string) =>
  s ? s.split(" ").filter((t) => t.length > 1 && !/[{};=()[\]<>|&$`"'\/\\]|\w\.\w/.test(t)).length : 0;
// robots.txt and sitemap.xml are URL paths by nature, so the prose test above
// would reject the very evidence that tier rests on. Count tokens there.
const tokens = (s: string) => (s ? s.split(" ").length : 0);

type Tier = "body" | "machine" | "none";

async function readable(domain: string): Promise<{ tier: Tier; text: string; how: string }> {
  for (const [host, ua, how] of [
    [domain, BOT_UA, "bot-ua"],
    [domain, CHROME_UA, "chrome-ua"],
    [`www.${domain}`, CHROME_UA, "www+chrome-ua"],
  ] as const) {
    const r = await get(`https://${host}/`, ua);
    const body = strip(r.text);
    if (prose(body) >= MIN_WORDS) return { tier: "body", text: body, how };
  }
  // Machine-facing surfaces. A non-200 body is an error page, not evidence.
  const [rob, sm] = await Promise.all([
    get(`https://${domain}/robots.txt`, BOT_UA),
    get(`https://${domain}/sitemap.xml`, BOT_UA),
  ]);
  const machine = [rob.status === 200 ? rob.text : "", sm.status === 200 ? sm.text : ""].join(" ").trim();
  if (tokens(machine) > 20) return { tier: "machine", text: machine, how: `robots ${rob.status} sitemap ${sm.status}` };
  return { tier: "none", text: "", how: `robots ${rob.status} sitemap ${sm.status}` };
}

function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.959963985;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const summary = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/index/summary.json"), "utf8"));
  const verdicts = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/index/classification.json"), "utf8"));
  const overridesPath = path.join(REPO_ROOT, "data/index/classification-overrides.json");
  const overrides = fs.existsSync(overridesPath) ? JSON.parse(fs.readFileSync(overridesPath, "utf8")) : {};
  const merged: Record<string, string> = { ...verdicts };
  for (const [d, v] of Object.entries(overrides)) {
    merged[d] = typeof v === "string" ? v : ((v as { verdict?: string }).verdict ?? "ok");
  }

  const all: string[] = summary.leaderboard.map((r: { domain: string }) => r.domain);
  const pool: string[] =
    POOL === "kept"
      ? all.filter((d) => !merged[d] || merged[d] === "ok")
      : Object.keys(merged).filter((d) => merged[d] !== "ok");
  const drawn = POOL === "withdrawn" && DRAW >= pool.length ? pool : sample(pool, DRAW, SEED);

  console.log(
    POOL === "kept"
      ? `Content filter, kept side — seed ${SEED}, ${drawn.length} drawn from ${pool.length} kept\n`
      : `Content filter, REMOVED side — readability control, ${drawn.length} of ${pool.length} withdrawn domains\n`
  );
  const counts: Record<Tier, number> = { body: 0, machine: 0, none: 0 };
  const flagged: string[] = [];
  const unresolved: string[] = [];

  for (const d of drawn) {
    const { tier, text, how } = await readable(d);
    counts[tier] += 1;
    if (tier === "none") {
      unresolved.push(d);
      console.log(`  ${d.padEnd(26)} UNRESOLVED    ${how}`);
      continue;
    }
    const hits: string[] = [];
    for (const [cat, re] of SIGNALS) {
      re.lastIndex = 0;
      const m = re.exec(text);
      if (m) hits.push(`${cat}:"${m[0]}" …${text.slice(Math.max(0, m.index - 70), m.index + 70)}…`);
    }
    if (hits.length) {
      flagged.push(d);
      console.log(`  ${d.padEnd(26)} ${tier.padEnd(13)} FLAG — judge by hand`);
      for (const h of hits) console.log(`      ${h}`);
    } else {
      console.log(`  ${d.padEnd(26)} ${tier.padEnd(13)} clean`);
    }
  }

  if (POOL === "withdrawn") {
    // The control prints the tier split and stops. A vocabulary hit on a domain
    // the filter already removed is agreement, not an error rate.
    console.log(
      `\nReadability of domains the filter REMOVED: ${counts.body} page body, ${counts.machine} robots/sitemap only, ` +
        `${counts.none} nothing — ${pct(counts.none / drawn.length)} unreadable.\n` +
        `Compare with the kept side's unreadable share to see whether discarding unreadable domains was biased.`
    );
    return;
  }

  const judged = counts.body + counts.machine;
  const [, hiJudged] = wilson(0, judged);
  const [loAll, hiAll] = wilson(counts.none, drawn.length);
  console.log(
    `\nEvidence: ${counts.body} judged on page body, ${counts.machine} on robots/sitemap only, ${counts.none} on nothing.\n` +
      `Flagged for hand judgement: ${flagged.length}${flagged.length ? ` (${flagged.join(", ")})` : ""}.\n` +
      `Unresolved: ${counts.none}${counts.none ? ` (${unresolved.join(", ")})` : ""}.\n\n` +
      `Enter the hand verdicts before quoting a rate. Assuming all ${flagged.length} flags are rejected:\n` +
      `  judged:          0/${judged} wrongly kept, 95% CI 0.0%-${pct(hiJudged)}\n` +
      `  whole sample:    ${counts.none}/${drawn.length} at worst (every unresolved domain counted as a wrong keep),\n` +
      `                   95% CI ${pct(loAll)}-${pct(hiAll)} — the bound that faces the whole population.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
