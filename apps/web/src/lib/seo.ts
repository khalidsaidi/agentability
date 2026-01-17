import { useEffect } from "react";

const SITE_NAME = "Agentability";
const SITE_URL = import.meta.env.VITE_SITE_URL || "https://agentability.org";
const DEFAULT_DESCRIPTION =
  "Agentability audits public machine entrypoints, docs, and reliability to score agent readiness.";
const DEFAULT_IMAGE = `${SITE_URL}/og.png`;
const ROBOTS_INDEX =
  "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";

type SeoOptions = {
  title: string;
  description?: string;
  path?: string;
  image?: string;
  noIndex?: boolean;
  type?: "website" | "article";
};

function ensureMeta(attr: "name" | "property", key: string, content: string) {
  if (typeof document === "undefined") return;
  const selector = `meta[${attr}="${key}"]`;
  let tag = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function ensureLink(rel: string, href: string) {
  if (typeof document === "undefined") return;
  const selector = `link[rel="${rel}"]`;
  let link = document.head.querySelector(selector) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", rel);
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

function buildCanonical(path?: string) {
  if (!path) return SITE_URL;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${safePath}`;
}

export function applySeo(options: SeoOptions) {
  if (typeof document === "undefined") return;
  const title = options.title.includes(SITE_NAME)
    ? options.title
    : `${options.title} | ${SITE_NAME}`;
  const description = options.description || DEFAULT_DESCRIPTION;
  const canonical = buildCanonical(options.path);
  const image = options.image || DEFAULT_IMAGE;
  const type = options.type || "website";

  document.title = title;
  ensureMeta("name", "description", description);
  ensureMeta("name", "robots", options.noIndex ? "noindex,nofollow" : ROBOTS_INDEX);

  ensureMeta("property", "og:site_name", SITE_NAME);
  ensureMeta("property", "og:title", title);
  ensureMeta("property", "og:description", description);
  ensureMeta("property", "og:type", type);
  ensureMeta("property", "og:url", canonical);
  ensureMeta("property", "og:image", image);
  ensureMeta("property", "og:image:alt", `${SITE_NAME} preview`);
  ensureMeta("property", "og:image:width", "1200");
  ensureMeta("property", "og:image:height", "630");

  ensureMeta("name", "twitter:card", "summary_large_image");
  ensureMeta("name", "twitter:title", title);
  ensureMeta("name", "twitter:description", description);
  ensureMeta("name", "twitter:image", image);
  ensureMeta("name", "twitter:image:alt", `${SITE_NAME} preview`);

  ensureLink("canonical", canonical);
}

export function useSeo(options: SeoOptions) {
  useEffect(() => {
    applySeo(options);
  }, [
    options.title,
    options.description,
    options.path,
    options.image,
    options.noIndex,
    options.type,
  ]);
}

export { DEFAULT_DESCRIPTION, SITE_NAME, SITE_URL };
