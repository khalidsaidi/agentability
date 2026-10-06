// The episode producer: invents each week's field-test tasks autonomously.
// Runs on the stronger model WITH live web search, so episodes are grounded in
// what's actually happening this week — launches, price changes, controversies
// — not stale training-data trivia.
//
// The search is the same plain-GET web access the agent gets (DuckDuckGo's
// no-JavaScript results page plus page visits), executed client-side, so the
// producer needs nothing from the model provider beyond tool use.

import Anthropic from "@anthropic-ai/sdk";
import type { FieldTask } from "./field-agent";
import { CostBudget } from "./cost-budget";
import { searchWeb, visitPage, trendingSearches } from "./web-tools";

export const PRODUCER_MODEL = "deepseek-v4-pro";
const MAX_RESEARCH_ROUNDS = 8;
// Anthropic's server-side search capped itself at a handful of uses; these tools
// don't, so the loop must: after this many research rounds the only tool left is
// propose_tasks, and the call is forced.
const RESEARCH_ROUNDS_BEFORE_FORCING = 5;
// Tasks built without reading a page carry invented start URLs, which the
// sanitiser then throws out — leaving an episode of seed tasks.
const MIN_RESEARCH_CALLS = 4;

const RESEARCH_TOOLS: Anthropic.Tool[] = [
  {
    name: "search",
    description: "Web search (DuckDuckGo). Returns titles, URLs and snippets. Use 3-6 focused queries about this week's news.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
  },
  {
    name: "visit",
    description: "Fetch a web page (plain GET, no JavaScript) and read its text. Use it to confirm a story or a real URL before building a task on it.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute URL" } },
      required: ["url"],
    },
  },
  {
    name: "trending",
    description:
      "What the US is searching right now (Google Trends). Most entries are news, sport or politics and make no errand — use it to spot the few that do: a company in the news, a price change, a product launch, a service people are suddenly trying to cancel or reach.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

const PRODUCER_TOOL: Anthropic.Tool = {
  name: "propose_tasks",
  description: "Propose the tasks for this week's episode. Call exactly once, after your research.",
  input_schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "kebab-case slug, unique this episode" },
            kind: { type: "string", enum: ["find", "choose", "stunt"] },
            title: { type: "string", description: "Short, punchy episode-card title (max 70 chars)" },
            prompt: { type: "string", description: "The exact task given to the agent, self-contained" },
            startUrls: { type: "array", items: { type: "string" }, description: "1-4 https:// start URLs" },
            candidates: { type: "array", items: { type: "string" }, description: "choose tasks only: candidate domains" },
          },
          required: ["id", "kind", "title", "prompt", "startUrls"],
        },
      },
    },
    required: ["tasks"],
  },
};

function producerPrompt(opts: {
  today: string;
  panelDomains: string[];
  blockedDomains: string[];
  pastTitles: string[];
}): string {
  return `Today is ${opts.today}. You are the producer of "The Agent Field Test" — a daily public show
on agentability.org where a real AI agent is sent out onto the live web with read-only access (plain
GET requests: no logins, no JavaScript, no forms, no purchases) and the full transcript is published
verbatim, win or fail. Your job: design today's 10 errands so the episode is about TODAY.

Start by calling "trending" to see what people are actually searching right now across several
countries. Those topics are your raw material, and ALL of them are fair game — sport, breaking news,
entertainment, disasters, politics, people, products, anything. Use "search" and "visit" to find out
what the story actually is before you build a task on it.

For each topic worth using, ask the only question that matters: **what would a real person ask an
assistant to go and find out about this?** Then write that as the errand. Shapes, not subjects:
- a fixture is trending  -> "What time does it kick off in UK time, and which channel is showing it?"
- an earthquake trends   -> "What magnitude, where exactly, and is there a tsunami warning?"
- a person trends        -> "What actually happened — from a source that isn't paywalled?"
- a show or film trends  -> "Where can I watch it, and what does that cost?"
- a product trends       -> "What does it actually cost and when can I get one?"
- an outage trends       -> "Is it still down, and has the company said anything?"

The test is always the same: can an agent armed with nothing but plain GET requests actually find
this out on the open web? When it cannot — paywalls, bot walls, JavaScript-only scores, login-gated
help pages — that failure IS the episode. Pick topics that will put that to the test.

Rules:
- Errands a normal person would delegate. Not developer trivia (no context windows, token limits).
- Name real sites that actually exist. Never invent a domain. Homepages are the safest start URLs.
- Mix: about 6 "find" tasks, 3 "choose" tasks (3-4 real candidate sites each), exactly 1 "stunt".
- The stunt should send the agent somewhere it will very likely be blocked. The wall is the story.
- Everything answerable in principle from public pages: read-only, no accounts, no personal data,
  nothing destructive, safe to publish. Avoid tasks that require a human's private information.
- On a grim story (a disaster, a death, a crime) keep the errand factual and respectful — what
  happened, where to find official information — never ghoulish.
- Do not repeat recent episode topics: ${opts.pastTitles.length ? opts.pastTitles.join(" · ") : "(none yet)"}.
- Prompts must be self-contained. The agent sees nothing but your prompt and has NO web search — only
  page fetches — so put today's context in the prompt itself and give it real starting URLs.

The audited panel below is useful for the stunt and for any errand where a site's agent-readiness is
the point, but you are NOT limited to it: ${opts.panelDomains.join(", ")}

Sites known to block or wall AI agents (prime stunt material): ${opts.blockedDomains.join(", ") || "(none known)"}

Research first — call "trending", then at least four "search"/"visit" calls — and only then call
propose_tasks once with the 10 tasks. Every startUrl must be a real page you have seen load, or the
task will be thrown away.`;
}

function sanitizeTask(raw: any, reasons: string[] = []): FieldTask | null {
  if (!raw || typeof raw !== "object") { reasons.push("not an object"); return null; }
  const kind = raw.kind === "choose" || raw.kind === "stunt" ? raw.kind : "find";
  const id = String(raw.id || "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 60);
  const title = String(raw.title || "").slice(0, 90);
  const prompt = String(raw.prompt || "").slice(0, 900);
  // Accept bare hosts and http:// — a producer that found a real page should not
  // lose the task to a missing scheme.
  const startUrls = (Array.isArray(raw.startUrls) ? raw.startUrls : [])
    .map((u: unknown) => String(u).trim())
    .map((u: string) => (/^https?:\/\//i.test(u) ? u : u ? `https://${u}` : ""))
    .map((u: string) => u.replace(/^http:\/\//i, "https://"))
    .filter((u: string) => /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(u))
    .slice(0, 4);
  if (!id || !title || !prompt || !startUrls.length) {
    reasons.push(
      `${raw.id || "(no id)"}: ` +
        [!id && "bad id", !title && "no title", !prompt && "no prompt", !startUrls.length && `no valid startUrls (${JSON.stringify(raw.startUrls ?? null)})`]
          .filter(Boolean)
          .join(", ")
    );
    return null;
  }
  const candidates = Array.isArray(raw.candidates)
    ? raw.candidates.map((c: unknown) => String(c).toLowerCase().replace(/^www\./, "").trim()).filter(Boolean).slice(0, 5)
    : undefined;
  return { id, kind, title, prompt, startUrls, ...(candidates?.length ? { candidates } : {}) };
}

export async function produceEpisodeTasks(
  client: Anthropic,
  panelDomains: string[],
  blockedDomains: string[],
  pastTitles: string[],
  budget: CostBudget
): Promise<{ tasks: FieldTask[]; producedBy: "producer" | "seed" }> {
  try {
    const params = {
      model: PRODUCER_MODEL,
      max_tokens: 9000,
      tools: [PRODUCER_TOOL, ...RESEARCH_TOOLS],
    };
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: producerPrompt({
          today: new Date().toISOString().slice(0, 10),
          panelDomains,
          blockedDomains,
          pastTitles,
        }),
      },
    ];
    // Streamed: producer turns are long (research + 10 tasks) and non-streaming
    // requests of that length get dropped by intermediaries. Research tools run
    // here and their results go back as tool_results until propose_tasks arrives;
    // a turn that ends in prose without any tool call is nudged once.
    let toolUse: Anthropic.ToolUseBlock | undefined;
    let researched = 0;
    for (let round = 0; round < MAX_RESEARCH_ROUNDS && !toolUse; round++) {
      // This model costs ~4x the agent's; a research loop must not run away.
      if (budget.exhausted) throw new Error("spend ceiling reached before tasks were produced");
      const forcing = round >= RESEARCH_ROUNDS_BEFORE_FORCING;
      if (forcing && round === RESEARCH_ROUNDS_BEFORE_FORCING) {
        messages.push({ role: "user", content: "Research is over. Call propose_tasks now with the 10 finished tasks, built from what you have already read." });
      }
      const turn = forcing
        ? { ...params, tools: [PRODUCER_TOOL], tool_choice: { type: "any" as const } } // `tool` is rejected in thinking mode; with one tool, `any` forces it
        : params;
      let response: Anthropic.Message | null = null;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3 && !response; attempt++) {
        try {
          response = await client.messages.stream({ ...turn, messages }).finalMessage();
        } catch (error) {
          lastError = error;
          const status = (error as any)?.status ?? 0;
          if (status && status < 500 && status !== 429) throw error;
          await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
        }
      }
      if (!response) throw lastError;
      budget.record(PRODUCER_MODEL, response.usage.input_tokens, response.usage.output_tokens);
      toolUse = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "propose_tasks"
      );
      if (toolUse && researched < MIN_RESEARCH_CALLS && !forcing) {
        // Proposing before looking anything up produces invented URLs. Send it back.
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              is_error: true,
              content:
                "Rejected: you have not researched yet. Use search and visit first to find out what today's trending stories actually are and to get real URLs that load. Then call propose_tasks.",
            },
          ],
        });
        toolUse = undefined;
        continue;
      }
      if (toolUse) break;
      messages.push({ role: "assistant", content: response.content });

      const research = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      researched += research.filter((c) => c.name === "search" || c.name === "visit").length;
      if (!research.length) {
        if (!forcing) messages.push({ role: "user", content: "Good — now call propose_tasks exactly once with the 10 finished tasks." });
        continue;
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of research) {
        const input = call.input as any;
        let content: string;
        if (call.name === "search") {
          const { hits, error } = await searchWeb(String(input.query || ""));
          content = error
            ? `Search failed: ${error}`
            : hits.length
              ? hits.map((h) => `- ${h.title}\n  ${h.url}\n  ${h.snippet}`).join("\n")
              : "No results.";
          console.log(`  producer searched: ${String(input.query || "").slice(0, 80)} → ${hits.length} hits${error ? ` (${error})` : ""}`);
        } else if (call.name === "trending") {
          const { topics, error } = await trendingSearches();
          content = error
            ? `Trending unavailable: ${error}`
            : topics.map((t) => `- ${t.topic} (${t.traffic} searches) — ${t.headline}`).join("\n") || "No trends returned.";
          console.log(`  producer read Google Trends → ${topics.length} topics${error ? ` (${error})` : ""}`);
        } else if (call.name === "visit") {
          const view = await visitPage(String(input.url || ""));
          content = view.ok || view.text
            ? `URL: ${view.url} (HTTP ${view.status})${view.botWall ? " — bot challenge wall" : ""}\nTitle: ${view.title}\n${view.text.slice(0, 3500)}`
            : `FAILED to load ${view.url}: ${view.error || `HTTP ${view.status}`}`;
          console.log(`  producer visited: ${view.url.slice(0, 80)} → HTTP ${view.status}`);
        } else {
          content = `Unknown tool ${call.name}`;
        }
        results.push({ type: "tool_result", tool_use_id: call.id, content });
      }
      messages.push({ role: "user", content: results });
    }
    const raw = (toolUse?.input as any)?.tasks;
    const reasons: string[] = [];
    const tasks = (Array.isArray(raw) ? raw : [])
      .map((t: any) => sanitizeTask(t, reasons))
      .filter((t): t is FieldTask => t !== null);
    if (reasons.length) console.error(`  ${reasons.length} task(s) rejected: ${reasons.slice(0, 4).join(" | ")}`);
    const seen = new Set<string>();
    const unique = tasks.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    if (unique.length >= 6) return { tasks: unique.slice(0, 10), producedBy: "producer" };
    throw new Error(`producer returned only ${unique.length} usable tasks`);
  } catch (error) {
    console.error(`Task producer failed (${String((error as any)?.message || error).slice(0, 160)}) — using seed tasks.`);
    const { EPISODE_TASKS } = await import("../fieldtest-tasks");
    return { tasks: EPISODE_TASKS, producedBy: "seed" };
  }
}
