// The field-test agent: a real Claude agent given read-only web access and a
// concrete everyday task. The transcript of what it does IS the product —
// published verbatim on agentability.org.

import Anthropic from "@anthropic-ai/sdk";
import { visitPage, type PageView } from "./web-tools";

export const AGENT_MODEL = "claude-haiku-4-5";
// Published pricing for the model above, used for the transparency line.
export const PRICE_PER_MTOK_IN = 1.0;
export const PRICE_PER_MTOK_OUT = 5.0;

const MAX_STEPS = 14;
const KEEP_FULL_PAGES = 3; // older page contents are pruned from context
const MAX_TOKENS_PER_CALL = 1200;

export type FieldTask = {
  id: string;
  kind: "find" | "choose" | "stunt";
  title: string;
  prompt: string;
  startUrls: string[];
  candidates?: string[]; // for "choose" tasks: candidate domains
};

export type TranscriptStep = {
  step: number;
  narration: string; // the agent's own words before acting
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  botWall: boolean;
  pageTitle: string;
  note: string; // short machine summary (chars read, wall, error)
};

export type TaskRun = {
  taskId: string;
  kind: FieldTask["kind"];
  title: string;
  prompt: string;
  model: string;
  outcome: "completed" | "partial" | "failed";
  answer: string;
  chosenSite: string | null;
  obstacles: string[];
  sources: string[];
  steps: TranscriptStep[];
  wallsHit: number;
  domainsVisited: string[];
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
  error?: string;
};

const SYSTEM_PROMPT = `You are an AI agent doing a real task on the real web for a busy person.
You can only read pages with the "visit" tool (plain GET requests — you cannot log in, run
JavaScript, submit forms, or buy anything). Work like a sharp assistant:

- Start from the URLs given. Follow links by visiting their exact href.
- Before each visit, say in one short sentence what you're doing and why — this narration is
  published verbatim, so keep it natural and honest (frustration included).
- Be efficient: you have a limited number of visits. Don't re-read pages.
- If a page is a bot wall, an error, or useless, say so and adapt.
- When you know the answer — or you're convinced you can't get it — call "finish".
  Never invent facts you didn't read on a page. If you failed, say plainly why.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "visit",
    description:
      "Fetch a web page (plain GET, no JavaScript). Returns readable text and links. Use exact URLs, including ones from earlier link lists.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute URL to fetch" } },
      required: ["url"],
    },
  },
  {
    name: "finish",
    description: "End the task and report the result. Call this exactly once, when done or stuck.",
    input_schema: {
      type: "object",
      properties: {
        found: { type: "boolean", description: "Did you actually complete the task?" },
        answer: { type: "string", description: "The result, in 1-4 plain sentences a person can act on." },
        chosen_site: { type: "string", description: "For choice tasks: the domain you picked (else omit)." },
        obstacles: { type: "array", items: { type: "string" }, description: "What got in the way (bot walls, hidden pricing, dead ends)." },
        sources: { type: "array", items: { type: "string" }, description: "URLs the answer is based on." },
      },
      required: ["found", "answer"],
    },
  },
];

function pageToToolResult(view: PageView): string {
  if (!view.ok && !view.text) {
    return `FAILED to load ${view.url}: ${view.error || `HTTP ${view.status}`}${view.botWall ? " (bot challenge page)" : ""}`;
  }
  const links = view.links.map((l) => `- ${l.text} -> ${l.href}`).join("\n");
  return [
    `URL: ${view.url} (HTTP ${view.status})${view.botWall ? " — WARNING: this looks like a bot challenge wall, not real content" : ""}`,
    view.title ? `Title: ${view.title}` : "",
    `--- page text (truncated) ---`,
    view.text || "(no readable text)",
    links ? `--- links ---\n${links}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function callWithRetry(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (error: any) {
      lastError = error;
      const status = error?.status ?? 0;
      if (status && status < 500 && status !== 429 && status !== 529) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)));
    }
  }
  throw lastError;
}

function pruneOldPages(messages: Anthropic.MessageParam[]): void {
  // Keep only the last KEEP_FULL_PAGES tool results verbatim; blank older ones.
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (typeof block === "object" && block.type === "tool_result") {
        seen += 1;
        if (seen > KEEP_FULL_PAGES && typeof block.content === "string" && block.content.length > 400) {
          const firstLine = block.content.split("\n")[0];
          block.content = `${firstLine}\n[page content pruned to save context — you already read this page]`;
        }
      }
    }
  }
}

export async function runFieldTask(client: Anthropic, task: FieldTask, budget: { tokensLeft: number }): Promise<TaskRun> {
  const startedAt = Date.now();
  const run: TaskRun = {
    taskId: task.id,
    kind: task.kind,
    title: task.title,
    prompt: task.prompt,
    model: AGENT_MODEL,
    outcome: "failed",
    answer: "",
    chosenSite: null,
    obstacles: [],
    sources: [],
    steps: [],
    wallsHit: 0,
    domainsVisited: [],
    inputTokens: 0,
    outputTokens: 0,
    elapsedMs: 0,
  };
  const domains = new Set<string>();

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `TASK: ${task.prompt}\n\nStart from: ${task.startUrls.join(", ")}\nYou have at most ${MAX_STEPS} page visits. Narrate briefly, then act.`,
    },
  ];

  try {
    for (let step = 1; step <= MAX_STEPS + 1; step++) {
      if (budget.tokensLeft <= 0) {
        run.error = "episode token budget exhausted";
        break;
      }
      pruneOldPages(messages);
      const response = await callWithRetry(client, {
        model: AGENT_MODEL,
        max_tokens: MAX_TOKENS_PER_CALL,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });
      run.inputTokens += response.usage.input_tokens;
      run.outputTokens += response.usage.output_tokens;
      budget.tokensLeft -= response.usage.input_tokens + response.usage.output_tokens;

      const narration = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text.trim())
        .join(" ")
        .slice(0, 500);
      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

      if (!toolUses.length) {
        // Model answered in prose without finishing — treat as a partial report.
        run.answer = narration || "(agent stopped without reporting)";
        run.outcome = "partial";
        break;
      }

      const finishUse = toolUses.find((t) => t.name === "finish");
      if (finishUse) {
        const input = finishUse.input as any;
        run.answer = String(input.answer || "").slice(0, 1200);
        run.chosenSite = input.chosen_site ? String(input.chosen_site).toLowerCase().replace(/^www\./, "") : null;
        run.obstacles = Array.isArray(input.obstacles) ? input.obstacles.map((o: unknown) => String(o).slice(0, 200)).slice(0, 8) : [];
        run.sources = Array.isArray(input.sources) ? input.sources.map((s: unknown) => String(s).slice(0, 300)).slice(0, 8) : [];
        run.outcome = input.found ? "completed" : "partial";
        if (narration) {
          run.steps.push({
            step: run.steps.length + 1,
            narration,
            url: "",
            finalUrl: "",
            status: 0,
            ok: true,
            botWall: false,
            pageTitle: "",
            note: "wrapped up",
          });
        }
        break;
      }

      // Every tool_use must get a tool_result — the model may issue parallel visits.
      const results: Anthropic.ToolResultBlockParam[] = [];
      let first = true;
      for (const toolUse of toolUses) {
        const url = String((toolUse.input as any).url || "");
        const view = await visitPage(url);
        if (view.botWall) run.wallsHit += 1;
        try {
          domains.add(new URL(view.url).hostname.replace(/^www\./, ""));
        } catch {
          /* ignore */
        }
        run.steps.push({
          step: run.steps.length + 1,
          narration: first ? narration : "",
          url,
          finalUrl: view.url,
          status: view.status,
          ok: view.ok,
          botWall: view.botWall,
          pageTitle: view.title,
          note: view.error
            ? `failed: ${view.error}`
            : view.botWall
              ? "hit a bot challenge wall"
              : `read ~${view.text.length} chars, ${view.links.length} links`,
        });
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content:
            step > MAX_STEPS
              ? "Visit limit reached. You must call finish now with your best honest report."
              : pageToToolResult(view),
        });
        first = false;
      }
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: results });
    }

    // If the loop ended without a report, force one final "finish" call so every
    // task ends with the agent's own honest words instead of a bare error.
    if (!run.answer && !run.error) {
      pruneOldPages(messages);
      const finalNudge = "The task is over (visit limit reached). Call finish NOW with your best honest report of what you found and what stopped you.";
      const last = messages[messages.length - 1];
      if (last?.role === "user" && Array.isArray(last.content)) {
        last.content.push({ type: "text", text: finalNudge });
      } else {
        messages.push({ role: "user", content: finalNudge });
      }
      const response = await callWithRetry(client, {
        model: AGENT_MODEL,
        max_tokens: MAX_TOKENS_PER_CALL,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        tool_choice: { type: "tool", name: "finish" },
        messages,
      });
      run.inputTokens += response.usage.input_tokens;
      run.outputTokens += response.usage.output_tokens;
      budget.tokensLeft -= response.usage.input_tokens + response.usage.output_tokens;
      const finishUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (finishUse) {
        const input = finishUse.input as any;
        run.answer = String(input.answer || "").slice(0, 1200);
        run.chosenSite = input.chosen_site ? String(input.chosen_site).toLowerCase().replace(/^www\./, "") : null;
        run.obstacles = Array.isArray(input.obstacles) ? input.obstacles.map((o: unknown) => String(o).slice(0, 200)).slice(0, 8) : [];
        run.sources = Array.isArray(input.sources) ? input.sources.map((s: unknown) => String(s).slice(0, 300)).slice(0, 8) : [];
        run.outcome = input.found ? "completed" : "partial";
      } else {
        run.error = "agent never reported (step limit)";
      }
    }
  } catch (error: any) {
    run.error = String(error?.message || error).slice(0, 300);
  }

  run.domainsVisited = [...domains].sort();
  run.elapsedMs = Date.now() - startedAt;
  return run;
}
