export type FixIt = {
  id: string;
  title: string;
  whyItMatters: string;
  steps: string[];
  snippet: string;
  links?: string[];
  estimatedMinutes?: number;
};

export const FIX_IT_LIBRARY: Record<string, FixIt> = {
  D1: {
    id: "D1",
    title: "Add machine discovery entrypoints",
    whyItMatters: "Agents need stable, machine-readable entrypoints to avoid scraping HTML.",
    estimatedMinutes: 15,
    steps: [
      "Publish /.well-known/air.json with product, entrypoints, legal, and verification fields.",
      "Publish /llms.txt and /llms-full.txt with canonical links.",
      "Ensure all entrypoints return 200 from static hosting.",
    ],
    snippet: `# .well-known/air.json\n{\n  \"spec_version\": \"1.2\",\n  \"canonical_base_url\": \"https://example.com\",\n  \"product\": {\"name\": \"Example\", \"description\": \"...\", \"home_url\": \"https://example.com\"},\n  \"entrypoints\": {\"web_app\": \"https://example.com\", \"api_base\": \"https://example.com/v1\"},\n  \"callable_surface\": {\"openapi\": \"https://example.com/.well-known/openapi.json\", \"mcp_endpoint\": \"https://example.com/mcp\"},\n  \"llm_entrypoints\": {\"llms_txt\": \"https://example.com/llms.txt\", \"llms_full_txt\": \"https://example.com/llms-full.txt\"},\n  \"legal\": {\"terms_url\": \"https://example.com/legal/terms\", \"privacy_url\": \"https://example.com/legal/privacy\"},\n  \"verification\": {\"discovery_audit_json\": \"https://example.com/discovery/audit/latest.json\"}\n}\n`,
    links: ["https://agentability.org/spec.md"],
  },
  D2: {
    id: "D2",
    title: "Serve entrypoints with correct content-types",
    whyItMatters: "Agents reject unstable or mis-typed surfaces (HTML where JSON is expected).",
    estimatedMinutes: 10,
    steps: [
      "Serve JSON/YAML/Markdown with explicit Content-Type headers.",
      "Avoid SPA rewrites for machine surfaces.",
      "Use caching headers to stabilize responses.",
    ],
    snippet: `# Firebase Hosting headers example\n{\n  \"source\": \"/.well-known/*.json\",\n  \"headers\": [{\"key\": \"Content-Type\", \"value\": \"application/json; charset=utf-8\"}]\n}\n`,
    links: ["https://agentability.org/spec.md"],
  },
  C2: {
    id: "C2",
    title: "Publish an example-rich OpenAPI",
    whyItMatters: "Callable APIs need examples and clear servers to be usable by agents.",
    estimatedMinutes: 20,
    steps: [
      "Publish OpenAPI JSON/YAML under /.well-known/.",
      "Include servers pointing to your domain.",
      "Add response examples for critical endpoints.",
    ],
    snippet: `openapi: 3.1.0\ninfo:\n  title: Example API\n  version: 1.0.0\nservers:\n  - url: https://example.com\npaths:\n  /v1/status:\n    get:\n      responses:\n        \"200\":\n          content:\n            application/json:\n              examples:\n                ok:\n                  value: {\"status\": \"ok\"}\n`,
    links: ["https://agentability.org/spec.md"],
  },
  C3: {
    id: "C3",
    title: "Expose an MCP endpoint",
    whyItMatters: "MCP provides a direct tool surface for agents beyond HTTP scraping.",
    estimatedMinutes: 30,
    steps: [
      "Expose POST /mcp for JSON-RPC 2.0.",
      "Implement initialize and tools/list.",
      "Return helpful guidance on GET /mcp.",
    ],
    snippet: `POST /mcp\n{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"method\": \"initialize\",\n  \"params\": {\"protocolVersion\": \"2024-11-05\"}\n}\n`,
    links: ["https://agentability.org/spec.md"],
  },
  L1: {
    id: "L1",
    title: "Publish canonical docs entrypoints",
    whyItMatters: "Agents need stable, linkable documentation for ingestion.",
    estimatedMinutes: 15,
    steps: [
      "Publish /docs.md with a concise product overview.",
      "Link to deeper docs like /docs/api.md.",
      "Keep markdown clean and stable.",
    ],
    snippet: `# docs.md\n\n## Quickstart\n- Base URL: https://example.com\n- OpenAPI: https://example.com/.well-known/openapi.json\n- MCP: https://example.com/mcp\n`,
    links: ["https://agentability.org/spec.md"],
  },
  T1: {
    id: "T1",
    title: "Complete air.json with legal + verification",
    whyItMatters: "Trust requires machine-readable provenance and legal endpoints.",
    estimatedMinutes: 10,
    steps: [
      "Add canonical_base_url and contact.email.",
      "Include legal terms + privacy URLs.",
      "Include verification discovery audit URLs.",
    ],
    snippet: `{\n  \"canonical_base_url\": \"https://example.com\",\n  \"contact\": {\n    \"email\": \"support@example.com\"\n  },\n  \"legal\": {\n    \"terms_url\": \"https://example.com/legal/terms\",\n    \"privacy_url\": \"https://example.com/legal/privacy\"\n  }\n}\n`,
    links: ["https://agentability.org/spec.md"],
  },
  T2: {
    id: "T2",
    title: "Add an AI plugin manifest",
    whyItMatters: "Plugin manifests provide a standard, trusted handshake for tools.",
    estimatedMinutes: 15,
    steps: [
      "Publish /.well-known/ai-plugin.json.",
      "Point to OpenAPI and legal URLs.",
      "Include contact_email.",
    ],
    snippet: `{\n  \"schema_version\": \"v1\",\n  \"name_for_model\": \"example\",\n  \"api\": {\"type\": \"openapi\", \"url\": \"https://example.com/.well-known/openapi.json\"},\n  \"contact_email\": \"support@example.com\",\n  \"legal_info_url\": \"https://example.com/legal/terms\"\n}\n`,
    links: ["https://agentability.org/spec.md"],
  },
  R3: {
    id: "R3",
    title: "Stabilize critical surfaces",
    whyItMatters: "Agents need repeatable responses for deterministic tool use.",
    estimatedMinutes: 20,
    steps: [
      "Avoid dynamic timestamps in core discovery surfaces.",
      "Use caching headers for stability.",
      "Verify repeated fetches are consistent.",
    ],
    snippet: `Cache-Control: public, max-age=3600\nETag: \"<stable-hash>\"\n`,
    links: ["https://agentability.org/spec.md"],
  },
};

export function getFixIt(checkId?: string, recommendationId?: string): FixIt | null {
  const key = recommendationId || checkId;
  if (!key) return null;
  return FIX_IT_LIBRARY[key] ?? null;
}
