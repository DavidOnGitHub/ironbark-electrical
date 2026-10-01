/** Who did something: a signed-in person, a workflow run, or the system.
 * Every state change carries one, and lands on the timeline. */
export type Actor =
  | { type: "USER"; userId: string; label: string }
  | { type: "WORKFLOW"; label: string; workflowInstanceId?: string }
  | { type: "SYSTEM"; label: string };

export function userActor(user: { id: string; name?: string | null; email?: string | null }): Actor {
  return { type: "USER", userId: user.id, label: user.name?.trim() || user.email || "Unknown user" };
}
