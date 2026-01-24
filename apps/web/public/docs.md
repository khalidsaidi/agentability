# Agentability Public Mode

Agentability evaluates public-facing agent readiness signals: discovery, callable surface quality, LLM ingestion clarity, trust, and reliability.

## Quickstart

1) Open https://agentability.org
2) Enter a URL (origin)
3) Run the audit

## Output

- Report UI: https://agentability.org/reports/{domain}
- Latest JSON: https://agentability.org/v1/evaluations/{domain}/latest.json
- Badge: https://agentability.org/badge/{domain}.svg
- Certificate: https://agentability.org/cert/{domain}

## API

- POST https://agentability.org/v1/evaluate
- GET  https://agentability.org/v1/runs/{runId}
- POST https://agentability.org/mcp (MCP JSON-RPC)
- GET  https://agentability.org/badge/{domain}.svg

See https://agentability.org/docs/api.md for full request and response details.

## Methodology

See https://agentability.org/spec.md for the public-mode scoring rules.
