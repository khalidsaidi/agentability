# Agentability

**We send AI agents to use the real web. Then we publish everything.**

Two weekly, fully autonomous productions:

1. **The Agent Field Test** — an AI producer invents real errands (find the true
   price, cancel the subscription, reach a human, pick a product between brands),
   and a real agent attempts them with read-only web access. Transcripts are
   published verbatim: wins, honest give-ups, bot walls, what it cost in tokens.
2. **The AI-Readiness Index** — ~113 well-known sites audited weekly against the
   conventions real AI agents rely on in 2026, with grades, postures, and open data.

Live: https://agentability.org · Field Test: https://agentability.org/fieldtest/ ·
Index: https://agentability.org/ai-index/ · Methodology: https://agentability.org/methodology/ ·
Data: https://agentability.org/data/summary.json

## The Field Test rules

- **Autonomous end to end**: producer model invents each episode's tasks from the
  audited panel (avoiding past topics); the agent attempts them. No human writes,
  selects, or edits an episode.
- **Read-only by construction**: the agent's only tool is a plain HTTP GET — no
  JavaScript, no logins, no forms, no purchases.
- **Hard limits**: ≤14 page visits per task, a fixed token budget per episode,
  model named on every page. (We pay for the API calls for fun.)
- **Verbatim or nothing**: no retries, no editing, no cherry-picking; raw episode
  JSON is open data under `/data/fieldtest/`.

## The Index rubric (all real 2026 conventions — nothing invented)

| Check | Convention | Points |
|---|---|---|
| A1 | `llms.txt` present and substantive (llmstxt.org) | 15 |
| A2 | robots.txt policy toward GPTBot, ClaudeBot, Claude-User, PerplexityBot, Google-Extended, CCBot | 15 |
| A3 | Homepage readable from a plain fetch (no JS wall / bot challenge) | 25 |
| A4 | Valid schema.org JSON-LD | 15 |
| A5 | Sitemap discoverable | 10 |
| A6 | Pricing / support / docs / legal reachable from the homepage | 20 |
| B1 | MCP server advertised (`/.well-known/mcp.json`) | +5 bonus |
| B2 | OpenAPI document published | +5 bonus |

Sites that block essentially all AI crawlers are labeled **“Closed by policy”** —
refusing agents is a stance, and we report it as one. Sites that publish
`llms.txt` *while blocking AI crawlers* get the **paradox** flag. Weekly history
in `data/index/history/` is an adoption time series for the agentic web.

## Architecture: ~$0/month, no servers

- `scripts/lib/evaluate-site.ts` — the Index evaluator (~300 lines, zero runtime deps)
- `scripts/lib/field-agent.ts` + `scripts/lib/episode-producer.ts` — the Field Test agent and its AI producer
- `scripts/run-ai-index.ts` / `scripts/run-fieldtest.ts` — batch runners; write `data/`
- `scripts/build-site.ts` — generates the entire static site into `dist-static/`
- `.github/workflows/` — weekly crons in public-repo CI (free): `ai-index` (Mon), `fieldtest` (Wed), `deploy` (on push)
- Firebase **Hosting only** (free tier; the project deliberately runs without billing)
- The Field Test's API calls are the only running cost — we pay for those for fun

## Run it yourself

```bash
npm ci
npm run index                       # audit every domain in data/index/domains.txt
ANTHROPIC_API_KEY=... npm run fieldtest   # run an episode
npm run build                       # build the site into dist-static/
```

Add a site to the panel: PR a line into `data/index/domains.txt`, or open an
[audit request issue](https://github.com/khalidsaidi/agentability/issues/new?title=Audit%20request:%20yourdomain.com&labels=audit-request).
Dispute a check or a transcript: open an issue — everything is versioned in public.

## License

MIT
