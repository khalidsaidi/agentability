#!/usr/bin/env tsx
// Derives the Index panel from the live web instead of a hand-typed list.
//
// Source is Tranco, which publishes a new ranked list every day under a
// permanent dated ID, aggregating Chrome UX Report, Majestic, Cloudflare Radar,
// Umbrella and Farsight. Google's own CrUX is the better single source but it is
// published monthly (the partition key is literally yyyymm), so it cannot drive
// a list that changes daily.
//
// Popularity is all any of these sources give — none of them, Google's included,
// carries a category field. So porn and piracy are removed by asking a model,
// once per domain, and caching the verdict. A cache rather than a blocklist:
// tomorrow's new entrants get judged on arrival instead of waiting for someone
// to maintain a list.
//
//   npm run panel          rebuild data/index/domains.txt from today's list
//   npm run panel -- 2000  take the top 2000 instead of the default

import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { rootDomain } from "./lib/domains";

const REPO_ROOT = path.resolve(__dirname, "..");
const DOMAINS_PATH = path.join(REPO_ROOT, "data/index/domains.txt");
const VERDICTS_PATH = path.join(REPO_ROOT, "data/index/classification.json");
const PROVENANCE_PATH = path.join(REPO_ROOT, "data/index/panel-source.json");
// Google's own Chrome-usage ranking (top-10k bucket), cached because CrUX
// publishes monthly. Tranco's top-5k and CrUX's top-10k agree on ~1,500 domains;
// the two rank different things, so the intersection is what both call popular.
// Refresh with: bq query --use_legacy_sql=false "SELECT DISTINCT origin FROM
// \`chrome-ux-report.experimental.global\` WHERE yyyymm=(SELECT MAX(yyyymm) ...)
// AND experimental.popularity.rank = 1000"
const CRUX_PATH = path.join(REPO_ROOT, "data/index/crux-top.txt");

const TAKE = Number(process.argv[2] || 5000);
const UA = "AgentabilityPanel/1.0 (+https://agentability.org/methodology)";
const CLASSIFIER = "deepseek-flash";
const BATCH = 50;

// Reached as plumbing, never as a destination: CDNs, DNS, ad tech, cloud endpoints.
const INFRASTRUCTURE =
  /(akamai|cloudfront|fastly|gstatic|googleapis|googleusercontent|googlevideo|googlesyndication|doubleclick|amazonaws|azureedge|cloudflare\.net|fbcdn|akadns|akamaiedge|edgekey|edgesuite|gtld-servers|domaincontrol|digicert|appsflyer|apple-dns|aaplimg|trafficmanager|llnwd|cdn77|jsdelivr|unpkg|rootcanal|nsone|dynect|ntp\.org|in-addr)/i;
// Login walls and API hosts: an agent sent here learns nothing about the brand.
const NOT_A_DESTINATION = /^(accounts|admin|adsmanager|adssettings|auth|login|signin|sso|api|cdn|static|assets|img|media|mail|webmail|smtp|mx|ns\d|wap|ads?)\./i;

type Verdicts = Record<string, "ok" | "porn" | "piracy">;

async function trancoTop(): Promise<{ hosts: string[]; listId: string }> {
  const meta = await fetch("https://tranco-list.eu/api/lists/date/latest", {
    headers: { "user-agent": UA },
  }).then((r) => r.json() as Promise<{ list_id: string }>);
  const csv = await fetch(`https://tranco-list.eu/download/${meta.list_id}/${TAKE}`, {
    headers: { "user-agent": UA },
  }).then((r) => r.text());
  const hosts = csv
    .split(/\r?\n/)
    .map((line) => line.split(",")[1]?.trim())
    .filter((h): h is string => Boolean(h));
  return { hosts, listId: meta.list_id };
}

// One question per unseen domain; verdicts are cached forever, so a daily rebuild
// only pays for whatever is genuinely new that day.
async function classify(unseen: string[], verdicts: Verdicts): Promise<void> {
  if (!unseen.length) return;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn(`::warning::DEEPSEEK_API_KEY not set — ${unseen.length} new domain(s) left unclassified and excluded.`);
    return;
  }
  const client = new Anthropic({ apiKey, baseURL: "https://api.deepseek.com/anthropic" });
  for (let i = 0; i < unseen.length; i += BATCH) {
    const chunk = unseen.slice(i, i + BATCH);
    try {
      const response = await client.messages.create({
        // Generous: this model thinks before it answers, and a tight ceiling is
        // spent entirely on thinking, returning an empty response.
        model: CLASSIFIER,
        max_tokens: 16000,
        messages: [
          {
            role: "user",
            content:
              `For each domain say porn, piracy, or ok.\n` +
              `piracy = illegal streaming/download of film, TV, anime, manga, music, software, cracked apps.\n` +
              `Format one per line: domain|porn or domain|piracy or domain|ok\n\n${chunk.join("\n")}`,
          },
        ],
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      for (const line of text.split("\n")) {
        const m = /([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\s*[|:=-]\s*(porn|piracy|ok)/i.exec(line);
        if (m) verdicts[m[1].toLowerCase()] = m[2].toLowerCase() as Verdicts[string];
      }
    } catch (error) {
      console.warn(`  classification batch failed: ${String((error as Error).message).slice(0, 120)}`);
    }
    console.log(`  classified ${Math.min(i + BATCH, unseen.length)}/${unseen.length}`);
  }
}

async function main() {
  const { hosts, listId } = await trancoTop();
  console.log(`Tranco list ${listId}: ${hosts.length} hosts`);

  // Tranco is a blend of five providers and refreshes daily; CrUX is Google's
  // direct measurement of real Chrome visits but only publishes monthly. Using
  // Tranco for the cadence and CrUX for validation gives a list that is both
  // current and grounded in Google's own usage data.
  const crux = fs.existsSync(CRUX_PATH)
    ? new Set((await fsp.readFile(CRUX_PATH, "utf8")).split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
    : new Set<string>();
  console.log(`CrUX cross-check: ${crux.size} domains in Google's own top ranking`);

  const candidates: string[] = [];
  const seen = new Set<string>();
  let droppedInfra = 0;
  for (const host of hosts) {
    if (NOT_A_DESTINATION.test(host)) { droppedInfra += 1; continue; }
    const domain = rootDomain(host);
    if (!domain || INFRASTRUCTURE.test(domain)) { droppedInfra += 1; continue; }
    if (seen.has(domain)) continue;
    seen.add(domain);
    candidates.push(domain);
  }
  console.log(`  ${droppedInfra} infrastructure/login hosts dropped → ${candidates.length} distinct sites`);

  // Apply the CrUX cross-check BEFORE classifying: a domain Google sees no real
  // traffic on can never reach the panel, so paying to classify it is waste.
  const eligible = crux.size ? candidates.filter((d) => crux.has(d)) : candidates;
  console.log(`  ${candidates.length - eligible.length} dropped as not in CrUX -> ${eligible.length} eligible`);

  const verdicts: Verdicts = fs.existsSync(VERDICTS_PATH)
    ? JSON.parse(await fsp.readFile(VERDICTS_PATH, "utf8"))
    : {};
  const unseen = eligible.filter((d) => !verdicts[d]);
  console.log(`  ${eligible.length - unseen.length} already classified, ${unseen.length} new`);
  await classify(unseen, verdicts);

  const panel = eligible.filter((d) => verdicts[d] === "ok").sort();
  const droppedNotInCrux = candidates.length - eligible.length;
  const removed = eligible.filter((d) => verdicts[d] === "porn" || verdicts[d] === "piracy");
  const unknown = eligible.filter((d) => !verdicts[d]);

  await fsp.writeFile(DOMAINS_PATH, panel.join("\n") + "\n", "utf8");
  await fsp.writeFile(VERDICTS_PATH, `${JSON.stringify(verdicts, Object.keys(verdicts).sort(), 1)}\n`, "utf8");
  await fsp.writeFile(
    PROVENANCE_PATH,
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        source: "tranco",
        listId,
        listUrl: `https://tranco-list.eu/list/${listId}`,
        tookTop: TAKE,
        panelSize: panel.length,
        cruxValidated: crux.size > 0,
        cruxListSize: crux.size,
        droppedNotInCrux,
        droppedInfrastructure: droppedInfra,
        droppedAdultOrPiracy: removed.length,
        unclassified: unknown.length,
        classifier: CLASSIFIER,
      },
      null,
      1
    ) + "\n",
    "utf8"
  );

  console.log(
    `\nPanel: ${panel.length} sites  (removed ${removed.length} adult/piracy, ${droppedNotInCrux} not in CrUX, ${unknown.length} unclassified)\n` +
      `Source: Tranco ${listId}, top ${TAKE} → ${DOMAINS_PATH}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
