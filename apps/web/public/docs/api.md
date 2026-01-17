# Agentability API (Public Mode)

Base URL: https://agentability.org

## POST /v1/evaluate

Request:

```
{
  "origin": "https://example.com",
  "profile": "auto"
}
```

Response (running):

```
{
  "runId": "...",
  "status": "running",
  "reportUrl": "https://agentability.org/reports/example.com",
  "jsonUrl": "https://agentability.org/v1/evaluations/example.com/latest.json",
  "statusUrl": "https://agentability.org/v1/runs/...",
  "domain": "example.com"
}
```

Response (complete): same shape with status "complete".

Errors:

```
{
  "message": "Invalid request",
  "code": "invalid_request",
  "details": { "fields": { "origin": "Origin must be a valid URL" } }
}
```

## GET /v1/runs/{runId}

Returns the latest run state. When complete, it returns a full evaluation result.

## GET /v1/evaluations/{domain}/latest.json

Returns the most recent evaluation for a domain.

## POST /mcp

MCP JSON-RPC endpoint. Example tool call:

```
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "evaluate_site",
    "arguments": {
      "origin": "https://example.com",
      "profile": "auto"
    }
  }
}
```

OpenAPI: https://agentability.org/.well-known/openapi.json
