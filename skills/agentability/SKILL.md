---
name: agentability
description: Check whether AI agents can use a website, and fix what stops them. Use when someone asks if their site is ready for AI agents, why ChatGPT, Claude or Perplexity can't read their site, how to add llms.txt, robots.txt AI rules, structured data, an MCP server or OpenAPI, or how their site compares with the web's most-visited sites.
---

# Agentability

Agentability (https://agentability.org) checks whether AI agents can use a website. It has scored the web's most-visited sites every week since 2026, and it checks any site on request.

## Check a site

Either:

- MCP: connect to `https://agentability.org/mcp` (Streamable HTTP, no auth) and call `check_site` with `{"domain": "example.com"}`.
- HTTP: `POST https://agentability.org/api/check` with JSON `{"domain": "example.com"}`.

The result has a 0-100 `score`, nine `checks` (each with `status`, `detail` and, when it did not pass, a `fix`), a `fixPrompt` that lists the fixes in order, and `comparedToIndex`: how the score compares with the web's most-visited sites. Checks take 2 to 10 seconds and are cached for 24 hours. Each client gets 10 checks per hour.

## Fix a site

1. Run the check.
2. Work through `checks` in order of points lost. The core checks are A1 to A6. B1 to B3 are optional bonuses.
3. A3 (content readable without a browser, 25 points) matters most: an agent reads the HTML it is sent and does not run JavaScript. If A3 says a bot challenge blocks plain fetches, the site's bot protection is turning agents away, whatever its robots.txt says.
4. Re-run the check after each change. Cached results last 24 hours, so a change shows up the next day, or right away for a different hostname.

## Look something up

- `lookup_index` (MCP): a site's score, rank and public report in the weekly Index.
- `get_findings` (MCP): the Index's headline numbers.
- Every site in the Index: `https://agentability.org/data/summary.json`.
- How each check works: https://agentability.org/methodology/

## What the checks are

A1 llms.txt · A2 AI-crawler policy in robots.txt · A3 content readable without a browser · A4 schema.org JSON-LD · A5 sitemap · A6 pricing, support, docs and legal reachable from the homepage · B1 MCP server · B2 OpenAPI · B3 UCP commerce profile.
