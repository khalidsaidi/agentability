# agentability

Can AI agents use this website? A live check, from the command line.

```
npx agentability example.com
```

You get a 0-100 score, each of the nine checks with what it found, a fix for each one that failed, and how the site compares with the web's most-visited sites.

```
npx agentability example.com --prompt   # the fixes as one prompt for a coding assistant
npx agentability example.com --json     # the full result
```

The checks: llms.txt, the AI-crawler policy in robots.txt, whether the homepage is readable without a browser, structured data, a sitemap, whether pricing, support, docs and legal can be reached from the homepage, and the optional MCP, OpenAPI and UCP.

It is the same check as [agentability.org](https://agentability.org/support/), which has scored the web's most-visited sites every week, and checked sites for AI agents since January 2026. It is also an MCP server, for AI assistants: `https://agentability.org/mcp`.

There is no account and no key. Each client gets 10 checks an hour, and results are cached for 24 hours. Apache-2.0.
