#!/usr/bin/env tsx
// Builds the entire agentability.org static site into dist-static/.
// No server, no functions, no billing: the observatory of the agentic web.

import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const SUMMARY_PATH = path.join(REPO_ROOT, "data/index/summary.json");
const RESULTS_DIR = path.join(REPO_ROOT, "data/index/results");
const HISTORY_DIR = path.join(REPO_ROOT, "data/index/history");
const OUT = path.join(REPO_ROOT, "dist-static");
const SITE = "https://agentability.org";

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function scoreColor(score: number): string {
  if (score >= 70) return "#0a7d46";
  if (score >= 55) return "#8a6d00";
  return "#b3261e";
}

function shell(opts: { title: string; description: string; canonicalPath: string; body: string; jsonLd?: object }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${SITE}${opts.canonicalPath}">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${SITE}${opts.canonicalPath}">
<meta name="twitter:card" content="summary">
${opts.jsonLd ? `<script type="application/ld+json">${JSON.stringify(opts.jsonLd)}</script>` : ""}
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #171b26; background: #fff; line-height: 1.55; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 28px 20px 64px; }
  header.top { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-bottom: 36px; }
  .brand { font-weight: 700; font-size: 1.05rem; color: #171b26; text-decoration: none; }
  .brand span { color: #1d4ed8; }
  nav.top a { margin-left: 18px; font-size: .88rem; color: #445; text-decoration: none; }
  nav.top a:hover { color: #1d4ed8; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-size: clamp(1.7rem, 4vw, 2.5rem); line-height: 1.15; margin: 6px 0 14px; }
  h2 { font-size: 1.15rem; margin: 34px 0 10px; }
  a { color: #1d4ed8; }
  .lede { color: #46506a; max-width: 62ch; font-size: 1.02rem; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 26px 0; }
  .stat { border: 1px solid #e6e8ef; border-radius: 12px; padding: 14px; }
  .stat b { display: block; font-size: 1.6rem; font-variant-numeric: tabular-nums; }
  .stat small { color: #667085; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: .92rem; }
  th { text-align: left; font-size: .7rem; text-transform: uppercase; letter-spacing: .1em; color: #667085; padding: 8px; border-bottom: 1px solid #e6e8ef; }
  td { padding: 9px 8px; border-bottom: 1px solid #f0f1f5; vertical-align: top; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .bar { display: inline-block; width: 80px; height: 8px; border-radius: 4px; background: #eef0f5; vertical-align: middle; margin-right: 8px; }
  .bar > span { display: block; height: 100%; border-radius: 4px; }
  .chip { display: inline-block; font-size: .72rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: #f1f3f9; color: #444; white-space: nowrap; }
  .chip.paradox { background: #fdecec; color: #b3261e; }
  .chip.closed { background: #171b26; color: #fff; }
  .status-pass { color: #0a7d46; font-weight: 600; }
  .status-warn { color: #8a6d00; font-weight: 600; }
  .status-fail { color: #b3261e; font-weight: 600; }
  .status-skip { color: #98a1b3; }
  .cta { margin-top: 26px; padding: 16px; border: 1px solid #e6e8ef; border-radius: 12px; font-size: .92rem; color: #46506a; }
  .foot { margin-top: 44px; padding-top: 18px; border-top: 1px solid #eef0f5; font-size: .8rem; color: #8a90a3; }
  .scorebig { font-size: 3.2rem; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
  @media (max-width: 640px) { .hide-sm { display: none; } }
</style>
</head>
<body><div class="wrap">
<header class="top">
  <a class="brand" href="/">agent<span>ability</span></a>
  <nav class="top"><a href="/ai-index/">The Index</a><a href="/methodology/">Methodology</a><a href="https://github.com/khalidsaidi/agentability">GitHub</a></nav>
</header>
${opts.body}
<footer class="foot">Agentability is an open-source observatory of the agentic web. Every check is reproducible —
<a href="https://github.com/khalidsaidi/agentability">source &amp; data on GitHub</a>. Weekly refresh via public CI. No tracking, no signup, no cost.</footer>
</div></body>
</html>`;
}

type Summary = {
  generatedAt: string;
  stats: Record<string, number>;
  unreachable: string[];
  leaderboard: Array<{
    rank: number;
    domain: string;
    score: number;
    grade: string;
    posture: string;
    paradox: boolean;
    llmsTxt: boolean;
    mcp: boolean;
  }>;
};

function postureChip(row: { posture: string; paradox: boolean }): string {
  if (row.paradox) return `<span class="chip paradox" title="Publishes llms.txt while blocking AI crawlers">paradox</span>`;
  if (row.posture === "closed") return `<span class="chip closed">closed by policy</span>`;
  if (row.posture === "selective") return `<span class="chip">selective</span>`;
  return "";
}

function leaderboardTable(rows: Summary["leaderboard"]): string {
  return `<table>
<thead><tr><th class="num">#</th><th>Site</th><th class="num">Score</th><th>Grade</th><th class="hide-sm">Signals</th></tr></thead>
<tbody>
${rows
  .map(
    (r) => `<tr>
  <td class="num">${r.rank}</td>
  <td><a href="/ai-index/site/${esc(r.domain)}/">${esc(r.domain)}</a> ${postureChip(r)}</td>
  <td class="num"><span class="bar"><span style="width:${Math.max(2, r.score)}%;background:${scoreColor(r.score)}"></span></span>${r.score}</td>
  <td><span class="chip">${esc(r.grade)}</span></td>
  <td class="hide-sm">${r.llmsTxt ? '<span class="chip">llms.txt</span>' : ""} ${r.mcp ? '<span class="chip">MCP</span>' : ""}</td>
</tr>`
  )
  .join("\n")}
</tbody>
</table>`;
}

async function main() {
  await fsp.rm(OUT, { recursive: true, force: true });
  await fsp.mkdir(OUT, { recursive: true });

  const hasData = fs.existsSync(SUMMARY_PATH);
  const summary: Summary | null = hasData ? JSON.parse(await fsp.readFile(SUMMARY_PATH, "utf8")) : null;
  const generated = summary
    ? new Date(summary.generatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    : null;

  const history: Array<{ date: string } & Record<string, number>> = [];
  if (fs.existsSync(HISTORY_DIR)) {
    for (const file of (await fsp.readdir(HISTORY_DIR)).sort()) {
      if (file.endsWith(".json")) history.push(JSON.parse(await fsp.readFile(path.join(HISTORY_DIR, file), "utf8")));
    }
  }

  // ---------- Landing: the observatory ----------
  const s = summary?.stats;
  const landingBody = summary && s
    ? `
<p class="chip">Tracking the agentic web since August 27, 2026 · updated weekly</p>
<h1>Is the web actually ready for AI agents?<br>We measure it.</h1>
<p class="lede">Every week we test ${s.audited} well-known sites — the AI companies included — against the conventions
real AI agents rely on in 2026: <code>llms.txt</code>, crawler policy, parseable content, structured data, MCP.
The result is a public scoreboard, an adoption time series, and some uncomfortable findings.</p>
<div class="stats">
  <div class="stat"><b>${s.averageScore}/100</b><small>average readiness score</small></div>
  <div class="stat"><b>${s.pctLlmsTxt}%</b><small>publish llms.txt</small></div>
  <div class="stat"><b>${s.pctBlockingSomeAI}%</b><small>block at least one AI crawler</small></div>
  <div class="stat"><b>${s.paradoxCount}</b><small>court AI while blocking it (the paradox)</small></div>
  <div class="stat"><b>${s.pctMcp}%</b><small>advertise an MCP server</small></div>
</div>
<h2>The AI-Readiness Index — top 20</h2>
${leaderboardTable(summary.leaderboard.slice(0, 20))}
<p style="margin-top:12px"><a href="/ai-index/">Full ranked index of ${s.audited} sites →</a></p>
<div class="cta"><b>Work on one of these sites?</b> Every failed check on your report page has a concrete fix, and scores
refresh weekly. <a href="https://github.com/khalidsaidi/agentability/issues/new?title=Audit%20request:%20yourdomain.com&labels=audit-request">Request an audit</a>
of any site — it's free and takes one issue.</div>
<h2>Why this exists</h2>
<p class="lede">Agents are becoming the web's newest audience: assistants that read pages, cite sources, and complete
tasks for people. Whether your site is legible to them is measurable — so we measure it, in public, with
reproducible checks and open data. History accrues weekly${history.length > 1 ? ` (${history.length} snapshots so far)` : " — this is week zero"}.</p>`
    : `
<h1>The observatory of the agentic web</h1>
<p class="lede">First index run is in progress. The scoreboard, adoption statistics, and site reports appear here
as soon as the initial audit completes.</p>`;

  await fsp.writeFile(
    path.join(OUT, "index.html"),
    shell({
      title: "Agentability — is the web ready for AI agents?",
      description: summary && s
        ? `We test ${s.audited} well-known sites weekly for AI-agent readiness. Average score ${s.averageScore}/100; ${s.pctBlockingSomeAI}% block at least one AI crawler.`
        : "A public, open-source observatory measuring how ready the web is for AI agents.",
      canonicalPath: "/",
      body: landingBody,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Agentability",
        url: SITE,
        description: "Open-source observatory measuring AI-agent readiness of the web.",
      },
    }),
    "utf8"
  );

  // ---------- Full index page + site reports ----------
  if (summary && s) {
    await fsp.mkdir(path.join(OUT, "ai-index"), { recursive: true });
    const failShare = summary.leaderboard.length
      ? Math.round((summary.leaderboard.filter((r) => r.score < 55).length / summary.leaderboard.length) * 100)
      : 0;
    await fsp.writeFile(
      path.join(OUT, "ai-index/index.html"),
      shell({
        title: "The AI-Readiness Index — full rankings",
        description: `All ${s.audited} sites ranked by AI-agent readiness. ${failShare}% score under 55/100. Updated ${generated}.`,
        canonicalPath: "/ai-index/",
        body: `
<p class="chip"><a href="/" style="text-decoration:none;color:inherit">Agentability</a> · AI-Readiness Index · updated ${generated}</p>
<h1>The AI-Readiness Index</h1>
<p class="lede">${s.audited} well-known sites, ranked by how usable they are for AI agents. Average ${s.averageScore}/100.
Checks: llms.txt, AI-crawler policy, content parseability, structured data, sitemap, task reachability, plus MCP/OpenAPI bonuses —
<a href="/methodology/">methodology</a>.</p>
${leaderboardTable(summary.leaderboard)}
${summary.unreachable.length ? `<p style="margin-top:14px;color:#667085;font-size:.85rem">Unreachable this run: ${summary.unreachable.map(esc).join(", ")}.</p>` : ""}
<div class="cta">Your site missing or mis-scored? <a href="https://github.com/khalidsaidi/agentability/issues/new?title=Audit%20request:%20yourdomain.com&labels=audit-request">Open an issue</a> — audits are free, from public surfaces only, and re-run weekly.</div>`,
      }),
      "utf8"
    );

    const files = (await fsp.readdir(RESULTS_DIR)).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const r = JSON.parse(await fsp.readFile(path.join(RESULTS_DIR, file), "utf8"));
      if (r.status !== "complete") continue;
      const rank = summary.leaderboard.find((x) => x.domain === r.domain)?.rank;
      const checksRows = r.checks
        .map(
          (c: any) => `<tr>
  <td><span class="chip">${esc(c.id)}</span></td>
  <td><b>${esc(c.title)}</b><br><span style="color:#667085;font-size:.86em">${esc(c.detail)}</span></td>
  <td class="num">${c.points}/${c.maxPoints}</td>
  <td class="status-${esc(c.status)}">${esc(c.status)}</td>
</tr>`
        )
        .join("\n");
      const robotsRow = r.robots.length
        ? `<p style="margin-top:8px">${r.robots
            .map((p: any) => `<span class="chip" title="robots.txt policy">${esc(p.bot)}: ${esc(p.policy)}</span>`)
            .join(" ")}</p>`
        : "";
      const dir = path.join(OUT, "ai-index/site", r.domain);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(
        path.join(dir, "index.html"),
        shell({
          title: `${r.domain} — AI readiness score ${r.score}/100`,
          description: `${r.domain} scores ${r.score}/100 (${r.grade}) for AI-agent readiness${r.paradox ? " — and publishes llms.txt while blocking AI crawlers" : ""}. Full check-by-check report.`,
          canonicalPath: `/ai-index/site/${r.domain}/`,
          body: `
<p class="chip"><a href="/ai-index/" style="text-decoration:none;color:inherit">← AI-Readiness Index</a></p>
<h1>${esc(r.domain)}</h1>
<p><span class="scorebig" style="color:${scoreColor(r.score)}">${r.score}</span><span style="color:#667085">/100</span>
&nbsp; <span class="chip">${esc(r.grade)}</span>${rank ? ` <span class="chip">#${rank} of ${s.audited}</span>` : ""}
${r.paradox ? ' <span class="chip paradox">the paradox: courts AI, blocks AI</span>' : ""}</p>
<p class="lede">Audited ${generated} from public surfaces only. Can AI agents discover, read, and act on
${esc(r.domain)}? Check by check:</p>
${robotsRow}
<table>
<thead><tr><th>Check</th><th>Finding</th><th class="num">Points</th><th>Result</th></tr></thead>
<tbody>${checksRows}</tbody>
</table>
<div class="cta"><b>Work on ${esc(r.domain)}?</b> Each failed check maps to a concrete fix in the
<a href="/methodology/">methodology</a> — most ship in under an hour. Scores refresh weekly;
<a href="https://github.com/khalidsaidi/agentability/issues/new?title=Re-audit:%20${esc(r.domain)}&labels=audit-request">request a re-run</a> after you deploy.</div>`,
          jsonLd: {
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: `${r.domain} AI-readiness audit`,
            description: `AI-agent readiness score for ${r.domain}: ${r.score}/100 (${r.grade}).`,
            url: `${SITE}/ai-index/site/${r.domain}/`,
            dateModified: summary.generatedAt,
            creator: { "@type": "Organization", name: "Agentability", url: SITE },
          },
        }),
        "utf8"
      );
    }
  }

  // ---------- Methodology ----------
  const methodologyBody = `
<p class="chip"><a href="/" style="text-decoration:none;color:inherit">Agentability</a> · Methodology</p>
<h1>How scoring works</h1>
<p class="lede">Eight checks, all against public surfaces, all reproducible with plain HTTP requests. No invented
standards: every check is traceable to a convention that real AI systems use in 2026.</p>
<table>
<thead><tr><th>Check</th><th>What &amp; why</th><th class="num">Points</th></tr></thead>
<tbody>
<tr><td><span class="chip">A1</span></td><td><b>llms.txt</b> — the llmstxt.org convention: a curated, plain-text entry point for AI readers. Substantive file with links required.</td><td class="num">15</td></tr>
<tr><td><span class="chip">A2</span></td><td><b>AI-crawler policy</b> — robots.txt rules for GPTBot, ClaudeBot, Claude-User, PerplexityBot, Google-Extended, CCBot. Open access scores full points; blanket blocks score zero and are labeled “closed by policy” (a stance, not a bug — but it is what it is).</td><td class="num">15</td></tr>
<tr><td><span class="chip">A3</span></td><td><b>Content readable without a browser</b> — a plain fetch of the homepage must yield real text, not a JavaScript wall or a bot challenge. Agents don't run your SPA.</td><td class="num">25</td></tr>
<tr><td><span class="chip">A4</span></td><td><b>Structured data</b> — valid schema.org JSON-LD so machines learn what the entity is.</td><td class="num">15</td></tr>
<tr><td><span class="chip">A5</span></td><td><b>Sitemap</b> — advertised in robots.txt or served at /sitemap.xml.</td><td class="num">10</td></tr>
<tr><td><span class="chip">A6</span></td><td><b>Everyday agent tasks</b> — pricing, support, docs, and legal reachable from the homepage; the links an assistant needs for the questions people actually ask.</td><td class="num">20</td></tr>
<tr><td><span class="chip">B1</span></td><td><b>MCP server</b> advertised at /.well-known/mcp.json — bonus; the emerging standard for callable sites.</td><td class="num">+5</td></tr>
<tr><td><span class="chip">B2</span></td><td><b>OpenAPI</b> document published — bonus; only relevant where an API exists.</td><td class="num">+5</td></tr>
</tbody>
</table>
<h2>Grades</h2>
<p class="lede">A ≥ 85 · B ≥ 70 · C ≥ 55 · D ≥ 40 · F &lt; 40. Sites whose robots.txt blocks essentially all AI crawlers
are labeled <b>“Closed by policy”</b> instead of graded — refusing agents is a legitimate choice, and we report it as
one rather than pretending it's a defect.</p>
<h2>Reproducibility</h2>
<p class="lede">The evaluator is ~300 lines of dependency-free TypeScript in the
<a href="https://github.com/khalidsaidi/agentability">open repo</a>, runs weekly in public GitHub Actions, and commits
raw results to the repository. Disagree with a check? Open an issue — the rubric is versioned in public.</p>`;
  await fsp.mkdir(path.join(OUT, "methodology"), { recursive: true });
  await fsp.writeFile(
    path.join(OUT, "methodology/index.html"),
    shell({
      title: "Methodology — Agentability",
      description: "How the AI-Readiness Index scores sites: eight reproducible checks against real 2026 conventions.",
      canonicalPath: "/methodology/",
      body: methodologyBody,
    }),
    "utf8"
  );

  // ---------- Machine surfaces (dogfood) ----------
  const domains = summary ? summary.leaderboard.map((r) => r.domain) : [];
  await fsp.writeFile(
    path.join(OUT, "llms.txt"),
    [
      "# Agentability (agentability.org)",
      "",
      "Open-source observatory measuring AI-agent readiness of the web. Weekly",
      "audits of well-known sites against real 2026 conventions (llms.txt, AI",
      "crawler policy, parseable content, structured data, MCP, OpenAPI).",
      "",
      "## Key pages",
      `- The AI-Readiness Index (full rankings): ${SITE}/ai-index/`,
      `- Methodology (checks and scoring): ${SITE}/methodology/`,
      `- Raw data (JSON): ${SITE}/data/summary.json`,
      "",
      "## Per-site reports",
      ...domains.slice(0, 40).map((d) => `- ${SITE}/ai-index/site/${d}/`),
    ].join("\n") + "\n",
    "utf8"
  );
  await fsp.writeFile(path.join(OUT, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`, "utf8");
  const urls = ["/", "/ai-index/", "/methodology/", ...domains.map((d) => `/ai-index/site/${d}/`)];
  await fsp.writeFile(
    path.join(OUT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => `<url><loc>${SITE}${u}</loc></url>`).join("\n") +
      `\n</urlset>\n`,
    "utf8"
  );

  // Open data: publish summary + history verbatim.
  await fsp.mkdir(path.join(OUT, "data/history"), { recursive: true });
  if (summary) await fsp.writeFile(path.join(OUT, "data/summary.json"), JSON.stringify(summary, null, 1), "utf8");
  for (const h of history) {
    await fsp.writeFile(path.join(OUT, `data/history/${h.date}.json`), JSON.stringify(h, null, 1), "utf8");
  }

  await fsp.writeFile(
    path.join(OUT, "404.html"),
    shell({
      title: "Not found — Agentability",
      description: "Page not found.",
      canonicalPath: "/404.html",
      body: `<h1>404</h1><p class="lede">That page doesn't exist — but <a href="/ai-index/">the Index</a> does.</p>`,
    }),
    "utf8"
  );

  console.log(`Built static site → ${OUT} (${summary ? summary.leaderboard.length : 0} site reports)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
