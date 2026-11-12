/**
 * IT assistant statuses. Pure rules: how AI Builder's session statuses become the words the business
 * sees, and which AI Builder intent a request starts. No database access here.
 */

export type ItKindValue = "FEATURE" | "ERROR" | "FINDING";
export type ItStatusValue = "SUBMITTED" | "DRAFTING_SPEC" | "NEEDS_ANSWERS" | "SPEC_REVIEW" | "BUILDING" | "BUILD_FAILED" | "PR_OPEN" | "ACCEPTED" | "MERGED" | "LIVE" | "DEPLOY_FAILED" | "CLOSED" | "FAILED" | "PROPOSED" | "APPLIED";
export type AiIntent = "feature" | "bugfix" | "maintenance";

export const IT_KIND_LABEL: Record<ItKindValue, string> = {
  FEATURE: "Change request",
  ERROR: "Error",
  FINDING: "Security finding",
};

export const IT_STATUS_LABEL: Record<ItStatusValue, string> = {
  SUBMITTED: "Submitted",
  DRAFTING_SPEC: "Working out what to build",
  NEEDS_ANSWERS: "Needs your answers",
  SPEC_REVIEW: "Plan ready to approve",
  BUILDING: "Building",
  BUILD_FAILED: "Build needs attention",
  PR_OPEN: "Ready to try",
  ACCEPTED: "Accepted, merging",
  MERGED: "Merged, going live",
  LIVE: "Live",
  DEPLOY_FAILED: "Deploy failed",
  CLOSED: "Closed without changes",
  FAILED: "Failed",
  PROPOSED: "Fix prepared, waiting for review",
  APPLIED: "Fix applied - publish the workflow to make it live",
};

/** Nothing more happens to these; the sync stops looking at them. */
export const IT_TERMINAL: ItStatusValue[] = ["LIVE", "CLOSED", "APPLIED"];
export const isTerminal = (status: ItStatusValue): boolean => IT_TERMINAL.includes(status);

/** Merged: AI Builder's part is over and the deploy is what is followed now. */
export const IT_DEPLOY_PHASE: ItStatusValue[] = ["MERGED", "DEPLOY_FAILED"];
export const inDeployPhase = (status: ItStatusValue): boolean => IT_DEPLOY_PHASE.includes(status);

/** AI Builder session status -> ours. Unknown statuses (a newer AI Builder) read as FAILED rather than silently stalling. */
const SESSION_STATUS: Record<string, ItStatusValue> = {
  working: "DRAFTING_SPEC",
  awaiting_user: "NEEDS_ANSWERS",
  spec_review: "SPEC_REVIEW",
  // Approved but not buildable: the app has no git remote. Treated like a plan waiting for a developer.
  approved: "SPEC_REVIEW",
  building: "BUILDING",
  build_failed: "BUILD_FAILED",
  pr_open: "PR_OPEN",
  accepted: "ACCEPTED",
  merged: "MERGED",
  closed: "CLOSED",
  failed: "FAILED",
};

export function fromSessionStatus(sessionStatus: string): ItStatusValue {
  return SESSION_STATUS[sessionStatus] ?? "FAILED";
}

/**
 * What the business needs to do next, if anything. Drives the Tasks inbox and the "needs you" badge.
 * Automated requests never wait for answers: they go straight to building, and a person reviews the result.
 */
export function waitingOnPerson(status: ItStatusValue): string | null {
  switch (status) {
    case "NEEDS_ANSWERS":
      return "Answer the assistant's questions";
    case "SPEC_REVIEW":
      return "Approve the plan";
    case "PR_OPEN":
      return "Try the change and accept it";
    case "PROPOSED":
      return "Review the prepared fix in the workflow editor";
    case "BUILD_FAILED":
    case "DEPLOY_FAILED":
    case "FAILED":
      return "Ask a developer to take a look";
    default:
      return null;
  }
}

/** The AI Builder intent for a request. Errors and findings are automated; `override` lets a dependency finding use `maintenance`. */
export function intentFor(kind: ItKindValue, override?: AiIntent): AiIntent {
  if (override) return override;
  return kind === "FEATURE" ? "feature" : "bugfix";
}

/** The IT page's histories: what was asked for, what was fixed, and what the security scans found. */
export const IT_TABS = ["features", "fixes", "security"] as const;
export type ItTab = (typeof IT_TABS)[number];
export const IT_TAB_OF_KIND: Record<"FEATURE" | "ERROR" | "FINDING", ItTab> = { FEATURE: "features", ERROR: "fixes", FINDING: "security" };
