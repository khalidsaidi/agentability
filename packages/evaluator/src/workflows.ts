import type { CheckResult, PriorityFix, SiteType, WorkflowAnalysis, WorkflowOutcome } from "@agentability/shared";

export const SITE_DEFAULT_WORKFLOWS: Record<SiteType, readonly string[]> = {
  marketing_site: [
    "Discover core product information quickly",
    "Find support and legal policies",
    "Verify stable public pages",
  ],
  docs_portal: [
    "Discover docs quickly",
    "Find setup guidance and troubleshooting",
    "Locate reference examples",
  ],
  api_product: [
    "Discover product docs and entrypoints",
    "Call a public API endpoint",
    "Run a reliable automated action",
  ],
  ai_native: [
    "Discover product docs and entrypoints",
    "Call a public API endpoint",
    "Run a reliable automated action",
  ],
};

export const DEFAULT_TARGET_WORKFLOWS = SITE_DEFAULT_WORKFLOWS.api_product;

const API_WORKFLOW_HINTS = [
  "api",
  "endpoint",
  "integration",
  "sync",
  "webhook",
  "tool",
  "automation",
  "action",
];

const DOCS_WORKFLOW_HINTS = [
  "docs",
  "documentation",
  "knowledge",
  "search",
  "assistant",
  "chat",
  "faq",
];

const RELIABILITY_WORKFLOW_HINTS = [
  "reliable",
  "consisten",
  "repeat",
  "determin",
  "stable",
];

const TRUST_WORKFLOW_HINTS = [
  "trust",
  "compliance",
  "legal",
  "secure",
  "safety",
  "policy",
  "privacy",
  "terms",
];

export type WorkflowProbeSignals = {
  endpointDiscovery: boolean;
  schemaBackedCall: boolean;
  deterministicHandshake: boolean;
  docsDiscovery: boolean;
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function defaultTargetWorkflows(siteType?: SiteType): readonly string[] {
  if (!siteType) return DEFAULT_TARGET_WORKFLOWS;
  return SITE_DEFAULT_WORKFLOWS[siteType];
}

export function normalizeTargetWorkflows(input?: string[], siteType?: SiteType): string[] {
  const cleaned = (input ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (!cleaned.length) {
    return [...defaultTargetWorkflows(siteType)];
  }
  return unique(cleaned);
}

export function inferRequiredChecks(workflow: string, siteType?: SiteType): string[] {
  const value = workflow.toLowerCase();
  const required = new Set<string>(["D1"]);

  if (API_WORKFLOW_HINTS.some((token) => value.includes(token))) {
    required.add("C2");
    required.add("C3");
    required.add("R3");
  }

  if (DOCS_WORKFLOW_HINTS.some((token) => value.includes(token))) {
    required.add("L1");
  }

  if (RELIABILITY_WORKFLOW_HINTS.some((token) => value.includes(token))) {
    required.add("R3");
  }

  if (TRUST_WORKFLOW_HINTS.some((token) => value.includes(token))) {
    required.add("T1");
  }

  if (!required.has("C2") && !required.has("L1")) {
    if (siteType === "marketing_site") {
      required.add("L1");
    } else if (siteType === "docs_portal") {
      required.add("L1");
      required.add("D2");
    } else if (siteType === "api_product" || siteType === "ai_native") {
      required.add("C2");
      required.add("L1");
      required.add("R3");
    } else {
      required.add("C2");
      required.add("L1");
    }
  }

  return [...required];
}

export function analyzeWorkflows(
  targetWorkflows: string[] | undefined,
  checks: CheckResult[],
  probes?: WorkflowProbeSignals,
  siteType?: SiteType
): WorkflowAnalysis {
  const workflows = normalizeTargetWorkflows(targetWorkflows, siteType);
  const byCheckId = new Map<string, CheckResult>(checks.map((check) => [check.id, check]));

  const outcomes: WorkflowOutcome[] = workflows.map((workflow) => {
    const requiredChecks = inferRequiredChecks(workflow, siteType);
    const blockerCheckIds: string[] = [];
    const warningCheckIds: string[] = [];

    for (const checkId of requiredChecks) {
      const check = byCheckId.get(checkId);
      if (!check) continue;
      if (check.status === "fail") {
        const downgradedByProbe =
          (checkId === "D1" && Boolean(probes?.docsDiscovery || probes?.endpointDiscovery)) ||
          (checkId === "C2" && Boolean(probes?.endpointDiscovery || probes?.schemaBackedCall)) ||
          (checkId === "C3" &&
            Boolean(
              probes?.deterministicHandshake ||
                ((siteType === "marketing_site" || siteType === "docs_portal") &&
                  (probes?.endpointDiscovery || probes?.schemaBackedCall || probes?.docsDiscovery))
            )) ||
          (checkId === "L1" && Boolean(probes?.docsDiscovery)) ||
          (checkId === "R3" && Boolean(probes?.schemaBackedCall || probes?.docsDiscovery));
        if (downgradedByProbe) {
          warningCheckIds.push(checkId);
          continue;
        }
        blockerCheckIds.push(checkId);
      }
      if (check.status === "warn") warningCheckIds.push(checkId);
    }

    const status = blockerCheckIds.length
      ? "blocked"
      : warningCheckIds.length
        ? "partial"
        : "ready";

    const estimatedImpact = blockerCheckIds.length * 15 + warningCheckIds.length * 7;

    return {
      workflow,
      status,
      blockerCheckIds,
      warningCheckIds,
      estimatedImpact,
    };
  });

  const readyCount = outcomes.filter((item) => item.status === "ready").length;
  const partialCount = outcomes.filter((item) => item.status === "partial").length;
  const blockedCount = outcomes.filter((item) => item.status === "blocked").length;
  const successRateRaw = outcomes.length ? (readyCount + partialCount * 0.5) / outcomes.length : 0;
  const successRate = Number(successRateRaw.toFixed(3));

  return {
    successRate,
    readyCount,
    partialCount,
    blockedCount,
    outcomes,
  };
}

export function rankPriorityFixes(
  checks: CheckResult[],
  workflowAnalysis: WorkflowAnalysis
): PriorityFix[] {
  const actionableChecks = checks.filter((check) => check.status !== "pass");
  const outcomeByCheck = new Map<string, { blocked: number; warning: number }>();

  for (const outcome of workflowAnalysis.outcomes) {
    for (const checkId of outcome.blockerCheckIds) {
      const current = outcomeByCheck.get(checkId) ?? { blocked: 0, warning: 0 };
      current.blocked += 1;
      outcomeByCheck.set(checkId, current);
    }
    for (const checkId of outcome.warningCheckIds) {
      const current = outcomeByCheck.get(checkId) ?? { blocked: 0, warning: 0 };
      current.warning += 1;
      outcomeByCheck.set(checkId, current);
    }
  }

  return actionableChecks
    .map((check) => {
      const impact = outcomeByCheck.get(check.id) ?? { blocked: 0, warning: 0 };
      const blockedWorkflows = impact.blocked + impact.warning;
      const baseGain = check.status === "fail" ? 12 : 6;
      const workflowMultiplier = Math.max(1, blockedWorkflows);
      const estimatedScoreGain = baseGain * workflowMultiplier;

      const rationale = blockedWorkflows
        ? `Improves ${blockedWorkflows} target workflow${blockedWorkflows === 1 ? "" : "s"}.`
        : "Improves baseline readiness signal.";

      return {
        checkId: check.id,
        status: check.status,
        blockedWorkflows,
        estimatedScoreGain,
        rationale,
      } satisfies PriorityFix;
    })
    .sort((a, b) => {
      if (b.estimatedScoreGain !== a.estimatedScoreGain) {
        return b.estimatedScoreGain - a.estimatedScoreGain;
      }
      if (b.blockedWorkflows !== a.blockedWorkflows) {
        return b.blockedWorkflows - a.blockedWorkflows;
      }
      return a.checkId.localeCompare(b.checkId);
    })
    .slice(0, 8);
}
