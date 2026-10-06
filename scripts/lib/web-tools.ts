// Read-only web access for the field-test agent. GET requests only — the
// agent can never submit forms, log in, or purchase. Pages are stripped to
// readable text plus links, capped hard so transcripts (and token bills)
// stay small.

const UA = "AgentabilityFieldTest/1.0 (+https://agentability.org/methodology)";
const FETCH_TIMEOUT_MS = 20000;
const MAX_BYTES = 2 * 1024 * 1024;
const PAGE_TEXT_CAP = 5000;
const MAX_LINKS = 40;

export type PageView = {
  url: string;
  ok: boolean;
  status: number;
  botWall: boolean;
  title: string;
  text: string;
  links: Array<{ text: string; href: string }>;
  error?: string;
};

const WALL_MARKERS = [
  "just a moment",
  "verifying you are human",
  "checking your browser",
  "cf-challenge",
  "attention required",
  "access denied",
  "enable javascript and cookies",
  "captcha",
];

function stripText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return m ? stripText(m[1]).slice(0, 160) : "";
}

function extractLinks(html: string, baseUrl: string): Array<{ text: string; href: string }> {
  const links: Array<{ text: string; href: string }> = [];
  const seen = new Set<string>();
  const re = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && links.length < MAX_LINKS * 3) {
    let href = m[1].trim();
    if (/^(javascript:|mailto:|tel:|data:)/i.test(href)) continue;
    try {
      href = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    const text = stripText(m[2]).slice(0, 80);
    if (!text) continue;
    const key = href.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ text, href });
  }
  // Prefer same-host links, keep a few external ones.
  let host = "";
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    /* keep all */
  }
  const same = links.filter((l) => host && l.href.includes(host));
  const other = links.filter((l) => !host || !l.href.includes(host));
  return [...same, ...other].slice(0, MAX_LINKS);
}

export async function visitPage(rawUrl: string): Promise<PageView> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const fail = (error: string, status = 0): PageView => ({
    url,
    ok: false,
    status,
    botWall: false,
    title: "",
    text: "",
    links: [],
    error,
  });
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return fail("only http(s) URLs allowed");
  } catch {
    return fail("invalid URL");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    const reader = response.body?.getReader();
    let html = "";
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      while (bytes < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        html += decoder.decode(value, { stream: true });
      }
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    const text = stripText(html);
    const lower = text.slice(0, 2500).toLowerCase();
    const botWall = (!response.ok || text.length < 600) && WALL_MARKERS.some((w) => lower.includes(w));
    return {
      url: response.url || url,
      ok: response.ok,
      status: response.status,
      botWall,
      title: extractTitle(html),
      text: text.slice(0, PAGE_TEXT_CAP),
      links: extractLinks(html, response.url || url),
    };
  } catch (error: any) {
    const message = String(error?.message || error);
    return fail(/abort/i.test(message) ? `timed out after ${FETCH_TIMEOUT_MS / 1000}s` : message.slice(0, 160));
  } finally {
    clearTimeout(timer);
  }
}

export type SearchHit = { title: string; url: string; snippet: string };

// A web search the producer can run with the same plain GET the agent gets:
// DuckDuckGo's no-JavaScript results page. Result hrefs are redirect links
// carrying the real URL in `uddg`; unwrap them so the producer sees true URLs.
export async function searchWeb(query: string, limit = 8): Promise<{ hits: SearchHit[]; error?: string }> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.trim())}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html,*/*;q=0.8" },
    });
    const html = (await response.text()).slice(0, MAX_BYTES);
    if (!response.ok) return { hits: [], error: `HTTP ${response.status}` };
    const hits: SearchHit[] = [];
    const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && hits.length < limit) {
      let href = m[1].replace(/&amp;/g, "&");
      const wrapped = /[?&]uddg=([^&]+)/.exec(href);
      if (wrapped) href = decodeURIComponent(wrapped[1]);
      else if (href.startsWith("//")) href = `https:${href}`;
      if (!/^https?:\/\//i.test(href)) continue;
      const title = stripText(m[2]).slice(0, 120);
      const snippet = stripText(m[3] || "").slice(0, 240);
      if (title) hits.push({ title, url: href, snippet });
    }
    const lower = stripText(html).slice(0, 2500).toLowerCase();
    if (!hits.length && WALL_MARKERS.some((w) => lower.includes(w))) return { hits, error: "search engine served a bot challenge" };
    return { hits };
  } catch (error: any) {
    const message = String(error?.message || error);
    return { hits: [], error: /abort/i.test(message) ? `timed out after ${FETCH_TIMEOUT_MS / 1000}s` : message.slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

export type TrendingTopic = { geo: string; topic: string; traffic: string; headline: string };

// What people are actually searching right now, from Google Trends' public RSS,
// across several English-speaking markets. This is the producer's raw material:
// any trending subject can become an errand, not just shopping ones.
//
// Note: Google Trends *Explore* (rising related queries) is 429-blocked for
// datacenter IPs, so it cannot be used from CI. This RSS feed is the one Trends
// surface that works server-side.
export async function trendingSearches(
  geos: string[] = ["US", "GB", "CA", "AU"],
  perGeo = 12
): Promise<{ topics: TrendingTopic[]; error?: string }> {
  const topics: TrendingTopic[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];

  for (const geo of geos) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`, {
        signal: controller.signal,
        headers: { "user-agent": UA, accept: "application/rss+xml,application/xml,*/*" },
      });
      if (!response.ok) {
        errors.push(`${geo}: HTTP ${response.status}`);
        continue;
      }
      const xml = (await response.text()).slice(0, MAX_BYTES);
      let taken = 0;
      for (const block of xml.split("<item>").slice(1)) {
        if (taken >= perGeo) break;
        const pick = (tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block)?.[1] ?? "";
        const topic = stripText(pick("title"));
        const key = topic.toLowerCase();
        if (!topic || seen.has(key)) continue;
        seen.add(key);
        topics.push({
          geo,
          topic,
          traffic: stripText(pick("ht:approx_traffic")),
          headline: stripText(pick("ht:news_item_title")).slice(0, 180),
        });
        taken += 1;
      }
    } catch (error: any) {
      errors.push(`${geo}: ${String(error?.message || error).slice(0, 60)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { topics, ...(topics.length ? {} : { error: errors.join("; ") || "no topics" }) };
}
