import { NextResponse } from "next/server";
import { currentUserForApi } from "@/lib/auth";
import { db } from "@/lib/db";
import { notesScope } from "@/lib/notes";
import { readUpload } from "@/lib/uploads";

// View / download a note: only people who can see it (same rules as the list).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUserForApi();
  if (!user) return new NextResponse("Please sign in.", { status: 401 });
  const { id } = await ctx.params;
  const scope = await notesScope(user);
  const note = scope ? await db.note.findFirst({ where: { AND: [{ id }, scope] } }) : null;
  if (!note) return new NextResponse("Not found", { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await readUpload(note.filePath);
  } catch {
    return new NextResponse("File missing", { status: 404 });
  }
  await db.note.update({ where: { id }, data: { downloads: { increment: 1 } } });
  const inline = note.fileMime === "application/pdf" || note.fileMime.startsWith("image/");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": note.fileMime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${note.fileName.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
