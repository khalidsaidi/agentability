import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type Surface = {
  path: string;
  expectedContentType: string;
};

type AuditFile = {
  path: string;
  expected_content_type: string;
  bytes: number;
  sha256: string;
  live_status?: number;
  live_content_type?: string;
  live_ok?: boolean;
  live_error?: string;
  live_checks?: {
    base_url: string;
    status: number;
    content_type?: string;
    ok: boolean;
    error?: string;
    sha256?: string;
    bytes?: number;
  }[];
  live_sha256?: string;
  live_bytes?: number;
  live_hash_match?: boolean;
};

type DiscoveryAudit = {
  generated_at: string;
  live_checked_at?: string;
  spec_version: string;
  engine: {
    name: string;
    version: string;
  };
  score_target: number;
  discoverability_health: {
    status: "pass" | "fail";
    missing: string[];
    unreachable: string[];
    hash_mismatch: string[];
  };
  live_sources: string[];
  files: AuditFile[];
};

const requiredSurfaces: Surface[] = [
  { path: "/.well-known/air.json", expectedContentType: "application/json; charset=utf-8" },
  { path: "/.well-known/openapi.json", expectedContentType: "application/json; charset=utf-8" },
  { path: "/.well-known/openapi.yaml", expectedContentType: "text/yaml; charset=utf-8" },
  { path: "/.well-known/ai-plugin.json", expectedContentType: "application/json; charset=utf-8" },
  { path: "/openapi.json", expectedContentType: "application/json; charset=utf-8" },
  { path: "/openapi.yaml", expectedContentType: "text/yaml; charset=utf-8" },
  { path: "/llms.txt", expectedContentType: "text/plain; charset=utf-8" },
  { path: "/llms-full.txt", expectedContentType: "text/plain; charset=utf-8" },
  { path: "/docs.md", expectedContentType: "text/markdown; charset=utf-8" },
  { path: "/docs/api.md", expectedContentType: "text/markdown; charset=utf-8" },
  { path: "/spec.md", expectedContentType: "text/markdown; charset=utf-8" },
  { path: "/status.md", expectedContentType: "text/markdown; charset=utf-8" },
  { path: "/legal/terms.md", expectedContentType: "text/markdown; charset=utf-8" },
  { path: "/legal/privacy.md", expectedContentType: "text/markdown; charset=utf-8" },
  { path: "/discovery/audit/index.html", expectedContentType: "text/html; charset=utf-8" },
  { path: "/robots.txt", expectedContentType: "text/plain; charset=utf-8" },
  { path: "/sitemap.xml", expectedContentType: "application/xml; charset=utf-8" },
  { path: "/rss.xml", expectedContentType: "application/rss+xml; charset=utf-8" },
  { path: "/logo.png", expectedContentType: "image/png" },
  { path: "/og.png", expectedContentType: "image/png" },
];

function toSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function contentTypeMatches(expected: string, actual: string | null | undefined): boolean {
  if (!actual) return false;
  const expectedLower = expected.toLowerCase();
  const actualLower = actual.toLowerCase();
  if (expectedLower === actualLower) return true;
  const expectedType = expectedLower.split(";")[0]?.trim();
  const actualType = actualLower.split(";")[0]?.trim();
  if (!expectedType || expectedType !== actualType) return false;
  if (expectedLower.includes("charset=")) {
    const expectedCharset = expectedLower.split("charset=")[1]?.trim();
    return expectedCharset ? actualLower.includes(`charset=${expectedCharset}`) : true;
  }
  return true;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

function buildIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agentability Discovery Audit</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; margin: 2rem; color: #0f172a; }
    .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.5rem; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); }
    h1 { margin: 0 0 0.5rem; }
    a { color: #0f766e; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Discovery Audit</h1>
    <p>Machine-readable JSON: <a href="./latest.json">latest.json</a></p>
    <pre id="audit"></pre>
  </div>
  <script>
    fetch("./latest.json")
      .then((response) => response.json())
      .then((audit) => {
        document.getElementById("audit").textContent = JSON.stringify(audit, null, 2);
      })
      .catch((error) => {
        document.getElementById("audit").textContent = "Failed to load audit JSON.";
      });
  </script>
</body>
</html>
`;
}

export async function generateDiscoveryAudit(repoRoot = process.cwd()): Promise<DiscoveryAudit> {
  const publicDir = path.join(repoRoot, "apps/web/public");
  const auditDir = path.join(publicDir, "discovery/audit");
  await fs.mkdir(auditDir, { recursive: true });
  const baseUrls = (process.env.DISCOVERY_AUDIT_BASE_URLS ?? "https://agentability.org,https://agentability-prod-jenfjn.web.app,https://agentability-prod-jenfjn.firebaseapp.com")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const htmlPath = path.join(auditDir, "index.html");
  await fs.writeFile(htmlPath, buildIndexHtml(), "utf8");

  const packageJsonPath = path.join(repoRoot, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const engineVersion = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

  const files: AuditFile[] = [];
  const missing: string[] = [];
  const unreachable: string[] = [];
  const hashMismatch: string[] = [];
  const liveCheckedAt = new Date().toISOString();

  for (const surface of requiredSurfaces) {
    const relativePath = surface.path.replace(/^\//, "");
    const absolutePath = path.join(publicDir, relativePath);

    try {
      const buffer = await fs.readFile(absolutePath);
      const entry: AuditFile = {
        path: surface.path,
        expected_content_type: surface.expectedContentType,
        bytes: buffer.byteLength,
        sha256: toSha256(buffer),
      };
      const checks = await Promise.all(
        baseUrls.map(async (baseUrl) => {
          try {
            const response = await fetchWithTimeout(`${baseUrl}${surface.path}`, 8000);
            const contentType = response.headers.get("content-type") ?? undefined;
            const body = await response.arrayBuffer();
            const bytes = body.byteLength;
            const sha256 = toSha256(Buffer.from(body));
            return {
              base_url: baseUrl,
              status: response.status,
              content_type: contentType,
              ok: response.ok && contentTypeMatches(surface.expectedContentType, contentType),
              sha256,
              bytes,
            };
          } catch (error) {
            return {
              base_url: baseUrl,
              status: 0,
              ok: false,
              error: error instanceof Error ? error.message : "fetch_failed",
            };
          }
        })
      );
      entry.live_checks = checks;
      const primary = checks[0];
      if (primary) {
        entry.live_status = primary.status;
        entry.live_content_type = primary.content_type;
        entry.live_ok = primary.ok;
        entry.live_error = primary.error;
        entry.live_sha256 = primary.sha256;
        entry.live_bytes = primary.bytes;
      }
      if (checks.some((check) => !check.ok)) {
        unreachable.push(surface.path);
      }
      const liveHashes = checks.map((check) => check.sha256).filter(Boolean) as string[];
      if (liveHashes.length && new Set(liveHashes).size > 1) {
        entry.live_hash_match = false;
        hashMismatch.push(surface.path);
      } else if (liveHashes.length) {
        entry.live_hash_match = true;
      }
      files.push(entry);
    } catch (error) {
      missing.push(surface.path);
      const entry: AuditFile = {
        path: surface.path,
        expected_content_type: surface.expectedContentType,
        bytes: 0,
        sha256: "",
      };
      const checks = await Promise.all(
        baseUrls.map(async (baseUrl) => {
          try {
            const response = await fetchWithTimeout(`${baseUrl}${surface.path}`, 8000);
            const contentType = response.headers.get("content-type") ?? undefined;
            const body = await response.arrayBuffer();
            const bytes = body.byteLength;
            const sha256 = toSha256(Buffer.from(body));
            return {
              base_url: baseUrl,
              status: response.status,
              content_type: contentType,
              ok: response.ok && contentTypeMatches(surface.expectedContentType, contentType),
              sha256,
              bytes,
            };
          } catch (error) {
            return {
              base_url: baseUrl,
              status: 0,
              ok: false,
              error: error instanceof Error ? error.message : "fetch_failed",
            };
          }
        })
      );
      entry.live_checks = checks;
      const primary = checks[0];
      if (primary) {
        entry.live_status = primary.status;
        entry.live_content_type = primary.content_type;
        entry.live_ok = primary.ok;
        entry.live_error = primary.error;
        entry.live_sha256 = primary.sha256;
        entry.live_bytes = primary.bytes;
      }
      if (checks.some((check) => !check.ok)) {
        unreachable.push(surface.path);
      }
      const liveHashes = checks.map((check) => check.sha256).filter(Boolean) as string[];
      if (liveHashes.length && new Set(liveHashes).size > 1) {
        entry.live_hash_match = false;
        hashMismatch.push(surface.path);
      } else if (liveHashes.length) {
        entry.live_hash_match = true;
      }
      files.push(entry);
    }
  }

  const audit: DiscoveryAudit = {
    generated_at: new Date().toISOString(),
    live_checked_at: liveCheckedAt,
    spec_version: "1.0",
    engine: {
      name: "agentability",
      version: engineVersion,
    },
    score_target: 100,
    discoverability_health: {
      status: missing.length === 0 && unreachable.length === 0 ? "pass" : "fail",
      missing,
      unreachable,
      hash_mismatch: hashMismatch,
    },
    live_sources: baseUrls,
    files,
  };

  const auditPath = path.join(auditDir, "latest.json");
  await fs.writeFile(auditPath, JSON.stringify(audit, null, 2) + "\n", "utf8");

  return audit;
}

if (require.main === module) {
  generateDiscoveryAudit().catch((error) => {
    console.error("Discovery audit generation failed:", error);
    process.exit(1);
  });
}
