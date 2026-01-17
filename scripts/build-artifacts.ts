import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { parse } from "yaml";
import { generateDiscoveryAudit } from "./generate-discovery-audit";

function resolveBuildId(): string {
  const explicit = process.env.BUILD_ID;
  if (explicit) {
    return explicit;
  }
  const githubSha = process.env.GITHUB_SHA;
  if (githubSha) {
    return githubSha.slice(0, 12);
  }
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch (error) {
    return "dev";
  }
}

async function writeBuildStamp(publicDir: string, buildId: string): Promise<void> {
  const buildPath = path.join(publicDir, "build.txt");
  await fs.writeFile(buildPath, `${buildId}\n`, "utf8");
}

async function writeOpenApiArtifacts(repoRoot: string, publicDir: string): Promise<void> {
  const sourcePath = path.join(repoRoot, "spec/openapi.yaml");
  const yamlText = await fs.readFile(sourcePath, "utf8");
  const parsed = parse(yamlText);

  const wellKnownDir = path.join(publicDir, ".well-known");
  await fs.mkdir(wellKnownDir, { recursive: true });

  await fs.writeFile(path.join(wellKnownDir, "openapi.yaml"), yamlText, "utf8");
  await fs.writeFile(path.join(publicDir, "openapi.yaml"), yamlText, "utf8");

  const jsonText = JSON.stringify(parsed, null, 2) + "\n";
  await fs.writeFile(path.join(wellKnownDir, "openapi.json"), jsonText, "utf8");
  await fs.writeFile(path.join(publicDir, "openapi.json"), jsonText, "utf8");
}

function buildLlmsTxt(): string {
  return [
    "Product: Agentability",
    "What it does: Public-mode agent readiness evaluator.",
    "Start here: https://agentability.org",
    "API: https://agentability.org/v1",
    "MCP: https://agentability.org/mcp",
    "OpenAPI: https://agentability.org/.well-known/openapi.json",
    "Manifest: https://agentability.org/.well-known/air.json",
    "",
    "Verification:",
    "- https://agentability.org/discovery/audit/latest.json",
    "",
    "Reports:",
    "- https://agentability.org/reports/{domain}",
    "- https://agentability.org/v1/evaluations/{domain}/latest.json",
    "",
    "Spec:",
    "- https://agentability.org/spec.md",
    "",
  ].join("\n");
}

function buildLlmsFullTxt(): string {
  return [
    buildLlmsTxt().trimEnd(),
    "",
    "How to use the API:",
    "- POST https://agentability.org/v1/evaluate",
    "  {\"origin\":\"https://example.com\",\"profile\":\"auto\"}",
    "- Poll https://agentability.org/v1/runs/{runId} until status is complete",
    "- POST https://agentability.org/mcp (JSON-RPC)",
    "",
    "Pillars:",
    "- Discovery: machine entrypoints and canonical docs.",
    "- Callable Surface: usable OpenAPI and callable signals.",
    "- LLM Ingestion: clear, linkable documentation.",
    "- Trust: attestations and provenance signals.",
    "- Reliability: repeatability across fetches.",
    "",
    "Failures:",
    "- fail means missing or broken surface.",
    "- warn means partial coverage or unstable responses.",
    "",
    "SSRF and abuse protections:",
    "- Only http/https.",
    "- Private IP ranges blocked after DNS resolution.",
    "- Redirects re-checked for private IPs.",
    "- Timeouts and size limits enforced (15s, 2 MB).",
    "- Rate limits apply to public evaluate requests.",
    "",
  ].join("\n");
}

async function writeLlms(publicDir: string): Promise<void> {
  await fs.writeFile(path.join(publicDir, "llms.txt"), buildLlmsTxt(), "utf8");
  await fs.writeFile(path.join(publicDir, "llms-full.txt"), buildLlmsFullTxt(), "utf8");
}

async function updateFirebaseHeaders(repoRoot: string, buildId: string): Promise<void> {
  const firebasePath = path.join(repoRoot, "firebase.json");
  const raw = await fs.readFile(firebasePath, "utf8");
  const config = JSON.parse(raw);

  if (!config.hosting || !Array.isArray(config.hosting.headers)) {
    return;
  }

  for (const headerBlock of config.hosting.headers) {
    if (!Array.isArray(headerBlock.headers)) {
      continue;
    }
    for (const header of headerBlock.headers) {
      if (header.key === "X-Agentability-Build") {
        header.value = buildId;
      }
    }
  }

  await fs.writeFile(firebasePath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const publicDir = path.join(repoRoot, "apps/web/public");
  await fs.mkdir(publicDir, { recursive: true });

  const buildId = resolveBuildId();
  await writeBuildStamp(publicDir, buildId);
  await writeOpenApiArtifacts(repoRoot, publicDir);
  await writeLlms(publicDir);
  await generateDiscoveryAudit(repoRoot);
  await updateFirebaseHeaders(repoRoot, buildId);

  console.log(`Artifacts built for ${buildId}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Artifact build failed:", error);
    process.exit(1);
  });
}
