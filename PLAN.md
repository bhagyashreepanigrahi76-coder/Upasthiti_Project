# 10-Day Build Plan: College Attendance & Academic Report App

Source: *PRD: College Attendance & Academic Report App v1.0*. FR numbers below refer to that document.

**Stack:** Next.js 16 (App Router, TypeScript), Tailwind CSS 4, Prisma 6, SQLite in development (switch to PostgreSQL for production by changing one line), jose (signed session cookies), bcryptjs (password hashing), zod (input validation).

**Mobile:** the student app is a responsive Progressive Web App (installable, uses browser GPS). Native-only checks in FR-9 (mock-location and root detection) need a native wrapper such as Capacitor. That is noted as a follow-up, not part of these 10 days.

---

## Day 1: Foundation, data model, login and role portals ✅
- Create the Next.js project, Prisma and SQLite setup, `.env` handling
- Core data model: User, UserRole (role + department + year + section + subject scope), Department, AcademicYear, Section, Subject, Teacher, TeacherSubject, Student, Parent, ParentStudent, Device, Setting, AuditLog
- Login with college ID + password (FR-1, without OTP yet), bcrypt hashing, account lockout after 5 failed attempts
- Signed, httpOnly session cookie (12 h), logout
- `proxy.ts` route guard plus server-side role checks on every page (role design rule, §3)
- Portals: Admin, HOD, Teacher (and Mentor), Student, Parent. Users with several roles can switch between portals
- Audit log entries for login success, login failure and logout (FR-30, started)
- Seed script with demo departments, sections, subjects, staff, students and parents

**Done when:** each demo user logs in, lands in the right portal, cannot open other portals, and the admin dashboard shows real counts and recent audit entries.

## Day 2: Admin setup and onboarding ✅
- CRUD for departments, academic years, sections, subjects and semesters (FR-26)
- Teacher to subject to section mapping (FR-26)
- User management: create, deactivate, assign roles, reset password
- CSV/Excel bulk import of students and teachers with a row-by-row validation report (FR-2)
- First-login OTP and forced password change, forgot-password flow (FR-1, FR-3). Development uses a console email sender

## Day 3: Geofenced punch in / punch out ✅
- Admin geofence settings: several campus points, radius (default 100 m), college hours, working days (FR-5, FR-27)
- Student punch screen: one tap, shows inside/outside campus, distance and last punch (FR-31)
- Server-side validation: distance (haversine), GPS accuracy ≤ 30 m, device time vs server time, impossible movement (FR-7, FR-8, FR-9)
- Device binding: one approved device per student, admin approves device changes (FR-4)
- Offline queue with sync and late-sync flag (FR-12); punches only on working days and hours (FR-13)
- PWA manifest so students can install the app

## Day 4: Calendar, leave and regularisation ✅
- Academic calendar: holidays, exam days, working Saturdays, events, per year/department, CSV import (FR-14, FR-15)
- Calendar visible to students; changes create notifications (FR-16)
- Auto-close missed punch-outs at the cut-off time and mark "incomplete" (FR-10)
- Regularisation requests and approval by class coordinator or HOD, with logged decisions (FR-11)
- Student leave requests with document upload and approval; leave counting policy setting (FR-17)

## Day 5: Class and section timetable ✅
- Period timings (separate Saturday timings), rooms, lab batches (FR-54, FR-56)
- Weekly grid editor and CSV import for Admin/HOD (FR-55, FR-57)
- Clash detection for teacher, room and section; weekly teacher workload (FR-58)
- Teacher timetable and student weekly grid plus "Today" list (FR-59, FR-60)
- Cancel, substitute and extra-class changes with notifications (FR-63)
- Versioning by "effective from" date (FR-64); printable view with Save as PDF (FR-65)

**Deferred from Days 2-5** (to pick up later): teacher swap requests (FR-67, optional in the PRD); importing the calendar from PDF (CSV/Excel work); a service worker so the punch page opens with no connection at all (queued punches already sync once the page is open); showing the timetable on the notice board (done on Day 8).

## Day 6: Class attendance and attendance engine ✅
- Teacher dashboard: today's periods and pending tasks (FR-19)
- Open a period and the section/batch list loads; mark Present, Absent, Late (FR-61)
- Optional rule: present only with an open campus punch that day (§4.3)
- Edits after 24 h need HOD approval, with an audit trail (FR-20)
- Attendance percentage engine following §6: holidays, exam days and cancelled periods excluded, leave counted per policy (FR-62, FR-63)
- Student attendance view: overall, subject-wise, monthly calendar, shortage warning (FR-32)

## Day 7: Marks, results and report cards ✅
- Assessments per subject (Internal 1, Internal 2, Assignment, Practical, Semester) with max marks and weightage (FR-21)
- Grid entry and Excel upload with validation, "AB" absentee code (FR-22)
- Workflow Draft → Submitted → Verified → Locked → Published, logged revisions (FR-23)
- Scheduled publishing and admin unpublish (FR-24)
- Student results: marks, grade, SGPA/CGPA, history, PDF report card (FR-33)
- Class analytics: average, highest, lowest, pass %, at-risk list (FR-25)

## Day 8: Announcements, notice board and notifications ✅
- Notices with audience targeting, categories, Urgent and Pinned (FR-43, FR-44, FR-45)
- Attachments with a size limit; scheduled publish and expiry to archive (FR-46, FR-47)
- Public notice board page and "Latest announcements" strip on login and dashboards (FR-42)
- Edit, withdraw, history and "Updated" label; posting permissions and approval (FR-49, FR-50)
- Search and archive; read tracking for urgent notices; link to calendar entries (FR-51, FR-52, FR-53)
- In-app notification centre: punch reminders, calendar changes, results, low attendance (FR-35, FR-48)

**Done early (from Day 9):** read-only parent views of attendance and results. **Still to come on Day 9:** low-attendance notifications and emails go with the monthly parent reports; notice emails move onto a retrying queue.

## Day 9: Parent reports and admin dashboards ✅
- Monthly parent report job on a set day, email template with status colour (FR-36, FR-37)
- Warning ladder: early warning below 75 %, critical alert below 30 %, copy to coordinator (FR-38, FR-41)
- Email queue with retries; EmailLog with sent/bounced/failed; preview, pause, resend, manual trigger (FR-39)
- Multiple parent emails; unsubscribe from non-critical mail only (FR-40)
- Admin dashboards: day-wise attendance, defaulters, department/year comparison, punch exceptions (FR-29)
- Audit log viewer with filters (FR-30); read-only parent portal

## Day 10: Hardening, year-end tools and release ✅
- Rate limiting, security headers, session expiry, optional 2FA for staff (FR-3, §7)
- Privacy consent screen and location-only-at-punch policy (§7, DPDP Act 2023)
- Year-end promotion and archive of passed-out students (FR-28)
- Excel/PDF exports for accreditation and audits (feature 13)
- Tests: attendance %, geofence distance, permissions; end-to-end smoke test
- PostgreSQL migration, deployment guide (hosting, scheduled jobs, backups), final README

**How Day 10 turned out:** two-step sign-in sends a code by email/SMS rather than using an authenticator app. PDF exports use the browser's Save as PDF. PostgreSQL was verified by generating its migration script, not by running against a live server (see DEPLOYMENT.md).

## After the 10 days
- Native wrapper (Capacitor) for fake-GPS / rooted-phone detection (FR-9)
- SMS / WhatsApp provider for critical alerts (FR-38, open question 5)
- Teacher period swaps (FR-67), calendar import from PDF, offline page shell (service worker)
- Phase 3 ideas from the PRD: at-risk prediction, revaluation requests, face verification, multi-campus

---

## Open PRD questions that affect the build
Defaults used until the college confirms:

| # | Question | Default used |
|---|----------|--------------|
| 1 | Parent alert threshold | Warning below 75 %, critical below 30 % (both configurable) |
| 2 | Day vs period attendance | Both layers, as §4.3 proposes |
| 3 | Who approves leave/regularisation | Class coordinator (mentor), HOD as fallback |
| 4 | Multiple campuses / labs outside 100 m | Multiple geofence points supported from Day 3 |
| 5 | Email provider | Console sender in development; SMTP adapter on Day 9 |
| 6 | Grading scheme | Configurable percentage → grade points → SGPA/CGPA |
| 7 | Parent login | Email reports first; read-only parent portal on Day 9 |
| 8 | Platform | Responsive web + installable PWA |
