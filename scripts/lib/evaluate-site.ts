// The Agentability evaluator, rebuilt around conventions that actually exist
// in 2026. Every check is citable; no invented standards, no dead specs.
// Zero dependencies: Node 20 global fetch only.

import { rootDomain } from "./domains";

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
  // Why a site produced no score. "offline" = DNS does not resolve, so it was
  // never an eligible website; the rest are real sites an agent could not use.
  failure?: "offline" | "timeout" | "tls" | "redirect-loop" | "refused";
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
    ucp: boolean;
    structuredData: boolean;
    sitemap: boolean;
    parseableText: boolean;
  };
  // Which e-commerce platform served the page, where it is detectable. UCP is a
  // Shopify default, so a bare "UCP: yes" says nothing about the merchant
  // without this beside it.
  platform?: "Shopify" | "WooCommerce" | "BigCommerce" | "Salesforce" | "Wix" | "Squarespace" | "Magento";
  error?: string;
  // Set by the runner when a transiently unreachable domain reuses its last
  // successful audit instead of dropping off the index.
  carriedForward?: boolean;
  carriedForwardAt?: string;
};

const UA = "AgentabilityBot/2.0 (+https://agentability.org/methodology)";
const FETCH_TIMEOUT_MS = 15000;

// The AI crawlers/agents that matter in 2026 — all real, all documented.
const AI_BOTS = ["GPTBot", "ClaudeBot", "Claude-User", "PerplexityBot", "Google-Extended", "CCBot"];

type FailureKind = "offline" | "timeout" | "tls" | "redirect-loop" | "refused";

async function get(url: string, accept = "*/*"): Promise<{ ok: boolean; status: number; text: string; contentType: string; reason?: FailureKind }> {
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
  } catch (error: any) {
    const cause = String(error?.cause?.code || error?.cause?.message || error?.name || "");
    const reason: FailureKind =
      /ENOTFOUND|EAI_AGAIN|ERR_NAME/.test(cause) ? "offline"
      : /ALTNAME|CERT|TLS|SSL/i.test(cause) ? "tls"
      : /redirect count/i.test(cause) ? "redirect-loop"
      : /Abort/i.test(cause) ? "timeout"
      : "refused";
    return { ok: false, status: 0, text: "", contentType: "", reason };
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

// Detected from the homepage we already fetched, so it costs nothing.
function platformOf(html: string, headerBlob: string): SiteEvaluation["platform"] {
  const h = `${html.slice(0, 200_000)} ${headerBlob}`.toLowerCase();
  if (/cdn\.shopify\.com|x-shopify|shopify-digital-wallet|myshopify\.com/.test(h)) return "Shopify";
  if (/woocommerce/.test(h)) return "WooCommerce";
  if (/bigcommerce/.test(h)) return "BigCommerce";
  if (/demandware|dwstatic|salesforce commerce/.test(h)) return "Salesforce";
  if (/static\.wixstatic\.com|wix-code/.test(h)) return "Wix";
  if (/squarespace/.test(h)) return "Squarespace";
  if (/magento|mage-init/.test(h)) return "Magento";
  return undefined;
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
  const checks: SiteCheck[] = [];

  // Plenty of sites only serve (or only hold a certificate for) the www host.
  // Giving up on the bare domain scores them as unreachable for our own reasons.
  let origin = `https://${domain}`;
  const bare = await get(`${origin}/`, "text/html");
  if (!bare.ok && bare.status === 0 && !domain.startsWith("www.")) {
    const withWww = await get(`https://www.${domain}/`, "text/html");
    if (withWww.ok || withWww.status !== 0) origin = `https://www.${domain}`;
  }

  try {
    // Fetch everything we need up front, in parallel.
    const [home, robots, llms, sitemapDirect, mcpWellKnown, mcpServerCard, openapiWellKnown, openapiRoot, ucpWellKnown, ucpJson] = await Promise.all([
      get(`${origin}/`, "text/html"),
      get(`${origin}/robots.txt`, "text/plain"),
      get(`${origin}/llms.txt`, "text/plain"),
      get(`${origin}/sitemap.xml`, "application/xml"),
      get(`${origin}/.well-known/mcp.json`, "application/json"),
      // The current MCP spec puts the server card here; /.well-known/mcp.json is
      // the older path. Probing only the old one scored Apify as having no MCP
      // server while it served a valid card and named it in its llms.txt.
      get(`${origin}/.well-known/mcp/server-card.json`, "application/json"),
      get(`${origin}/.well-known/openapi.json`, "application/json"),
      get(`${origin}/openapi.json`, "application/json"),
      get(`${origin}/.well-known/ucp`, "application/json"),
      get(`${origin}/.well-known/ucp.json`, "application/json"),
    ]);

    if (!home.ok && home.status === 0) {
      const err = new Error("homepage unreachable") as Error & { failure?: FailureKind };
      err.failure = home.reason ?? "refused";
      throw err;
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
    //
    // Matching a bare substring anywhere in an href was wrong twice over.
    // "api" is inside "googleapis", so every site with a Google Fonts preconnect
    // scored a free point for publishing developer docs it does not have —
    // kbag.se was credited for href="https://fonts.googleapis.com". And the
    // words were English only, on a panel that is the most-visited sites in the
    // world, so a Swedish shop linking kontakt and villkor scored zero for
    // pages it serves perfectly well.
    //
    // So: look at path segments of the site's own links, not raw substrings,
    // and know the words in the languages the panel actually contains.
    const TASK_WORDS: Array<{ name: string; words: string[] }> = [
      {
        name: "pricing",
        words: ["pricing", "prices", "price", "plans", "tarif", "tarifs", "tarife", "preise", "preis",
          "precios", "precio", "prezzi", "prezzo", "priser", "prijzen", "cennik", "abonnements", "abonnemang"],
      },
      {
        name: "support/contact",
        words: ["contact", "contacts", "support", "help", "helpdesk", "kontakt", "kontakta", "contacto",
          "contatti", "contato", "kontakty", "assistance", "assistenza", "ayuda", "hilfe", "hjalp",
          "customer-service", "kundservice", "kundtjanst", "iletisim"],
      },
      {
        name: "docs/api",
        words: ["docs", "doc", "documentation", "documentatie", "dokumentation", "developer", "developers",
          "api", "apis", "api-docs", "devcenter", "utvecklare", "entwickler"],
      },
      {
        name: "legal/privacy",
        words: ["privacy", "privacidad", "privacidade", "privacy-policy", "integritetspolicy", "integritet",
          "terms", "tos", "legal", "impressum", "datenschutz", "mentions-legales", "villkor", "vilkar",
          "allmanna-villkor", "privatlivspolitik", "cgu", "cgv", "termini", "terminos", "regulamin",
          "voorwaarden", "kvkk"],
      },
    ];
    // Only the site's own links count: a third-party asset or widget host is not
    // this site publishing anything.
    const ownHrefs: string[] = [];
    for (const m of home.text.matchAll(/href=["']([^"']+)["']/gi)) {
      const raw = m[1].trim();
      if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript):/i.test(raw)) continue;
      try {
        const url = new URL(raw, `${origin}/`);
        // Same registrable domain, so help.shopify.com and docs.example.com count —
        // a support centre on a subdomain is still this site publishing it — while
        // fonts.googleapis.com and checkout.stripe.com do not.
        if (rootDomain(url.hostname) !== rootDomain(new URL(origin).hostname)) continue;
        ownHrefs.push([url.hostname, url.pathname, url.search].join(" ").toLowerCase());
      } catch {
        /* unparseable href */
      }
    }
    // Two sets, because how much latitude a word deserves depends on its length.
    // Hostname labels are segments in their own right: help.shopify.com is where
    // Shopify's support actually lives, and "help" has to be findable there.
    const segments = new Set<string>(); // "mentions-legales", "help", "docs"
    const parts = new Set<string>(); // dash/underscore parts: "mentions", "legales"
    for (const href of ownHrefs) {
      for (const seg of href.split(/[/?&=.\s]+/)) {
        if (!seg) continue;
        segments.add(seg);
        for (const part of seg.split(/[-_]+/)) if (part) parts.add(part);
      }
    }
    // A short generic token must be the entire segment: /api is a developer area,
    // "delphine-papin" is a journalist and "midterms-2026" is an election. A longer
    // word may be a part, and may carry an inflection — French contacter, Swedish
    // kontakta — which is why only words over five letters get prefix latitude.
    const hasWord = (w: string): boolean =>
      w.length <= 5
        ? segments.has(w)
        : segments.has(w) || parts.has(w) || [...parts].some((p) => p.startsWith(w));
    // Visible anchor text, as a fallback for a link whose URL is an opaque id.
    const anchorText = [...home.text.matchAll(/<a\b[^>]*>([\s\S]{0,80}?)<\/a>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, " ").toLowerCase())
      .join(" | ");
    const found = TASK_WORDS.filter(
      (t) =>
        t.words.some(hasWord) ||
        t.words.some((w) => w.length > 5 && new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(anchorText))
    );
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
    // Three ways a site can advertise one, strongest first: a server card on
    // either well-known path, or an endpoint named in the site's own llms.txt
    // that answers when asked. Probing only /.well-known/mcp.json scored Apify
    // as having no MCP server while it served a valid card and named it in
    // llms.txt, so this check reads the declaration too.
    // An MCP endpoint behind auth answers 401/403, and a streamable-http one
    // often answers 405/406 to a plain GET. None of those mean "absent".
    const MCP_ALIVE = new Set([200, 401, 403, 405, 406]);
    let mcp = false;
    let mcpDetail = "No MCP advertisement (bonus check — most sites skip this).";
    if (mcpServerCard.ok && mcpServerCard.text.trim().startsWith("{")) {
      mcp = true;
      mcpDetail = "Serves /.well-known/mcp/server-card.json.";
    } else if (mcpWellKnown.ok && mcpWellKnown.text.trim().startsWith("{")) {
      mcp = true;
      mcpDetail = "Serves /.well-known/mcp.json.";
    } else if (llmsBody) {
      // Only a dedicated endpoint host counts (mcp.example.com). A path that
      // merely contains "mcp" is almost always documentation about MCP —
      // cursor.com's llms.txt lists five such pages and runs no server at them —
      // and a docs page answering 200 would be a false pass.
      const declared = [
        ...new Set(
          (llmsBody.match(/https:\/\/[^\s<>()[\]"']+/g) ?? [])
            .map((u) => u.replace(/[.,;:]+$/, ""))
            .filter((u) => {
              try {
                return new URL(u).hostname.startsWith("mcp.");
              } catch {
                return false;
              }
            })
            .map((u) => new URL(u).origin)
        ),
      ].slice(0, 3);
      for (const base of declared) {
        const host = new URL(base).host;
        const card = await get(`${base}/.well-known/mcp/server-card.json`, "application/json");
        if (card.ok && card.text.trim().startsWith("{")) {
          mcp = true;
          mcpDetail = `llms.txt names an MCP server at ${host}, which serves a valid server card.`;
          break;
        }
        const live = await get(base, "application/json");
        if (MCP_ALIVE.has(live.status)) {
          mcp = true;
          mcpDetail = `llms.txt names an MCP server at ${host} — reachable (HTTP ${live.status}).`;
          break;
        }
      }
    }
    checks.push({
      id: "B1",
      title: "MCP server advertised",
      status: mcp ? "pass" : "skip",
      points: mcp ? 5 : 0,
      maxPoints: 5,
      detail: mcpDetail,
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

    // --- B3: UCP commerce profile — +5 bonus
    //
    // The one agentic-commerce standard that can actually be verified from
    // outside. ACP, the OpenAI/Stripe protocol, is approval-gated and delivered
    // as a product feed, so no endpoint exists to check and nobody — including
    // the trade press quoting adoption figures for it — can confirm a merchant
    // supports it. UCP publishes a profile at a well-known path, so it can.
    //
    // Note what a pass does and does not mean: Shopify serves this for its
    // merchants, so for a Shopify store it records a platform default rather
    // than anything the merchant did. The commerce view reports the platform
    // alongside for that reason.
    let ucp: { version?: string; services: string[]; ap2: boolean } | null = null;
    for (const candidate of [ucpWellKnown, ucpJson]) {
      if (!candidate.ok || !candidate.text.trim().startsWith("{")) continue;
      try {
        const doc = JSON.parse(candidate.text);
        if (!doc?.ucp) continue;
        const services = Object.keys(doc.ucp.services ?? {});
        const caps = Object.keys(doc.ucp.capabilities ?? {});
        ucp = {
          version: typeof doc.ucp.version === "string" ? doc.ucp.version : undefined,
          services: services.length ? services : caps,
          // AP2 rides inside UCP as signed payment mandates; the signing keys
          // sit beside the profile.
          ap2: Array.isArray(doc.keys) && doc.keys.length > 0,
        };
        break;
      } catch {
        /* not JSON */
      }
    }
    checks.push({
      id: "B3",
      title: "UCP commerce profile published",
      status: ucp ? "pass" : "skip",
      points: ucp ? 5 : 0,
      maxPoints: 5,
      detail: ucp
        ? `Serves a UCP profile${ucp.version ? ` (version ${ucp.version})` : ""}${
            ucp.services.length ? ` declaring ${ucp.services.join(", ")}` : ""
          }${ucp.ap2 ? ", with signing keys for AP2 payment mandates" : ""}.`
        : "No UCP profile (bonus check — agentic commerce, relevant to shops).",
    });

    const platform = platformOf(home.text, home.contentType);
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
      signals: { llmsTxt, mcp, openapi, ucp: Boolean(ucp), structuredData, sitemap, parseableText: parseable },
      ...(platform ? { platform } : {}),
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
      signals: { llmsTxt: false, mcp: false, openapi: false, ucp: false, structuredData: false, sitemap: false, parseableText: false },
      error: String(error?.message || error).slice(0, 200),
      failure: (error?.failure as FailureKind) ?? "refused",
    };
  }
}
