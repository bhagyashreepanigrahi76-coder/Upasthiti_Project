# Deploying Upasthiti

For the person who installs and runs the system for a college. It assumes a Linux server and basic command-line experience.

## 1. What you need

| Item | Recommendation |
|---|---|
| Server | One Linux VM, 2 vCPU and 4 GB RAM, comfortably handles 5,000 students (PRD §7) |
| Software | Node.js 20 or newer, PostgreSQL 15 or newer, Nginx (or another reverse proxy) |
| Domain and HTTPS | Required. Phones only share GPS location with `https://` sites |
| Email | An SMTP provider and a sending domain with **SPF and DKIM** set up, so reports don't land in spam (PRD §12) |
| SMS (optional) | Not wired to a provider yet: SMS is printed to the server log. Plug your provider's API into `sendSms()` in `src/lib/mailer.ts` |

SQLite is for development only. Use PostgreSQL in production.

## 2. Switch the database to PostgreSQL

The development migrations in `prisma/migrations/` are for SQLite and cannot run on PostgreSQL, so production starts from a fresh baseline:

1. In `prisma/schema.prisma`, change `provider = "sqlite"` to `provider = "postgresql"`.
2. Move the SQLite migrations aside: `mv prisma/migrations prisma/migrations-sqlite`.
3. Point `DATABASE_URL` at an empty PostgreSQL database (a development copy is fine), then run `npx prisma migrate dev --name init`. This creates `prisma/migrations/<timestamp>_init/` for PostgreSQL. Commit it.
4. On the production server, apply migrations with `npm run db:deploy` (that is `prisma migrate deploy`, which never resets data).

This was checked without a database: the schema with `provider = "postgresql"` validates, and `prisma migrate diff` produces a complete PostgreSQL script (40 tables, native enum types). Text search already switches to case-insensitive matching on PostgreSQL (`src/lib/db-search.ts`).

## 3. Environment variables

Set these in the service's environment, or in a `.env` file readable only by the app user.

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://app:secret@localhost:5432/attendance` | |
| `SESSION_SECRET` | 64 random characters | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Changing it signs everyone out |
| `CRON_SECRET` | 32+ random characters | Protects the scheduled-job endpoint |
| `APP_URL` | `https://attendance.your-college.edu` | Used in email links (unsubscribe, notices) |
| `MAIL_TRANSPORT` | `smtp` | `console` only for development |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | | `SMTP_SECURE=true` for port 465 |
| `MAIL_FROM` | `College Attendance <attendance@your-college.edu>` | Must match your SPF/DKIM domain |
| `NEXT_PUBLIC_COLLEGE_NAME` | `N.C. Autonomous College, Jajpur` | Shown across the app. Set it before building |
| `NEXT_PUBLIC_TIME_ZONE` | `Asia/Kolkata` | All attendance dates use this zone. Set it before building |

## 4. Build and run

```bash
git clone <your repository> /srv/attendance && cd /srv/attendance
npm ci
npm run db:deploy               # create / update tables
npm run build
npm run admin:create -- ADMIN01 "Office Admin" office@your-college.edu   # first admin; prints a temporary password once
npm start                       # listens on port 3000
```

Never run `npm run db:seed` in production. It wipes data, and it refuses to run when `NODE_ENV=production`.

Run it as a service, for example with systemd:

```ini
# /etc/systemd/system/attendance.service
[Unit]
Description=Upasthiti college portal
After=network.target postgresql.service

[Service]
WorkingDirectory=/srv/attendance
EnvironmentFile=/srv/attendance/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
User=attendance

[Install]
WantedBy=multi-user.target
```

Put Nginx in front for HTTPS (for example with Let's Encrypt) and forward the real client address and host, which the app uses for rate limiting and its same-origin checks:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 8m;   # imports and attachments are capped at 5 MB in the app
}
```

## 5. Scheduled jobs

One endpoint does everything that runs on a timer. Call it every 10 minutes:

```cron
*/10 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://attendance.your-college.edu/api/jobs/tick > /dev/null
```

Each call closes missed punch-outs after the cut-off, publishes results whose time has come, delivers scheduled notices, sends one punch-in reminder per working day, generates the monthly parent reports on the configured day, and sends queued email with retries. It is safe to call more often. Results still appear at their scheduled time if a call is missed; only the notifications wait.

## 6. Monitoring

- `GET /api/health` returns `200 {"ok":true}` when the app can reach the database, and `503` otherwise. Point your uptime monitor at it.
- **Admin → Parent reports** shows email delivery: queued, sent, bounced and failed. Admins also get an in-app alert when emails bounce.
- **Admin → Audit log** records sign-ins, edits, approvals, exports and report sends (FR-30).

## 7. Backups and retention (PRD §5 feature 14)

| What | How | Keep |
|---|---|---|
| Database | Nightly `pg_dump -Fc attendance > attendance-$(date +%F).dump`, copied off the server | 30 daily and 12 monthly copies |
| Uploaded files | Nightly sync of the `uploads/` folder (leave documents, notice attachments) to the same off-server location | Same as the database |
| Restore test | Restore last night's dump into a scratch database every term and open a few pages | |

Agree a retention period with the college (university and accreditation rules usually set it) and delete records older than that at year end. Year-end promotion keeps passed-out students' records and only turns their sign-in off.

## 8. Security checklist

- HTTPS only. The app sends HSTS, a Content-Security-Policy, `X-Frame-Options: DENY` and a Permissions-Policy that allows location only for this site.
- Keep `SESSION_SECRET`, `CRON_SECRET` and SMTP credentials out of the repository. `.env` is git-ignored.
- PostgreSQL should accept connections only from the app server.
- Ask staff to turn on two-step sign-in (**Account → Two-step sign-in**), and admins especially.
- Rate limits and uploaded files are per server. If you run more than one app instance, move the rate-limit counters to Redis (`src/lib/rate-limit.ts`) and uploads to object storage such as S3 (`src/lib/uploads.ts`).
- Privacy (DPDP Act 2023): every user accepts the notice at `/privacy` before any data, including location, is collected. Students under 18 also confirm guardian agreement. Update `PRIVACY_VERSION` in `src/lib/privacy.ts` when the notice changes.

## 9. Phones

Students open the site in their phone browser and can add it to the home screen (installable web app). Location is read only when they tap a punch button. Detecting fake-GPS apps and rooted phones (FR-9) needs a native wrapper such as Capacitor; the punch API already accepts a `mocked` flag for that.

## 10. Updating

```bash
cd /srv/attendance && git pull && npm ci && npm run db:deploy && npm run build && sudo systemctl restart attendance
```
