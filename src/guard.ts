import { redirect } from "next/navigation";
import { auth, hasAnyRole, requirePageRole } from "@kabosh-digital/m-street-kit/auth";
import type { UserRole } from "@kabosh-digital/workflow-schema";
import { Access, Roles } from "./access";

/** Page guard for the business pages: signed-in user with one of `allowed`;
 * anyone else is sent away (a technician to their own page, others to "/"). */
export async function requireBusinessPage(allowed: UserRole[]) {
  return requirePageRole(allowed);
}

/** "/" for each role: the owner/office/bookkeeper dashboard, or the technician's day. */
export async function dashboardAccess() {
  const session = await auth();
  const roles = session?.user?.roles ?? [];
  const mfaPending = session?.user?.mfa === "setup" || session?.user?.mfa === "required";
  if (!mfaPending && hasAnyRole(roles, [Roles.TECHNICIAN]) && !hasAnyRole(roles, Access.DASHBOARD)) redirect("/my-day");
  const user = await requirePageRole(Access.DASHBOARD);
  return { user, roles: user.roles };
}
