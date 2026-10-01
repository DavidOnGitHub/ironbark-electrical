import { prisma, UserRole } from "@kabosh-digital/workflow-schema";

/** Platform users who can own work (Owner and Office). The business tables hold
 * only their ids; names come from here. */
export async function listStaff() {
  return prisma.user.findMany({
    where: { roles: { hasSome: [UserRole.ADMIN, UserRole.EDITOR] } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

export async function staffLabelMap(): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name?.trim() || u.email]));
}
