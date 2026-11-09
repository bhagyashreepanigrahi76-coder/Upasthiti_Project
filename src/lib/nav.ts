import type { PortalKey } from "./roles";

export type NavItem = {
  label: string;
  href?: string; // no href = not built yet
  day?: number; // PLAN.md day that delivers it
};

// Sidebar entries per portal. Items without an href show as "Day N" until built.
export const NAV: Record<PortalKey, NavItem[]> = {
  admin: [
    { label: "Dashboard", href: "/admin" },
    { label: "Academic setup", href: "/admin/academic" },
    { label: "Users", href: "/admin/users" },
    { label: "Bulk import", href: "/admin/import" },
    { label: "Geofence & hours", href: "/admin/geofence" },
    { label: "Devices", href: "/admin/devices" },
    { label: "Punch log", href: "/admin/punches" },
    { label: "Calendar", href: "/admin/calendar" },
    { label: "Timetable", href: "/admin/timetable" },
    { label: "Results publishing", day: 7 },
    { label: "Notices", day: 8 },
    { label: "Parent reports", day: 9 },
    { label: "Audit log", day: 9 },
  ],
  hod: [
    { label: "Dashboard", href: "/hod" },
    { label: "Approvals", href: "/hod/approvals" },
    { label: "Timetable", href: "/hod/timetable" },
    { label: "Attendance edits", day: 6 },
    { label: "Marks verification", day: 7 },
    { label: "Analytics", day: 9 },
  ],
  teacher: [
    { label: "Dashboard", href: "/teacher" },
    { label: "My timetable", href: "/teacher/timetable" },
    { label: "Approvals", href: "/teacher/approvals" },
    { label: "Calendar", href: "/teacher/calendar" },
    { label: "Mark attendance", day: 6 },
    { label: "Mentees", day: 6 },
    { label: "Marks entry", day: 7 },
  ],
  student: [
    { label: "Dashboard", href: "/student" },
    { label: "Punch in / out", href: "/student/punch" },
    { label: "Leave & regularisation", href: "/student/requests" },
    { label: "Calendar", href: "/student/calendar" },
    { label: "Timetable", href: "/student/timetable" },
    { label: "Attendance", day: 6 },
    { label: "Results", day: 7 },
    { label: "Notices", day: 8 },
  ],
  parent: [
    { label: "Dashboard", href: "/parent" },
    { label: "Calendar", href: "/parent/calendar" },
    { label: "Attendance", day: 9 },
    { label: "Results", day: 9 },
  ],
};
