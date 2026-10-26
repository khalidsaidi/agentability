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
// Two providers, because one of them kept not answering. DeepSeek terminated
// most of these requests at the gateway — a 10-domain batch would answer in 20s
// or never return at all, and a single request once held the process for seven
// hours. Anthropic's Haiku is the reliable path for a bulk classifier like this
// and costs cents for the whole panel ($0.10/$0.50 per MTok), so it is preferred
// when its key is present; DeepSeek stays as the fallback so CI keeps working
// where only that secret is configured.
const PROVIDERS = [
  {
    name: "deepseek",
    model: "deepseek-v4-pro",
    envVar: "DEEPSEEK_API_KEY",
    baseURL: "https://api.deepseek.com/anthropic" as string | undefined,
  },
  // Only used when DEEPSEEK_API_KEY is absent and this one is deliberately set.
  // This project runs on DeepSeek for cost reasons and must keep doing so by
  // default: nothing here should start billing another provider on its own just
  // because a key happens to exist in the environment.
  {
    name: "haiku",
    model: "claude-haiku-5-5",
    envVar: "ANTHROPIC_API_KEY",
    baseURL: undefined as string | undefined,
  },
];
// 10, after measuring rather than guessing. Time and output per request scale
// with how ambiguous the domains are, not just how many: batches of 25 ran
// 19s/1,341 tokens for easy ones and 68s/4,603 for hard ones, and the long tail
// is what the gateway terminates. Ten keeps every request short enough to land.
// (build-panel.ts still uses 50 for its porn/piracy filter and will hit the same
// wall when its cache next misses in bulk.)
const BATCH = 10;
// Enforced with Promise.race, not by the SDK — see the comment at the call site.
const HARD_TIMEOUT_MS = 120_000;

type Verdict = "shop" | "not-shop";
type Verdicts = Record<string, Verdict>;

async function classify(unseen: string[], verdicts: Verdicts): Promise<void> {
  if (!unseen.length) return;
  const provider = PROVIDERS.find((p) => process.env[p.envVar]);
  if (!provider) {
    console.warn(
      `::warning::no classifier key set (${PROVIDERS.map((p) => p.envVar).join(" or ")}) — ${unseen.length} domain(s) left unjudged.`
    );
    return;
  }
  const apiKey = process.env[provider.envVar] as string;
  console.log(`classifier: ${provider.model}`);
  // A request with no deadline hung this script for seven hours on its fourth
  // batch: alive, holding the connection, writing nothing. Every call now has a
  // ceiling and gives up rather than waiting forever.
  const client = new Anthropic({
    apiKey,
    ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
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

  // A stall must be loud. Twice this script hung silently and I reported it as
  // "still running" because the process existed — which proves nothing.
  let lastProgress = Date.now();
  const watchdog = setInterval(() => {
    const idle = Math.round((Date.now() - lastProgress) / 1000);
    if (idle > 600) {
      console.error(`::error::classify-shops stalled — nothing judged for ${idle}s. Verdicts so far are saved; re-run to resume.`);
      process.exit(1);
    }
  }, 60_000);
  watchdog.unref();

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
        // The SDK's own `timeout` does not reliably fire here: twice this script
        // sat on a single request for seven hours, process alive, zero CPU, no
        // error, no retry. So the deadline is enforced outside the SDK, where
        // nothing can swallow it. The request is abandoned, not awaited.
        const ctl = new AbortController();
        const deadline = new Promise<never>((_, reject) =>
          setTimeout(() => {
            ctl.abort();
            reject(new Error(`no response in ${HARD_TIMEOUT_MS / 1000}s`));
          }, HARD_TIMEOUT_MS).unref()
        );
        response = await Promise.race([
          client.messages.create(
            {
              // Both models think before answering and thinking comes out of this
              // budget, so a tight ceiling returns an empty response and no error.
              model: provider.model,
              max_tokens: 8000,
              // Low effort is right for a yes/no classification; DeepSeek has no
              // equivalent knob, so it only goes to the Anthropic model.
              ...(provider.name === "haiku" ? { output_config: { effort: "low" as const } } : {}),
              messages: [{ role: "user", content: prompt(chunk) }],
            },
            { signal: ctl.signal }
          ),
          deadline,
        ]);
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
    lastProgress = Date.now();
    // Save after every batch: a long run that dies halfway should not throw
    // away the verdicts already paid for.
    await save(verdicts);
  }
  clearInterval(watchdog);
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
