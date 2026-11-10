import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLE_LABELS, portalsForRoles, type PortalKey } from "@/lib/roles";
import { logout } from "@/app/login/actions";

// Reads the session, so it must render inside a <Suspense> boundary.
export async function UserMenu({ current }: { current: PortalKey }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const otherPortals = portalsForRoles(user.roles).filter((p) => p.key !== current);
  const unread = await db.notification.count({ where: { userId: user.id, readAt: null } });

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {otherPortals.length > 0 && (
        <nav aria-label="Switch portal" className="flex items-center gap-1 text-xs">
          <span className="text-slate-500">Switch to:</span>
          {otherPortals.map((p) => (
            <Link
              key={p.key}
              href={p.path}
              className="rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50"
            >
              {p.label}
            </Link>
          ))}
        </nav>
      )}
      <Link
        href="/notifications"
        className="relative rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Notifications
        {unread > 0 && (
          <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>
        )}
      </Link>
      <Link href="/account/security" className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
        Account
      </Link>
      <div className="text-right leading-tight">
        <p className="text-sm font-medium text-slate-900">{user.name}</p>
        <p className="text-xs text-slate-500">
          {user.collegeId} · {user.roles.map((r) => ROLE_LABELS[r]).join(", ")}
        </p>
      </div>
      <form action={logout}>
        <button
          type="submit"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

export function UserMenuSkeleton() {
  return <div className="h-9 w-48 animate-pulse rounded-md bg-slate-100" aria-hidden="true" />;
}
