import type { FixIt } from "./recommendations";

export type CommunityFixCitation = {
  title?: string;
  url: string;
};

const STOPWORDS = new Set([
  "the",
  "and",
  "with",
  "from",
  "that",
  "this",
  "these",
  "those",
  "your",
  "you",
  "for",
  "are",
  "was",
  "were",
  "will",
  "shall",
  "have",
  "has",
  "had",
  "into",
  "onto",
  "over",
  "under",
  "then",
  "than",
  "what",
  "when",
  "where",
  "how",
  "why",
  "can",
  "could",
  "should",
  "would",
  "not",
  "only",
  "use",
  "using",
  "add",
  "make",
  "more",
  "less",
  "just",
  "about",
  "public",
  "mode",
  "agentability",
  "agents",
  "agent",
  "score",
  "ready",
  "readying",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9./:_-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function extractKeywords(chunks: string[], limit = 10): string[] {
  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    for (const token of tokenize(chunk)) {
      if (token.length < 3) continue;
      if (STOPWORDS.has(token)) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      keywords.push(token);
      if (keywords.length >= limit) return keywords;
    }
  }
  return keywords;
}

export function buildCommunityFixQuery(args: {
  issueId: string;
  summary: string;
  recommendation?: FixIt | null;
}): string {
  const title = args.recommendation?.title ?? "";
  const context = [title, args.summary].filter(Boolean).join(" ");
  const base = `Agentability ${args.issueId} ${context} fix`.trim();
  const recommendationChunks = args.recommendation
    ? [args.recommendation.title, args.recommendation.whyItMatters, args.recommendation.steps.join(" "), args.recommendation.snippet]
    : [];
  const keywords = extractKeywords(recommendationChunks);
  return keywords.length ? `${base} ${keywords.join(" ")}` : base;
}

export function normalizeCommunityFixResponse(input: unknown): {
  answerMd?: string;
  citations: CommunityFixCitation[];
} {
  const record = (input ?? {}) as Record<string, unknown>;
  const answer =
    (typeof record.answerMd === "string" && record.answerMd) ||
    (typeof record.answer === "string" && record.answer) ||
    (typeof record.response === "string" && record.response) ||
    undefined;

  const rawCitations =
    (Array.isArray(record.citations) && record.citations) ||
    (Array.isArray(record.sources) && record.sources) ||
    (Array.isArray(record.references) && record.references) ||
    [];

  const citations: CommunityFixCitation[] = [];
  for (const item of rawCitations) {
    if (typeof item === "string") {
      citations.push({ url: item });
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const url =
        (typeof obj.url === "string" && obj.url) ||
        (typeof obj.link === "string" && obj.link) ||
        (typeof obj.source === "string" && obj.source) ||
        (typeof obj.href === "string" && obj.href) ||
        "";
      if (!url) continue;
      const title =
        (typeof obj.title === "string" && obj.title) ||
        (typeof obj.name === "string" && obj.name) ||
        undefined;
      citations.push({ url, title });
    }
  }

  return { answerMd: answer, citations };
}

export function buildA2ABenchSearchUrl(baseUrl: string, query: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/search?q=${encodeURIComponent(query)}`;
}
