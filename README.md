# Upasthiti — College Attendance Portal (BCA & BBA)

Web app for geofenced student attendance, class attendance, timetables, marks and results, notices, and monthly parent reports. It is built from *PRD: College Attendance & Academic Report App v1.0*. See [PLAN.md](PLAN.md) for the 10-day build plan.

**Status:** all 10 days of the plan are complete. To put it on a server, see [DEPLOYMENT.md](DEPLOYMENT.md).

## What works today
| Area | Highlights |
|---|---|
| Sign-in (FR-1, FR-3) | College ID + password, 5-try lockout, first sign-in needs an emailed/SMS code and a new password, "First time here or forgot your password?" flow |
| Admin setup (FR-2, FR-26) | Academic years, departments, sections, lab batches, subjects, teacher-subject mapping; users with scoped roles; CSV/Excel bulk import with a preview |
| Punch in/out (FR-4 to FR-13) | Server-side 100 m geofence check (several campus points), GPS accuracy limit, one approved phone per student, offline queue, clock and impossible-movement flags, working days and hours |
| Calendar and requests (FR-10, FR-11, FR-14 to FR-17) | Holidays, exams, working Saturdays, events with notifications; leave with PDF/image documents; regularisation approved by class coordinator or HOD; missed punch-outs auto-closed |
| Timetable (FR-54 to FR-66) | Period timings, rooms, weekly grid editor, clash detection, versions by effective date, cancel/substitute/extra class, teacher and student views, printable view, posted to the notice board |
| Class attendance (§4.3, §6, FR-19, FR-20, FR-32, FR-61) | Teachers mark P/L/A/Leave/Medical per timetabled period; edits after 24 h need HOD approval; attendance % per PRD §6 with optional campus-punch rule and leave policy; student, coordinator (risk list) and parent views |
| Marks and results (FR-21 to FR-25, FR-33) | Admin-set assessment scheme; grid or CSV/Excel entry with AB; Draft → Submitted → Verified → Locked → Published; scheduled publishing; logged revisions; grades, SGPA/CGPA, report card; class analytics |
| Parent communication (FR-36 to FR-41) | Monthly report emails on a set day with a status colour; warning below 75 % and critical below 30 % with coordinator copy and SMS; retrying email queue with delivery log, preview, pause, resend, manual trigger; unsubscribe from non-critical mail; several parent emails per student |
| Dashboards and audit (FR-29, FR-30) | Day-wise attendance chart, defaulters, department and year comparison, punch exceptions (admin and HOD); audit log viewer; Excel/CSV exports of defaulters, attendance registers, marks and the audit log |
| Security and privacy (§7, FR-3, FR-28) | Privacy consent before any data is collected (guardian consent under 18); optional emailed-code two-step sign-in for staff; password change; rate limits; security headers; year-end promotion and archive |
| Library (added) | Catalogue with search by title/author/ISBN, issue and return, renewals, 3-book limit, ₹/day overdue fines, due-date reminders; librarian portal, admin access, student "My books" and catalogue search |
| Study notes (added) | Teachers upload PDF/Word/PowerPoint/image notes per subject (whole year or one section); students search by topic or subject and open them; HOD sees and moderates department notes |
| Notices (FR-35, FR-42 to FR-53) | Audience targeting, categories, urgent/pinned, attachments, scheduling and expiry, edit history, withdraw, posting rights with approval, search and archive, read stats, calendar links, public board, punch reminders |

## Tech stack
- Next.js 16 (App Router, TypeScript, Cache Components), Tailwind CSS 4
- Prisma 6 with SQLite for development (switch to PostgreSQL for production)
- jose (session cookies), bcryptjs (passwords), zod (validation), fflate (reading .xlsx files)

## Getting started

Requirements: Node.js 20 or newer.

```bash
npm install
cp .env.example .env        # then set SESSION_SECRET and CRON_SECRET (commands are in the file)
npm run db:migrate          # creates prisma/dev.db
npm run db:seed             # loads demo data (wipes existing data)
npm run dev                 # http://localhost:3000
```

### Demo accounts
All demo accounts use the password `Demo@1234`.

| College ID | Who | Lands on |
|---|---|---|
| `ADMIN01` | Office admin | Admin portal |
| `T1001` | Dr. Meera Iyer: Teacher + HOD, BCA | Portal picker (HOD or Teacher) |
| `T1002` | Rahul Verma: Teacher + Class coordinator, BCA Year 1-A | Teacher portal, with mentees and approvals |
| `T1003` | Anita Desai: Teacher | Teacher portal |
| `T2001` | Prof. Suresh Nair: Teacher + HOD, BBA | Portal picker |
| `S26BCA001` | Student, B.Sc. BCA Year 1-A, lab Batch 1 (has an incomplete day to regularise) | Student portal |
| `S24BCA001` | Student, BCA Year 3-A | Student portal |
| `L1001` | Ramesh Patra: Librarian | Library portal |
| `S26BBA001` | Student, BBA Year 1 | Student portal |
| `P26BCA001` | Parent of S26BCA001 and S24BCA001 | Parent portal |

The seed also creates a campus point, period timings, rooms, timetables for BCA 1-A and BCA 2-A, calendar entries, two weeks of class attendance for BCA 1-A (S26CS008 is critical, S26CS007 is below 75%), a published CS101 Internal 1 result, CS102 marks waiting for HOD verification, and three notices.

### Trying the punch screen
The demo campus point is in Bengaluru (12.9716, 77.5946). To punch from where you are, sign in as `ADMIN01`, open **Geofence & hours**, and add a point with **Use my current location**. Browsers only give location to `https://` pages or `localhost`. To try it outside college hours or on a holiday, untick **Only allow punches on working days and within college hours**.

### Codes and emails in development
With `MAIL_TRANSPORT="console"` (the default), every email and SMS is printed in the server console and saved as a text file in `.outbox/`. That's where first-login and password-reset codes appear. Notices marked "Also email" use the same outbox. A real SMTP/SMS provider and a retrying email queue come on Day 9.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint checks |
| `npm run db:migrate` | Apply schema changes (creates a migration) |
| `npm run db:seed` | Reset to demo data |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run test:e2e` | Day 1 sign-in and access test (needs a running server on port 3000) |
| `npm run test:e2e:days2-5` | Days 2–5 test, 121 checks (needs a running server on fresh seed data) |
| `npm run test:e2e:days6-8` | Days 6–8 test, 103 checks (needs a running server on fresh seed data) |
| `npm run test:e2e:days9-10` | Days 9–10 test, 69 checks. Run it last: its final check pauses sign-ins from your machine for 15 minutes (restart the server to clear) |
| `npm run test:unit` | Unit tests for geofence distance, dates, attendance %, grades, permissions, notice audiences, CSV/Excel, rate limits (no server needed) |
| `npm run admin:create -- ID "Name" email` | Create the first admin on a fresh database (production) |
| `npm run db:deploy` | Apply migrations without resetting data (production) |

All end-to-end tests change data. Run `npm run db:seed` before and after.

## Scheduled jobs
Call the tick endpoint every 10–15 minutes from cron, Windows Task Scheduler or your host's scheduler:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-host>/api/jobs/tick
```

Each run closes missed punch-outs after the cut-off (FR-10), publishes results whose scheduled time has passed and notifies students and parents (FR-24), delivers scheduled notices (FR-47/48), and sends one punch-in reminder per working day to students who haven't punched in (FR-35). It is safe to call often. Results become visible at their scheduled time even if the job runs late; the job only sends the notifications.

Admins can close missed punch-outs by hand from **Punch log**. The older `/api/jobs/close-sessions` endpoint still works.

## Project structure
```
prisma/
  schema.prisma        data model
  seed.ts              demo data
src/
  proxy.ts             fast route guard: session cookie + portal role check
  lib/
    auth.ts            data access layer: getCurrentUser, requireRole, requirePortal, approver checks
    punch.ts           punch validation engine (geofence, device, schedule, sessions)
    timetable.ts       versions, day schedules, clash detection, workload
    calendar.ts        working-day rules from the calendar
    importers.ts       CSV/Excel import validation for students and teachers
    settings.ts        typed admin settings with defaults
    otp.ts / mailer.ts one-time codes; console email/SMS outbox
    uploads.ts         private document storage (checked by file content)
    dates.ts           college time-zone date helpers
    attendance.ts      attendance % engine, risk levels, classes needed
    class-attendance.ts  period lookup and roster for marking
    results.ts         visibility, grades, SGPA/CGPA, class stats, publishing job
    notices.ts         audience matching, posting rights, delivery, read stats
    jobs.ts            scheduled tick: auto-close, results, notices, reminders, reports, email
    reports.ts         monthly parent reports and low-attendance alerts
    email-queue.ts     queued email with retries, bounces, resend
    analytics.ts       dashboards: day-wise, defaulters, comparison, exceptions
    audience.ts        notice audience rules (pure, unit-tested)
    privacy.ts         privacy notice text and version
    rate-limit.ts      in-memory rate limiter
  components/          portal shell, forms, calendar, timetable views and editor, approvals board
  app/
    admin/ hod/ teacher/ student/ parent/   one folder per portal
    account/           first-login setup, activate / reset password
    api/punch          punch endpoint used by the student app
    api/jobs           scheduled jobs
    api/leave          permission-checked document download
    notifications/     in-app notifications
    timetable-print/   printable timetables
tests/                 end-to-end tests
```

## Security conventions (follow these on every new feature)
1. **Every page** calls `requirePortal(...)` or `requireRole(...)` from `src/lib/auth.ts` before reading data. `proxy.ts` is only a first filter.
2. **Every server action and route handler** checks the role again. Never trust IDs or roles sent from the browser.
3. **Scope queries to the user:** a teacher sees only assigned classes, a HOD only their department, a student only their own record.
4. **Log changes** to attendance, marks, approvals and settings with `logAudit(...)`.
5. Pages that read the session must render inside `<Suspense>` or a `loading.tsx` (a Cache Components rule). Keep layouts free of session reads, and keep `usePathname()` behind `<Suspense>`.

Also in place: session versioning (a password reset or deactivation signs the user out everywhere), single-use one-time codes with attempt limits, a neutral answer on password recovery so IDs can't be probed, a same-origin check on the punch API, uploads checked by file content and served only to the owner, their approvers and admins, and formula-injection-safe CSV exports.

## Known limitations
- **Fake GPS and rooted phones** can't be detected from a web browser (FR-9). The API accepts a `mocked` flag that a native wrapper (e.g. Capacitor) can send later.
- **Offline:** punches made while the punch page is open are queued and synced. The page itself can't open with no connection yet; that needs a service worker.
- **Form messages need JavaScript.** Without JS the action still runs, but its confirmation message only appears once the page's scripts load. Notice read tracking (FR-52) also records only when the page's scripts run.
- **SMS** is printed to the server log until an SMS provider is chosen (PRD open question 5).
- **Rate limits and uploads are per server.** Fine for one instance; for several, see DEPLOYMENT.md.
- **PDF export** uses the browser's print dialog (Save as PDF), not a generated file.
- **Search** relies on SQLite's case-insensitive matching; PostgreSQL needs `mode: "insensitive"` (Day 10).

## Notes
- **OneDrive:** this folder is inside OneDrive. Syncing `node_modules`, `.next` and `uploads` can cause slow installs and `EPERM` file-lock errors. Exclude those folders from sync or move the project outside OneDrive.
- **npm install scripts:** this npm version skips package install scripts by default. Prisma still works because `postinstall` runs `prisma generate`.
- **Prisma config** lives in `prisma.config.ts`, which loads `.env` itself.
- **PostgreSQL:** development uses SQLite. DEPLOYMENT.md explains the switch.
