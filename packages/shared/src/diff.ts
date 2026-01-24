import type {
  CheckResult,
  CheckStatus,
  DiffChange,
  DiffIssue,
  DiffSummary,
  PillarScores,
} from "./index";

export type DiffInput = {
  score: number;
  grade: string;
  pillarScores: PillarScores;
  checks: CheckResult[];
};

const STATUS_ORDER: Record<CheckStatus, number> = {
  pass: 0,
  warn: 1,
  fail: 2,
};

function countStatuses(checks: CheckResult[]): DiffSummary["counts"] {
  return checks.reduce(
    (acc, check) => {
      acc[check.status] += 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 }
  );
}

export function computeDiff(previous: DiffInput | null, current: DiffInput): DiffSummary | null {
  if (!previous) return null;

  const previousById = new Map(previous.checks.map((check) => [check.id, check]));
  const newIssues: DiffIssue[] = [];
  const fixedIssues: DiffIssue[] = [];
  const changed: DiffChange[] = [];

  for (const check of current.checks) {
    const before = previousById.get(check.id);
    const from = before?.status ?? null;
    const to = check.status;
    if (from === to) continue;

    const regression =
      (from === null || from === "pass") && (to === "warn" || to === "fail");
    const escalated = from === "warn" && to === "fail";
    const improved =
      (from === "warn" || from === "fail") && to === "pass";
    const softened = from === "fail" && to === "warn";

    if (regression || escalated) {
      newIssues.push({
        checkId: check.id,
        from,
        to,
        severity: check.severity,
      });
      continue;
    }

    if (improved || softened) {
      fixedIssues.push({
        checkId: check.id,
        from,
        to,
        severity: before?.severity ?? check.severity,
      });
      continue;
    }

    changed.push({ checkId: check.id, from, to });
  }

  return {
    scoreDelta: current.score - previous.score,
    gradeFrom: previous.grade,
    gradeTo: current.grade,
    pillarDelta: {
      discovery: current.pillarScores.discovery - previous.pillarScores.discovery,
      callableSurface:
        current.pillarScores.callableSurface - previous.pillarScores.callableSurface,
      llmIngestion: current.pillarScores.llmIngestion - previous.pillarScores.llmIngestion,
      trust: current.pillarScores.trust - previous.pillarScores.trust,
      reliability: current.pillarScores.reliability - previous.pillarScores.reliability,
    },
    newIssues,
    fixedIssues,
    changed,
    counts: countStatuses(current.checks),
  };
}

export function compareStatus(from: CheckStatus, to: CheckStatus): number {
  return STATUS_ORDER[to] - STATUS_ORDER[from];
}
