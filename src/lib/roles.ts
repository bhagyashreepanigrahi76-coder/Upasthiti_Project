// Roles and portals. No server-only imports here: this file is shared by
// proxy.ts, server components and client components.

export const ROLES = ["ADMIN", "HOD", "TEACHER", "MENTOR", "STUDENT", "PARENT"] as const;
export type RoleName = (typeof ROLES)[number];

export function isRole(value: unknown): value is RoleName {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<RoleName, string> = {
  ADMIN: "Admin",
  HOD: "Head of Department",
  TEACHER: "Teacher",
  MENTOR: "Class Coordinator",
  STUDENT: "Student",
  PARENT: "Parent",
};

export type PortalKey = "admin" | "hod" | "teacher" | "student" | "parent";

export type Portal = {
  key: PortalKey;
  label: string;
  path: string;
  roles: RoleName[]; // any one of these roles opens the portal
  description: string;
};

export const PORTALS: Record<PortalKey, Portal> = {
  admin: {
    key: "admin",
    label: "Admin",
    path: "/admin",
    roles: ["ADMIN"],
    description: "Users, academic setup, calendar, reports and audit",
  },
  hod: {
    key: "hod",
    label: "HOD",
    path: "/hod",
    roles: ["HOD"],
    description: "Department overview, approvals and analytics",
  },
  teacher: {
    key: "teacher",
    label: "Teacher",
    path: "/teacher",
    roles: ["TEACHER", "MENTOR"],
    description: "Your classes, attendance, marks and mentees",
  },
  student: {
    key: "student",
    label: "Student",
    path: "/student",
    roles: ["STUDENT"],
    description: "Punch in/out, attendance, timetable and results",
  },
  parent: {
    key: "parent",
    label: "Parent",
    path: "/parent",
    roles: ["PARENT"],
    description: "Your child's attendance and results",
  },
};

const PORTAL_ORDER: PortalKey[] = ["admin", "hod", "teacher", "student", "parent"];

export function canOpenPortal(roles: readonly RoleName[], portal: PortalKey): boolean {
  return PORTALS[portal].roles.some((r) => roles.includes(r));
}

export function portalsForRoles(roles: readonly RoleName[]): Portal[] {
  return PORTAL_ORDER.filter((key) => canOpenPortal(roles, key)).map((key) => PORTALS[key]);
}

/** Which portal a URL path belongs to, or null for non-portal pages. */
export function portalForPath(pathname: string): PortalKey | null {
  for (const key of PORTAL_ORDER) {
    const base = PORTALS[key].path;
    if (pathname === base || pathname.startsWith(base + "/")) return key;
  }
  return null;
}

/** Where to send a user after login: their only portal, or the portal picker. */
export function homePathForRoles(roles: readonly RoleName[]): string {
  const portals = portalsForRoles(roles);
  if (portals.length === 0) return "/forbidden";
  if (portals.length === 1) return portals[0].path;
  return "/select-role";
}

/**
 * Validates a ?next= redirect target: must be a same-site path the user is
 * allowed to open. Prevents open redirects such as "//evil.example".
 */
export function safeNextPath(next: unknown, roles: readonly RoleName[]): string | null {
  if (typeof next !== "string" || next.length === 0 || next.length > 200) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  if (next.startsWith("/login") || next.startsWith("/auth")) return null;
  const portal = portalForPath(next.split("?")[0]);
  if (portal && !canOpenPortal(roles, portal)) return null;
  return next;
}
