// End-to-end checks for Days 9-10 against a running server, on freshly seeded data:
//   npm run db:seed && npm run build && npm start      (then, in another terminal)
//   node tests/e2e-days9-10.mjs . http://localhost:3000
// Run it LAST: the final check blocks sign-ins from this machine for 15 minutes
// (restart the server to clear it). It changes data; run npm run db:seed afterwards.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const APP = path.resolve(process.argv[2] ?? ".");
const BASE = process.argv[3] ?? "http://localhost:3000";
process.env.DATABASE_URL = "file:" + path.join(APP, "prisma", "dev.db").replace(/\\/g, "/");
const require = createRequire(path.join(APP, "package.json"));
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

let failures = 0;
let section = "";
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && extra ? "  — " + String(extra).slice(0, 300) : ""}`);
  if (!ok) failures++;
};
const heading = (s) => {
  section = s;
  console.log(`\n== ${s} ==`);
};

const clean = (h) => h.replace(/<!-- -->/g, "");
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const IST = 5.5 * 3600_000;
const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
const istHour = new Date(Date.now() + IST).getUTCHours();
const shiftMonth = (k, d) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1 + d, 1)).toISOString().slice(0, 7);

async function get(p, cookie) {
  const r = await fetch(BASE + p, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { status: r.status, location: r.headers.get("location"), body: clean(await r.text()) };
}
const forms = (html) => [...html.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0]);
function hidden(form) {
  const out = [];
  for (const m of form.matchAll(/<input[^>]*>/g)) {
    if (!/type="hidden"/.test(m[0])) continue;
    const name = m[0].match(/name="([^"]*)"/)?.[1];
    if (name) out.push([decode(name), decode(m[0].match(/value="([^"]*)"/)?.[1] ?? "")]);
  }
  return out;
}
async function act(pagePath, cookie, match, fields = {}, files = {}, postPath = pagePath, postCookie = cookie) {
  const page = await get(pagePath, cookie);
  const form = forms(page.body).find((f) => (typeof match === "string" ? f.includes(match) : match(f)));
  if (!form) throw new Error(`[${section}] form "${match}" not found on ${pagePath} (status ${page.status})`);
  const fd = new FormData();
  const own = new Set(Object.keys(fields));
  for (const [k, v] of hidden(form)) if (!own.has(k)) fd.append(k, v);
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) fd.append(k, x);
  for (const [k, f] of Object.entries(files)) fd.append(k, new Blob([f.data], { type: f.type }), f.name);
  const res = await fetch(BASE + postPath, { method: "POST", body: fd, headers: postCookie ? { cookie: postCookie } : {}, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), body: clean(await res.text()), setCookie: res.headers.get("set-cookie") ?? "" };
}
const login = (id, password = "Demo@1234") => act("/login", null, 'name="collegeId"', { collegeId: id, password, next: "" });
const cookieOf = (r, name = "cas_session") => r.setCookie.match(new RegExp(`${name}=[^;]+`))?.[0] ?? null;
const cookies = {};
async function as(id) {
  if (!cookies[id]) cookies[id] = cookieOf(await login(id));
  return cookies[id];
}
async function setSetting(key, value) {
  await db.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
}
const outboxFiles = () => (fs.existsSync(path.join(APP, ".outbox")) ? fs.readdirSync(path.join(APP, ".outbox")) : []);
const outboxText = (f) => fs.readFileSync(path.join(APP, ".outbox", f), "utf8");
const latestCode = (to) => {
  const f = outboxFiles().filter((x) => x.includes(to)).sort().pop();
  return f ? outboxText(f).match(/is: (\d{6})/)?.[1] : null;
};
const cron = fs.readFileSync(path.join(APP, ".env"), "utf8").match(/CRON_SECRET="([^"]+)"/)?.[1];
const tick = () => fetch(`${BASE}/api/jobs/tick`, { method: "POST", headers: { authorization: `Bearer ${cron}` } }).then((r) => r.json());
const punch = (cookie, body = {}) =>
  fetch(BASE + "/api/punch", {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, cookie },
    body: JSON.stringify({ type: "IN", latitude: 12.9716, longitude: 77.5946, accuracy: 10, deviceTime: Date.now(), deviceId: "device-e2e-0000001", dryRun: true, ...body }),
  });

const cs = await db.department.findUnique({ where: { code: "BCA" } });
const cs1A = await db.section.findFirst({ where: { departmentId: cs.id, year: 1, name: "A" } });
const s008 = await db.student.findUnique({ where: { rollNo: "S26BCA008" } });
const month = (await db.classSession.findFirst({ orderBy: { dateKey: "desc" } })).dateKey.slice(0, 7);
const admin = await as("ADMIN01");

// =============================================================================
heading("Day 9 · Unsubscribe (FR-40)");
await setSetting("criticalThreshold", 50); // makes the seeded ~31 % student a critical case for this run
const p001 = await db.parent.findFirst({ where: { email: "parent.s26bca001@example.com" } });
let r = await get(`/unsubscribe/${p001.unsubscribeToken}`);
check(r.status === 200 && r.body.includes("<strong>on</strong>"), "the unsubscribe link works without signing in");
r = await act(`/unsubscribe/${p001.unsubscribeToken}`, null, 'name="token"', {});
check(r.body.includes("no longer receive monthly reports") && (await db.parent.findUnique({ where: { id: p001.id } })).unsubscribedNonCritical, "a parent stops monthly reports");
check((await get("/unsubscribe/notarealtoken0000000000")).body.includes("not valid"), "a made-up link is refused");
await db.parent.updateMany({ where: { email: "parent.s26bca008@example.com" }, data: { unsubscribedNonCritical: true } });
const u008 = await db.user.findUnique({ where: { collegeId: "S26BCA008" } });
r = await act(`/admin/users/${u008.id}`, admin, "Add parent contact", { name: "Old Address", email: "old@bounce.example", relationship: "Guardian" });
check(r.body.includes("Parent contact added"), "admin adds a second parent email for a student");

heading("Day 9 · Monthly reports and alerts (FR-36..38, FR-41)");
r = await get(`/admin/reports/preview?student=${s008.id}&month=${month}`, admin);
check(r.body.includes("URGENT: Low attendance") && r.body.includes("srcDoc"), "admin previews the critical alert email (FR-39)");
const smsBefore = outboxFiles().filter((f) => f.includes("-sms-")).length;
r = await act("/admin/reports", admin, 'name="monthKey"', { monthKey: month });
check(r.body.includes("emails queued"), "admin generates the month's reports", r.body.match(/"error":"[^"]*"/)?.[0]);
const run = await db.reportRun.findFirst({ orderBy: { createdAt: "desc" } });
check(run.students >= 8 && run.critical >= 1 && run.warnings >= 1, `run counts students, warnings and critical cases (${run.students}/${run.warnings}/${run.critical})`);
let emails = await db.emailLog.findMany({ where: { runId: run.id } });
const critical = emails.find((e) => e.toAddress === "parent.s26bca008@example.com");
check(critical?.kind === "LOW_ATTENDANCE" && critical.priority === 2, "a critical alert reaches the parent even though they unsubscribed from monthly reports");
check(critical?.htmlBody?.includes("#b91c1c") && critical.htmlBody.includes("Working days") && critical.htmlBody.includes("Days present"), "the email has working days, days present and a red status colour (FR-37)");
check(!emails.some((e) => e.toAddress === "parent.s26bca001@example.com"), "the unsubscribed parent gets no monthly report");
check(emails.some((e) => e.toAddress === "sunita.sharma@example.com"), "the student's other parent still gets one");
check(emails.some((e) => e.kind === "MONTHLY_REPORT" && e.textBody.includes("/unsubscribe/")), "monthly reports carry an unsubscribe link");
check(emails.some((e) => e.kind === "COORDINATOR_COPY" && e.toAddress === "t1002@college.example.edu"), "the class coordinator is copied on critical alerts");
check(outboxFiles().filter((f) => f.includes("-sms-")).length > smsBefore, "parents of critical cases also get an SMS");
check((await get("/notifications", await as("S26BCA008"))).body.includes("Low attendance warning"), "the student gets an in-app low-attendance warning (FR-35)");
check(emails.every((e) => e.status === "QUEUED"), "emails are queued, not sent inline");

heading("Day 9 · Queue: pause, send, bounce, resend (FR-39)");
await act("/admin/reports", admin, (f) => f.includes(run.id) && f.includes("Pause"), {});
check((await db.reportRun.findUnique({ where: { id: run.id } })).status === "PAUSED", "admin pauses the run");
await act("/admin/reports", admin, "Send queued emails now", {});
check((await db.emailLog.count({ where: { runId: run.id, status: "SENT" } })) === 0, "a paused run's emails are held back");
await act("/admin/reports", admin, (f) => f.includes(run.id) && f.includes("Resume"), {});
r = await act("/admin/reports", admin, "Send queued emails now", {});
emails = await db.emailLog.findMany({ where: { runId: run.id } });
const bounced = emails.find((e) => e.toAddress === "old@bounce.example");
check(emails.filter((e) => e.status === "SENT").length === emails.length - 1, "after resuming, every good address is sent");
check(bounced?.status === "BOUNCED" && bounced.lastError?.includes("550"), "a bad address is marked bounced and not retried");
check((await db.reportRun.findUnique({ where: { id: run.id } })).status === "COMPLETED", "the run is marked complete");
check((await get("/notifications", admin)).body.includes("Email delivery problems"), "admins are alerted about bounces");
check((await get("/admin/reports?status=BOUNCED", admin)).body.includes("old@bounce.example"), "the delivery log filters by status");
await act("/admin/reports?status=BOUNCED", admin, (f) => f.includes(bounced.id) && f.includes("Resend"), {});
check((await db.emailLog.count({ where: { toAddress: "old@bounce.example", status: "QUEUED" } })) === 1, "admin can resend an email");

heading("Day 9 · Scheduled reports and queued notice emails");
await setSetting("reportDayOfMonth", 1);
await tick();
const prev = shiftMonth(today.slice(0, 7), -1);
if (istHour >= 7) {
  check((await db.reportRun.count({ where: { monthKey: prev, trigger: "SCHEDULED" } })) === 1, "the tick job runs last month's reports on the set day (FR-36)");
  await tick();
  check((await db.reportRun.count({ where: { monthKey: prev, trigger: "SCHEDULED" } })) === 1, "it runs only once per month");
} else console.log("SKIP  scheduled report checks (they only run after 07:00 college time)");
r = await act("/admin/notices", admin, 'name="title"', { title: "Parents meeting", body: "Saturday 10:00.", category: "EVENT", audience: "PARENTS", year: "3", notifyOnPublish: "on", emailOnPublish: "on", publishTime: "09:00" });
check((await db.emailLog.count({ where: { kind: "NOTICE", subject: { contains: "Parents meeting" } } })) > 0, "notice emails now go through the queue");

heading("Day 9 · Analytics (FR-29), exports, audit log (FR-30)");
r = await get("/admin/analytics", admin);
check(r.body.includes("Class attendance by day") && r.body.includes("<svg") && r.body.includes("Kavya Pillai") && r.body.includes("Show as a table"), "admin sees the day-wise chart (with table view) and the defaulters list");
const t1001 = await as("T1001");
const t2001 = await as("T2001");
check((await get("/hod/analytics", t1001)).body.includes("Kavya Pillai"), "the CS HOD sees CS defaulters");
check(!(await get("/hod/analytics", t2001)).body.includes("Kavya Pillai"), "the Commerce HOD does not");
let res = await fetch(`${BASE}/api/exports/defaulters?format=xlsx`, { headers: { cookie: admin } });
let bytes = new Uint8Array(await res.arrayBuffer());
check(res.status === 200 && res.headers.get("content-type")?.includes("spreadsheetml") && bytes[0] === 0x50 && bytes[1] === 0x4b, "defaulters export as a real Excel file");
check((await (await fetch(`${BASE}/api/exports/defaulters?format=csv`, { headers: { cookie: admin } })).text()).includes("Kavya Pillai"), "defaulters export as CSV");
check((await fetch(`${BASE}/api/exports/defaulters?format=csv&dept=${cs.id}`, { headers: { cookie: t2001 } })).status === 403, "a HOD cannot export another department");
const register = await (await fetch(`${BASE}/api/exports/attendance?section=${cs1A.id}&month=${month}&format=csv`, { headers: { cookie: admin } })).text();
check(register.includes("Roll no") && register.includes("S26BCA008") && /P\d/.test(register), "monthly attendance register export (accreditation)");
check((await fetch(`${BASE}/api/exports/attendance?section=${cs1A.id}&month=${month}&format=csv`, { headers: { cookie: await as("S26BCA001") } })).status === 403, "students cannot export registers");
const pubA = await db.assessment.findFirst({ where: { status: "PUBLISHED" } });
check((await fetch(`${BASE}/api/exports/marks/${pubA.id}`, { headers: { cookie: admin } })).status === 200, "marks sheet export");
r = await get("/admin/audit?action=LOGIN", admin);
check(r.body.includes("LOGIN_SUCCESS") && r.body.includes("entries match"), "audit log viewer filters by action");
check((await (await fetch(`${BASE}/api/exports/audit?action=LOGIN`, { headers: { cookie: admin } })).text()).includes("LOGIN_SUCCESS"), "audit log export");
check((await fetch(`${BASE}/api/exports/audit`, { headers: { cookie: t1001 } })).status === 403, "only admins can export the audit log");

// =============================================================================
heading("Day 10 · Security headers and privacy page");
res = await fetch(`${BASE}/login`);
const csp = res.headers.get("content-security-policy") ?? "";
check(csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'"), "a Content-Security-Policy is sent");
check(res.headers.get("x-frame-options") === "DENY" && res.headers.get("x-content-type-options") === "nosniff", "clickjacking and MIME-sniffing protection");
check((res.headers.get("permissions-policy") ?? "").includes("geolocation=(self)") && !res.headers.get("x-powered-by"), "location limited to this site; no framework banner");
check((await get("/privacy")).body.includes("Location is read only when you tap"), "the privacy notice is public");

heading("Day 10 · Two-step sign-in, password change (FR-3)");
const t1003 = await as("T1003");
r = await act("/account/security", t1003, 'name="enable"', {});
check(r.body.includes("Two-step sign-in is on"), "a teacher turns on two-step sign-in");
r = await login("T1003");
const pending = cookieOf(r, "cas_2fa");
check(r.status === 303 && r.location?.startsWith("/account/verify") && pending && !cookieOf(r), "after the password, a code is required and no session exists yet");
r = await act("/account/verify", pending, 'name="code"', { code: latestCode("t1003@college.example.edu") === "111111" ? "222222" : "111111" });
check(r.body.includes("not correct"), "a wrong code is refused");
r = await act("/account/verify", pending, 'name="code"', { code: latestCode("t1003@college.example.edu") });
const t1003b = cookieOf(r);
check(r.status === 303 && r.location?.endsWith("/teacher") && t1003b, "the right code signs the teacher in");
check((await get("/teacher", t1003b)).body.includes("Anita Desai"), "the new session works");
const s010 = await as("S26BCA010");
r = await act("/account/security", s010, 'name="currentPassword"', { currentPassword: "wrong-pass1", password: "Better123", confirmPassword: "Better123" });
check(r.body.includes("current password is not correct"), "changing password needs the current one");
r = await act("/account/security", s010, 'name="currentPassword"', { currentPassword: "Demo@1234", password: "Better123", confirmPassword: "Better123" });
check(r.body.includes("Password changed"), "a student changes their password");
check((await get("/student", s010)).body.includes("/auth/reset"), "other sessions are signed out");
check((await login("S26BCA010", "Better123")).location?.endsWith("/student"), "the new password works");

heading("Day 10 · Privacy consent (PRD §7, DPDP)");
r = await act("/admin/users/new", admin, 'name="kind"', {
  kind: "STUDENT", collegeId: "S26BCA950", name: "Minor Student", email: "minor.student@example.com", sectionId: cs1A.id,
  admissionYear: "2026", dateOfBirth: "2010-01-01", parentName: "Minor Parent", parentEmail: "minor.parent@example.com", relationship: "Guardian",
});
const temp = r.body.match(/"secret":"([A-Za-z]+-\d{4}-[A-Za-z]+)"/)?.[1];
let c = cookieOf(await login("S26BCA950", temp));
await act("/account/setup", c, "Send code", {});
r = await act("/account/setup", c, "Save and continue", { code: latestCode("minor.student@example.com"), password: "Minor1234", confirmPassword: "Minor1234" });
c = cookieOf(r);
check(r.location?.endsWith("/account/consent"), "a new user is shown the privacy notice after setup");
check((await get("/student", c)).body.includes("/account/consent"), "the portal stays closed until they agree");
check((await punch(c)).status === 401, "no location is accepted before consent");
r = await act("/account/consent", c, 'name="agree"', { agree: "on" });
check(r.body.includes("parent or guardian must also agree"), "a student under 18 needs guardian agreement too");
r = await act("/account/consent", c, 'name="agree"', { agree: "on", guardian: "on" });
check(r.status === 303 && r.location?.endsWith("/student"), "with both boxes ticked the portal opens");
check((await db.user.findUnique({ where: { collegeId: "S26BCA950" } })).consentVersion?.endsWith("+guardian"), "the consent and its version are recorded");
check((await punch(c)).status === 200, "punching works after consent");

heading("Day 10 · Rate limits (PRD §7)");
const s011 = await as("S26BCA011");
let last;
for (let i = 0; i < 21; i++) last = await punch(s011, { deviceId: "device-s011-ratelimit" });
check(last.status === 429 && last.headers.get("retry-after"), "a student hammering the punch API is slowed down");
for (let i = 0; i < 5; i++) await act("/account/recover", null, "Send code", { collegeId: "S26BCA012" });
r = await act("/account/recover", null, "Send code", { collegeId: "S26BCA012" });
check(r.body.includes("Too many code requests"), "code requests are limited per college ID");

heading("Day 10 · Year-end promotion (FR-28)");
await act("/admin/academic", admin, 'name="startDate"', { name: "2027-28", startDate: "2027-06-14", endDate: "2028-04-30" });
const nextYear = await db.academicYear.findUnique({ where: { name: "2027-28" } });
const s001 = await db.student.findUnique({ where: { rollNo: "S26BCA001" } });
const recordsBefore = await db.attendanceRecord.count({ where: { studentId: s001.id } });
r = await act("/admin/promotion", admin, 'name="confirm"', { targetYearId: nextYear.id, confirm: "yes", makeCurrent: "on" });
check(r.body.includes("Type PROMOTE"), "promotion needs typed confirmation");
r = await act("/admin/promotion", admin, 'name="confirm"', { targetYearId: nextYear.id, confirm: "PROMOTE", makeCurrent: "on" });
check(r.body.includes("students promoted"), "admin promotes every student", r.body.match(/"error":"[^"]*"/)?.[0]);
const moved = await db.student.findUnique({ where: { id: s001.id }, include: { section: true } });
check(moved.year === 2 && moved.section.year === 2 && moved.section.name === "A" && moved.section.academicYearId === nextYear.id, "Year 1 students move to Year 2 in the new year");
const grad = await db.student.findUnique({ where: { rollNo: "S24BCA001" }, include: { user: true } });
check(grad.status === "PASSED_OUT" && !grad.user.isActive, "Year 3 students are marked passed out and can't sign in");
check((await db.attendanceRecord.count({ where: { studentId: s001.id } })) === recordsBefore, "past attendance records are kept");
check((await db.academicYear.findUnique({ where: { id: nextYear.id } })).isCurrent, "the new year becomes current");
r = await act("/admin/promotion", admin, 'name="confirm"', { targetYearId: nextYear.id, confirm: "PROMOTE", makeCurrent: "on" }).catch(() => ({ body: "already" }));
check(r.body.includes("already") || r.body.includes("create the next academic year"), "promotion cannot run twice into the same year");

heading("Day 10 · Failed sign-ins from one network (run last)");
for (let i = 0; i < 50; i++) await login(`NOSUCH${i}`, "wrong-pass");
r = await login("ADMIN01");
check(r.body.includes("Too many failed sign-ins from this network") && !cookieOf(r), "after many failures from one network, sign-ins are paused");

await db.$disconnect();
console.log(failures === 0 ? "\nAll Day 9-10 checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures ? 1 : 0);
