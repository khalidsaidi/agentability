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
const EPISODES_DIR = path.join(REPO_ROOT, "data/fieldtest/episodes");
const OUT = path.join(REPO_ROOT, "dist-static");
const SITE = "https://agentability.org";
const INDEXNOW_KEY = "4e1abda486c0a02493e7b6520d2ae99b";

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function scoreColor(score: number): string {
  if (score >= 70) return "#46e094";
  if (score >= 55) return "#ffd028";
  return "#ff6058";
}

function shell(opts: { title: string; description: string; canonicalPath: string; body: string; jsonLd?: object }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="google-site-verification" content="UwlyIMgY4AbelS-xVcScH18Jmk1-ojfzvD3vZOi1vTk">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${SITE}${opts.canonicalPath}">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${SITE}${opts.canonicalPath}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#0f1014">
${opts.jsonLd ? `<script type="application/ld+json">${JSON.stringify(opts.jsonLd)}</script>` : ""}
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
gtag('js', new Date());
gtag('config', 'G-55RKNLGPNT');
</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-55RKNLGPNT"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Spline+Sans+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root {
    --stage: #0f1014; --panel: #16171d; --panel-2: #1c1d25; --line: #272935;
    --ink: #f2f1ea; --dim: #9a9daf;
    --hazard: #ffd028; --win: #46e094; --alert: #ff6058; --link: #9db8ff;
    --display: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
    --mono: "Spline Sans Mono", ui-monospace, "SF Mono", Menlo, monospace;
  }
  * { box-sizing: border-box; margin: 0; }
  html { scroll-behavior: smooth; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: var(--stage); line-height: 1.6; }
  ::selection { background: var(--hazard); color: #111; }
  :focus-visible { outline: 2px solid var(--hazard); outline-offset: 2px; border-radius: 4px; }
  .wrap { max-width: 1020px; margin: 0 auto; padding: 26px 20px 72px; }
  header.top { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 40px; }
  .brand { font-family: var(--display); font-weight: 800; font-size: 1.12rem; color: var(--ink); text-decoration: none; letter-spacing: -.01em; }
  .brand span { background: var(--hazard); color: #111; padding: 0 5px; border-radius: 5px; margin-left: 1px; }
  nav.top { display: flex; gap: 4px; flex-wrap: wrap; }
  nav.top a { padding: 6px 12px; font-size: .85rem; font-weight: 600; color: var(--dim); text-decoration: none; border-radius: 999px; transition: color .15s, background .15s; }
  nav.top a:hover { color: var(--ink); background: var(--panel-2); }
  h1 { font-family: var(--display); font-weight: 800; font-size: clamp(2rem, 5.4vw, 3.6rem); line-height: 1.04; letter-spacing: -.02em; margin: 10px 0 18px; text-wrap: balance; max-width: 20ch; }
  h2 { font-family: var(--display); font-weight: 700; font-size: clamp(1.2rem, 2.6vw, 1.55rem); letter-spacing: -.01em; margin: 52px 0 14px; }
  a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 3px; }
  a:hover { color: var(--ink); }
  .hl { background: var(--hazard); color: #111; padding: 0 .14em; border-radius: .12em; display: inline-block; transform: rotate(-1deg); }
  .lede { color: var(--dim); max-width: 64ch; font-size: 1.05rem; }
  .lede b, .lede a { color: var(--ink); }
  .eyebrow, .chip { display: inline-flex; align-items: center; gap: 7px; font-family: var(--mono); font-size: .72rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }
  .chip { padding: 3px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--panel); white-space: nowrap; text-transform: none; letter-spacing: .02em; }
  .chip a { color: inherit; }
  .chip.paradox { border-color: rgba(255,96,88,.5); color: var(--alert); }
  .chip.closed { background: var(--hazard); border-color: var(--hazard); color: #111; font-weight: 700; }
  .live { width: 8px; height: 8px; border-radius: 50%; background: var(--win); box-shadow: 0 0 0 0 rgba(70,224,148,.5); }
  @media (prefers-reduced-motion: no-preference) {
    .live { animation: pulse 2.2s ease-out infinite; }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(70,224,148,.55); } 70% { box-shadow: 0 0 0 9px rgba(70,224,148,0); } 100% { box-shadow: 0 0 0 0 rgba(70,224,148,0); } }
    .rise { opacity: 0; transform: translateY(18px); animation: rise .65s cubic-bezier(.2,.75,.25,1) forwards; }
    .rise.d1 { animation-delay: .07s; } .rise.d2 { animation-delay: .16s; } .rise.d3 { animation-delay: .26s; } .rise.d4 { animation-delay: .38s; }
    @keyframes rise { to { opacity: 1; transform: none; } }
  }
  /* ticker */
  .ticker { margin: 34px -20px 0; border-block: 1px solid var(--line); overflow: hidden; }
  .ticker-track { display: inline-flex; gap: 0; white-space: nowrap; padding: 9px 0; }
  .ticker-track span { font-family: var(--mono); font-size: .74rem; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); padding: 0 1.4rem; }
  .ticker-track span b { color: var(--hazard); font-weight: 600; }
  @media (prefers-reduced-motion: no-preference) {
    .ticker-track { animation: tick 36s linear infinite; }
    @keyframes tick { to { transform: translateX(-50%); } }
  }
  /* bento scoreboard */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 30px 0 8px; }
  .stat { border: 1px solid var(--line); background: var(--panel); border-radius: 18px; padding: 18px; transition: transform .18s, border-color .18s; }
  .stat:hover { transform: translateY(-3px); border-color: #3a3d4d; }
  .stat b { display: block; font-family: var(--display); font-weight: 800; font-size: clamp(1.7rem, 3.4vw, 2.5rem); line-height: 1.05; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
  .stat small { color: var(--dim); font-size: .8rem; }
  .stat.walls b { color: var(--hazard); }
  @media (max-width: 720px) { .stats { grid-template-columns: repeat(2, 1fr); } }
  /* tables */
  table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: .92rem; }
  th { text-align: left; font-family: var(--mono); font-size: .68rem; text-transform: uppercase; letter-spacing: .1em; color: var(--dim); padding: 8px; border-bottom: 1px solid var(--line); }
  td { padding: 10px 8px; border-bottom: 1px solid #1d1f28; vertical-align: top; }
  tr:hover td { background: rgba(255,255,255,.018); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .bar { display: inline-block; width: 76px; height: 7px; border-radius: 4px; background: #22242e; vertical-align: middle; margin-right: 8px; }
  .bar > span { display: block; height: 100%; border-radius: 4px; }
  .status-pass { color: var(--win); font-weight: 600; }
  .status-warn { color: var(--hazard); font-weight: 600; }
  .status-fail { color: var(--alert); font-weight: 600; }
  .status-skip { color: #565968; }
  .cta { margin-top: 30px; padding: 18px 20px; border: 1px dashed #3a3d4d; border-radius: 16px; font-size: .93rem; color: var(--dim); }
  .cta b { color: var(--ink); }
  .foot { margin-top: 64px; padding-top: 20px; border-top: 1px solid var(--line); font-size: .8rem; color: #6d7080; }
  .scorebig { font-family: var(--display); font-size: 3.6rem; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1; letter-spacing: -.03em; }
  /* the show: segments */
  .task { position: relative; border: 1px solid var(--line); background: var(--panel); border-radius: 20px; padding: 22px 24px; margin: 18px 0; transition: border-color .18s; }
  .task:hover { border-color: #3a3d4d; }
  .task h3 { font-family: var(--display); font-weight: 700; font-size: 1.28rem; letter-spacing: -.01em; margin: 4px 0 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .segno { font-family: var(--mono); font-size: .7rem; letter-spacing: .14em; color: #565968; text-transform: uppercase; }
  .stamp { font-family: var(--mono); font-size: .68rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; border: 2px solid currentColor; padding: 2px 8px; border-radius: 7px; transform: rotate(-2deg); }
  .stamp.completed { color: var(--win); }
  .stamp.partial { color: var(--hazard); }
  .stamp.failed { color: var(--alert); }
  .wallcount { font-family: var(--mono); font-size: .7rem; color: var(--hazard); letter-spacing: .06em; }
  .pick { font-family: var(--mono); font-size: .7rem; color: var(--win); letter-spacing: .06em; }
  .prompt { font-size: .88rem; color: var(--dim); max-width: 70ch; }
  .answer { position: relative; margin: 14px 0 4px; padding: 14px 16px 13px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 4px 16px 16px 16px; font-size: .95rem; }
  .answer::before { content: "AGENT'S REPORT"; display: block; font-family: var(--mono); font-size: .62rem; letter-spacing: .16em; color: var(--dim); margin-bottom: 6px; }
  .obst { font-size: .86rem; color: var(--hazard); margin-top: 10px; opacity: .92; }
  .diag { font-size: .8rem; color: var(--dim); margin-top: 8px; }
  .task details { margin-top: 12px; }
  .task summary { cursor: pointer; font-family: var(--mono); font-size: .78rem; letter-spacing: .04em; color: var(--link); }
  .task summary:hover { color: var(--ink); }
  .tl { list-style: none; padding: 0; margin: 14px 0 0; }
  .tl li { position: relative; padding: 0 0 14px 22px; }
  .tl li::before { content: ""; position: absolute; left: 5px; top: 8px; bottom: -2px; width: 2px; background: #262835; }
  .tl li::after { content: ""; position: absolute; left: 0; top: 6px; width: 12px; height: 12px; border-radius: 50%; background: var(--stage); border: 2px solid #3a3d4d; }
  .tl li:last-child::before { display: none; }
  .tl li.walled::after { border-color: var(--hazard); background: var(--hazard); }
  .tl .say { display: inline-block; background: var(--panel-2); border: 1px solid var(--line); border-radius: 4px 14px 14px 14px; padding: 8px 12px; font-size: .9rem; margin-bottom: 6px; }
  .tl .act { font-family: var(--mono); font-size: .74rem; color: #767a8c; word-break: break-all; }
  .tl .act .ok { color: #767a8c; }
  .stripe { height: 12px; border-radius: 4px; margin: 6px 0 8px; max-width: 420px;
    background: repeating-linear-gradient(-45deg, var(--hazard) 0 12px, #14151a 12px 24px); }
  .wallchip { display: inline-block; font-family: var(--mono); font-size: .68rem; font-weight: 600; letter-spacing: .1em; background: var(--hazard); color: #111; padding: 2px 8px; border-radius: 5px; }
  /* this-week segment cards */
  .segs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 18px; }
  .seg { position: relative; display: block; border: 1px solid var(--line); background: var(--panel); border-radius: 18px; padding: 18px; text-decoration: none; color: var(--ink); overflow: hidden; transition: transform .18s, border-color .18s; }
  .seg:hover { transform: translateY(-3px); border-color: #3a3d4d; color: var(--ink); }
  .seg .bigno { position: absolute; right: 10px; top: 2px; font-family: var(--display); font-weight: 800; font-size: 4.4rem; color: #20222c; line-height: 1; z-index: 0; }
  .seg .t { position: relative; font-family: var(--display); font-weight: 700; font-size: 1.02rem; line-height: 1.25; z-index: 1; }
  .seg .o { position: relative; display: block; margin-top: 10px; z-index: 1; }
  @media (max-width: 720px) { .segs { grid-template-columns: 1fr; } }
  .hero-cta { display: inline-block; margin-top: 22px; font-family: var(--display); font-weight: 700; font-size: 1rem; background: var(--hazard); color: #111 !important; text-decoration: none; padding: 12px 22px; border-radius: 999px; transition: transform .15s; }
  .hero-cta:hover { transform: translateY(-2px) rotate(-1deg); }
  @media (max-width: 640px) { .hide-sm { display: none; } }
</style>
</head>
<body><div class="wrap">
<header class="top">
  <a class="brand" href="/">agent<span>ability</span></a>
  <nav class="top"><a href="/fieldtest/">The Show</a><a href="/ai-index/">The Index</a><a href="/methodology/">Methodology</a><a href="https://github.com/khalidsaidi/agentability">GitHub</a></nav>
</header>
${opts.body}
<footer class="foot">Agentability is an open-source observatory of the agentic web. Every check is reproducible —
<a href="https://github.com/khalidsaidi/agentability">source &amp; data on GitHub</a>. Weekly refresh via public CI. No cookies, no signup, no cost.
<br /><a href="/docs/">Data docs</a> · <a href="/support/">Support</a> · <a href="/privacy/">Privacy</a></footer>
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

type EpisodeRun = {
  taskId: string;
  kind: string;
  title: string;
  prompt: string;
  outcome: "completed" | "partial" | "failed";
  answer: string;
  chosenSite: string | null;
  obstacles: string[];
  sources: string[];
  steps: Array<{
    step: number;
    narration: string;
    url: string;
    finalUrl: string;
    status: number;
    ok: boolean;
    botWall: boolean;
    pageTitle: string;
    note: string;
  }>;
  wallsHit: number;
  domainsVisited: string[];
  error?: string;
  diagnosis: Array<{ domain: string; posture: string; parseable: boolean }>;
};

type Episode = {
  date: string;
  generatedAt: string;
  model: string;
  stats: {
    tasks: number;
    completed: number;
    partial: number;
    failed: number;
    wallsHit: number;
    pageVisits: number;
    domainsVisited: number;
    costUsd: number;
  };
  runs: EpisodeRun[];
};

const FIELD_FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Can AI agents actually use websites in 2026?",
    a: "Sometimes. In our weekly field tests a production agent completes most simple errands (finding real prices, comparing plans) but is regularly stopped by bot walls, login-only pages, and JavaScript-only content — every attempt is published verbatim in the episodes.",
  },
  {
    q: "Is the Agent Field Test edited or scripted?",
    a: "No. An AI producer invents the tasks (grounded in that week's news), a separate AI agent attempts them with read-only web access, and the transcripts are published exactly as they happened — failures included. No human writes, selects, or edits an episode.",
  },
  {
    q: "Which websites block AI agents?",
    a: 'Our <a href="/ai-index/">AI-Readiness Index</a> audits 113 well-known sites weekly; sites like meta.ai are "closed by policy" (their robots.txt blocks all major AI crawlers), and field-test episodes regularly hit Cloudflare-style bot challenges on others.',
  },
  {
    q: "What tools does the agent get?",
    a: "One: a plain HTTP GET. It cannot run JavaScript, log in, submit forms, create accounts, or buy anything — which is exactly the point: it experiences the web the way most production AI assistants do.",
  },
];

function prettyDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const STAMP_LABEL: Record<EpisodeRun["outcome"], string> = {
  completed: "done",
  partial: "gave up honestly",
  failed: "failed",
};

function stamp(outcome: EpisodeRun["outcome"]): string {
  return `<span class="stamp ${outcome}">${STAMP_LABEL[outcome]}</span>`;
}

function taskCard(run: EpisodeRun, idx: number): string {
  const timeline = run.steps
    .map((s) => {
      const say = s.narration ? `<div class="say">“${esc(s.narration)}”</div>` : "";
      const wall = s.botWall ? `<div class="stripe"></div><span class="wallchip">⚠ BOT WALL</span> ` : "";
      const act = s.url
        ? `<div class="act">${wall}GET ${esc(s.finalUrl || s.url)} — ${esc(s.note)}</div>`
        : `<div class="act">${esc(s.note)}</div>`;
      return `<li${s.botWall ? ' class="walled"' : ""}>${say}${act}</li>`;
    })
    .join("\n");
  const diag = run.diagnosis
    .filter((d) => d.posture !== "open" || !d.parseable)
    .map(
      (d) =>
        `<a href="/ai-index/site/${esc(d.domain)}/">${esc(d.domain)}</a> is ${
          d.posture === "closed" ? "closed to AI crawlers by policy" : d.posture === "selective" ? "selectively blocking AI crawlers" : ""
        }${!d.parseable ? `${d.posture !== "open" ? " and" : ""} unreadable without a browser` : ""} on our index`
    )
    .join("; ");
  return `<div class="task" id="task-${esc(run.taskId)}">
<div class="segno">Segment ${String(idx + 1).padStart(2, "0")} · ${esc(run.kind)}</div>
<h3>${esc(run.title)} ${stamp(run.outcome)}${run.wallsHit ? ` <span class="wallcount">⚠ ${run.wallsHit} bot wall${run.wallsHit > 1 ? "s" : ""}</span>` : ""}${run.chosenSite ? ` <span class="pick">✓ picked ${esc(run.chosenSite)}</span>` : ""}</h3>
<p class="prompt">The task: ${esc(run.prompt)}</p>
<div class="answer">${esc(run.answer || run.error || "no report")}</div>
${run.obstacles.length ? `<p class="obst">In the agent's words: ${run.obstacles.map((o) => `“${esc(o)}”`).join(" · ")}</p>` : ""}
${diag ? `<p class="diag">Why: ${diag}.</p>` : ""}
<details><summary>▸ Play-by-play — ${run.steps.filter((s) => s.url).length} page visits, published verbatim</summary>
<ul class="tl">${timeline}</ul></details>
</div>`;
}

function segCards(episode: Episode): string {
  const scored = episode.runs
    .map((run) => ({
      run,
      drama:
        run.wallsHit * 3 +
        (run.kind === "stunt" ? 4 : 0) +
        (run.outcome === "failed" ? 3 : run.outcome === "partial" ? 1 : 0) +
        (run.chosenSite ? 2 : 0),
    }))
    .sort((a, b) => b.drama - a.drama)
    .slice(0, 3);
  return `<div class="segs">${scored
    .map(({ run }) => {
      const idx = episode.runs.indexOf(run) + 1;
      const note = run.wallsHit
        ? `<span class="wallcount">⚠ ${run.wallsHit} bot wall${run.wallsHit > 1 ? "s" : ""}</span>`
        : run.chosenSite
          ? `<span class="pick">✓ picked ${esc(run.chosenSite)}</span>`
          : stamp(run.outcome);
      return `<a class="seg" href="/fieldtest/${episode.date}/#task-${esc(run.taskId)}">
<span class="bigno">${String(idx).padStart(2, "0")}</span>
<span class="t">${esc(run.title)}</span>
<span class="o">${note}</span>
</a>`;
    })
    .join("\n")}</div>`;
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

  const episodes: Episode[] = [];
  if (fs.existsSync(EPISODES_DIR)) {
    for (const file of (await fsp.readdir(EPISODES_DIR)).sort().reverse()) {
      if (file.endsWith(".json")) episodes.push(JSON.parse(await fsp.readFile(path.join(EPISODES_DIR, file), "utf8")));
    }
  }
  const latest = episodes[0] ?? null;

  // ---------- Landing: the field test leads, the index is the reference ----------
  const s = summary?.stats;
  const tickerSpans = latest
    ? `<span><b>${latest.stats.tasks}</b> tasks</span><span><b>${latest.stats.completed}</b> completed</span><span><b>${latest.stats.wallsHit}</b> bot walls</span><span><b>${latest.stats.pageVisits}</b> pages read</span><span><b>${latest.stats.domainsVisited}</b> sites visited</span><span>no retries · no editing · no mercy</span><span>agent: ${esc(latest.model)}</span><span>producer: opus 5 + live search</span>`
    : "";
  const fieldtestHero = latest
    ? `
<p class="eyebrow rise"><span class="live"></span>The Agent Field Test · episode of ${prettyDate(latest.date)} · new every week, fully autonomous</p>
<h1 class="rise d1">We send an AI agent to run your <span class="hl">errands</span> on the real web. Then we publish <span class="hl">everything</span>.</h1>
<p class="lede rise d2">An AI producer reads the week's news and invents real tasks — find the true price, cancel the
subscription, reach a human, pick a product. A real agent (${esc(latest.model)}) attempts them with read-only web
access. Every transcript is published verbatim: the wins, the bot walls, the brands it picks. (We pay for the API
calls for fun.)</p>
<a class="hero-cta rise d3" href="/fieldtest/${latest.date}/">Watch this week's episode →</a>
<div class="ticker rise d4"><div class="ticker-track">${tickerSpans}${tickerSpans}</div></div>
<div class="stats">
  <div class="stat"><b>${latest.stats.completed}/${latest.stats.tasks}</b><small>tasks completed this episode</small></div>
  <div class="stat walls"><b>${latest.stats.wallsHit}</b><small>bot walls hit</small></div>
  <div class="stat"><b>${latest.stats.pageVisits}</b><small>pages read</small></div>
  <div class="stat"><b>${latest.stats.domainsVisited}</b><small>sites visited</small></div>
</div>
<h2>This week's best segments</h2>
${segCards(latest)}`
    : `
<p class="eyebrow"><span class="live"></span>The Agent Field Test · first episode in production</p>
<h1>We send an AI agent to run your <span class="hl">errands</span> on the real web. Then we publish <span class="hl">everything</span>.</h1>
<p class="lede">A weekly, fully autonomous show: an AI producer invents real errands, a real agent attempts them with
read-only web access, and the full transcripts are published here — wins, bot walls, and all.</p>`;
  const landingBody = `${fieldtestHero}
${summary && s
    ? `
<h2>The reference data: the AI-Readiness Index</h2>
<p class="lede">Behind the show sits the panel: ${s.audited} well-known sites audited weekly against the conventions
real AI agents rely on — <code>llms.txt</code>, crawler policy, parseable content, structured data, MCP. When the
agent hits a wall, the index usually already predicted it.</p>
<div class="stats">
  <div class="stat"><b>${s.averageScore}/100</b><small>average readiness score</small></div>
  <div class="stat"><b>${s.pctLlmsTxt}%</b><small>publish llms.txt</small></div>
  <div class="stat"><b>${s.pctBlockingSomeAI}%</b><small>block at least one AI crawler</small></div>
  <div class="stat"><b>${s.pctClosed}%</b><small>closed to AI by policy</small></div>
</div>
<h2>The Index — top 10</h2>
${leaderboardTable(summary.leaderboard.slice(0, 10))}
<p style="margin-top:12px"><a href="/ai-index/">Full ranked index of ${s.audited} sites →</a></p>
<div class="cta"><b>Work on one of these sites?</b> Every failed check on your report page has a concrete fix, and scores
refresh weekly. <a href="https://github.com/khalidsaidi/agentability/issues/new?title=Audit%20request:%20yourdomain.com&labels=audit-request">Request an audit</a>
of any site — it's free and takes one issue.</div>`
    : ""}
<h2>Why this exists</h2>
<p class="lede">Agents are the web's newest audience: assistants that read pages, cite sources, and run errands for
people. Whether the web actually works for them is an empirical question — so we test it, in public, every week,
with verbatim transcripts, reproducible checks, and open data. History accrues weekly${history.length > 1 ? ` (${history.length} snapshots so far)` : ""}.</p>`;

  await fsp.writeFile(
    path.join(OUT, "index.html"),
    shell({
      title: "Agentability — we send AI agents to use the real web",
      description: latest
        ? `The Agent Field Test: a real AI agent runs real errands on the real web weekly, transcripts published verbatim. This episode: ${latest.stats.completed}/${latest.stats.tasks} tasks done, ${latest.stats.wallsHit} bot walls.`
        : "A weekly autonomous show plus an open index: real AI agents attempt real web tasks, and 100+ well-known sites are audited for AI-agent readiness.",
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
<p class="eyebrow"><a href="/" style="text-decoration:none;color:inherit">Agentability</a> · AI-Readiness Index · updated ${generated}</p>
<h1>The AI-Readiness Index</h1>
<p class="lede">${s.audited} well-known sites, ranked by how usable they are for AI agents. Average ${s.averageScore}/100.
Checks: llms.txt, AI-crawler policy, content parseability, structured data, sitemap, task reachability, plus MCP/OpenAPI bonuses —
<a href="/methodology/">methodology</a>.</p>
${leaderboardTable(summary.leaderboard)}
${summary.unreachable.length ? `<p style="margin-top:14px;color:#667085;font-size:.85rem">Unreachable this run: ${summary.unreachable.map(esc).join(", ")}.</p>` : ""}
<div class="cta">Your site missing or mis-scored? <a href="https://github.com/khalidsaidi/agentability/issues/new?title=Audit%20request:%20yourdomain.com&labels=audit-request">Open an issue</a> — audits are free, from public surfaces only, and re-run weekly.</div>`,
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "The AI-Readiness Index",
          description: `${s.audited} well-known sites ranked by AI-agent readiness.`,
          numberOfItems: summary.leaderboard.length,
          itemListElement: summary.leaderboard.slice(0, 25).map((r) => ({
            "@type": "ListItem",
            position: r.rank,
            name: r.domain,
            url: `${SITE}/ai-index/site/${r.domain}/`,
          })),
        },
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
<p class="eyebrow"><a href="/ai-index/" style="text-decoration:none;color:inherit">← AI-Readiness Index</a></p>
<h1>${esc(r.domain)}</h1>
<p><span class="scorebig" style="color:${scoreColor(r.score)}">${r.score}</span><span style="color:#667085">/100</span>
&nbsp; <span class="chip">${esc(r.grade)}</span>${rank ? ` <span class="chip">#${rank} of ${s.audited}</span>` : ""}
${r.paradox ? ' <span class="chip paradox">the paradox: courts AI, blocks AI</span>' : ""}</p>
<p class="lede">Audited ${(r as any).carriedForward ? `${new Date(r.checkedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} (site unreachable during the latest run — showing the last successful audit)` : generated} from public surfaces only. Can AI agents discover, read, and act on
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
<p class="eyebrow"><a href="/" style="text-decoration:none;color:inherit">Agentability</a> · Methodology</p>
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
<h2>The Agent Field Test</h2>
<p class="lede">The weekly <a href="/fieldtest/">Field Test</a> is the empirical companion to the Index: instead of
checking plumbing, it watches a real agent try real errands. The rules:</p>
<table>
<tbody>
<tr><td><b>Autonomous end to end</b></td><td>An AI producer invents each episode's tasks (grounded in the audited panel, avoiding past topics); a separate agent attempts them. No human writes, selects, or edits an episode.</td></tr>
<tr><td><b>Read-only, by construction</b></td><td>The agent's only tool is a plain HTTP GET. It cannot run JavaScript, log in, submit forms, create accounts, or buy anything.</td></tr>
<tr><td><b>Hard limits</b></td><td>At most 14 page visits per task, a fixed token budget per episode, and the model is named on every page. (We pay for the API calls for fun.)</td></tr>
<tr><td><b>Verbatim or nothing</b></td><td>Transcripts are published exactly as they happened — no retries, no cherry-picking, failures included. The raw JSON is open data.</td></tr>
<tr><td><b>Honest reporting</b></td><td>The agent is instructed never to invent facts it didn't read on a page, and to report failure plainly. "Gave up honestly" is a first-class outcome.</td></tr>
</tbody>
</table>
<h2>Reproducibility</h2>
<p class="lede">The evaluator is ~300 lines of dependency-free TypeScript in the
<a href="https://github.com/khalidsaidi/agentability">open repo</a>, runs weekly in public GitHub Actions, and commits
raw results to the repository. The field-test agent and producer are in the same repo. Disagree with a check or a
transcript? Open an issue — everything is versioned in public.</p>`;
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

  // ---------- The Agent Field Test ----------
  await fsp.mkdir(path.join(OUT, "fieldtest"), { recursive: true });
  const archiveRows = episodes
    .map(
      (ep) => `<tr>
  <td><a href="/fieldtest/${esc(ep.date)}/">${prettyDate(ep.date)}</a></td>
  <td class="num">${ep.stats.completed}/${ep.stats.tasks}</td>
  <td class="num">${ep.stats.wallsHit}</td>
  <td class="num">${ep.stats.pageVisits}</td>
  <td class="num">${ep.stats.domainsVisited}</td>
</tr>`
    )
    .join("\n");
  await fsp.writeFile(
    path.join(OUT, "fieldtest/index.html"),
    shell({
      title: "The Agent Field Test — episodes",
      description:
        "A weekly autonomous show: an AI producer invents real web errands, a real agent attempts them read-only, and every transcript is published verbatim.",
      canonicalPath: "/fieldtest/",
      body: `
<p class="eyebrow"><a href="/" style="text-decoration:none;color:inherit">Agentability</a> · The Agent Field Test</p>
<h1>The Agent Field Test</h1>
<p class="lede">The web's newest users are AI agents — so every week we make one run real errands: find the true
price, cancel the thing, reach a human, pick a product. Read-only access, hard step limits, transcripts published
verbatim. The producer inventing the tasks is an AI too: no human touches an episode from cron to publish.</p>
${episodes.length ? `<table>
<thead><tr><th>Episode</th><th class="num">Completed</th><th class="num">Bot walls</th><th class="num">Pages read</th><th class="num">Sites</th></tr></thead>
<tbody>${archiveRows}</tbody></table>` : `<p class="lede">First episode is in production — the weekly run publishes it here automatically.</p>`}
<div class="cta"><b>Want your site in an episode?</b> Everyday tasks on real brands are invented weekly by the producer
from <a href="/ai-index/">the audited panel</a>. <a href="https://github.com/khalidsaidi/agentability/issues/new?title=Audit%20request:%20yourdomain.com&labels=audit-request">Get on the panel</a>.</div>
<h2>Questions people ask</h2>
${FIELD_FAQ.map((f) => `<h3 style="font-size:.98rem;margin:18px 0 4px">${esc(f.q)}</h3><p class="lede" style="font-size:.92rem">${f.a}</p>`).join("\n")}`,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FIELD_FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a.replace(/<[^>]+>/g, "") },
        })),
      },
    }),
    "utf8"
  );

  for (const ep of episodes) {
    const dir = path.join(OUT, "fieldtest", ep.date);
    await fsp.mkdir(dir, { recursive: true });
    const chosen = ep.runs.filter((r) => r.chosenSite);
    await fsp.writeFile(
      path.join(dir, "index.html"),
      shell({
        title: `Agent Field Test — ${prettyDate(ep.date)}`,
        description: `Episode of ${prettyDate(ep.date)}: ${ep.stats.completed}/${ep.stats.tasks} tasks completed, ${ep.stats.wallsHit} bot walls, ${ep.stats.pageVisits} pages read${chosen.length ? `; picked ${chosen.map((r) => r.chosenSite).join(", ")}` : ""}. Full verbatim transcripts.`,
        canonicalPath: `/fieldtest/${ep.date}/`,
        body: `
<p class="eyebrow"><a href="/fieldtest/" style="text-decoration:none;color:inherit">← All episodes</a> · ${prettyDate(ep.date)} · agent: ${esc(ep.model)}</p>
<h1>Episode of ${prettyDate(ep.date)}</h1>
<p class="lede">${ep.stats.tasks} tasks, invented by the AI producer and attempted by ${esc(ep.model)} with read-only
web access. ${ep.stats.completed} completed, ${ep.stats.partial} honest give-ups, ${ep.stats.failed} failures,
${ep.stats.wallsHit} bot walls across ${ep.stats.pageVisits} page visits and ${ep.stats.domainsVisited} sites.
(Yes, we pay for these API calls. For fun.)</p>
${ep.runs.map(taskCard).join("\n")}
<div class="cta">Every transcript above is verbatim — no retries, no editing, no cherry-picking. Method, limits, and
rules: <a href="/methodology/">methodology</a>. Raw episode JSON: <a href="/data/fieldtest/${esc(ep.date)}.json">open data</a>.</div>`,
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: `The Agent Field Test — episode of ${prettyDate(ep.date)}`,
          datePublished: ep.generatedAt,
          author: { "@type": "Organization", name: "Agentability", url: SITE },
          description: `A real AI agent attempted ${ep.stats.tasks} real web errands; ${ep.stats.completed} completed, ${ep.stats.wallsHit} bot walls. Verbatim transcripts.`,
        },
      }),
      "utf8"
    );
  }

  // ---------- Docs / Support / Privacy (the task pages we grade everyone else on) ----------
  const docsBody = `
<p class="eyebrow"><a href="/" style="text-decoration:none;color:inherit">Agentability</a> · Data docs</p>
<h1>Using the open data</h1>
<p class="lede">Everything the Index publishes is available as plain JSON with CORS enabled — no key, no signup,
no rate-limit games. Cite it, chart it, build on it.</p>
<table>
<thead><tr><th>Endpoint</th><th>What it returns</th></tr></thead>
<tbody>
<tr><td><code>/data/summary.json</code></td><td>The latest run: aggregate stats (average score, llms.txt adoption, blocking and closed percentages, paradox count) plus the full ranked leaderboard with score, grade, posture, and signal flags per domain.</td></tr>
<tr><td><code>/data/history/{YYYY-MM-DD}.json</code></td><td>One snapshot per weekly run — the adoption time series. Week zero is 2026-08-27.</td></tr>
</tbody>
</table>
<p class="lede">Raw per-site check results live in the repository under
<a href="https://github.com/khalidsaidi/agentability/tree/main/data/index/results">data/index/results/</a>, one JSON
file per domain, refreshed by the same public CI run. The evaluator itself is
<a href="https://github.com/khalidsaidi/agentability/blob/main/scripts/lib/evaluate-site.ts">~300 lines of dependency-free
TypeScript</a> — reproduce any number on this site with plain HTTP requests.</p>
<p class="lede">Attribution: link to <a href="/ai-index/">the Index</a> or the per-site report you're citing.</p>`;
  const supportBody = `
<p class="eyebrow"><a href="/" style="text-decoration:none;color:inherit">Agentability</a> · Support</p>
<h1>Get help, get audited, or dispute a score</h1>
<p class="lede"><b>Request an audit</b> — open an
<a href="https://github.com/khalidsaidi/agentability/issues/new?title=Audit%20request:%20yourdomain.com&amp;labels=audit-request">audit
request issue</a> (or PR a line into <code>data/index/domains.txt</code>) and your site joins the next weekly run.</p>
<p class="lede"><b>Deployed a fix?</b> Scores refresh automatically every Monday. If you've shipped fixes and want the
number updated sooner, say so in an issue and we'll trigger a re-run.</p>
<p class="lede"><b>Dispute a check</b> — every check is reproducible from
<a href="/methodology/">the methodology</a> and the open evaluator source. If you think a result is wrong, open an
issue with the domain and the check ID; the rubric is versioned in public and we correct real errors in the next run.</p>
<p class="lede"><b>Anything else</b> — <a href="https://github.com/khalidsaidi/agentability/issues">GitHub issues</a>
is the front door; there is no ticket system because there is no company, just an open observatory.</p>`;
  const privacyBody = `
<p class="eyebrow"><a href="/" style="text-decoration:none;color:inherit">Agentability</a> · Privacy</p>
<h1>Privacy</h1>
<p class="lede">No cookies, no accounts, no forms, no identifiers. Pages are static files served from a CDN. We count
visits in aggregate using Google Analytics locked in cookie-less consent-denied mode: it stores nothing on your
device and cannot identify you — it tells us roughly how many people visited, and nothing about who they are.</p>
<p class="lede">The audit data we publish is gathered exclusively from public surfaces — homepages, robots.txt,
llms.txt, sitemaps, and well-known endpoints — the same requests any AI crawler makes. We fetch each site a handful
of times per week with the user agent <code>AgentabilityBot/2.0</code>, honor what robots.txt tells us in scoring,
and publish only what those public files say. To remove a domain from the Index, open a
<a href="https://github.com/khalidsaidi/agentability/issues">GitHub issue</a>.</p>`;
  const smallPages: Array<{ dir: string; title: string; description: string; body: string }> = [
    { dir: "docs", title: "Data docs — Agentability", description: "How to use the AI-Readiness Index open data: JSON endpoints, history snapshots, and raw per-site results.", body: docsBody },
    { dir: "support", title: "Support — Agentability", description: "Request an audit, dispute a check, or get your score re-run after deploying fixes.", body: supportBody },
    { dir: "privacy", title: "Privacy — Agentability", description: "No analytics, no cookies, no accounts. Audits use only public surfaces.", body: privacyBody },
  ];
  for (const p of smallPages) {
    await fsp.mkdir(path.join(OUT, p.dir), { recursive: true });
    await fsp.writeFile(
      path.join(OUT, `${p.dir}/index.html`),
      shell({ title: p.title, description: p.description, canonicalPath: `/${p.dir}/`, body: p.body }),
      "utf8"
    );
  }

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
      `- The Agent Field Test (weekly episodes, verbatim agent transcripts): ${SITE}/fieldtest/`,
      `- The AI-Readiness Index (full rankings): ${SITE}/ai-index/`,
      `- Methodology (checks and scoring): ${SITE}/methodology/`,
      `- Raw data (JSON): ${SITE}/data/summary.json`,
      `- Data docs (endpoints and attribution): ${SITE}/docs/`,
      `- Support (audit requests, disputes): ${SITE}/support/`,
      "",
      "## Per-site reports",
      ...domains.slice(0, 40).map((d) => `- ${SITE}/ai-index/site/${d}/`),
    ].join("\n") + "\n",
    "utf8"
  );
  await fsp.writeFile(path.join(OUT, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`, "utf8");
  // IndexNow key file (workflows ping api.indexnow.org after each deploy).
  await fsp.writeFile(path.join(OUT, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY, "utf8");
  // Google Search Console ownership verification — must persist forever.
  await fsp.writeFile(
    path.join(OUT, "googlea3bb680f11452088.html"),
    "google-site-verification: googlea3bb680f11452088.html",
    "utf8"
  );
  const urls = [
    "/",
    "/fieldtest/",
    ...episodes.map((ep) => `/fieldtest/${ep.date}/`),
    "/ai-index/",
    "/methodology/",
    "/docs/",
    "/support/",
    "/privacy/",
    ...domains.map((d) => `/ai-index/site/${d}/`),
  ];
  await fsp.writeFile(
    path.join(OUT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => `<url><loc>${SITE}${u}</loc></url>`).join("\n") +
      `\n</urlset>\n`,
    "utf8"
  );

  // Open data: publish summary + history + episodes verbatim.
  await fsp.mkdir(path.join(OUT, "data/history"), { recursive: true });
  await fsp.mkdir(path.join(OUT, "data/fieldtest"), { recursive: true });
  if (summary) await fsp.writeFile(path.join(OUT, "data/summary.json"), JSON.stringify(summary, null, 1), "utf8");
  for (const h of history) {
    await fsp.writeFile(path.join(OUT, `data/history/${h.date}.json`), JSON.stringify(h, null, 1), "utf8");
  }
  for (const ep of episodes) {
    await fsp.writeFile(path.join(OUT, `data/fieldtest/${ep.date}.json`), JSON.stringify(ep, null, 1), "utf8");
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
