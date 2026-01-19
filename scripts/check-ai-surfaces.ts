import fs from "node:fs/promises";
import path from "node:path";

type AuditFile = {
  path?: string;
  sha256?: string;
  bytes?: number;
};

type DiscoveryAudit = {
  files?: AuditFile[];
};

const requiredPaths = [
  "/.well-known/air.json",
  "/.well-known/openapi.json",
  "/.well-known/openapi.yaml",
  "/.well-known/ai-plugin.json",
  "/openapi.json",
  "/openapi.yaml",
  "/llms.txt",
  "/llms-full.txt",
  "/docs.md",
  "/docs/api.md",
  "/spec.md",
  "/status.md",
  "/legal/terms.md",
  "/legal/privacy.md",
  "/discovery/audit/index.html",
  "/robots.txt",
  "/sitemap.xml",
  "/rss.xml",
  "/logo.png",
  "/og.png",
];

const llmsRequired = [
  "Product: Agentability",
  "Start here: https://agentability.org",
  "API: https://agentability.org/v1",
  "MCP: https://agentability.org/mcp",
  "OpenAPI: https://agentability.org/.well-known/openapi.json",
  "Manifest: https://agentability.org/.well-known/air.json",
  "https://agentability.org/discovery/audit/latest.json",
  "https://agentability.org/reports/{domain}",
  "https://agentability.org/v1/evaluations/{domain}/latest.json",
  "https://agentability.org/spec.md",
];

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const publicDir = path.join(repoRoot, "apps/web/public");
  const errors: string[] = [];

  const auditPath = path.join(publicDir, "discovery/audit/latest.json");
  if (!(await fileExists(auditPath))) {
    errors.push("Missing discovery audit latest.json");
  }

  let audit: DiscoveryAudit | null = null;
  if (await fileExists(auditPath)) {
    const auditRaw = await fs.readFile(auditPath, "utf8");
    audit = JSON.parse(auditRaw);
  }

  const auditPaths = new Set((audit?.files ?? []).map((file) => file.path).filter(Boolean) as string[]);

  for (const surfacePath of requiredPaths) {
    const absPath = path.join(publicDir, surfacePath.replace(/^\//, ""));
    if (!(await fileExists(absPath))) {
      errors.push(`Missing required file: ${surfacePath}`);
    }
    if (audit && !auditPaths.has(surfacePath)) {
      errors.push(`Audit missing surface: ${surfacePath}`);
    }
  }

  const openapiPath = path.join(publicDir, ".well-known/openapi.json");
  if (await fileExists(openapiPath)) {
    try {
      const openapiRaw = await fs.readFile(openapiPath, "utf8");
      const openapi = JSON.parse(openapiRaw);
      if (!openapi.openapi || !openapi.info) {
        errors.push("OpenAPI JSON missing required fields");
      }
    } catch (error) {
      errors.push("OpenAPI JSON failed to parse");
    }
  }

  const llmsPath = path.join(publicDir, "llms.txt");
  if (await fileExists(llmsPath)) {
    const llmsText = await fs.readFile(llmsPath, "utf8");
    for (const required of llmsRequired) {
      if (!llmsText.includes(required)) {
        errors.push(`llms.txt missing: ${required}`);
      }
    }
  }

  const llmsFullPath = path.join(publicDir, "llms-full.txt");
  if (await fileExists(llmsFullPath)) {
    const llmsFullText = await fs.readFile(llmsFullPath, "utf8");
    for (const required of llmsRequired) {
      if (!llmsFullText.includes(required)) {
        errors.push(`llms-full.txt missing: ${required}`);
      }
    }
    const fullRequiredSections = ["How to use the API", "Pillars", "SSRF"];
    for (const required of fullRequiredSections) {
      if (!llmsFullText.includes(required)) {
        errors.push(`llms-full.txt missing section: ${required}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error("AI surface checks failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("AI surface checks passed.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("AI surface checks failed:", error);
    process.exit(1);
  });
}
