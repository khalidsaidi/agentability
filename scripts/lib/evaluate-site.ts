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
// Browsers allow 20; sites needing more than a dozen are looping.
const MAX_REDIRECTS = 12;

// The AI crawlers/agents that matter in 2026 — all real, all documented.
// Two kinds: crawlers that collect for training or search (GPTBot, ClaudeBot,
// PerplexityBot, Google-Extended, CCBot), and fetchers that run when a person
// asks an assistant to look something up (Claude-User, ChatGPT-User,
// Perplexity-User). The list had only one fetcher until a reader pointed out
// that "closed by policy" then mostly described training crawlers, which is
// not what an agent acting for a person runs into.
const AI_BOTS = [
  "GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot",
  "Claude-User", "ChatGPT-User", "Perplexity-User",
];
// "Closed" means blocking at least two-thirds of the bots named above. Written
// as a fraction so adding a bot does not silently change what the word means:
// with six bots this was 4, with eight it is 6.
const CLOSED_AT = Math.ceil((AI_BOTS.length * 2) / 3);

type FailureKind = "offline" | "timeout" | "tls" | "redirect-loop" | "refused";

async function get(url: string, accept = "*/*"): Promise<{ ok: boolean; status: number; text: string; contentType: string; reason?: FailureKind }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Redirects are followed by hand so cookies can be carried forward. With
    // `redirect: "follow"` and no cookie jar, a site that bounces through a
    // region or consent redirect sets a cookie, sees it missing on the next
    // hop and redirects again — forever. battle.net did exactly that: it was
    // scored 0/100 as a redirect loop, while the same seven hops with the
    // cookies kept return HTTP 200 and 48,914 words. A browser does this; an
    // agent that doesn't is measuring its own omission.
    let target = url;
    const jar = new Map<string, string>();
    let response!: Response;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      response = await fetch(target, {
        headers: { "User-Agent": UA, Accept: accept, ...(cookie ? { Cookie: cookie } : {}) },
        redirect: "manual",
        signal: controller.signal,
      });
      for (const setCookie of response.headers.getSetCookie?.() ?? []) {
        const m = /^([^=]+)=([^;]*)/.exec(setCookie);
        if (m) jar.set(m[1], m[2]);
      }
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        if (hop === MAX_REDIRECTS) throw Object.assign(new Error("redirect count exceeded"), { cause: { message: "redirect count exceeded" } });
        target = new URL(location, target).toString();
        continue;
      }
      break;
    }
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

// What A3 writes when the homepage turns a plain fetch away — a challenge page,
// or a refusal like 403 or 429. Exported so the site counts walls from the
// same rule the auditor applies, rather than re-deriving it from prose.
export const WALL_DETAIL = "A bot challenge page blocks plain fetches — agents see a wall, not your content.";
export function isWalled(result: { checks?: Array<{ id: string; detail: string }> }): boolean {
  return result.checks?.find((c) => c.id === "A3")?.detail === WALL_DETAIL;
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
// Running ON a platform is not the same as referencing one. Matching any
// mention put biblegateway.com on Shopify because it loads a book cover from
// cdn.shopify.com, and plex.tv because it links to its merch store at
// plex-gear.myshopify.com. That mattered: the commerce view argues that Shopify
// publishes UCP for its merchants while others chose it, and a wrong platform
// column collapses the argument.
//
// So each platform needs a marker that only its own storefront emits — a
// response header, its checkout bundle, its config object — or two independent
// weaker hints. A single CDN asset is never enough on its own.
function platformOf(html: string, headerBlob: string): SiteEvaluation["platform"] {
  const h = `${html.slice(0, 200_000)} ${headerBlob}`.toLowerCase();
  const rules: Array<{ name: NonNullable<SiteEvaluation["platform"]>; strong: RegExp[]; weak: RegExp[] }> = [
    {
      name: "Shopify",
      // Only a Shopify-served storefront sets these.
      strong: [/x-shopify-stage|x-shopid|shopify-digital-wallet|shopify\.shop\b|window\.shopify\s*=|shopifycloud\/(checkout|shop-js)/],
      weak: [/cdn\.shopify\.com/, /myshopify\.com/, /shopify-features/, /\/cdn\/shop\//],
    },
    { name: "WooCommerce", strong: [/woocommerce-page|wc-ajax=|woocommerce_params/], weak: [/woocommerce/, /wp-content\/plugins\/woocommerce/] },
    { name: "BigCommerce", strong: [/cdn\d*\.bigcommerce\.com\/s-/], weak: [/bigcommerce/, /stencil-utils/] },
    { name: "Salesforce", strong: [/demandware\.store|dwstatic|\/on\/demandware\.store\//], weak: [/demandware/, /salesforce commerce/] },
    { name: "Wix", strong: [/static\.parastorage\.com|wix-code|x-wix-request-id/], weak: [/static\.wixstatic\.com/, /wixsite\.com/] },
    { name: "Squarespace", strong: [/squarespace-cdn\.com\/static|static1\.squarespace\.com|squarespace\.com\/universal/], weak: [/squarespace/] },
    { name: "Magento", strong: [/mage\/requirejs|mage-init|magento_/], weak: [/magento/, /static\/version\d/] },
  ];
  for (const { name, strong, weak } of rules) {
    if (strong.some((re) => re.test(h))) return name;
    if (weak.filter((re) => re.test(h)).length >= 2) return name;
  }
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
      blocked.length >= CLOSED_AT ? "closed" : blocked.length >= 1 ? "selective" : "open";
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
        ? WALL_DETAIL
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
          "precios", "precio", "prezzi", "prezzo", "priser", "prijzen", "cennik", "abonnements",
          "abonnemang", "hinnasto", "hinnat", "priser", "precos",
          // A bank's price list is its rates and fees. Without these, Wells
          // Fargo linking /mortgage/rates/ from its homepage scored as having
          // no pricing at all — raised by a reader asking why banks hide
          // public mortgage rates.
          "rates", "fees", "taxas", "tarifas", "tasas", "taux", "tassi"],
      },
      {
        name: "support/contact",
        words: ["contact", "contacts", "support", "help", "helpdesk", "kontakt", "kontakta", "contacto",
          "contatti", "contato", "kontakty", "assistance", "assistenza", "ayuda", "hilfe", "hjalp",
          "customer-service", "kundservice", "kundtjanst", "iletisim", "yhteystiedot", "yhteystieto",
          "asiakaspalvelu", "kundeservice", "obsluga-klienta", "atendimento", "servicio-al-cliente"],
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
          "voorwaarden", "kvkk", "tietosuoja", "kayttoehdot", "personvern", "privatliv"],
      },
    ];
    // Only the site's own links count: a third-party asset or widget host is not
    // this site publishing anything.
    const ownHrefs: Array<{ key: string; url: string }> = [];
    for (const m of home.text.matchAll(/href=["']([^"']+)["']/gi)) {
      const raw = m[1].trim();
      if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript):/i.test(raw)) continue;
      // A script is not a documentation page. fortune.com scored docs/api off
      // /api/tinypass.min.js, which is a paywall bundle.
      if (/\.(js|mjs|css|json|xml|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|pdf|zip|mp4|webm)(\?|$)/i.test(raw)) continue;
      try {
        const url = new URL(raw, `${origin}/`);
        // Same registrable domain, so help.shopify.com and docs.example.com count —
        // a support centre on a subdomain is still this site publishing it — while
        // fonts.googleapis.com and checkout.stripe.com do not.
        if (rootDomain(url.hostname) !== rootDomain(new URL(origin).hostname)) continue;
        url.hash = "";
        ownHrefs.push({ key: [url.hostname, url.pathname, url.search].join(" ").toLowerCase(), url: url.href });
      } catch {
        /* unparseable href */
      }
    }
    // Two sets, because how much latitude a word deserves depends on its length.
    // Hostname labels are segments in their own right: help.shopify.com is where
    // Shopify's support actually lives, and "help" has to be findable there.
    // Path depth decides between competing candidates; defined before the loop
    // that uses it, because a const referenced earlier throws at runtime while the
    // type-checker says nothing.
    // A pricing page is /pricing or /tarifs. An article about prices is
    // /economie/article/2026/10/31/penurie-de-navires-et-tarifs-record-... —
    // six segments and a hundred-character slug. Utility pages are shallow and
    // short, so anything article-shaped is not a candidate at all, however well
    // its slug matches and however convincingly the page then confirms.
    const looksEditorial = (u: string) => {
      try {
        const { pathname } = new URL(u);
        const segs = pathname.split("/").filter(Boolean);
        return segs.length >= 4 || segs.some((x) => x.length > 40) || /\/(19|20)\d\d\/\d\d?\//.test(pathname);
      } catch {
        return true;
      }
    };
    const depth = (u: string) => {
      try {
        const { pathname } = new URL(u);
        return [pathname.split("/").filter(Boolean).length, pathname.length];
      } catch {
        return [99, 999];
      }
    };
    // Every URL per token, not one. Keeping only the shortest discarded the
    // better candidate before ranking could see it: johnlewis.com links both
    // /customer-services/prices-and-payment/price-promise and .../gift-cards,
    // both carrying the token "prices", and gift-cards won by being one
    // character shorter. Ranking happens later, over the whole category.
    const segments = new Map<string, string[]>(); // "mentions-legales" -> URLs
    const parts = new Map<string, string[]>(); // "mentions" -> URLs
    const add = (m: Map<string, string[]>, k: string, u: string) => {
      const list = m.get(k);
      if (!list) m.set(k, [u]);
      else if (!list.includes(u) && list.length < 12) list.push(u);
    };
    for (const href of ownHrefs) {
      for (const seg of href.key.split(/[/?&=.\s]+/)) {
        if (!seg) continue;
        add(segments, seg, href.url);
        for (const part of seg.split(/[-_]+/)) if (part) add(parts, part, href.url);
      }
    }
    // A short generic token must be the entire segment: /api is a developer area,
    // "delphine-papin" is a journalist and "midterms-2026" is an election. A longer
    // word may be a part, and may carry an inflection — French contacter, Swedish
    // kontakta — which is why only words over five letters get prefix latitude.
    // Returns the URL that matched, so the check can go and look at it.
    //
    // When several match, take the shallowest path. A utility page lives at
    // /pricing or /tarifs; lemonde.fr otherwise scored "pricing" off a news
    // article whose slug happened to contain "tarifs-record", and the article
    // confirmed because it is about prices and quotes euros. Depth is the signal
    // that separates a site's pricing page from a story about prices.
    // Candidates for a whole category, ranked. Taking the first word that
    // matched and stopping was too arbitrary: johnlewis.com matched "prices"
    // inside /customer-services/prices-and-payment/... and then picked
    // .../gift-cards over .../price-promise on link order alone. Ranking across
    // the category's whole vocabulary lets the page whose final segment is
    // actually about the thing win.
    const urlForCategory = (words: string[]): { url: string; word: string } | undefined => {
      const cands: Array<{ url: string; word: string }> = [];
      for (const w of words) {
        for (const u of segments.get(w) ?? []) cands.push({ url: u, word: w });
        if (w.length > 5) {
          for (const u of parts.get(w) ?? []) cands.push({ url: u, word: w });
          for (const [pt, us] of parts) if (pt.startsWith(w)) for (const u of us) cands.push({ url: u, word: w });
        }
      }
      const usable = cands.filter((c) => !looksEditorial(c.url));
      if (!usable.length) return undefined;
      const lastSegHit = (u: string) => {
        try {
          const segs = new URL(u).pathname.split("/").filter(Boolean);
          const last = (segs[segs.length - 1] ?? "").toLowerCase();
          const bits = [last, ...last.split(/[-_.]+/)];
          return words.some((w) => bits.some((b) => b === w || (w.length > 4 && (b.startsWith(w) || w.startsWith(b)))));
        } catch {
          return false;
        }
      };
      return usable.sort((a, b) => {
        const ea = lastSegHit(a.url) ? 0 : 1;
        const eb = lastSegHit(b.url) ? 0 : 1;
        if (ea !== eb) return ea - eb;
        const [sa, la] = depth(a.url);
        const [sb, lb] = depth(b.url);
        return sa - sb || la - lb;
      })[0];
    };
    // Visible anchor text, as a fallback for a link whose URL is an opaque id.
    const anchorText = [...home.text.matchAll(/<a\b[^>]*>([\s\S]{0,80}?)<\/a>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, " ").toLowerCase())
      .join(" | ");
    // Every scoring bug this file has had was in a check that guessed from a
    // pattern — "api" inside googleapis, "plans" inside bons-plans-reductions,
    // cdn.shopify.com in an img src. The checks that fetch one thing and report
    // what came back have never had one. So A6 stops guessing: the slug only
    // nominates a candidate, and the candidate has to be fetched and look like
    // the thing it claims to be before it scores.
    //
    // Confirmation runs on the destination page, which is a far stronger signal
    // than the slug: a blog post at /blog/our-new-pricing no longer passes for a
    // pricing page. At most four extra fetches per site, once a week.
    const CONFIRM: Record<string, RegExp> = {
      pricing: /(\$|€|£|¥|\bprice|\bpricing|\bplans?\b|per month|\/mo\b|kostenlos|preis|tarif|precio|prezzo|kr\b|gratis|free tier|abonnement)/i,
      // A support page offers a way to reach someone. Requiring only the word
      // "support" credited grow.google/certificates/it-support/ — a course about
      // becoming an IT support technician — as Google's customer support.
      "support/contact":
        /(contact ?(us|form)?|kontakt|contacto|contatta|yhteystiedot|help ?cent|helpdesk|customer (service|support|care)|kundtjanst|asiakaspalvelu|service ?client|e-?mail|@[a-z0-9.-]+\.[a-z]{2,}|telefon|phone|\+\d[\d ()-]{6,}|live ?chat|raise a ticket|support ?ticket)/i,
      "docs/api": /(api|endpoint|documentation|documentación|developer|sdk|reference|authentication|curl |http request)/i,
      // Accented forms matter: clarin.com's "Términos y condiciones" page failed
      // on "terms" and was then credited as support instead, because its URL
      // sits under /ayuda/.
      "legal/privacy":
        /(privacy|privacidad|privacidade|cookie|terms|términos|terminos|condiciones|condições|gdpr|datenschutz|impressum|personuppgift|tietosuoja|käyttöehdot|rgpd|mentions légales|processing of personal)/i,
    };
    type Hit = { name: string; url?: string; status?: number; confirmed: boolean; note: string };
    const hits: Hit[] = [];
    for (const t of TASK_WORDS) {
      const best = urlForCategory(t.words);
      const url = best?.url;
      const matchedWord = best?.word ?? "";
      // One URL can be nominated by two categories — /ayuda/terminos-condiciones
      // is "help" to one and "terms" to the other. The last path segment says
      // what the page is, so the other category does not get to claim it.
      if (url && matchedWord) {
        const lastSeg = (() => {
          try {
            const segs = new URL(url).pathname.split("/").filter(Boolean);
            return (segs[segs.length - 1] ?? "").toLowerCase();
          } catch {
            return "";
          }
        })();
        const ownerElsewhere = TASK_WORDS.find(
          (other) =>
            other.name !== t.name &&
            other.words.some((w) => lastSeg === w || lastSeg.split(/[-_.]+/).some((b) => b === w || (w.length > 4 && b.startsWith(w))))
        );
        const minePresent = t.words.some((w) => lastSeg.split(/[-_.]+/).some((b) => b === w || (w.length > 4 && b.startsWith(w))));
        if (ownerElsewhere && !minePresent) {
          hits.push({ name: t.name, url, confirmed: false, note: `that link is ${ownerElsewhere.name}, not ${t.name}` });
          continue;
        }
      }
      // Anchor text is the fallback when the URL is an opaque id; nothing to fetch.
      if (!url) {
        const inAnchor = t.words.some(
          (w) => w.length > 5 && new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(anchorText)
        );
        if (inAnchor) hits.push({ name: t.name, confirmed: true, note: "named in link text" });
        continue;
      }
      const page = await get(url, "text/html");
      // Being blocked is not the site's failure, so a wall still counts and is
      // marked unverified. A 404 is different: the page is not there, and
      // crediting it was wrong. api.marksandspencer.com answers 404 with an API
      // gateway fault and was scoring Marks & Spencer a developer-docs point.
      const BLOCKED = new Set([401, 403, 429, 451]);
      if (page.status === 0 || BLOCKED.has(page.status) || page.status >= 500) {
        hits.push({ name: t.name, url, status: page.status, confirmed: true, note: page.status ? `link returns ${page.status}, content unverified` : "link unreachable, content unverified" });
        continue;
      }
      if (page.status >= 400) {
        hits.push({ name: t.name, url, status: page.status, confirmed: false, note: `link returns ${page.status} — the page is not there` });
        continue;
      }
      const body = stripToText(page.text).slice(0, 20000);
      // Two ways to confirm. The category vocabulary is English-leaning, so a
      // genuine Finnish contact page — "Yhteystiedot | Iltalehti", 571 words,
      // not one English contact word in it — failed on content alone. A
      // destination whose own <title> echoes the word that nominated it is
      // strong evidence in any language, and still rejects lemonde.fr's news
      // story, whose title is about shipping and not "tarifs".
      const title = (/<title[^>]*>([\s\S]{0,160}?)<\/title>/i.exec(page.text)?.[1] ?? "").toLowerCase();
      const ok = CONFIRM[t.name].test(body) || (matchedWord.length > 4 && title.includes(matchedWord));
      hits.push({ name: t.name, url, status: page.status, confirmed: ok, note: ok ? "confirmed" : "page does not read as this" });
    }
    const found = hits.filter((h) => h.confirmed);
    const short = (u?: string) => {
      if (!u) return "";
      try { const x = new URL(u); return ` (${x.pathname === "/" ? x.host : x.pathname})`; } catch { return ""; }
    };
    const rejected = hits.filter((h) => !h.confirmed);
    checks.push({
      id: "A6",
      title: "Everyday agent tasks reachable from the homepage",
      status: found.length >= 3 ? "pass" : found.length >= 2 ? "warn" : "fail",
      points: found.length * 5,
      maxPoints: 20,
      detail:
        (found.length
          ? `Reached from homepage: ${found.map((h) => `${h.name}${short(h.url)}`).join(", ")}.`
          : home.ok
            ? // A 200 that carries no readable HTML is not the same finding as a
              // homepage whose links are genuinely missing, and 179 reports —
              // 15% of the Index — were telling sites the second thing when the
              // truth was the first. aliexpress.com was being told its legal
              // pages are unreachable after a fetch that returned zero words.
              //
              // The first version of this used its own 30-word threshold and
              // only caught 92 of them: a Cloudflare interstitial has more
              // words than that, and A3's visible-text measure is stricter than
              // the link-extraction text here, so 87 reports still claimed
              // missing links. A3 has already decided whether a plain fetch
              // yields a readable page. If it said no, A6 has no standing to
              // report anything about links, so it defers to that one answer
              // instead of taking a second opinion.
              (checks.find((c) => c.id === "A3")?.points ?? 0) === 0
              ? `The homepage answered ${home.status}, but a plain fetch of it yields no readable page (see A3), so there were no links to follow. This scores zero because an agent reads what you sent, not what renders in a browser; it is not evidence the pages are missing.`
              : "None of pricing, support, docs, or legal are reachable from the homepage."
            : `The homepage itself returned ${home.status} to a plain fetch, so nothing could be reached from it. An agent hits the same wall, which is why this scores zero — but it is not evidence the pages are missing.`) +
        (rejected.length ? ` Link found but not confirmed: ${rejected.map((h) => `${h.name}${short(h.url)}`).join(", ")}.` : ""),
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
