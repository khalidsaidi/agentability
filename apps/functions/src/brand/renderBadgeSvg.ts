export type BadgeInput = {
  domain: string;
  score?: number | null;
  grade?: string | null;
  updatedAtISO?: string | null;
  statusLabel?: string | null;
};

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "\"":
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return char;
    }
  });
}

export function renderBadgeSvg({
  domain,
  score,
  grade,
  updatedAtISO,
  statusLabel,
}: BadgeInput): string {
  const left = "Agentability";
  const right =
    statusLabel ?? (score == null ? "Not evaluated" : `Score ${score}${grade ? ` (${grade})` : ""}`);
  const date = updatedAtISO ? updatedAtISO.slice(0, 10) : "";
  const sub = date ? `updated ${date}` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="28" viewBox="0 0 420 28" role="img" aria-label="${escapeXml(left)}: ${escapeXml(right)}">
  <rect x="0" y="0" width="420" height="28" rx="6" fill="#0b0f19"/>
  <rect x="0" y="0" width="160" height="28" rx="6" fill="#111827"/>
  <rect x="156" y="0" width="264" height="28" rx="6" fill="#0b0f19"/>

  <g transform="translate(10,5)" fill="none" stroke="#e5e7eb" stroke-width="1.8" stroke-linejoin="round">
    <path d="M10 0l8 4v6c0 5-3 9-8 12C5 19 2 15 2 10V4l8-4z"/>
    <path d="M5.2 10.5l2.2 2.2 6-6.2" stroke-linecap="round"/>
  </g>

  <text x="40" y="18" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
        font-size="12" fill="#e5e7eb" font-weight="700" letter-spacing=".2">${escapeXml(left)}</text>

  <text x="170" y="18" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
        font-size="12" fill="#e5e7eb" font-weight="600">${escapeXml(right)}</text>

  ${sub ? `<text x="410" y="18" text-anchor="end"
        font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
        font-size="10" fill="#9ca3af">${escapeXml(sub)}</text>` : ""}

  <title>${escapeXml(domain)}</title>
</svg>`;
}
