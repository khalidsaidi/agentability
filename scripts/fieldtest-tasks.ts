// The weekly field-test task pool. Every task is read-only, everyday, and
// brand-real: things people actually ask assistants to do. Tasks rotate by
// episode; keep each one answerable from public pages (in principle).

import type { FieldTask } from "./lib/field-agent";

export const EPISODE_TASKS: FieldTask[] = [
  {
    id: "price-notion",
    kind: "find",
    title: "What does Notion really cost for a small team?",
    prompt:
      "You're setting up Notion for a 5-person team. Find the actual price per member per month when billed MONTHLY (not the annual rate) for the cheapest paid plan, from notion.com's own pages.",
    startUrls: ["https://www.notion.com"],
  },
  {
    id: "price-midjourney",
    kind: "find",
    title: "Find Midjourney's cheapest plan",
    prompt:
      "Find what Midjourney costs per month on its cheapest subscription, using only midjourney.com's own public pages.",
    startUrls: ["https://www.midjourney.com"],
  },
  {
    id: "price-zoom",
    kind: "find",
    title: "Zoom's cheapest paid plan",
    prompt: "Find the monthly price of Zoom's cheapest paid plan for one host, from zoom.us's own pages.",
    startUrls: ["https://zoom.us"],
  },
  {
    id: "price-salesforce",
    kind: "find",
    title: "Salesforce's cheapest CRM plan",
    prompt:
      "A 3-person startup wants the cheapest Salesforce CRM plan. Find its name and per-user monthly price from salesforce.com.",
    startUrls: ["https://www.salesforce.com"],
  },
  {
    id: "price-figma",
    kind: "find",
    title: "Figma Professional, billed monthly",
    prompt:
      "Find Figma's price per editor per month on the Professional plan when billed monthly, from figma.com's own pages.",
    startUrls: ["https://www.figma.com"],
  },
  {
    id: "cancel-chatgpt",
    kind: "find",
    title: "How do you cancel ChatGPT Plus?",
    prompt:
      "A user wants to cancel their ChatGPT Plus subscription. Find the exact official steps to cancel, from OpenAI's own sites.",
    startUrls: ["https://openai.com", "https://help.openai.com"],
  },
  {
    id: "support-poe",
    kind: "find",
    title: "Reach a human at Poe about billing",
    prompt:
      "A Poe subscriber has a billing problem. Find how to contact Poe's support (form, email, or page), starting from poe.com.",
    startUrls: ["https://poe.com"],
  },
  {
    id: "choose-tts",
    kind: "choose",
    title: "Pick a text-to-speech service for an audiobook",
    prompt:
      "Someone wants to narrate a 3-hour audiobook with AI voices on roughly a $30/month budget. Visit the candidate sites, compare what you can actually learn from their public pages (pricing, voice quality claims, usage limits), and pick ONE. Candidates: elevenlabs.io, murf.ai, resemble.ai, wellsaidlabs.com.",
    startUrls: ["https://elevenlabs.io", "https://murf.ai", "https://www.resemble.ai", "https://wellsaidlabs.com"],
    candidates: ["elevenlabs.io", "murf.ai", "resemble.ai", "wellsaidlabs.com"],
  },
  {
    id: "choose-product-photos",
    kind: "choose",
    title: "Pick an AI tool for product photos",
    prompt:
      "A small online shop wants an AI tool to turn phone snapshots into professional product photos. Visit the candidates, compare from their public pages, and pick ONE with a reason. Candidates: photoroom.com, getimg.ai, canva.com.",
    startUrls: ["https://www.photoroom.com", "https://getimg.ai", "https://www.canva.com"],
    candidates: ["photoroom.com", "getimg.ai", "canva.com"],
  },
  {
    id: "stunt-meta-ai",
    kind: "stunt",
    title: "Ask an AI agent to read meta.ai",
    prompt:
      "Find out what the meta.ai product offers and whether it costs anything, using meta.ai's own pages. Report honestly what an agent can actually see there.",
    startUrls: ["https://www.meta.ai"],
  },
];
