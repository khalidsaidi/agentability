import type { CheckResult, EvaluationFramework, FixPack, FixPackFile } from "@agentability/shared";

type BuildFixPackArgs = {
  framework?: EvaluationFramework;
  domain: string;
  checks: CheckResult[];
  targetWorkflows: string[];
};

function publicDirectoryForFramework(framework: EvaluationFramework): string {
  switch (framework) {
    case "fastapi":
      return "app/static";
    case "nextjs":
    case "rails":
    case "express":
    case "generic":
    default:
      return "public";
  }
}

function mcpFileForFramework(framework: EvaluationFramework): FixPackFile {
  switch (framework) {
    case "nextjs":
      return {
        path: "app/api/mcp/route.ts",
        description: "MCP JSON-RPC route for initialize and tools/list in Next.js App Router.",
        contents: `import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  return new Response("POST JSON-RPC to /api/mcp", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
  }
  if (body.method === "initialize") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "example", version: "1.0.0" },
        capabilities: { tools: {} },
      },
    });
  }
  if (body.method === "tools/list") {
    return NextResponse.json({ jsonrpc: "2.0", id: body.id ?? null, result: { tools: [] } });
  }
  return NextResponse.json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32601, message: "Method not found" } });
}
`,
      };
    case "fastapi":
      return {
        path: "app/main.py",
        description: "FastAPI MCP endpoint skeleton.",
        contents: `from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse

app = FastAPI()

@app.get("/mcp")
async def mcp_info():
    return PlainTextResponse("POST JSON-RPC to /mcp")

@app.post("/mcp")
async def mcp(request: Request):
    payload = await request.json()
    method = payload.get("method")
    rpc_id = payload.get("id")
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "serverInfo": {"name": "example", "version": "1.0.0"},
                "capabilities": {"tools": {}},
            },
        }
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": rpc_id, "result": {"tools": []}}
    return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": -32601, "message": "Method not found"}}
`,
      };
    case "rails":
      return {
        path: "config/routes.rb",
        description: "Rails route additions for MCP endpoint.",
        contents: `Rails.application.routes.draw do
  get  "/mcp", to: "mcp#show"
  post "/mcp", to: "mcp#create"
end
`,
      };
    case "express":
    case "generic":
    default:
      return {
        path: "server/mcp.js",
        description: "Express MCP endpoint skeleton.",
        contents: `export function registerMcp(app) {
  app.get("/mcp", (_req, res) => {
    res.type("text/plain").send("POST JSON-RPC to /mcp");
  });

  app.post("/mcp", (req, res) => {
    const payload = req.body ?? {};
    const method = payload.method;
    const id = payload.id ?? null;
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "example", version: "1.0.0" },
          capabilities: { tools: {} },
        },
      });
    }
    if (method === "tools/list") {
      return res.json({ jsonrpc: "2.0", id, result: { tools: [] } });
    }
    return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  });
}
`,
      };
  }
}

function renderAirJson(domain: string): string {
  return `{
  "spec_version": "1.2",
  "canonical_base_url": "https://${domain}",
  "product": {
    "name": "Example Product",
    "description": "Public AI-ready surface.",
    "home_url": "https://${domain}"
  },
  "contact": { "email": "support@${domain}" },
  "legal": {
    "terms_url": "https://${domain}/legal/terms",
    "privacy_url": "https://${domain}/legal/privacy"
  },
  "entrypoints": {
    "web_app": "https://${domain}",
    "api_base": "https://${domain}/v1"
  },
  "callable_surface": {
    "openapi": "https://${domain}/.well-known/openapi.json",
    "mcp_endpoint": "https://${domain}/mcp"
  },
  "llm_entrypoints": {
    "llms_txt": "https://${domain}/llms.txt",
    "llms_full_txt": "https://${domain}/llms-full.txt"
  },
  "verification": {
    "discovery_audit_json": "https://${domain}/discovery/audit/latest.json",
    "discovery_audit_html": "https://${domain}/discovery/audit"
  }
}
`;
}

function renderAiPlugin(domain: string): string {
  return `{
  "schema_version": "v1",
  "name_for_human": "Example",
  "name_for_model": "example",
  "description_for_human": "Agent integration surface.",
  "description_for_model": "Provides API + docs for tool usage.",
  "auth": { "type": "none" },
  "api": {
    "type": "openapi",
    "url": "https://${domain}/.well-known/openapi.json",
    "is_user_authenticated": false
  },
  "logo_url": "https://${domain}/logo.svg",
  "contact_email": "support@${domain}",
  "legal_url": "https://${domain}/legal/terms",
  "legal_info_url": "https://${domain}/legal/terms"
}
`;
}

function renderOpenApi(domain: string): string {
  return `openapi: 3.1.0
info:
  title: Example API
  version: 1.0.0
servers:
  - url: https://${domain}
paths:
  /v1/health:
    get:
      operationId: getHealth
      responses:
        "200":
          description: Service health
          content:
            application/json:
              examples:
                ok:
                  value:
                    status: ok
`;
}

function renderDocs(targetWorkflows: string[]): string {
  const workflowBullets = targetWorkflows.map((workflow) => `- ${workflow}`).join("\n");
  return `# Agent Integration Guide

## Top Workflows
${workflowBullets}

## Quickstart
- Base URL: https://example.com/v1
- OpenAPI: https://example.com/.well-known/openapi.json
- MCP: https://example.com/mcp
`;
}

export function buildFixPack(args: BuildFixPackArgs): FixPack {
  const framework = args.framework ?? "generic";
  const publicDir = publicDirectoryForFramework(framework);
  const nonPassingIds = new Set(args.checks.filter((check) => check.status !== "pass").map((check) => check.id));
  const files: FixPackFile[] = [];

  if (nonPassingIds.has("D1") || nonPassingIds.has("T1")) {
    files.push({
      path: `${publicDir}/.well-known/air.json`,
      description: "Machine-readable manifest for discovery, legal metadata, and callable surfaces.",
      contents: renderAirJson(args.domain),
    });
  }

  if (nonPassingIds.has("T2")) {
    files.push({
      path: `${publicDir}/.well-known/ai-plugin.json`,
      description: "Plugin metadata including legal and contact fields.",
      contents: renderAiPlugin(args.domain),
    });
  }

  if (nonPassingIds.has("C2")) {
    files.push({
      path: `${publicDir}/.well-known/openapi.yaml`,
      description: "OpenAPI surface with response examples.",
      contents: renderOpenApi(args.domain),
    });
  }

  if (nonPassingIds.has("L1")) {
    files.push({
      path: `${publicDir}/docs.md`,
      description: "Canonical docs entrypoint for LLM ingestion.",
      contents: renderDocs(args.targetWorkflows),
    });
  }

  if (nonPassingIds.has("C3")) {
    files.push(mcpFileForFramework(framework));
  }

  if (!files.length) {
    files.push({
      path: "docs/agentability-maintenance.md",
      description: "Maintenance checklist for preserving current readiness.",
      contents: `# Agentability Maintenance\n\n- Re-run readiness checks in CI.\n- Keep OpenAPI examples up to date.\n- Monitor workflow success trends weekly.\n`,
    });
  }

  return {
    framework,
    generatedAt: new Date().toISOString(),
    files,
  };
}
