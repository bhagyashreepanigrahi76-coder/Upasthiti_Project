import { NextResponse } from "next/server";
import { currentUserForApi } from "@/lib/auth";
import { db } from "@/lib/db";
import { audienceContext, canSee } from "@/lib/notices";
import { readUpload } from "@/lib/uploads";

// Notice attachments (FR-46): anyone for live public notices; otherwise only
// people in the notice's audience, its author and admins.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = await db.notice.findUnique({ where: { id } });
  if (!n?.attachmentPath) return new NextResponse("Not found", { status: 404 });
  const now = new Date();
  const live = n.status === "PUBLISHED" && n.publishAt <= now;
  const publicLive = live && n.isPublic && n.audience === "EVERYONE" && (!n.expiresAt || n.expiresAt > now);

  if (!publicLive) {
    const user = await currentUserForApi();
    if (!user) return new NextResponse("Please sign in.", { status: 401 });
    const allowed = n.createdById === user.id || user.roles.includes("ADMIN") || (live && canSee(n, await audienceContext(user)));
    if (!allowed) return new NextResponse("Not found", { status: 404 });
  }
  let bytes: Buffer;
  try {
    bytes = await readUpload(n.attachmentPath);
  } catch {
    return new NextResponse("File missing", { status: 404 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": n.attachmentMime ?? "application/octet-stream",
      "Content-Disposition": `${n.attachmentMime?.startsWith("image/") || n.attachmentMime === "application/pdf" ? "inline" : "attachment"}; filename="${(n.attachmentName ?? "attachment").replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": publicLive ? "public, max-age=300" : "private, no-store",
    },
  });
}
