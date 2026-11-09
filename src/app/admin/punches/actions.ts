"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { autoCloseSessions } from "@/lib/punch";
import { type ActionState, success } from "@/lib/action-state";

/** FR-10: manually run the missed punch-out job (it also runs on a schedule). */
export async function closeOpenSessionsNow(): Promise<ActionState> {
  const admin = await requireRole("ADMIN");
  const closed = await autoCloseSessions();
  await logAudit({ actorId: admin.id, action: "SESSIONS_AUTO_CLOSED", details: { closed, trigger: "manual" } });
  refresh();
  return success(`${closed} open session${closed === 1 ? "" : "s"} marked incomplete.`);
}
