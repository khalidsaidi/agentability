---
name: get-started
description: Show a new user what Agentability does by checking a website they care about for AI agents and explaining the result.
---

# Get started with Agentability

1. Ask the user which website they want to check. If they don't have one, suggest their own company's site or one they use often.
2. Call `check_site` with that domain, for example `example.com`.
3. Report the score out of 100 and the comparison with the most-visited sites, then the checks that did not pass, starting with the most points lost. For each, give the `fix` from the result in plain words.
4. If the homepage check (A3) says a bot challenge blocks plain fetches, explain that the site's bot protection is turning AI agents away, whatever its robots.txt says.
5. Offer two next steps: look up a well-known site with `lookup_index` to compare, or ask `get_findings` how many top sites block AI agents.

Don't invent scores or fixes. Use only what the tools return. If a check fails because the address is private or not a website, say so and ask for a public domain.
