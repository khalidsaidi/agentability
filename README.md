# Agentability

Agentability is an open-source, public-mode evaluator for agent readiness. It audits discoverability, callable surfaces,
LLM ingestion hygiene, trust signals, and reliability to produce shareable reports and evidence bundles.

Live: https://agentability.org
OpenAPI: https://agentability.org/.well-known/openapi.json
Manifest: https://agentability.org/.well-known/air.json
MCP: https://agentability.org/mcp

## Why this project exists

We want a transparent, community-owned standard for "agent readiness" that any product can run and improve against.
Agentability is open by design: the checks, scoring, and evidence format are public, and improvements from contributors
directly shape the ecosystem.

If you care about building agent-friendly APIs, docs, or tooling, this project is for you.

## What it does (Public Mode v1)

- Discovers machine entrypoints and docs across common locations.
- Runs deterministic checks (D1, D2, L1, R3) with evidence.
- Produces a shareable report URL and a stable JSON result.
- Enforces SSRF protection, timeouts, and size limits.

## Quickstart (local)

Requirements:
- Node 20+
- pnpm
- Firebase CLI (authenticated)

Install and run the web app:

```bash
pnpm install
pnpm build:artifacts
pnpm -C apps/web dev --host 0.0.0.0 --port 5174
```

To point the local UI to production API, create `apps/web/.env.local`:

```bash
VITE_API_BASE_URL=https://agentability.org
```

Optional: run Functions locally (uses Firebase emulators):

```bash
firebase emulators:start
```

## Run an evaluation

```bash
curl -X POST https://agentability.org/v1/evaluate \
  -H "Content-Type: application/json" \
  -d '{"origin":"https://example.com","profile":"auto"}'
```

You will receive a `runId` and URLs for the report and JSON result.

## MCP usage (tooling)

```bash
curl -X POST https://agentability.org/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "evaluate_site",
      "arguments": { "origin": "https://example.com" }
    }
  }'
```

## Project structure

```
apps/web          # React + Vite UI + static public surfaces
apps/functions    # Firebase Functions v2 API (SSR + evaluation endpoints)
packages/evaluator# Evaluation engine + SSRF-safe fetch
packages/shared   # Shared schemas and types
spec              # Public specs (OpenAPI source)
```

## Contributing

We actively welcome new collaborators. If you want to help, pick an area and open a PR:

- Add new checks or profiles to the evaluator
- Improve reporting clarity for non-technical users
- Harden SSRF and abuse controls
- Expand AI-native public surfaces and audits

Guidelines:
- No secrets in commits (ever).
- Keep generated artifacts out of git (`.ai/generated` is ignored).
- Run `pnpm check:ai` and `pnpm -C apps/functions build` before submitting.

If you plan a significant change, open an issue first so we can align.

## Security

Agentability fetches user-provided URLs and enforces strict SSRF protections:
- http/https only
- blocks private IP ranges after DNS resolution
- re-checks redirects
- timeouts and size limits

If you find a security issue, open a private report via GitHub Security Advisories.

## License

Apache-2.0. See `LICENSE`.
