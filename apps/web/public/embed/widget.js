(() => {
  const BASE_URL = "https://agentability.org";
  const STYLE_ID = "agentability-widget-style";
  const WIDGET_SELECTOR = "[data-agentability-domain]";
  const PROCESSED_FLAG = "agentabilityWidgetReady";

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.ab-widget-root {
  --ab-bg: #ffffff;
  --ab-fg: #0f172a;
  --ab-muted: #475569;
  --ab-border: #dbe2ef;
  --ab-shadow: rgba(15, 23, 42, 0.12);
  --ab-good: #047857;
  --ab-mid: #b45309;
  --ab-low: #b91c1c;
  --ab-accent: #0f766e;
  box-sizing: border-box;
  max-width: 420px;
  width: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
}
.ab-widget-root * {
  box-sizing: border-box;
}
.ab-widget-root.ab-theme-night {
  --ab-bg: #0b1220;
  --ab-fg: #f8fafc;
  --ab-muted: #cbd5e1;
  --ab-border: #334155;
  --ab-shadow: rgba(2, 6, 23, 0.55);
  --ab-good: #34d399;
  --ab-mid: #fbbf24;
  --ab-low: #fca5a5;
  --ab-accent: #5eead4;
}
.ab-widget-link {
  display: block;
  text-decoration: none;
  color: inherit;
}
.ab-widget-card {
  border: 1px solid var(--ab-border);
  background: linear-gradient(170deg, var(--ab-bg), color-mix(in srgb, var(--ab-bg) 88%, #ccfbf1));
  border-radius: 14px;
  padding: 12px;
  box-shadow: 0 14px 30px var(--ab-shadow);
}
.ab-widget-inline {
  border: 1px solid var(--ab-border);
  background: var(--ab-bg);
  border-radius: 999px;
  padding: 6px 10px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 8px 22px var(--ab-shadow);
}
.ab-widget-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ab-widget-domain {
  margin: 0;
  font-size: 13px;
  color: var(--ab-muted);
}
.ab-widget-brand {
  margin: 2px 0 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--ab-accent);
}
.ab-widget-grade {
  font-weight: 700;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid var(--ab-border);
  color: var(--ab-fg);
}
.ab-widget-grade.ab-score-good {
  color: var(--ab-good);
}
.ab-widget-grade.ab-score-mid {
  color: var(--ab-mid);
}
.ab-widget-grade.ab-score-low {
  color: var(--ab-low);
}
.ab-widget-score {
  margin-top: 9px;
  color: var(--ab-fg);
  font-size: 22px;
  line-height: 1;
  font-weight: 750;
}
.ab-widget-sub {
  margin-top: 5px;
  color: var(--ab-muted);
  font-size: 12px;
}
.ab-widget-bar {
  margin-top: 10px;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ab-border) 78%, transparent);
  overflow: hidden;
}
.ab-widget-bar-fill {
  height: 100%;
  width: 0;
  transition: width 450ms ease;
  border-radius: 999px;
  background: linear-gradient(90deg, #0891b2, #0f766e 50%, #10b981 100%);
}
.ab-widget-inline .ab-widget-score {
  margin-top: 0;
  font-size: 14px;
  font-weight: 700;
}
.ab-widget-inline .ab-widget-sub {
  margin-top: 0;
  font-size: 11px;
}
.ab-widget-inline .ab-widget-grade {
  padding: 2px 7px;
}
.ab-widget-inline .ab-widget-domain {
  font-size: 12px;
}
.ab-widget-loading,
.ab-widget-error {
  border: 1px dashed var(--ab-border);
  border-radius: 12px;
  background: var(--ab-bg);
  color: var(--ab-muted);
  padding: 10px;
  font-size: 12px;
}
`;
    document.head.appendChild(style);
  }

  function normalizeDomain(raw) {
    if (!raw || typeof raw !== "string") return "";
    let value = raw.trim().toLowerCase();
    if (!value) return "";
    try {
      if (value.startsWith("http://") || value.startsWith("https://")) {
        return new URL(value).hostname.toLowerCase();
      }
    } catch {
      return "";
    }
    value = value.replace(/^https?:\/\//, "");
    value = value.split("/")[0];
    return value.replace(/[^a-z0-9.-]/g, "");
  }

  function formatDate(value) {
    if (!value) return "Recently verified";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Recently verified";
    return `Verified ${date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  }

  function scoreTone(score) {
    if (score >= 80) return "ab-score-good";
    if (score >= 55) return "ab-score-mid";
    return "ab-score-low";
  }

  function buildEndpoint(domain) {
    return `${BASE_URL}/v1/evaluations/${encodeURIComponent(domain)}/latest.json`;
  }

  function buildReportUrl(domain) {
    return `${BASE_URL}/reports/${encodeURIComponent(domain)}`;
  }

  function withTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
  }

  function createElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === "string") node.textContent = text;
    return node;
  }

  function readMode(container) {
    const mode = (container.getAttribute("data-agentability-style") || "card").toLowerCase();
    return mode === "inline" ? "inline" : "card";
  }

  function readTheme(container) {
    const theme = (container.getAttribute("data-agentability-theme") || "light").toLowerCase();
    return theme === "night" ? "night" : "light";
  }

  function shouldOpenNewTab(container) {
    const value = (container.getAttribute("data-agentability-target") || "_blank").toLowerCase();
    return value !== "_self";
  }

  function renderLoading(container, theme) {
    container.innerHTML = "";
    const root = createElement("div", `ab-widget-root ${theme === "night" ? "ab-theme-night" : ""}`);
    const loading = createElement("div", "ab-widget-loading", "Loading Agentability score...");
    root.appendChild(loading);
    container.appendChild(root);
  }

  function renderError(container, domain, theme) {
    container.innerHTML = "";
    const root = createElement("div", `ab-widget-root ${theme === "night" ? "ab-theme-night" : ""}`);
    const link = createElement("a", "ab-widget-link");
    link.href = `${BASE_URL}/?origin=${encodeURIComponent(`https://${domain}`)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const error = createElement("div", "ab-widget-error");
    error.textContent = `No public Agentability report yet for ${domain}. Run a free audit.`;
    link.appendChild(error);
    root.appendChild(link);
    container.appendChild(root);
  }

  function renderWidget(container, domain, data, mode, theme, openNewTab) {
    container.innerHTML = "";

    const root = createElement("div", `ab-widget-root ${theme === "night" ? "ab-theme-night" : ""}`);
    const link = createElement("a", "ab-widget-link");
    link.href = buildReportUrl(domain);
    if (openNewTab) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }

    const shellClass = mode === "inline" ? "ab-widget-inline" : "ab-widget-card";
    const shell = createElement("div", shellClass);

    const head = createElement("div", "ab-widget-head");
    const idBlock = createElement("div");
    const domainNode = createElement("p", "ab-widget-domain", domain);
    const brand = createElement("p", "ab-widget-brand", "Agentability");
    idBlock.appendChild(domainNode);
    if (mode !== "inline") idBlock.appendChild(brand);

    const gradeNode = createElement("span", `ab-widget-grade ${scoreTone(data.score)}`);
    gradeNode.textContent = `${data.grade || "N/A"} Grade`;
    head.appendChild(idBlock);
    head.appendChild(gradeNode);
    shell.appendChild(head);

    const scoreNode = createElement("div", "ab-widget-score", `${Math.max(0, data.score)}/100`);
    shell.appendChild(scoreNode);

    const subNode = createElement("div", "ab-widget-sub", formatDate(data.completedAt || data.createdAt));
    shell.appendChild(subNode);

    if (mode !== "inline") {
      const bar = createElement("div", "ab-widget-bar");
      const fill = createElement("div", "ab-widget-bar-fill");
      fill.style.width = `${Math.max(0, Math.min(100, data.score || 0))}%`;
      bar.appendChild(fill);
      shell.appendChild(bar);
    }

    link.appendChild(shell);
    root.appendChild(link);
    container.appendChild(root);
  }

  async function hydrate(container) {
    const domain = normalizeDomain(container.getAttribute("data-agentability-domain"));
    const mode = readMode(container);
    const theme = readTheme(container);
    const openNewTab = shouldOpenNewTab(container);

    if (!domain) {
      renderError(container, "unknown", theme);
      return;
    }

    renderLoading(container, theme);

    try {
      const response = await withTimeout(buildEndpoint(domain), 7000);
      if (!response.ok) {
        renderError(container, domain, theme);
        return;
      }
      const data = await response.json();
      if (typeof data?.score !== "number") {
        renderError(container, domain, theme);
        return;
      }
      renderWidget(container, domain, data, mode, theme, openNewTab);
    } catch {
      renderError(container, domain, theme);
    }
  }

  function init(selector) {
    ensureStyles();
    const targets = document.querySelectorAll(selector || WIDGET_SELECTOR);
    targets.forEach((container) => {
      if (!(container instanceof HTMLElement)) return;
      if (container.dataset[PROCESSED_FLAG] === "1") return;
      container.dataset[PROCESSED_FLAG] = "1";
      void hydrate(container);
    });
  }

  window.AgentabilityWidget = {
    init,
    version: "1.0.0",
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init());
  } else {
    init();
  }
})();
