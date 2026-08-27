# Agentability

**The observatory of the agentic web.**

Every week we audit ~115 well-known sites — the AI companies included — for
whether AI agents can actually discover, read, and act on them, then publish
the results as a public index with open data.

Live: https://agentability.org · Index: https://agentability.org/ai-index/ ·
Methodology: https://agentability.org/methodology/ · Data: https://agentability.org/data/summary.json

## What we measure (all real 2026 conventions — nothing invented)

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

Sites that block essentially all AI crawlers are labeled **“Closed by policy”**
rather than graded — refusing agents is a stance, and we report it as one.
Sites that publish `llms.txt` *while blocking AI crawlers* get the **paradox**
flag. The weekly history in `data/index/history/` is an adoption time series
for the agentic web — the longer it runs, the more it's worth.

## Architecture: $0/month, no servers

- `scripts/lib/evaluate-site.ts` — the evaluator (~300 lines, zero dependencies, plain `fetch`)
- `scripts/run-ai-index.ts` — batch runner; writes `data/index/` results + summary + weekly history
- `scripts/build-site.ts` — generates the entire static site into `dist-static/`
- `.github/workflows/ai-index.yml` — weekly cron in public-repo CI (free) → audit → commit data → deploy
- Firebase **Hosting only** (free tier; the project deliberately runs without billing)

## Run it yourself

```bash
npm ci
npm run index   # audits every domain in data/index/domains.txt
npm run build   # builds the site into dist-static/
```

Add a site: PR a line into `data/index/domains.txt`, or open an
[audit request issue](https://github.com/khalidsaidi/agentability/issues/new?title=Audit%20request:%20yourdomain.com&labels=audit-request).
Dispute a check: open an issue — the rubric is versioned in public.

## License

MIT
