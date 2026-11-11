import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session-token";
import { PORTALS, homePathForRoles, portalForPath } from "@/lib/roles";

// Fast, optimistic check before a page renders: is there a valid session
// cookie, and does it carry a role for this portal? The real authorisation
// happens again on the server in every page and action (src/lib/auth.ts),
// using roles from the database.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    return session
      ? NextResponse.redirect(new URL(homePathForRoles(session.roles), request.url))
      : NextResponse.next();
  }

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  const portal = portalForPath(pathname);
  if (portal && !PORTALS[portal].roles.some((r) => session.roles.includes(r))) {
    return NextResponse.redirect(new URL("/forbidden", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/login",
    "/select-role",
    "/account/setup",
    "/account/consent",
    "/account/security",
    "/notifications",
    "/notices/:path*",
    "/admin/:path*",
    "/hod/:path*",
    "/teacher/:path*",
    "/student/:path*",
    "/parent/:path*",
    "/library/:path*",
  ],
};
