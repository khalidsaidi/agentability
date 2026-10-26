#!/usr/bin/env tsx
// Marks which audited domains are shops, so the commerce view has a membership
// list without anyone maintaining one.
//
// There is no free ranking of "the top online stores", and there does not need
// to be: the daily field test already walks into shops — Trends picks the
// topic, the producer writes the errand, the agent visits whatever the errand
// needs, and the runner audits every domain it touched. 256 sites reached the
// index that way, none of them from the Tranco list. This script does the one
// thing missing: it says which of them sell things.
//
// Same shape as the porn/piracy filter in build-panel.ts — one model verdict
// per domain, cached forever, so tomorrow's arrivals get judged on arrival and
// nobody pays twice for the same domain.
//
//   npm run shops          classify any audited domain not yet judged
//   npm run shops -- --all re-judge everything, ignoring the cache

import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const REPO_ROOT = path.resolve(__dirname, "..");
const RESULTS_DIR = path.join(REPO_ROOT, "data/index/results");
const COMMERCE_PATH = path.join(REPO_ROOT, "data/index/commerce.json");
const CLASSIFIER = "deepseek-v4-pro";
// 10, after measuring rather than guessing. Time and output per request scale
// with how ambiguous the domains are, not just how many: batches of 25 ran
// 19s/1,341 tokens for easy ones and 68s/4,603 for hard ones, and the long tail
// is what the gateway terminates. Ten keeps every request short enough to land.
// (build-panel.ts still uses 50 for its porn/piracy filter and will hit the same
// wall when its cache next misses in bulk.)
const BATCH = 10;

type Verdict = "shop" | "not-shop";
type Verdicts = Record<string, Verdict>;

async function classify(unseen: string[], verdicts: Verdicts): Promise<void> {
  if (!unseen.length) return;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn(`::warning::DEEPSEEK_API_KEY not set — ${unseen.length} domain(s) left unjudged.`);
    return;
  }
  // A request with no deadline hung this script for seven hours on its fourth
  // batch: alive, holding the connection, writing nothing. Every call now has a
  // ceiling and gives up rather than waiting forever.
  const client = new Anthropic({
    apiKey,
    baseURL: "https://api.deepseek.com/anthropic",
    timeout: 180_000,
    maxRetries: 2,
  });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const prompt = (chunk: string[]) =>
    `For each domain say shop or not-shop.\n` +
    `shop = you can buy goods or services on the site itself: a retailer, a brand selling direct, ` +
    `a marketplace, a grocery or food-delivery service, a ticket or travel booking site, ` +
    `or a business selling a paid subscription or plan to the public.\n` +
    `not-shop = news, reference, social, government, sport, banking, a company site with no ` +
    `self-serve purchase, or a tool that is free only.\n` +
    `Judge the site, not the brand: a carmaker's brochure site is not-shop; its online store is.\n` +
    `Format one per line: domain|shop or domain|not-shop\n\n${chunk.join("\n")}`;

  const total = Math.ceil(unseen.length / BATCH);
  for (let i = 0; i < unseen.length; i += BATCH) {
    const chunk = unseen.slice(i, i + BATCH);
    const n = i / BATCH + 1;
    const started = Date.now();

    // Sustained back-to-back requests get terminated at the gateway after a few
    // minutes, while the same request in isolation answers in ten seconds. So
    // pace the run, and retry a terminated batch rather than abandoning the
    // domains in it — the first version skipped them and left 1,100 unjudged.
    if (i) await sleep(1500);

    let response: Anthropic.Message | null = null;
    for (let attempt = 1; attempt <= 3 && !response; attempt++) {
      try {
        response = await client.messages.create({
          // This model thinks before answering and thinking comes out of the same
          // budget, so a tight ceiling returns an empty response and no error.
          model: CLASSIFIER,
          max_tokens: 16000,
          messages: [{ role: "user", content: prompt(chunk) }],
        });
      } catch (error: any) {
        const why = String(error?.message || error).slice(0, 70);
        if (attempt === 3) {
          console.warn(`  batch ${n}/${total} gave up after 3 attempts: ${why}`);
        } else {
          console.warn(`  batch ${n}/${total} attempt ${attempt} failed (${why}) — backing off`);
          await sleep(attempt * 20000);
        }
      }
    }
    if (!response) continue;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    let got = 0;
    for (const line of text.split("\n")) {
      const m = /([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\s*[|:=-]\s*(not-shop|shop)/i.exec(line);
      if (!m) continue;
      const domain = m[1].toLowerCase();
      if (!chunk.includes(domain)) continue;
      verdicts[domain] = m[2].toLowerCase() === "shop" ? "shop" : "not-shop";
      got += 1;
    }
    console.log(`  batch ${n}/${total}: ${got}/${chunk.length} judged in ${Math.round((Date.now() - started) / 1000)}s`);
    // Save after every batch: a long run that dies halfway should not throw
    // away the verdicts already paid for.
    await save(verdicts);
  }
}

async function save(verdicts: Verdicts): Promise<void> {
  await fsp.writeFile(COMMERCE_PATH, `${JSON.stringify(verdicts, Object.keys(verdicts).sort(), 1)}\n`, "utf8");
}

async function main() {
  const all = process.argv.includes("--all");
  const audited = (await fsp.readdir(RESULTS_DIR))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();

  const verdicts: Verdicts = fs.existsSync(COMMERCE_PATH)
    ? JSON.parse(await fsp.readFile(COMMERCE_PATH, "utf8"))
    : {};

  const unseen = all ? audited : audited.filter((d) => !verdicts[d]);
  console.log(`${audited.length} audited domains · ${audited.length - unseen.length} already judged · ${unseen.length} to judge`);
  await classify(unseen, verdicts);
  await save(verdicts);

  const shops = audited.filter((d) => verdicts[d] === "shop");
  console.log(`\n${shops.length} shops of ${audited.length} audited → ${path.relative(REPO_ROOT, COMMERCE_PATH)}`);
  console.log(shops.slice(0, 25).join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
