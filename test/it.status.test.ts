import { describe, expect, it } from "vitest";
import { delegatedRoleFor, fromSessionStatus, intentFor, isTerminal, IT_STATUS_LABEL, waitingOnPerson, type ItStatusValue } from "../src/domain/it";

describe("IT request status", () => {
  it("maps every AI Builder session status", () => {
    const expected: Record<string, ItStatusValue> = {
      working: "DRAFTING_SPEC",
      awaiting_user: "NEEDS_ANSWERS",
      spec_review: "SPEC_REVIEW",
      approved: "SPEC_REVIEW",
      building: "BUILDING",
      build_failed: "BUILD_FAILED",
      pr_open: "PR_OPEN",
      accepted: "ACCEPTED",
      merged: "MERGED",
      closed: "CLOSED",
      failed: "FAILED",
    };
    for (const [session, ours] of Object.entries(expected)) expect(fromSessionStatus(session), session).toBe(ours);
  });

  it("reads an unknown status as failed instead of stalling", () => {
    expect(fromSessionStatus("something_new")).toBe("FAILED");
  });

  it("has a label for every status, and only Done and Closed are final", () => {
    const all = Object.keys(IT_STATUS_LABEL) as ItStatusValue[];
    expect(all.filter(isTerminal).sort()).toEqual(["CLOSED", "MERGED"]);
    for (const s of all) expect(IT_STATUS_LABEL[s].length).toBeGreaterThan(0);
  });

  it("says what a person has to do next, only when they do", () => {
    expect(waitingOnPerson("NEEDS_ANSWERS")).toBeTruthy();
    expect(waitingOnPerson("SPEC_REVIEW")).toBeTruthy();
    expect(waitingOnPerson("PR_OPEN")).toBeTruthy();
    expect(waitingOnPerson("BUILD_FAILED")).toBeTruthy();
    for (const s of ["SUBMITTED", "DRAFTING_SPEC", "BUILDING", "ACCEPTED", "MERGED", "CLOSED"] as const) expect(waitingOnPerson(s), s).toBeNull();
  });

  it("starts the right AI Builder intent for each kind", () => {
    expect(intentFor("FEATURE")).toBe("feature");
    expect(intentFor("ERROR")).toBe("bugfix");
    expect(intentFor("FINDING")).toBe("bugfix");
    expect(intentFor("FINDING", "maintenance")).toBe("maintenance");
  });

  it("lets Owner and Office approve, and nobody else", () => {
    expect(delegatedRoleFor(["ADMIN"])).toBe("approver");
    expect(delegatedRoleFor(["EDITOR"])).toBe("approver");
    expect(delegatedRoleFor(["OPERATOR"])).toBe("requester");
    expect(delegatedRoleFor(["VIEWER"])).toBe("requester");
    expect(delegatedRoleFor([])).toBe("requester");
  });
});
