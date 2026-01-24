# Agentability Spec (Public Mode v1.2)

Spec version: 1.2

## Scope

Public mode evaluates only public, unauthenticated surfaces (HTTP/HTTPS).

## Pillars

- Discovery: machine entrypoints and canonical documentation.
- Callable Surface: OpenAPI quality and callable affordances.
- LLM Ingestion: clean, linkable docs and manifests.
- Trust: attestations and provenance signals.
- Reliability: repeatability and stability under re-fetch.

## Required MVP Checks

- D1: Machine entrypoints exist.
- D2: Entrypoints reachable and stable across repeated fetches.
- L1: Canonical docs entrypoint exists with meaningful text.
- R3: Repeat-request consistency on critical surfaces.

## Scoring

Each check yields pass/warn/fail with weights per profile. Pillar scores sum into a total score.

## Output

Evaluation results are published at:
- https://agentability.org/v1/evaluations/{domain}/latest.json
- https://agentability.org/reports/{domain}
- https://agentability.org/badge/{domain}.svg
- https://agentability.org/cert/{domain}

Latest evaluation responses may include:
- previousRunId
- diff (score + pillar deltas, issue changes)
- previousSummary (prior score snapshot)

## SSRF Policy (Public Mode)

- Only HTTP/HTTPS allowed.
- Private IP ranges are blocked after DNS resolution.
- Redirects to private IPs are blocked.
- Timeouts and size limits enforced.
