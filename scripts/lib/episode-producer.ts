// The episode producer: invents each week's field-test tasks autonomously.
// Runs on the strongest available model WITH live web search, so episodes are
// grounded in what's actually happening this week — launches, price changes,
// controversies — not stale training-data trivia.

import Anthropic from "@anthropic-ai/sdk";
import type { FieldTask } from "./field-agent";

const PRODUCER_MODEL = "claude-opus-5";

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
  return `Today is ${opts.today}. You are the producer of "The Agent Field Test" — a weekly public show
on agentability.org where a real AI agent does everyday web tasks with read-only access (plain GET
requests: no logins, no JavaScript, no forms, no purchases) and the full transcript is published
verbatim. Your job: design this week's 10 tasks so the episode is CURRENT, human, and dramatic.

First, use web search (a few searches) to find out what's actually happening this week: product
launches, price changes or hikes people are angry about, subscription controversies, things people
are trying to cancel, viral complaints about companies being hard to reach. Then design tasks that
ride those stories — an episode about THIS week, not about the eternal web.

Rules for great episodes:
- Tasks are errands a normal person would delegate to an assistant: what does this really cost now,
  how do I cancel this, how do I reach a human, which of these should I buy, what does this policy
  actually say. NOT developer trivia (no context windows, parameter counts, API limits).
- Name real, well-known brands people care about. Prefer the audited panel below, but 3-4 tasks may
  use other famous sites (airlines, ticketing, streaming, retail, banks-adjacent-but-read-only) when
  the week's news makes a better story. Never invent domains.
- Mix: about 6 "find" tasks, 3 "choose" tasks (3-4 candidate brands each), and exactly 1 "stunt".
- The stunt should send the agent somewhere it will very likely be blocked or lost — sites known to
  wall off agents are listed below. The comedy/tragedy of the wall IS the story.
- Everything must be answerable in principle from public pages, read-only, nothing destructive, no
  accounts, no personal data, and safe to publish.
- Avoid repeating past episode topics: ${opts.pastTitles.length ? opts.pastTitles.join(" · ") : "(none yet)"}.
- Prompts must be self-contained (the agent sees nothing else, and has NO web search — only page
  fetches), concrete, and start from URLs that actually exist (homepages are safest). If a task
  depends on this week's news, put the needed context in the prompt itself.

Audited panel: ${opts.panelDomains.join(", ")}

Sites known to block or wall AI agents (stunt material): ${opts.blockedDomains.join(", ") || "(none known)"}

Research first, then call propose_tasks once with the 10 tasks.`;
}

function sanitizeTask(raw: any): FieldTask | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.kind === "choose" || raw.kind === "stunt" ? raw.kind : "find";
  const id = String(raw.id || "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 60);
  const title = String(raw.title || "").slice(0, 90);
  const prompt = String(raw.prompt || "").slice(0, 900);
  const startUrls = (Array.isArray(raw.startUrls) ? raw.startUrls : [])
    .map((u: unknown) => String(u).trim())
    .filter((u: string) => /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(u))
    .slice(0, 4);
  if (!id || !title || !prompt || !startUrls.length) return null;
  const candidates = Array.isArray(raw.candidates)
    ? raw.candidates.map((c: unknown) => String(c).toLowerCase().replace(/^www\./, "").trim()).filter(Boolean).slice(0, 5)
    : undefined;
  return { id, kind, title, prompt, startUrls, ...(candidates?.length ? { candidates } : {}) };
}

export async function produceEpisodeTasks(
  client: Anthropic,
  panelDomains: string[],
  blockedDomains: string[],
  pastTitles: string[]
): Promise<{ tasks: FieldTask[]; producedBy: "producer" | "seed" }> {
  try {
    const params = {
      model: PRODUCER_MODEL,
      max_tokens: 9000,
      tools: [
        PRODUCER_TOOL,
        { type: "web_search_20260209", name: "web_search", max_uses: 5 } as unknown as Anthropic.ToolUnion,
      ],
      messages: [
        {
          role: "user" as const,
          content: producerPrompt({
            today: new Date().toISOString().slice(0, 10),
            panelDomains,
            blockedDomains,
            pastTitles,
          }),
        },
      ],
    };
    // Streamed: producer turns are long (web research + 10 tasks) and
    // non-streaming requests of that length get dropped by intermediaries.
    // Server-tool turns can also end in `pause_turn` (continue by echoing the
    // content back) or in prose without the tool call (nudge once) — handle both.
    const messages: Anthropic.MessageParam[] = [...params.messages];
    let toolUse: Anthropic.ToolUseBlock | undefined;
    for (let round = 0; round < 6 && !toolUse; round++) {
      let response: Anthropic.Message | null = null;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3 && !response; attempt++) {
        try {
          response = await client.messages.stream({ ...params, messages }).finalMessage();
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
        }
      }
      if (!response) throw lastError;
      toolUse = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "propose_tasks"
      );
      if (toolUse) break;
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason !== "pause_turn") {
        messages.push({ role: "user", content: "Good — now call propose_tasks exactly once with the 10 finished tasks." });
      }
    }
    const raw = (toolUse?.input as any)?.tasks;
    const tasks = (Array.isArray(raw) ? raw : []).map(sanitizeTask).filter((t): t is FieldTask => t !== null);
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
