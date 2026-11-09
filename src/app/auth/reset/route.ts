import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteSession } from "@/lib/session";
import { homePathForRoles } from "@/lib/roles";

// Clears a session cookie that no longer belongs to an active user (for
// example, the account was deactivated). Pages redirect here because they
// cannot change cookies while rendering. A still-valid session is left alone,
// so this link cannot be used to sign someone out.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (user) {
    return NextResponse.redirect(new URL(homePathForRoles(user.roles), request.url));
  }
  await deleteSession();
  return NextResponse.redirect(new URL("/login", request.url));
}
