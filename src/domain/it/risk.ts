/**
 * Risk tiers by file path (PLAN-it-assistant.md, Phase 4): advice for the person who accepts a change, from the files the
 * assistant changed. A change is higher risk when it touches money, quoting, sign-in and permissions, the database or the
 * code that runs workflows; anything else is lower risk. It is advice only: it never accepts, merges or holds a change.
 * Holding a change for a developer is the protected paths' job (guardrails.ts), and every protected file is higher risk too.
 *
 * To change what counts as higher risk, edit HIGH_RISK_RULES. Labels are shown to people, so keep them plain.
 */
import { normalisePath, PROTECTED_RULES } from "./guardrails";

export type RiskLevel = "LOW" | "HIGH";

export interface RiskRule {
  label: string;
  test: RegExp;
}

export const HIGH_RISK_RULES: RiskRule[] = [
  {
    label: "Money",
    test: /^(src\/domain\/(invoicing|pricing)\/|src\/integrations\/(stripe|payments)[^/]*$|app\/(invoices|pay|pricing)\/|app\/api\/stripe\/|src\/domain\/it\/(budget|credits|pricing)\.ts$)/,
  },
  { label: "Quoting", test: /^(src\/domain\/quotes\/|app\/quotes\/|app\/accept\/)/ },
  { label: "Sign-in and permissions", test: /^(app\/api\/auth\/|app\/auth\/|app\/admin\/|app\/connectors\/oauth\/|proxy\.ts$|src\/guard\.ts$|src\/access\.ts$)/ },
  { label: "Database", test: /^prisma\// },
  { label: "Workflows", test: /^(src\/(steps|automation|workflows)\/|src\/worker\.ts$|app\/(definitions|instances)\/)/ },
];

export interface ChangeRisk {
  level: RiskLevel;
  /** The higher-risk areas the change touches, named for people and sorted. Empty for a lower-risk change. */
  areas: string[];
}

/** The higher-risk area a file falls in, or null. Protected files and paths that climb out with ".." always count. */
export function riskArea(file: string): string | null {
  const f = normalisePath(file);
  if (!f) return null;
  if (f.split("/").includes("..")) return "Outside the project";
  return HIGH_RISK_RULES.find((r) => r.test.test(f))?.label ?? PROTECTED_RULES.find((r) => r.test.test(f))?.label ?? null;
}

/** How risky a change is, from the files it changed. Null when no files are known yet: no advice is better than a guess. */
export function changeRisk(files: readonly string[]): ChangeRisk | null {
  const known = files.map(normalisePath).filter(Boolean);
  if (known.length === 0) return null;
  const areas = [...new Set(known.map(riskArea).filter((a): a is string => a !== null))].sort();
  return { level: areas.length > 0 ? "HIGH" : "LOW", areas };
}

/** The advice in one plain sentence, for the activity trail and the accept panel. */
export function riskSentence(risk: ChangeRisk): string {
  if (risk.level === "LOW") return "Lower risk: it does not touch money, quoting, sign-in, the database or workflows.";
  return `Higher risk: it changes ${risk.areas.join(", ")}. Try those parts carefully in the preview before accepting.`;
}
