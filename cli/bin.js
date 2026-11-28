#!/usr/bin/env node
// npx agentability <domain> [--json | --prompt]
// Checks whether AI agents can use a website, live, with Agentability's nine
// checks. No dependencies and no account: it calls https://agentability.org/api/check.

"use strict";

const API = "https://agentability.org/api/check";
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const domain = args.find((a) => !a.startsWith("--"));

if (!domain || flags.has("--help") || flags.has("-h")) {
  console.log(`agentability: can AI agents use this website?

  npx agentability example.com            score, every check, and what to fix
  npx agentability example.com --prompt   just the fix prompt, to paste into a coding assistant
  npx agentability example.com --json     the full result as JSON

Same check as https://agentability.org/support/ and the MCP server at https://agentability.org/mcp.
10 checks per hour per client; results are cached for 24 hours.`);
  process.exit(domain ? 0 : 1);
}

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint("1"), dim = paint("2"), green = paint("32"), yellow = paint("33"), red = paint("31");
const byStatus = { pass: green, warn: yellow, fail: red, skip: dim };
const mark = { pass: "✓", warn: "~", fail: "✗", skip: "·" };

async function main() {
  if (!flags.has("--json") && !flags.has("--prompt")) process.stderr.write(dim(`Checking ${domain} the way an AI agent would…\n`));
  let res;
  try {
    res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "agentability-cli/1.0" },
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(70_000),
    });
  } catch (e) {
    console.error(`Could not reach ${API}: ${e.message}`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  if (flags.has("--json")) {
    console.log(JSON.stringify(data, null, 2));
    process.exit(res.ok ? 0 : 1);
  }
  if (!res.ok || typeof data.score !== "number") {
    console.error(data.message || `The check failed (HTTP ${res.status}).`);
    process.exit(1);
  }
  if (flags.has("--prompt")) {
    console.log(data.fixPrompt || `Nothing to fix: ${data.domain} passes every core check.`);
    return;
  }
  const color = data.score >= 70 ? green : data.score >= 55 ? yellow : red;
  console.log(`\n${bold(data.domain)}  ${color(bold(data.score))}${dim("/100")}  grade ${data.grade}${data.posture === "closed" ? "  " + red("closed to AI by policy") : ""}`);
  if (data.comparedToIndex) {
    console.log(dim(`Better than ${data.comparedToIndex.betterThanPercent}% of the ${data.comparedToIndex.sites} most-visited sites on the web.`));
  }
  console.log("");
  for (const c of data.checks || []) {
    const paintIt = byStatus[c.status] || ((s) => s);
    console.log(`${paintIt(mark[c.status] || "?")} ${c.id} ${c.title} ${dim(`${c.points}/${c.maxPoints}`)}`);
    console.log(dim(`    ${c.detail}`));
    if (c.fix) console.log(`    Fix: ${c.fix}`);
  }
  console.log(dim(`\n${data.cached ? "Cached result (24h)." : "Checked just now."} Fix prompt: npx agentability ${data.domain} --prompt`));
  console.log(dim(`Share: https://agentability.org/support/?check=${encodeURIComponent(data.domain)}`));
}

main();
