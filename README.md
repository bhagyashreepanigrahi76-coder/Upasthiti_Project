# College Attendance Portal

Web app for geofenced student attendance, class attendance, timetables, marks and results, notices, and monthly parent reports. It is built from *PRD: College Attendance & Academic Report App v1.0*. See [PLAN.md](PLAN.md) for the 10-day build plan.

**Status:** Days 1–5 of 10 are complete: login and role portals, admin setup and onboarding, geofenced punch in/out, calendar with leave and regularisation, and section timetables.

## What works today
| Area | Highlights |
|---|---|
| Sign-in (FR-1, FR-3) | College ID + password, 5-try lockout, first sign-in needs an emailed/SMS code and a new password, "First time here or forgot your password?" flow |
| Admin setup (FR-2, FR-26) | Academic years, departments, sections, lab batches, subjects, teacher-subject mapping; users with scoped roles; CSV/Excel bulk import with a preview |
| Punch in/out (FR-4 to FR-13) | Server-side 100 m geofence check (several campus points), GPS accuracy limit, one approved phone per student, offline queue, clock and impossible-movement flags, working days and hours |
| Calendar and requests (FR-10, FR-11, FR-14 to FR-17) | Holidays, exams, working Saturdays, events with notifications; leave with PDF/image documents; regularisation approved by class coordinator or HOD; missed punch-outs auto-closed |
| Timetable (FR-54 to FR-66) | Period timings, rooms, weekly grid editor, clash detection, versions by effective date, cancel/substitute/extra class, teacher and student views, printable view |

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
| `T1001` | Dr. Meera Iyer: Teacher + HOD, Computer Science | Portal picker (HOD or Teacher) |
| `T1002` | Rahul Verma: Teacher + Class coordinator, CS Year 1-A | Teacher portal, with mentees and approvals |
| `T1003` | Anita Desai: Teacher | Teacher portal |
| `T2001` | Prof. Suresh Nair: Teacher + HOD, Commerce | Portal picker |
| `S26CS001` | Student, B.Sc. CS Year 1-A, lab Batch 1 (has an incomplete day to regularise) | Student portal |
| `S24CS001` | Student, B.Sc. CS Year 3-A | Student portal |
| `P26CS001` | Parent of S26CS001 and S24CS001 | Parent portal |

The seed also creates a campus point, period timings, rooms, timetables for CS 1-A and CS 2-A, and a few calendar entries.

### Trying the punch screen
The demo campus point is in Bengaluru (12.9716, 77.5946). To punch from where you are, sign in as `ADMIN01`, open **Geofence & hours**, and add a point with **Use my current location**. Browsers only give location to `https://` pages or `localhost`. To try it outside college hours or on a holiday, untick **Only allow punches on working days and within college hours**.

### Codes and emails in development
With `MAIL_TRANSPORT="console"` (the default), every email and SMS is printed in the server console and saved as a text file in `.outbox/`. That's where first-login and password-reset codes appear. A real SMTP/SMS provider comes on Day 9.

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
| `npm run test:e2e:days2-5` | Days 2–5 test, 120 checks (needs a running server on fresh seed data) |

Both tests change data. Run `npm run db:seed` before and after.

## Scheduled job
Missed punch-outs are closed as "incomplete" (FR-10) by calling this a few minutes after the punch cut-off (for example 18:05 daily) from cron, Windows Task Scheduler or your host's scheduler:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-host>/api/jobs/close-sessions
```

Admins can also run it from **Punch log → Close open sessions from earlier days**.

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
- **Form messages need JavaScript.** Without JS the action still runs, but its confirmation message only appears once the page's scripts load.
- **PDF export** uses the browser's print dialog (Save as PDF), not a generated file.
- **Search** relies on SQLite's case-insensitive matching; PostgreSQL needs `mode: "insensitive"` (Day 10).

## Notes
- **OneDrive:** this folder is inside OneDrive. Syncing `node_modules`, `.next` and `uploads` can cause slow installs and `EPERM` file-lock errors. Exclude those folders from sync or move the project outside OneDrive.
- **npm install scripts:** this npm version skips package install scripts by default. Prisma still works because `postinstall` runs `prisma generate`.
- **Prisma warning:** `package.json#prisma` is deprecated in favour of `prisma.config.ts`. It still works in Prisma 6 and moves to the new config with the PostgreSQL switch on Day 10.
