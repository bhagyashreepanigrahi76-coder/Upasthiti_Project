import "server-only";
import { headers } from "next/headers";
import { db } from "./db";

export type AuditInput = {
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
};

/**
 * Records who did what and when (FR-30, PRD §7 auditability).
 * Call from server actions and route handlers; never from the browser.
 * Audit failures are logged but never break the user's action.
 */
export async function logAudit(input: AuditInput): Promise<void> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    await db.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        details: input.details ? JSON.stringify(input.details) : null,
        ipAddress: ip,
        userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log", input.action, err);
  }
}
