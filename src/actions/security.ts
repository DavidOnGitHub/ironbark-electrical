"use server";

import { requireRole } from "@kabosh-digital/m-street-kit/auth";
import { Access } from "../access";
import { startScan } from "../domain/it";

/** Owner and Office: starts the security scan now. The report arrives a few minutes later on its own. */
export async function scanNowAction(): Promise<{ error: string | null }> {
  await requireRole(Access.IT_MANAGE);
  const r = await startScan();
  return r.started ? { error: null } : { error: r.reason };
}
