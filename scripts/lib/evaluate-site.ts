// The Agentability evaluator, rebuilt around conventions that actually exist
// in 2026. Every check is citable; no invented standards, no dead specs.
// Zero dependencies: Node 20 global fetch only.

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export type SiteCheck = {
  id: string;
  title: string;
  status: CheckStatus;
  points: number;
  maxPoints: number;
  detail: string;
};

export type RobotsPolicy = {
  bot: string;
  policy: "allowed" | "blocked" | "partial";
};

export type SiteEvaluation = {
  domain: string;
  checkedAt: string;
  status: "complete" | "error";
  elapsedMs: number;
  score: number;
  grade: string;
  posture: "open" | "selective" | "closed";
  paradox: boolean;
  checks: SiteCheck[];
  robots: RobotsPolicy[];
  signals: {
    llmsTxt: boolean;
    mcp: boolean;
    openapi: boolean;
    structuredData: boolean;
    sitemap: boolean;
    parseableText: boolean;
  };
  error?: string;
};

const UA = "AgentabilityBot/2.0 (+https://agentability.org/methodology)";
const FETCH_TIMEOUT_MS = 15000;

// The AI crawlers/agents that matter in 2026 — all real, all documented.
const AI_BOTS = ["GPTBot", "ClaudeBot", "Claude-User", "PerplexityBot", "Google-Extended", "CCBot"];

async function get(url: string, accept = "*/*"): Promise<{ ok: boolean; status: number; text: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    // Cap reads at 2MB — enough for any page we care about.
    const buf = await response.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 2 * 1024 * 1024));
    return { ok: response.ok, status: response.status, text, contentType };
  } catch {
    return { ok: false, status: 0, text: "", contentType: "" };
  } finally {
    clearTimeout(timer);
  }
}

function stripToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeBotWall(html: string): boolean {
  const h = html.toLowerCase();
  return (
    h.includes("just a moment") ||
    h.includes("enable javascript and cookies") ||
    h.includes("checking your browser") ||
    h.includes("cf-challenge") ||
    h.includes("attention required")
  );
}

// Minimal robots.txt interpreter: for each bot, find the most specific
// user-agent group (exact name beats *) and judge whether "/" is disallowed.
function parseRobots(robotsTxt: string): { policies: RobotsPolicy[]; sitemaps: string[] } {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  const groups: Array<{ agents: string[]; disallow: string[]; allow: string[] }> = [];
  let current: { agents: string[]; disallow: string[]; allow: string[] } | null = null;
  let lastWasAgent = false;
  const sitemaps: string[] = [];

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    if (!rest.length) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "sitemap" && value) sitemaps.push(value);
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (current && (key === "disallow" || key === "allow")) {
      (key === "disallow" ? current.disallow : current.allow).push(value);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }

  const policies: RobotsPolicy[] = AI_BOTS.map((bot) => {
    const lower = bot.toLowerCase();
    const specific = groups.filter((g) => g.agents.some((a) => a === lower));
    const wildcard = groups.filter((g) => g.agents.includes("*"));
    const applicable = specific.length ? specific : wildcard;
    if (!applicable.length) return { bot, policy: "allowed" };
    const disallows = applicable.flatMap((g) => g.disallow);
    const allowsRoot = applicable.some((g) => g.allow.some((a) => a === "/" || a === ""));
    const blocksRoot = disallows.some((d) => d === "/");
    if (blocksRoot && !allowsRoot) return { bot, policy: "blocked" };
    if (disallows.some((d) => d && d !== "/")) return { bot, policy: "partial" };
    return { bot, policy: "allowed" };
  });

  return { policies, sitemaps };
}

function gradeFor(score: number, posture: string): string {
  if (posture === "closed") return "Closed by policy";
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export async function evaluateSite(domain: string): Promise<SiteEvaluation> {
  const started = Date.now();
  const checkedAt = new Date().toISOString();
  const origin = `https://${domain}`;
  const checks: SiteCheck[] = [];

  try {
    // Fetch everything we need up front, in parallel.
    const [home, robots, llms, sitemapDirect, mcpWellKnown, openapiWellKnown, openapiRoot] = await Promise.all([
      get(`${origin}/`, "text/html"),
      get(`${origin}/robots.txt`, "text/plain"),
      get(`${origin}/llms.txt`, "text/plain"),
      get(`${origin}/sitemap.xml`, "application/xml"),
      get(`${origin}/.well-known/mcp.json`, "application/json"),
      get(`${origin}/.well-known/openapi.json`, "application/json"),
      get(`${origin}/openapi.json`, "application/json"),
    ]);

    if (!home.ok && home.status === 0) {
      throw new Error("homepage unreachable");
    }

    // --- A1: llms.txt (llmstxt.org convention) — 15 pts
    const llmsBody = llms.ok && !llms.contentType.includes("html") ? llms.text.trim() : "";
    const llmsSubstantive = llmsBody.length > 100 && /https?:\/\//.test(llmsBody);
    const llmsTxt = Boolean(llmsBody) && llmsSubstantive;
    checks.push({
      id: "A1",
      title: "llms.txt for AI readers",
      status: llmsTxt ? "pass" : llmsBody ? "warn" : "fail",
      points: llmsTxt ? 15 : llmsBody ? 7 : 0,
      maxPoints: 15,
      detail: llmsTxt
        ? `Present with ${llmsBody.length} chars and links.`
        : llmsBody
          ? "Present but thin (no links or under 100 chars)."
          : "No /llms.txt found — AI readers get no curated entry point.",
    });

    // --- A2: AI-crawler policy — 15 pts
    const { policies, sitemaps } = robots.ok ? parseRobots(robots.text) : { policies: AI_BOTS.map((bot) => ({ bot, policy: "allowed" as const })), sitemaps: [] };
    const blocked = policies.filter((p) => p.policy === "blocked");
    const posture: SiteEvaluation["posture"] =
      blocked.length >= 4 ? "closed" : blocked.length >= 1 ? "selective" : "open";
    checks.push({
      id: "A2",
      title: "AI crawler access policy",
      status: posture === "open" ? "pass" : posture === "selective" ? "warn" : "fail",
      points: posture === "open" ? 15 : posture === "selective" ? 8 : 0,
      maxPoints: 15,
      detail:
        posture === "open"
          ? "robots.txt allows the major AI crawlers and agents."
          : `robots.txt blocks: ${blocked.map((b) => b.bot).join(", ")}.`,
    });

    // --- A3: Agent-parseable content — 25 pts
    const text = home.ok ? stripToText(home.text) : "";
    const words = text ? text.split(" ").filter(Boolean).length : 0;
    const botWall = home.ok ? looksLikeBotWall(home.text) : true;
    const parseable = home.ok && !botWall && words >= 150;
    checks.push({
      id: "A3",
      title: "Content readable without a browser",
      status: parseable ? "pass" : home.ok && !botWall && words >= 50 ? "warn" : "fail",
      points: parseable ? 25 : home.ok && !botWall && words >= 50 ? 12 : 0,
      maxPoints: 25,
      detail: botWall
        ? "A bot challenge page blocks plain fetches — agents see a wall, not your content."
        : `Plain fetch of the homepage yields ~${words} words of visible text.`,
    });

    // --- A4: Structured data — 15 pts
    let structuredData = false;
    const ldMatches = home.text.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const m of ldMatches) {
      try {
        JSON.parse(m.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, ""));
        structuredData = true;
        break;
      } catch {
        /* invalid block; keep looking */
      }
    }
    checks.push({
      id: "A4",
      title: "Structured data (schema.org JSON-LD)",
      status: structuredData ? "pass" : ldMatches.length ? "warn" : "fail",
      points: structuredData ? 15 : ldMatches.length ? 7 : 0,
      maxPoints: 15,
      detail: structuredData
        ? "Valid JSON-LD found on the homepage."
        : ldMatches.length
          ? "JSON-LD present but failed to parse."
          : "No machine-readable entity markup on the homepage.",
    });

    // --- A5: Sitemap — 10 pts
    const sitemap = sitemaps.length > 0 || (sitemapDirect.ok && sitemapDirect.text.includes("<"));
    checks.push({
      id: "A5",
      title: "Sitemap discoverable",
      status: sitemap ? "pass" : "fail",
      points: sitemap ? 10 : 0,
      maxPoints: 10,
      detail: sitemap ? "Sitemap advertised in robots.txt or served at /sitemap.xml." : "No sitemap found.",
    });

    // --- A6: Everyday agent tasks (deterministic) — 20 pts
    const homeLower = home.text.toLowerCase();
    const tasks: Array<{ name: string; pattern: RegExp }> = [
      { name: "pricing", pattern: /href=["'][^"']*(pricing|plans)[^"']*["']|>\s*pricing\s*</i },
      { name: "support/contact", pattern: /href=["'][^"']*(contact|support|help)[^"']*["']/i },
      { name: "docs/api", pattern: /href=["'][^"']*(docs|documentation|developer|api)[^"']*["']/i },
      { name: "legal/privacy", pattern: /href=["'][^"']*(privacy|terms|legal)[^"']*["']/i },
    ];
    const found = tasks.filter((t) => t.pattern.test(homeLower));
    checks.push({
      id: "A6",
      title: "Everyday agent tasks reachable from the homepage",
      status: found.length >= 3 ? "pass" : found.length >= 2 ? "warn" : "fail",
      points: found.length * 5,
      maxPoints: 20,
      detail: found.length
        ? `Found from homepage: ${found.map((t) => t.name).join(", ")}.`
        : "None of pricing, support, docs, or legal are linked from the homepage.",
    });

    // --- B1: MCP endpoint — +5 bonus
    const mcp = mcpWellKnown.ok && mcpWellKnown.text.trim().startsWith("{");
    checks.push({
      id: "B1",
      title: "MCP server advertised",
      status: mcp ? "pass" : "skip",
      points: mcp ? 5 : 0,
      maxPoints: 5,
      detail: mcp ? "Serves /.well-known/mcp.json." : "No MCP advertisement (bonus check — most sites skip this).",
    });

    // --- B2: OpenAPI — +5 bonus
    let openapi = false;
    for (const candidate of [openapiWellKnown, openapiRoot]) {
      if (candidate.ok && candidate.text.trim().startsWith("{")) {
        try {
          const doc = JSON.parse(candidate.text);
          if (doc.openapi || doc.swagger) {
            openapi = true;
            break;
          }
        } catch {
          /* not JSON */
        }
      }
    }
    checks.push({
      id: "B2",
      title: "OpenAPI description published",
      status: openapi ? "pass" : "skip",
      points: openapi ? 5 : 0,
      maxPoints: 5,
      detail: openapi ? "Valid OpenAPI document found." : "No OpenAPI document (bonus check — only relevant for APIs).",
    });

    const score = Math.min(100, checks.reduce((acc, c) => acc + c.points, 0));
    const paradox = llmsTxt && blocked.length >= 2;

    return {
      domain,
      checkedAt,
      status: "complete",
      elapsedMs: Date.now() - started,
      score,
      grade: gradeFor(score, posture),
      posture,
      paradox,
      checks,
      robots: policies,
      signals: { llmsTxt, mcp, openapi, structuredData, sitemap, parseableText: parseable },
    };
  } catch (error: any) {
    return {
      domain,
      checkedAt,
      status: "error",
      elapsedMs: Date.now() - started,
      score: 0,
      grade: "unreachable",
      posture: "open",
      paradox: false,
      checks,
      robots: [],
      signals: { llmsTxt: false, mcp: false, openapi: false, structuredData: false, sitemap: false, parseableText: false },
      error: String(error?.message || error).slice(0, 200),
    };
  }
}
