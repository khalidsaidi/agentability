// The guides: the practical half of the site. Each one answers a question people
// actually search for, using the same rubric the Index scores every site on —
// nothing here is a convention we invented.
//
// URLs are stable on purpose: these three pages earned most of the site's search
// impressions before the 2026 rebuild, and the old .html paths redirect here.

export type GuideContext = {
  audited: number;
  averageScore: number;
  pctLlmsTxt: number;
  pctBlockingSomeAI: number;
  pctClosed: number;
  latestEpisode: { date: string; completed: number; tasks: number; wallsHit: number; pageVisits: number } | null;
};

export type Guide = {
  slug: string;
  title: string;
  description: string;
  updated: string; // ISO date of the last substantive edit
  body: (ctx: GuideContext) => string;
};

const curl = (cmd: string) => `<pre><code>${cmd.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</code></pre>`;

export const GUIDES: Guide[] = [
  {
    slug: "ai-readiness-audit-checklist",
    title: "AI SEO Checklist: 8 Checks AI Agents Run on Your Site",
    description:
      "An AI readiness audit checklist you can run yourself in an hour: the eight checks that decide whether AI agents can read, understand and act on your site — llms.txt, crawler policy, readable HTML, structured data, sitemap, reachable pricing and support, MCP and OpenAPI — each with a 60-second curl test and the exact fix.",
    updated: "2026-09-14",
    body: (ctx) => `
<p class="lede">AI agents are the web's newest audience, and most sites fail them in the same handful of ways. This is the
checklist we score the ${ctx.audited} most-visited sites on the web against every week — the same eight checks, in the same order, with a
way to test each one yourself in about a minute. The panel's average right now is <b>${ctx.averageScore}/100</b>.</p>

<h2>What an agent actually needs</h2>
<p class="lede">Not a chatbot, not an API key, not a partnership. A production AI agent working on someone's behalf makes plain
HTTP requests and reads what comes back. It cannot run your JavaScript, solve your bot challenge, or click through a
cookie wall. If the answer to "what does this cost?" only exists after a script executes, the agent never sees it — and
in our daily <a href="/fieldtest/">Field Test</a>, that is the single most common reason an errand fails.</p>

<h2>The checklist</h2>

<h3>A1 · Publish a substantive <code>llms.txt</code> <span class="pts">15 points</span></h3>
<p class="lede">The <a href="https://llmstxt.org/" rel="nofollow noopener">llms.txt convention</a> is a plain-text file at your site root
that tells AI readers where the important things are. "Substantive" means it carries real links — docs, pricing,
support, legal — not a paragraph of marketing copy. ${ctx.pctLlmsTxt}% of the panel publishes one.</p>
<ul>
<li>Serve it at <code>/llms.txt</code> with <code>Content-Type: text/plain</code>.</li>
<li>One H1 (your name), a one-line summary, then H2 sections of link lists with a short note per link.</li>
<li>Link the pages an assistant would need to finish a task: pricing, cancellation, contact, API docs, terms.</li>
</ul>
${curl("curl -s https://yourdomain.com/llms.txt | head -20")}
<p class="lede">See <a href="/guides/llms-txt-openapi-for-ai-agents/">llms.txt and OpenAPI for AI agents</a> for a full template.</p>

<h3>A2 · Decide your AI-crawler policy on purpose <span class="pts">15 points</span></h3>
<p class="lede">Your <code>robots.txt</code> is read by GPTBot, ClaudeBot, Claude-User, PerplexityBot, Google-Extended and CCBot. Blocking
all of them is a legitimate stance — we label it "closed by policy" and report it as one — but do it knowingly. Two
things to know: <b>Claude-User</b> and similar agents fetch on behalf of a person who asked, which is different from a
training crawler; and publishing <code>llms.txt</code> while blocking every AI crawler is a contradiction we flag as
the <b>paradox</b>. ${ctx.pctBlockingSomeAI}% of the panel blocks at least one crawler; ${ctx.pctClosed}% blocks them all.</p>
${curl("curl -s https://yourdomain.com/robots.txt | grep -iA2 'gptbot\\|claudebot\\|claude-user\\|perplexitybot\\|google-extended\\|ccbot'")}

<h3>A3 · Make the homepage readable without a browser <span class="pts">25 points</span></h3>
<p class="lede">The heaviest-weighted check, because it is the one that ends the most errands. A plain fetch of your homepage should
return the actual content as HTML text. A JavaScript shell with an empty <code>&lt;div id="root"&gt;</code> fails.
A Cloudflare "checking your browser" interstitial fails. Server-render or pre-render the pages that carry answers.</p>
${curl("curl -sL https://yourdomain.com/ | sed 's/<[^>]*>/ /g' | tr -s ' \\n' | wc -w\n# under ~150 words of visible text, or a page titled 'Just a moment', is a fail")}

<h3>A4 · Add schema.org JSON-LD <span class="pts">15 points</span></h3>
<p class="lede">A valid <code>&lt;script type="application/ld+json"&gt;</code> block on the homepage — <code>Organization</code> or
<code>WebSite</code> at minimum, <code>Product</code> with <code>Offer</code> on pricing pages, <code>FAQPage</code> where
you answer questions. Agents parse it directly; it is the cheapest structured signal you can ship.</p>
${curl("curl -sL https://yourdomain.com/ | grep -o '<script type=\"application/ld+json\">[^<]*' | head -c 400")}

<h3>A5 · Make the sitemap discoverable <span class="pts">10 points</span></h3>
<p class="lede">Either a <code>Sitemap:</code> line in <code>robots.txt</code> or a file at <code>/sitemap.xml</code>. Include
<code>&lt;lastmod&gt;</code> — it is how crawlers know what changed without re-fetching everything.</p>
${curl("curl -s https://yourdomain.com/sitemap.xml | grep -c '<loc>'")}

<h3>A6 · Link pricing, support, docs and legal from the homepage <span class="pts">20 points</span></h3>
<p class="lede">Every everyday errand starts from the front door: what does it cost, how do I cancel, how do I reach a person, what
does the policy say. Those pages need to be reachable by following an <code>&lt;a href&gt;</code> in the homepage
HTML — not a menu that only exists after JavaScript runs, and not behind a login.</p>
${curl("curl -sL https://yourdomain.com/ | grep -oi 'href=\"[^\"]*\\(pricing\\|support\\|help\\|docs\\|terms\\|privacy\\)[^\"]*\"' | sort -u")}

<h3>B1 · Advertise an MCP server <span class="pts">+5 bonus</span></h3>
<p class="lede">If you expose tools to agents over the Model Context Protocol, say so at <code>/.well-known/mcp.json</code>. Most
sites skip this; the ones that ship it are the ones agents can actually act on rather than just read.</p>

<h3>B2 · Publish an OpenAPI document <span class="pts">+5 bonus</span></h3>
<p class="lede">A reachable OpenAPI description at a stable URL, linked from your docs and your <code>llms.txt</code>. Only relevant
if you have an API — but if you do, it is how an agent learns to call it correctly the first time.</p>

<h2>What fails most, in practice</h2>
<p class="lede">Every week a real agent attempts ten errands on real sites and we publish the transcript. The recurring killers, in
order: pricing pages that render only in JavaScript; help centers behind a bot challenge; cancellation flows that
require a login to even describe; and "contact us" pages with no contact on them.
${ctx.latestEpisode ? `In the <a href="/fieldtest/${ctx.latestEpisode.date}/">latest episode</a> the agent finished ${ctx.latestEpisode.completed} of ${ctx.latestEpisode.tasks} errands across ${ctx.latestEpisode.pageVisits} page reads and hit ${ctx.latestEpisode.wallsHit} bot walls.` : ""}</p>

<h2>A three-day plan</h2>
<ul>
<li><b>Day 1</b> — ship <code>llms.txt</code>, fix <code>robots.txt</code> to say what you mean, add JSON-LD to the homepage.</li>
<li><b>Day 2</b> — server-render the pricing, support and legal pages; link all four from the homepage HTML.</li>
<li><b>Day 3</b> — publish a sitemap with <code>lastmod</code>; if you have an API, publish OpenAPI and link it.</li>
</ul>
<div class="cta"><b>See your score.</b> Every site on the <a href="/ai-index/">Index</a> has a check-by-check report with the exact
fix for each failure. Not on the panel? <a href="https://github.com/khalidsaidi/agentability/issues/new?title=Audit%20request:%20yourdomain.com&labels=audit-request">Request an audit</a> — free, one issue.</div>`,
  },
  {
    slug: "llms-txt-openapi-for-ai-agents",
    title: "llms.txt and OpenAPI: the AI Visibility Setup Guide",
    description:
      "How to write an llms.txt that AI agents can actually use, publish OpenAPI and MCP so they can act, and serve the file correctly from FastAPI, Django, Express, Hono, Next.js, Laravel, Rails, Go, ASP.NET and more.",
    updated: "2026-09-14",
    body: (ctx) => `
<p class="lede"><code>llms.txt</code> is the front door for AI readers; OpenAPI and MCP are how they get past the lobby. This guide covers
what to put in each, what makes the difference between a file that scores and one that doesn't, and the two lines of
code it takes to serve it from whatever framework you run. ${ctx.pctLlmsTxt}% of the ${ctx.audited} sites we audit publish
an <code>llms.txt</code>; far fewer publish one worth reading.</p>

<h2>What llms.txt is</h2>
<p class="lede">A Markdown file at your site root, defined at <a href="https://llmstxt.org/" rel="nofollow noopener">llmstxt.org</a>. The
shape is strict enough to parse and loose enough to write in ten minutes:</p>
<ul>
<li>An H1 with the name of the site or project — the only required element.</li>
<li>A blockquote with a one-paragraph summary.</li>
<li>H2 sections, each a list of links in the form <code>- [Title](URL): one line on what's there</code>.</li>
<li>An optional <code>## Optional</code> section for links that can be skipped when context is tight.</li>
</ul>
<p class="lede">Optionally, <code>/llms-full.txt</code> carries the full text of your docs in one file for readers that want everything.</p>

<h2>A template that scores</h2>
<pre><code># Acme

&gt; Acme sells widgets by subscription. Plans, cancellation and support are all self-serve; the API is public.

## Product
- [Pricing](https://acme.com/pricing): every plan with the current monthly and annual price
- [Cancel or change a plan](https://acme.com/help/cancel): the exact steps, no login needed to read
- [Contact support](https://acme.com/support): email, hours, and the phone number for billing

## Developers
- [API reference](https://acme.com/docs/api): REST, auth, rate limits
- [OpenAPI document](https://acme.com/openapi.json): machine-readable description of every endpoint

## Legal
- [Terms of service](https://acme.com/terms)
- [Privacy policy](https://acme.com/privacy)

## Optional
- [Changelog](https://acme.com/changelog)</code></pre>

<h2>What separates a real one from a token one</h2>
<ul>
<li><b>Links, not prose.</b> The Index checks for a substantive file with links. A paragraph about your mission scores like an empty file.</li>
<li><b>The task pages.</b> Pricing, cancellation, support, legal. Those are what an agent is sent to find.</li>
<li><b>Match your crawler policy.</b> Publishing <code>llms.txt</code> while your <code>robots.txt</code> blocks ClaudeBot, GPTBot and
PerplexityBot is the <b>paradox</b> — we flag it in red on your report. Decide which you mean.</li>
<li><b>Plain text.</b> <code>Content-Type: text/plain; charset=utf-8</code>. Not HTML, not a redirect to a docs page.</li>
</ul>

<h2>OpenAPI: so agents can call, not just read</h2>
<p class="lede">If you have an API, publish its OpenAPI description at a stable URL and link it from both your docs and your
<code>llms.txt</code>. Common locations are <code>/openapi.json</code> and <code>/.well-known/openapi.json</code>; what matters is that
the link is discoverable and the document is valid. Include request and response examples — an agent will copy them.
Document authentication in plain words: where to get a key, which header carries it.</p>

<h2>MCP: advertise your tools</h2>
<p class="lede">If you expose tools over the <a href="https://modelcontextprotocol.io/" rel="nofollow noopener">Model Context Protocol</a>,
publish <code>/.well-known/mcp.json</code> describing the server endpoint. It's a bonus check on the Index because it is
still rare — which is exactly why shipping it stands out.</p>

<h2>Serving llms.txt from your framework</h2>
<p class="lede">The file has to live at the root and return as plain text. Here is the shortest correct way in each stack.</p>

<h3>Next.js</h3>
<pre><code># drop it in public/ — served at /llms.txt automatically
public/llms.txt</code></pre>

<h3>FastAPI</h3>
<pre><code>from fastapi.responses import PlainTextResponse

@app.get("/llms.txt", response_class=PlainTextResponse)
def llms_txt():
    return open("llms.txt").read()</code></pre>

<h3>Flask</h3>
<pre><code>@app.get("/llms.txt")
def llms_txt():
    return send_from_directory(".", "llms.txt", mimetype="text/plain")</code></pre>

<h3>Django</h3>
<pre><code>from django.views.generic import TemplateView

urlpatterns += [path("llms.txt", TemplateView.as_view(template_name="llms.txt", content_type="text/plain"))]</code></pre>

<h3>Express</h3>
<pre><code>app.get("/llms.txt", (req, res) =&gt; res.type("text/plain").sendFile(path.join(__dirname, "llms.txt")));</code></pre>

<h3>Fastify</h3>
<pre><code>fastify.get("/llms.txt", (req, reply) =&gt; reply.type("text/plain").send(LLMS_TXT));</code></pre>

<h3>Hono</h3>
<pre><code>app.get("/llms.txt", (c) =&gt; c.text(LLMS_TXT));</code></pre>

<h3>Laravel and Rails</h3>
<pre><code># both serve the public directory at the site root
public/llms.txt</code></pre>

<h3>Go (net/http)</h3>
<pre><code>http.HandleFunc("/llms.txt", func(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/plain; charset=utf-8")
    http.ServeFile(w, r, "llms.txt")
})</code></pre>

<h3>ASP.NET Core</h3>
<pre><code>// wwwroot/llms.txt, with static files enabled
app.UseStaticFiles();</code></pre>

<h3>Angular, React and other single-page apps</h3>
<p class="lede">Put <code>llms.txt</code> in the static assets that deploy to the site root (for Angular, an <code>assets</code> entry in
<code>angular.json</code> with output at <code>/</code>). Then read the bigger warning: a single-page app fails the 25-point
readability check unless the pages agents need are pre-rendered. The file helps; server-side rendering is the fix.</p>

<h2>Check it</h2>
${curl("curl -sI https://yourdomain.com/llms.txt | grep -i '^content-type'\ncurl -s https://yourdomain.com/llms.txt | grep -c '](http'")}
<p class="lede">The first line should say <code>text/plain</code>; the second is your link count. Under five, keep writing.</p>
<div class="cta">Back to the <a href="/guides/ai-readiness-audit-checklist/">full audit checklist</a>, or see how your site
scores on the <a href="/ai-index/">Index</a>.</div>`,
  },
  {
    slug: "ai-seo-vs-geo-vs-aeo",
    title: "AI SEO vs GEO vs AEO: What Actually Matters",
    description:
      "Generative engine optimization, answer engine optimization, AI SEO and AI visibility are four names for mostly the same work. Here is what the labels mean, where they genuinely differ, and the eight things that decide whether an AI can use your site at all — measured across the most-visited sites on the web, audited every week.",
    updated: "2026-10-05",
    body: (ctx) => `
<p class="lede">Four labels are competing to name the same job: <b>AI SEO</b>, <b>GEO</b> (generative engine optimization),
<b>AEO</b> (answer engine optimization) and <b>AI visibility</b>. Vendors will tell you they are different disciplines.
Mostly they are not. Underneath all four sits one question with a measurable answer: <b>can a machine fetch your page,
read it, and act on what it says?</b> We measure exactly that on the ${ctx.audited} most-visited sites on the web every week, and send a
real agent out to try. Here is what the labels actually mean and which parts are worth your time.</p>

<h2>What each term means</h2>
<ul>
<li><b>AI SEO</b> — the broadest and most-searched label. Usually means "everything you do so AI systems surface your
site", which spans classic technical SEO, content, and the machine-readable surfaces below.</li>
<li><b>GEO — generative engine optimization</b> — aimed at being cited inside generated answers (ChatGPT, Gemini,
Perplexity, AI Overviews). Emphasis on being quotable: clear claims, facts near the top, citable structure.</li>
<li><b>AEO — answer engine optimization</b> — older term, from the featured-snippet and voice-assistant era. Emphasis on
directly answering a specific question in a parseable block.</li>
<li><b>AI visibility</b> — the measurement side: are you actually appearing in AI answers, and how often. A reporting
category more than a technique.</li>
</ul>

<h2>The honest version: one job, three layers</h2>
<p class="lede">Strip the branding and every one of these resolves to the same stack, in strict order of dependency.
Each layer is worthless if the one below it fails.</p>
<ul>
<li><b>1 · Reachable</b> — a plain HTTP request gets your page, not a bot challenge, not a login. If an agent cannot
fetch it, nothing above this matters. This is where most sites actually fail.</li>
<li><b>2 · Readable</b> — the answer is in the served HTML, not assembled by JavaScript afterwards. Prices, plans,
cancellation steps, contact details.</li>
<li><b>3 · Quotable</b> — once a machine can read it, structure makes it citable: a direct answer near the top,
schema.org JSON-LD, a curated <code>llms.txt</code>, stable URLs.</li>
</ul>
<p class="lede">GEO and AEO advice is almost entirely layer 3. That advice is sound — and completely wasted if you fail
layers 1 or 2, which is the situation for a large share of the sites we audit.</p>

<h2>What the data says</h2>
<p class="lede">Across the ${ctx.audited} most-visited sites on the web, average score <b>${ctx.averageScore}/100</b>:</p>
<ul>
<li><b>${ctx.pctBlockingSomeAI}%</b> block at least one major AI crawler in <code>robots.txt</code>, and
<b>${ctx.pctClosed}%</b> block essentially all of them. For those, every hour spent on GEO tactics is spent behind a
locked door.</li>
<li>Only <b>${ctx.pctLlmsTxt}%</b> publish an <code>llms.txt</code> — the cheapest layer-3 win there is.</li>
<li>In our daily <a href="/fieldtest/">Field Test</a>, the errands that fail almost never fail for lack of clever
content. They fail on JavaScript-only pricing pages, bot walls on help centers, and cancellation flows you cannot
even read without logging in.${ctx.latestEpisode ? ` In the <a href="/fieldtest/${ctx.latestEpisode.date}/">latest episode</a> the agent hit ${ctx.latestEpisode.wallsHit} bot walls across ${ctx.latestEpisode.pageVisits} page reads.` : ""}</li>
</ul>

<h2>So what should you actually do?</h2>
<p class="lede">In this order. Stop when you run out of time — the order is the point.</p>
<ul>
<li><b>Unblock deliberately.</b> Open your <code>robots.txt</code> and decide, on purpose, which AI crawlers you allow.
Blocking everything is a legitimate business choice; blocking by accident is not.</li>
<li><b>Server-render the money pages.</b> Pricing, support, cancellation, legal. One curl should show the numbers.</li>
<li><b>Link those four from the homepage</b> with real anchors in the HTML.</li>
<li><b>Ship <code>llms.txt</code> and JSON-LD.</b> An afternoon's work, and it is the whole of what most GEO guides sell you.</li>
<li><b>Then</b> worry about quotability, phrasing, and being cited.</li>
</ul>

<h2>How to measure it without buying anything</h2>
<p class="lede">You do not need an AI-visibility subscription to find out whether you are reachable and readable. Fetch
your own pages the way an agent does:</p>
<pre><code>curl -sL https://yourdomain.com/pricing | grep -o '\$[0-9]*' | head</code></pre>
<p class="lede">No prices, or a page titled "Just a moment", is your answer. Then look up your site on the
<a href="/ai-index/">Index</a> for a check-by-check report, and read the
<a href="/guides/ai-readiness-audit-checklist/">full checklist</a> for the fix to each failure.</p>

<div class="cta"><b>The short answer to "AEO vs GEO":</b> pick whichever word your team likes, then go fix layers 1 and 2
first. The labels are marketing; the eight checks are not.</div>`,
  },
  {
    slug: "technical-seo-for-ai-discovery",
    title: "AI SEO: How to Get Your Site Read by AI Agents",
    description:
      "Technical SEO for AI discovery: search engines and AI agents want mostly the same things from your site — but agents fail in different places. Server rendering, bot walls, structured data, one-hop navigation, and how to measure your AI visibility with real agent transcripts.",
    updated: "2026-09-14",
    body: (ctx) => `
<p class="lede">Classic technical SEO asks whether a crawler can find, fetch and understand your pages. AI discovery asks the same
question of a different reader — one that arrives with a task, reads a page or two, and either finishes the errand or
gives up. The fundamentals overlap almost entirely. The failure modes don't.</p>

<h2>Where agents fail that crawlers don't</h2>
<p class="lede">Googlebot renders JavaScript. Most production agents don't — they make a plain HTTP request and read the HTML that
comes back. Googlebot is allow-listed through every bot-protection product. Agents are the traffic those products are
tuned to stop. And Googlebot has all the time in the world; an agent has a step budget and a person waiting.</p>
<p class="lede">So a site can be technically flawless for search and still lose every agent at the door.
${ctx.latestEpisode ? `In our <a href="/fieldtest/${ctx.latestEpisode.date}/">latest Field Test episode</a>, ${ctx.latestEpisode.wallsHit} of ${ctx.latestEpisode.pageVisits} page fetches hit a bot wall.` : ""}
${ctx.pctBlockingSomeAI}% of the ${ctx.audited} sites on our Index block at least one AI crawler by policy.</p>

<h2>1. Render the answer in HTML</h2>
<p class="lede">Pricing, plan comparisons, cancellation steps, contact details: these must exist in the served HTML, not appear
after a script runs. Server-side rendering, static generation, or pre-rendering for the handful of pages that carry
answers. The test is one command:</p>
<pre><code>curl -sL https://yourdomain.com/pricing | grep -o '\\$[0-9]*' | head</code></pre>
<p class="lede">No prices in the output means no prices for an agent. This single check is worth 25 of the 100 points on the Index.</p>

<h2>2. Don't wall the readers you want</h2>
<p class="lede">Bot-protection defaults treat every non-browser request as hostile. That includes an agent fetching your help
center because a customer asked how to cancel. Review your rules: distinguish scrapers from named, well-behaved
agents; serve the plain HTML version to anything that identifies itself honestly; never put your support and legal
pages behind a challenge. And write a <code>robots.txt</code> that says what you mean — blocking everything is a
choice, and we report it as "closed by policy" rather than as a bug.</p>

<h2>3. Ship structured data agents can use</h2>
<p class="lede">JSON-LD is read directly, no parsing heuristics needed. <code>Organization</code> and <code>WebSite</code> on the
homepage; <code>Product</code> with <code>Offer</code> on every plan; <code>FAQPage</code> wherever you answer a question;
<code>HowTo</code> for cancellation and setup flows. Keep it in sync with the visible page — an agent that reads both and
finds them disagreeing trusts neither.</p>

<h2>4. One hop from the homepage to the money pages</h2>
<p class="lede">Pricing, support, docs, legal. Each linked from the homepage with a real <code>&lt;a href&gt;</code> in the HTML, not a
JavaScript menu, not an icon with no text. An agent that has to guess URLs burns its step budget guessing.</p>

<h2>5. llms.txt as the map</h2>
<p class="lede">A curated, link-rich <code>llms.txt</code> at the root is the fastest way to tell an AI reader where things are. It costs
ten minutes and it's checked on every audit. <a href="/guides/llms-txt-openapi-for-ai-agents/">Here is the template.</a></p>

<h2>6. Sitemaps with lastmod</h2>
<p class="lede">The standard advice, still right: <code>/sitemap.xml</code> or a <code>Sitemap:</code> line in <code>robots.txt</code>,
every canonical URL, and a real <code>&lt;lastmod&gt;</code> on each. Crawlers of every kind use it to spend their budget on
what changed.</p>

<h2>7. Measure it the way it's actually experienced</h2>
<p class="lede">Fetch your own pages the way an agent does and read what comes back:</p>
<pre><code>curl -sL -A "Mozilla/5.0 (compatible; ClaudeBot/1.0)" https://yourdomain.com/ | head -c 2000</code></pre>
<p class="lede">If you see "Just a moment", "Verifying you are human", or an empty app shell, that is what every agent sees. Then
look at your site's <a href="/ai-index/">Index report</a> — each check maps to a fix — and read a few
<a href="/fieldtest/">Field Test transcripts</a> to watch a real agent hit real walls, verbatim.</p>

<div class="cta">Start with the <a href="/guides/ai-readiness-audit-checklist/">audit checklist</a>. Every item has a one-line test
and a concrete fix.</div>`,
  },
];
