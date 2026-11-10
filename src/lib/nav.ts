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
    { label: "Results publishing", href: "/admin/results" },
    { label: "Notices", href: "/admin/notices" },
    { label: "Parent reports", href: "/admin/reports" },
    { label: "Analytics", href: "/admin/analytics" },
    { label: "Year-end promotion", href: "/admin/promotion" },
    { label: "Audit log", href: "/admin/audit" },
    { label: "Library", href: "/admin/library" },
  ],
  hod: [
    { label: "Dashboard", href: "/hod" },
    { label: "Approvals", href: "/hod/approvals" },
    { label: "Timetable", href: "/hod/timetable" },
    { label: "Attendance edits", href: "/hod/attendance-edits" },
    { label: "Marks verification", href: "/hod/marks" },
    { label: "Notices", href: "/hod/notices" },
    { label: "Analytics", href: "/hod/analytics" },
    { label: "Notes", href: "/hod/notes" },
  ],
  teacher: [
    { label: "Dashboard", href: "/teacher" },
    { label: "My timetable", href: "/teacher/timetable" },
    { label: "Approvals", href: "/teacher/approvals" },
    { label: "Calendar", href: "/teacher/calendar" },
    { label: "Mark attendance", href: "/teacher/attendance" },
    { label: "Mentees", href: "/teacher/mentees" },
    { label: "Marks entry", href: "/teacher/marks" },
    { label: "Notes", href: "/teacher/notes" },
    { label: "Notices", href: "/teacher/notices" },
  ],
  student: [
    { label: "Dashboard", href: "/student" },
    { label: "Punch in / out", href: "/student/punch" },
    { label: "Leave & regularisation", href: "/student/requests" },
    { label: "Calendar", href: "/student/calendar" },
    { label: "Timetable", href: "/student/timetable" },
    { label: "Attendance", href: "/student/attendance" },
    { label: "Results", href: "/student/results" },
    { label: "Notes", href: "/student/notes" },
    { label: "Library", href: "/student/library" },
    { label: "Notices", href: "/notices" },
  ],
  library: [
    { label: "Dashboard", href: "/library" },
    { label: "Notices", href: "/notices" },
  ],
  parent: [
    { label: "Dashboard", href: "/parent" },
    { label: "Calendar", href: "/parent/calendar" },
    { label: "Attendance", href: "/parent/attendance" },
    { label: "Results", href: "/parent/results" },
    { label: "Notices", href: "/notices" },
  ],
};
