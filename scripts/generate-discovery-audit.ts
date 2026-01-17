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
};

type DiscoveryAudit = {
  generated_at: string;
  spec_version: string;
  engine: {
    name: string;
    version: string;
  };
  score_target: number;
  discoverability_health: {
    status: "pass" | "fail";
    missing: string[];
  };
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

  const htmlPath = path.join(auditDir, "index.html");
  await fs.writeFile(htmlPath, buildIndexHtml(), "utf8");

  const packageJsonPath = path.join(repoRoot, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const engineVersion = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

  const files: AuditFile[] = [];
  const missing: string[] = [];

  for (const surface of requiredSurfaces) {
    const relativePath = surface.path.replace(/^\//, "");
    const absolutePath = path.join(publicDir, relativePath);

    try {
      const buffer = await fs.readFile(absolutePath);
      files.push({
        path: surface.path,
        expected_content_type: surface.expectedContentType,
        bytes: buffer.byteLength,
        sha256: toSha256(buffer),
      });
    } catch (error) {
      missing.push(surface.path);
      files.push({
        path: surface.path,
        expected_content_type: surface.expectedContentType,
        bytes: 0,
        sha256: "",
      });
    }
  }

  const audit: DiscoveryAudit = {
    generated_at: new Date().toISOString(),
    spec_version: "1.0",
    engine: {
      name: "agentability",
      version: engineVersion,
    },
    score_target: 100,
    discoverability_health: {
      status: missing.length === 0 ? "pass" : "fail",
      missing,
    },
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
