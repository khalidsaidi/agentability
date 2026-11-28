// What a site has to do about each check it did not pass, in plain text.
//
// Shared by the report pages (built into HTML) and the instant check (sent as
// JSON and drawn as text), so a site gets the same advice either way. Code is
// marked with backticks; each surface turns those into its own markup.
//
// Every string is built from the site's own measured result. Google's
// scaled-content policy turns on whether a page is worth reading, and a report
// that names the score but not the remedy is not.

export type CheckLike = { id: string; title: string; status: string; detail: string };
export type RobotsLike = Array<{ bot: string; policy: string }>;

const TASKS = ["pricing", "support/contact", "docs/api", "legal/privacy"];

// A6 writes "Reached from homepage: support/contact (/support/), legal/privacy
// (/privacy/)." and, separately, "Link found but not confirmed: ...". Only the
// first sentence lists what an agent actually reached. (This parsed "Found from
// homepage:" until 2026-11-28, a wording A6 no longer uses, so every report told
// sites they were missing pages they link.)
export function reachedTasks(detail: string): string[] {
  const m = /Reached from homepage:([^]*?)(?:\.\s|\.$|$)/.exec(detail);
  if (!m) return [];
  return TASKS.filter((t) => m[1].includes(t));
}

export function fixFor(domain: string, c: CheckLike, robots: RobotsLike): string | null {
  if (c.status === "pass") return null;
  const blocked = robots.filter((p) => p.policy !== "allowed");
  switch (c.id) {
    case "A1":
      return `Serve a plain-text file at \`https://${domain}/llms.txt\` listing the pages an agent most often needs (pricing, docs, support, account management), each as a one-line description and an absolute URL. It is read by an agent arriving cold with no idea of your structure. Fifteen points, and most teams ship it in an afternoon.`;
    case "A2":
      if (/could not be read/.test(c.detail)) {
        return `Your \`robots.txt\` could not be read, so nobody can tell what you allow. Serve it as plain text at \`https://${domain}/robots.txt\`, outside any bot challenge, and state your AI policy in it on purpose.`;
      }
      return blocked.length
        ? `Your \`robots.txt\` currently refuses ${blocked.map((p) => p.bot).join(", ")}. If that is deliberate, this score is the cost and the trade is yours to make. If it is inherited from an old rule or a security plugin, the commonest cause we see, those agents cannot read ${domain} on a user's behalf at all.`
        : `Make the policy explicit in \`robots.txt\` rather than leaving it implied. An agent that cannot tell whether it is welcome usually treats silence as a wall.`;
    case "A3":
      return /bot challenge/.test(c.detail)
        ? `Your homepage turns a plain request away with a bot challenge or a refusal, so an agent sees a wall instead of your content. If you use bot protection, allow the AI agents you want, or serve the main pages to plain requests. This is the heaviest check at 25 points.`
        : `${c.detail} An agent fetches the page and reads what comes back; it does not run your JavaScript. Server-render the main content, or serve the same text to a plain request. This is the heaviest check at 25 points, and the one that most often decides whether an agent can use a site at all.`;
    case "A4":
      return `Add schema.org JSON-LD to the homepage: \`Organization\` at minimum, plus \`Product\` or \`Article\` where they apply. It is how an agent learns what ${domain} is without inferring it from prose.`;
    case "A5":
      return `Serve \`https://${domain}/sitemap.xml\` and point to it from \`robots.txt\`. Without it an agent has to guess your URL structure from whatever the homepage happens to link.`;
    case "A6": {
      const found = reachedTasks(c.detail);
      const missing = TASKS.filter((t) => !found.includes(t));
      if (!missing.length) return null;
      return `An agent could not reach ${missing.join(", ")} from the ${domain} homepage${found.length ? `, though ${found.join(" and ")} ${found.length === 1 ? "was" : "were"} fine` : ""}. These are what agents are sent to find most often. Each needs a plain link an agent can follow from the homepage in one hop: not behind a menu that only appears once JavaScript runs, and not only in a logged-in view.`;
    }
    case "B1":
      return `Optional, and rare: only a handful of the sites we track run one. An MCP server lets an agent act on ${domain} through a defined interface instead of scraping it. Advertise it at \`/.well-known/mcp/server-card.json\`.`;
    case "B2":
      return `Optional. If ${domain} has a public API, publishing an OpenAPI document at \`/openapi.json\` lets an agent call it correctly without a human reading your docs first.`;
    case "B3":
      return `Optional, and only if you sell online. A Universal Commerce Protocol profile at \`/.well-known/ucp\` tells a shopping agent how to browse your catalogue and check out.`;
    default:
      return null;
  }
}

// One prompt a site owner can paste into a coding assistant, built from the fixes.
export function fixPrompt(domain: string, fixes: Array<{ id: string; title: string; fix: string }>): string | null {
  if (!fixes.length) return null;
  const steps = fixes.map((f, i) => `${i + 1}. ${f.title} (${f.id}): ${f.fix.replace(/`/g, "")}`).join("\n");
  return `I want AI agents to be able to use ${domain}. An agent-readiness check (agentability.org) found these problems. Fix them in this order, changing only what each one needs, and tell me anything you could not do:\n\n${steps}\n\nAfterwards I will re-check at https://agentability.org/support/?check=${encodeURIComponent(domain)}`;
}
