// End-to-end checks for Days 2-5 against a running server, on freshly seeded data:
//   npm run db:seed && npm run build && npm start      (then, in another terminal)
//   node tests/e2e-days2-5.mjs . http://localhost:3000
// It changes data (creates users, punches, requests). Run npm run db:seed afterwards.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const APP = path.resolve(process.argv[2] ?? ".");
const BASE = process.argv[3] ?? "http://localhost:3000";
process.env.DATABASE_URL = "file:" + path.join(APP, "prisma", "dev.db").replace(/\\/g, "/");
const require = createRequire(path.join(APP, "package.json"));
const { PrismaClient } = require("@prisma/client");
const fflate = require("fflate");
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

// --- helpers ------------------------------------------------------------------
const clean = (h) => h.replace(/<!-- -->/g, "");
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const IST = 5.5 * 3600_000;
const dateKey = (ms = Date.now()) => new Date(ms + IST).toISOString().slice(0, 10);
const addDays = (k, n) => {
  const d = new Date(k + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (k) => ((new Date(k + "T12:00:00Z").getUTCDay() + 6) % 7) + 1; // 1=Mon
const today = dateKey();
const tomorrow = addDays(today, 1);

async function get(p, cookie) {
  const r = await fetch(BASE + p, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { status: r.status, location: r.headers.get("location"), body: clean(await r.text()), type: r.headers.get("content-type") };
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
/** Submits the first form on a page matching `match`, like a browser without JS. */
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
async function login(id, password) {
  const r = await act("/login", null, 'name="collegeId"', { collegeId: id, password, next: "" });
  return { ...r, cookie: r.setCookie.match(/cas_session=[^;]+/)?.[0] ?? null };
}
const cookieOf = (r) => r.setCookie.match(/cas_session=[^;]+/)?.[0] ?? null;
function latestCode(to) {
  const dir = path.join(APP, ".outbox");
  const file = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.includes(to)).sort().pop() : null;
  return file ? fs.readFileSync(path.join(dir, file), "utf8").match(/is: (\d{6})/)?.[1] : null;
}
const outboxCount = (to) => (fs.existsSync(path.join(APP, ".outbox")) ? fs.readdirSync(path.join(APP, ".outbox")).filter((f) => f.includes(to)).length : 0);
async function punch(cookie, body, headers = {}) {
  const r = await fetch(BASE + "/api/punch", {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}), ...headers },
    body: JSON.stringify({ type: "IN", latitude: 12.9716, longitude: 77.5946, accuracy: 10, deviceTime: Date.now(), source: "LIVE", ...body }),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function setSetting(key, value) {
  if (value === undefined) return db.setting.deleteMany({ where: { key } });
  await db.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
}
function xlsx(rows) {
  const shared = rows[0];
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const cell = (v, r, c) => {
    const ref = String.fromCharCode(65 + c) + (r + 1);
    return r === 0 ? `<c r="${ref}" t="s"><v>${shared.indexOf(v)}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  };
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${rows
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => (v === "" ? "" : cell(v, r, c))).join("")}</row>`)
    .join("")}</sheetData></worksheet>`;
  const u = fflate.strToU8;
  return fflate.zipSync({
    "[Content_Types].xml": u("<Types/>"),
    "xl/workbook.xml": u('<workbook xmlns:r="r"><sheets><sheet name="Teachers" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": u('<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": u(sheet),
    "xl/sharedStrings.xml": u(`<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`),
  });
}

const cs = await db.department.findUnique({ where: { code: "CS" } });
const sections = await db.section.findMany({ include: { department: true } });
const sec = (code, year, name) => sections.find((s) => s.department.code === code && s.year === year && s.name === name);
const cs1A = sec("CS", 1, "A");
const cs1B = sec("CS", 1, "B");
const cs2A = sec("CS", 2, "A");
const teacherId = async (collegeId) => (await db.teacher.findFirst({ where: { user: { collegeId } } })).id;
const subjectId = async (code) => (await db.subject.findUnique({ where: { code } })).id;

const admin = await login("ADMIN01", "Demo@1234");

// =============================================================================
heading("Day 2 · Academic setup");
let r = await act("/admin/academic", admin.cookie, 'name="programme"', { code: "math", name: "Mathematics", programme: "B.Sc. Mathematics" });
check(r.body.includes("Department MATH added"), "admin adds a department (code upper-cased)", r.body.match(/role="alert"[^<]*<p[^>]*>([^<]*)/)?.[1]);
const math = await db.department.findUnique({ where: { code: "MATH" } });
r = await act("/admin/academic", admin.cookie, 'name="programme"', { code: "MATH", name: "Dup", programme: "Dup prog" });
check(r.body.includes("already used"), "duplicate department code is rejected");
r = await act("/admin/academic/sections", admin.cookie, "Add section", { departmentId: math.id, year: "1", name: "a" });
check(r.body.includes("Section 1-A added"), "admin adds a section");
r = await act("/admin/academic/subjects", admin.cookie, "Add subject", { code: "ma101", name: "Calculus", departmentId: math.id, year: "1", semester: "3", credits: "4", type: "THEORY" });
check(r.body.includes("Year 1 has semesters 1-2"), "subject semester must match its year");
r = await act("/admin/academic/subjects", admin.cookie, "Add subject", { code: "ma101", name: "Calculus", departmentId: math.id, year: "1", semester: "1", credits: "4", type: "THEORY" });
check(r.body.includes("Subject MA101 added"), "admin adds a subject");
r = await act(`/admin/academic/mapping?dept=${cs.id}`, admin.cookie, ">Assign<", { sectionId: cs1A.id, subjectId: await subjectId("CS201"), teacherId: await teacherId("T1003") });
check(r.body.includes("different department or year"), "mapping a Year 2 subject to a Year 1 section is refused");
r = await act("/admin/academic/sections", admin.cookie, (f) => f.includes(cs1B.id) && f.includes("Split"), { count: "2" });
check(r.body.includes("students split into 2 batches"), "admin splits a section into lab batches");
check((await db.batch.count({ where: { sectionId: cs1B.id } })) === 2, "two batches exist for CS 1-B");

// =============================================================================
heading("Day 2 · Users, first login with OTP");
r = await act("/admin/users/new", admin.cookie, 'name="kind"', {
  kind: "STUDENT", collegeId: "s26cs900", name: "Test Student", email: "test.student@example.com",
  sectionId: cs1A.id, admissionYear: "2026", parentName: "Test Parent", parentEmail: "test.parent@example.com", relationship: "Guardian",
});
// Action results travel in React's payload and render on hydration, so read them from there.
const temp = r.body.match(/"secret":"([A-Za-z]+-\d{4}-[A-Za-z]+)"/)?.[1];
check(Boolean(temp), "admin creates a student and sees a one-time temporary password", r.body.match(/role="alert"[\s\S]{0,300}/)?.[0]);
let s900 = await login("S26CS900", temp);
check(s900.status === 303 && s900.location?.endsWith("/account/setup"), "first login with temporary password goes to account setup", s900.location);
r = await get("/student", s900.cookie);
check(r.body.includes("/account/setup"), "portal pages redirect to setup until it is finished");
r = await act("/account/setup", s900.cookie, "Send code", {});
check(r.body.includes("We sent a 6-digit code to t"), "setup sends a code to the masked email");
const code900 = latestCode("test.student@example.com");
check(/^\d{6}$/.test(code900 ?? ""), "code is delivered to the dev outbox");
r = await act("/account/setup", s900.cookie, "Save and continue", { code: code900 === "000000" ? "111111" : "000000", password: "NewPass123", confirmPassword: "NewPass123" });
check(r.body.includes("That code is not correct"), "a wrong code is rejected");
r = await act("/account/setup", s900.cookie, "Save and continue", { code: code900, password: "short", confirmPassword: "short" });
check(r.body.includes("at least 8 characters"), "weak password is rejected");
r = await act("/account/setup", s900.cookie, "Save and continue", { code: code900, password: "NewPass123", confirmPassword: "NewPass123" });
const newCookie = cookieOf(r);
check(r.status === 303 && r.location?.endsWith("/student") && newCookie, "correct code + strong password completes setup", `${r.status} ${r.location}`);
check((await get("/student", s900.cookie)).body.includes("/auth/reset"), "the old session is signed out after the password change");
check((await get("/student", newCookie)).body.includes("S26CS900"), "the renewed session opens the student portal");
check((await login("S26CS900", "NewPass123")).location?.endsWith("/student"), "student signs in with the new password");

heading("Day 2 · Bulk import (CSV and Excel) and account activation");
const csv =
  "name,college_id,year,department,section,parent_name,parent_email,parent_phone,email\n" +
  "Import One,S26CS901,1,CS,A,Parent One,p1@example.com,,import.one@example.com\n" +
  '"Two, Import",S26CS902,1,CS,B,Parent Two,p2@example.com,,\n' +
  "Bad Row,S26CS001,1,CS,Z,,not-an-email,,\n";
r = await act("/admin/import", admin.cookie, 'name="file"', { kind: "STUDENTS" }, { file: { data: csv, type: "text/csv", name: "students.csv" } });
check(r.status === 303 && r.location?.includes("/admin/import?job="), "CSV upload produces a preview", r.status);
const jobPath = r.location?.replace(BASE, "") ?? "/admin/import";
r = await get(jobPath, admin.cookie);
check(r.body.includes("2 ready") && r.body.includes("already exists") && r.body.includes("not found in CS") && r.body.includes("Parent email is not valid"), "preview shows valid rows and per-row errors");
check((await db.user.count({ where: { collegeId: { in: ["S26CS901", "S26CS902"] } } })) === 0, "nothing is saved before confirming");
r = await act(jobPath, admin.cookie, "Import 2 valid rows", {});
check(r.body.includes("Created 2 accounts"), "commit creates the valid rows", r.body.match(/role="(alert|status)"[\s\S]{0,200}/)?.[0]);
check((await db.user.findUnique({ where: { collegeId: "S26CS902" } }))?.name === "Two, Import", "quoted CSV field with a comma is read correctly");
check((await login("S26CS901", "anything123")).body.includes("Invalid college ID or password"), "imported account has no usable password yet");
const before901 = outboxCount("import.one@example.com");
r = await act("/account/recover", null, "Send code", { collegeId: "s26cs901" });
check(r.body.includes("If that college ID is registered"), "activation request gives a neutral answer");
check(outboxCount("import.one@example.com") === before901 + 1, "activation code was sent to the student's email");
r = await act("/account/recover", null, "Send code", { collegeId: "NOSUCH999" });
check(r.body.includes("If that college ID is registered"), "unknown IDs get the same neutral answer");
r = await act("/account/recover", null, "Set password", { collegeId: "S26CS901", code: latestCode("import.one@example.com"), password: "Imported123", confirmPassword: "Imported123" });
check(r.status === 303 && r.location?.includes("/login?notice=password-set"), "code + new password activates the account", `${r.status} ${r.location}`);
check((await login("S26CS901", "Imported123")).location?.endsWith("/student"), "activated student can sign in");

const book = xlsx([
  ["name", "college_id", "department", "email", "designation", "roles", "mentor_section"],
  ["Priya Raman", "T1050", "CS", "priya.raman@example.edu", "Assistant Professor", "TEACHER;MENTOR", "1-B"],
  ["No Email", "T1051", "CS", "", "", "TEACHER", ""],
]);
r = await act("/admin/import", admin.cookie, 'name="file"', { kind: "TEACHERS" }, { file: { data: book, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: "teachers.xlsx" } });
const xJob = r.location?.replace(BASE, "") ?? "";
r = await get(xJob, admin.cookie);
check(r.body.includes("1 ready") && r.body.includes("Email is needed"), "Excel (.xlsx) file is read, with shared and inline strings");
await act(xJob, admin.cookie, "Import 1 valid row", {});
const priya = await db.user.findUnique({ where: { collegeId: "T1050" }, include: { roles: true, teacher: true } });
check(priya?.roles.some((x) => x.role === "MENTOR" && x.sectionId === cs1B.id), "imported teacher gets the MENTOR role for 1-B");
check((await db.student.count({ where: { sectionId: cs1B.id, mentorId: priya?.teacher?.id } })) > 0, "1-B students now have the new coordinator");

heading("Day 2 · Account administration and server-side checks");
const s004 = await login("S26CS004", "Demo@1234");
const u004 = await db.user.findUnique({ where: { collegeId: "S26CS004" } });
r = await act(`/admin/users/${u004.id}`, admin.cookie, (f) => f.includes("Deactivate account"), {});
check(r.body.includes("deactivated") || (await db.user.findUnique({ where: { id: u004.id } })).isActive === false, "admin deactivates an account");
check((await get("/student", s004.cookie)).body.includes("/auth/reset"), "a deactivated user's open session stops working");
check((await login("S26CS004", "Demo@1234")).body.includes("deactivated"), "a deactivated user cannot sign in");
await act(`/admin/users/${u004.id}`, admin.cookie, (f) => f.includes("Activate account"), {});
r = await act(`/admin/users/${u004.id}`, admin.cookie, (f) => f.includes("Reset password"), {});
check(/"secret":"[A-Za-z]+-\d{4}-[A-Za-z]+"/.test(r.body), "admin password reset shows a one-time temporary password");
const student = await login("S26CS005", "Demo@1234");
r = await act("/admin/users/new", admin.cookie, 'name="kind"', { kind: "ADMIN", collegeId: "HACKER1", name: "Hacker", email: "" }, {}, "/student", student.cookie);
check((await db.user.count({ where: { collegeId: "HACKER1" } })) === 0, "a student calling the admin 'create user' action directly is refused on the server");

// =============================================================================
heading("Day 3 · Geofenced punch in / out");
await setSetting("enforceSchedule", false); // tests run at any hour; the schedule is tested separately below
r = await act("/admin/geofence", admin.cookie, "Add point", { name: "Far campus", latitude: "13.4", longitude: "77.6", radiusMeters: "200" });
check(r.body.includes("Campus point added"), "admin adds a second campus point");
const s002 = await login("S26CS002", "Demo@1234");
const devA = "device-s002-aaaaaaaa";
let p = await punch(s002.cookie, { dryRun: true, deviceId: devA });
check(p.json?.code === "READY" && p.json.inside === true, "dry run inside campus says ready, with distance", JSON.stringify(p.json));
check((await db.punchRecord.count({ where: { student: { rollNo: "S26CS002" } } })) === 0, "dry runs are not stored");
p = await punch(s002.cookie, { deviceId: devA, accuracy: 80 });
check(p.json?.code === "POOR_ACCURACY", "poor GPS accuracy is rejected (FR-8)");
p = await punch(s002.cookie, { deviceId: devA, latitude: 12.9816 });
check(p.json?.code === "OUTSIDE_GEOFENCE" && p.json.distanceMeters > 1000, "1.1 km away is rejected with the distance (FR-5)", JSON.stringify(p.json));
p = await punch(s002.cookie, { deviceId: devA });
check(p.json?.accepted === true && p.json.code === "OK", "punch in inside campus is accepted", JSON.stringify(p.json));
check((await db.device.findFirst({ where: { user: { collegeId: "S26CS002" } } }))?.status === "APPROVED", "first phone is registered automatically (FR-4)");
p = await punch(s002.cookie, { deviceId: devA });
check(p.json?.code === "ALREADY_IN", "second punch-in is refused");
p = await punch(s002.cookie, { type: "OUT", deviceId: "device-s002-bbbbbbbb" });
check(p.json?.code === "DEVICE_NOT_REGISTERED", "punching from another phone is refused and requests approval");
const devB = await db.device.findFirst({ where: { user: { collegeId: "S26CS002" }, status: "PENDING" } });
check(Boolean(devB), "a pending device request is created");
p = await punch(s002.cookie, { type: "OUT", deviceId: devA });
check(p.json?.accepted && p.json.message.startsWith("Punched out"), "punch out from the registered phone works (FR-6)", p.json?.message);
p = await punch(s002.cookie, { deviceId: devA });
check(p.json?.code === "ALREADY_DONE", "only one campus session per day by default");
p = await punch(s002.cookie, { deviceId: devA, mocked: true });
check(p.json?.code === "MOCK_LOCATION", "a reported fake-location app is rejected (FR-9)");
check((await db.punchRecord.count({ where: { student: { rollNo: "S26CS002" }, status: "REJECTED" } })) >= 5, "rejected attempts are stored for the exceptions report");
r = await act("/admin/devices", admin.cookie, (f) => f.includes(devB.id) && f.includes("Approve"), {});
const devices = await db.device.findMany({ where: { user: { collegeId: "S26CS002" } } });
check(devices.find((d) => d.id === devB.id)?.status === "APPROVED" && devices.find((d) => d.id !== devB.id)?.status === "REVOKED", "approving the new phone revokes the old one");
p = await punch(s002.cookie, { dryRun: true, deviceId: devA });
check(p.json?.code === "DEVICE_BLOCKED", "the revoked phone can no longer punch");

const s005 = await login("S26CS005", "Demo@1234");
const offTime = Date.now() - 2 * 3600_000;
p = await punch(s005.cookie, { deviceId: "device-s005-cccccccc", source: "OFFLINE", deviceTime: offTime });
check(p.json?.accepted === true, "offline punch is accepted after sync (FR-12)", JSON.stringify(p.json));
const off = await db.punchRecord.findFirst({ where: { student: { rollNo: "S26CS005" }, status: "ACCEPTED" } });
check(off?.effectiveTime.getTime() === offTime && off.source === "OFFLINE", "offline punch keeps the time it was made");
p = await punch(s005.cookie, { deviceId: "device-s005-cccccccc", source: "OFFLINE", deviceTime: offTime });
check(p.json?.code === "DUPLICATE", "re-sending the same offline punch does not count twice");
p = await punch(s005.cookie, { type: "OUT", deviceId: "device-s005-cccccccc", source: "OFFLINE", deviceTime: Date.now() + 3600_000 });
check(p.json?.code === "FUTURE_TIME", "an offline punch dated in the future is rejected");
const s006 = await login("S26CS006", "Demo@1234");
p = await punch(s006.cookie, { deviceId: "device-s006-dddddddd", source: "OFFLINE", deviceTime: Date.now() - 13 * 3600_000 });
const late = await db.punchRecord.findFirst({ where: { student: { rollNo: "S26CS006" } } });
check(p.json?.accepted && late?.flags?.includes("LATE_SYNC"), "a sync later than the limit is flagged for review");
const s007 = await login("S26CS007", "Demo@1234");
p = await punch(s007.cookie, { deviceId: "device-s007-eeeeeeee", deviceTime: Date.now() - 30 * 60_000 });
const skew = await db.punchRecord.findFirst({ where: { student: { rollNo: "S26CS007" }, type: "IN" } });
check(p.json?.accepted && skew?.flags?.includes("CLOCK_SKEW"), "a phone clock 30 min off is flagged (FR-9)");
p = await punch(s007.cookie, { type: "OUT", deviceId: "device-s007-eeeeeeee", latitude: 13.4, longitude: 77.6 });
const jump = await db.punchRecord.findFirst({ where: { student: { rollNo: "S26CS007" }, type: "OUT" } });
check(p.json?.accepted && jump?.flags?.includes("IMPOSSIBLE_MOVEMENT"), "47 km in a minute is flagged as impossible movement", JSON.stringify(p.json));

check((await punch(null, { deviceId: "x-device-000" })).status === 401, "punch without signing in is refused");
const t1002 = await login("T1002", "Demo@1234");
check((await punch(t1002.cookie, { deviceId: "x-device-000" })).status === 403, "teachers cannot punch as students");
check((await punch(s002.cookie, { deviceId: devA }, { origin: "https://evil.example" })).status === 403, "cross-site punch requests are refused");
check((await punch(s002.cookie, { deviceId: "x", latitude: "abc" })).status === 400, "malformed punch data is refused");

const s008 = await login("S26CS008", "Demo@1234");
await setSetting("enforceSchedule", true);
await setSetting("workingDays", [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== weekday(today)));
p = await punch(s008.cookie, { dryRun: true, deviceId: "device-s008-ffffffff" });
check(p.json?.code === "NOT_WORKING_DAY", "punching is closed on non-working days (FR-13)", JSON.stringify(p.json));
await setSetting("workingDays", [1, 2, 3, 4, 5, 6, 7]);
await setSetting("collegeStart", "23:00");
await setSetting("earlyArrivalMinutes", 0);
await setSetting("punchCutoff", "23:30");
p = await punch(s008.cookie, { dryRun: true, deviceId: "device-s008-ffffffff" });
const nowMin = new Date(Date.now() + IST).getUTCHours() * 60 + new Date(Date.now() + IST).getUTCMinutes();
check(p.json?.code === "OUTSIDE_HOURS" || (nowMin >= 1380 && nowMin <= 1410), "punching is closed outside college hours (FR-13)", JSON.stringify(p.json));
for (const k of ["workingDays", "collegeStart", "earlyArrivalMinutes", "punchCutoff"]) await setSetting(k, undefined);
await setSetting("collegeStart", "08:30");
await setSetting("punchCutoff", "18:00");
await setSetting("enforceSchedule", false);
r = await get("/admin/punches", admin.cookie);
check(r.body.includes("OUTSIDE_GEOFENCE") && r.body.includes("IMPOSSIBLE_MOVEMENT"), "admin punch log shows rejections and flags");
r = await get("/student/punch", s002.cookie);
check(r.body.includes("Done for today") && r.body.includes("COMPLETE"), "student punch screen shows today's completed session");

// =============================================================================
heading("Day 4 · Calendar and notifications");
r = await act("/admin/calendar", admin.cookie, "Add to calendar", { title: "Test Holiday", type: "HOLIDAY", startDate: tomorrow });
check(r.body.includes("notified"), "admin adds a holiday");
r = await act("/admin/calendar", admin.cookie, "Add to calendar", { title: "Bad Saturday", type: "WORKING_SATURDAY", startDate: weekday(tomorrow) === 6 ? addDays(tomorrow, 1) : tomorrow });
check(r.body.includes("must be a single Saturday"), "a working Saturday must be a Saturday");
check((await get("/notifications", s002.cookie)).body.includes("Calendar added: Holiday · Test Holiday"), "students are notified of calendar changes (FR-16)");
check((await get("/notifications", t1002.cookie)).body.includes("Test Holiday"), "teachers are notified too");
check((await get(`/student/calendar?month=${tomorrow.slice(0, 7)}`, s002.cookie)).body.includes("Test Holiday"), "the student calendar shows the holiday");
check((await get("/student/timetable", s002.cookie)).body.includes("Holiday: Test Holiday"), "the holiday cancels tomorrow's classes (FR-62)");
const calBad = "start_date,type,title\n2026-13-40,HOLIDAY,Bad date\n";
r = await act("/admin/calendar", admin.cookie, 'name="file"', {}, { file: { data: calBad, type: "text/csv", name: "cal.csv" } });
check(r.body.includes("Nothing imported"), "calendar import with an error imports nothing");
const calOk = `start_date,end_date,type,title,department,year\n${addDays(today, 40)},,EVENT,Sports day,,\n${addDays(today, 41)},${addDays(today, 42)},EXAM,Lab exam,CS,1\n`;
r = await act("/admin/calendar", admin.cookie, 'name="file"', {}, { file: { data: calOk, type: "text/csv", name: "cal.csv" } });
check(r.body.includes("Imported 2 calendar entries"), "a valid calendar file imports all rows");

heading("Day 4 · Regularisation (FR-11)");
const s001 = await login("S26CS001", "Demo@1234");
const incomplete = await db.campusSession.findFirst({ where: { student: { rollNo: "S26CS001" }, status: "INCOMPLETE" } });
r = await act("/student/requests", s001.cookie, "Send request", { dateKey: tomorrow, requestedIn: "09:10", requestedOut: "16:00", reason: "FORGOT", details: "Testing future date" });
check(r.body.includes("Cannot be in the future"), "regularisation for a future date is refused");
r = await act("/student/requests", s001.cookie, "Send request", { dateKey: incomplete.dateKey, requestedIn: "09:10", requestedOut: "16:00", reason: "FORGOT", details: "Forgot to punch out at four" });
check(r.body.includes("Regularisation request sent"), "student requests regularisation for an incomplete day");
r = await act("/student/requests", s001.cookie, "Send request", { dateKey: incomplete.dateKey, requestedIn: "09:10", requestedOut: "16:00", reason: "FORGOT", details: "Second try" });
check(r.body.includes("already have a pending request"), "duplicate pending requests are refused");
const reg = await db.regularisationRequest.findFirst({ where: { student: { rollNo: "S26CS001" }, status: "PENDING" } });
check((await get("/notifications", t1002.cookie)).body.includes("Regularisation request from Aarav Sharma"), "the class coordinator is notified");
const t1003 = await login("T1003", "Demo@1234");
check((await get("/teacher/approvals", t1003.cookie)).body.includes("don't have either role"), "a teacher who is neither coordinator nor HOD sees no requests");
await act("/teacher/approvals", t1002.cookie, (f) => f.includes(reg.id), { decision: "APPROVED" }, {}, "/teacher/approvals", t1003.cookie);
check((await db.regularisationRequest.findUnique({ where: { id: reg.id } })).status === "PENDING", "that teacher cannot approve it by calling the action directly");
r = await act("/teacher/approvals", t1002.cookie, (f) => f.includes(reg.id), { decision: "REJECTED", note: "" });
check(r.body.includes("Add a short reason"), "rejecting needs a reason");
r = await act("/teacher/approvals", t1002.cookie, (f) => f.includes(reg.id), { decision: "APPROVED" });
const fixed = await db.campusSession.findUnique({ where: { id: incomplete.id } });
check(fixed.status === "REGULARISED" && fixed.minutesOnCampus === 410, "approval records the campus day (09:10-16:00 = 410 min)", JSON.stringify(fixed));
check((await get("/notifications", s001.cookie)).body.includes("Regularisation approved"), "the student is notified of the decision");

heading("Day 4 · Leave with documents (FR-17)");
const leaveDay = addDays(today, 3);
const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
r = await act("/student/requests", s001.cookie, "Send leave request", { fromDate: leaveDay, toDate: addDays(leaveDay, 3), type: "MEDICAL", reason: "Fever and cold" });
check(r.body.includes("Attach a medical certificate"), "medical leave over 2 days needs a certificate");
r = await act("/student/requests", s001.cookie, "Send leave request", { fromDate: leaveDay, toDate: leaveDay, type: "MEDICAL", reason: "Fever and cold" }, { document: { data: new TextEncoder().encode("not really a pdf"), type: "application/pdf", name: "fake.pdf" } });
check(r.body.includes("Only PDF, JPEG or PNG"), "a file that is not really a PDF is refused (checked by content)");
r = await act("/student/requests", s001.cookie, "Send leave request", { fromDate: leaveDay, toDate: leaveDay, type: "MEDICAL", reason: "Fever and cold" }, { document: { data: pdf, type: "application/pdf", name: "certificate.pdf" } });
check(r.body.includes("Leave request sent"), "leave with a PDF certificate is sent");
r = await act("/student/requests", s001.cookie, "Send leave request", { fromDate: leaveDay, toDate: leaveDay, type: "PERSONAL", reason: "Overlapping request" });
check(r.body.includes("already have a pending leave"), "overlapping leave is refused");
const leave = await db.leaveRequest.findFirst({ where: { student: { rollNo: "S26CS001" } } });
const doc = (c) => fetch(`${BASE}/api/leave/${leave.id}/document`, { headers: { cookie: c } });
let d = await doc(s001.cookie);
check(d.status === 200 && d.headers.get("content-type") === "application/pdf", "the student can open their own document");
check((await doc((await login("S26CS003", "Demo@1234")).cookie)).status === 404, "another student cannot open it");
check((await doc(t1002.cookie)).status === 200, "their class coordinator can open it");
const t1001 = await login("T1001", "Demo@1234");
check((await doc(t1001.cookie)).status === 200, "their HOD can open it");
const t2001 = await login("T2001", "Demo@1234");
check((await doc(t2001.cookie)).status === 404, "another department's HOD cannot open it");
r = await act("/hod/approvals", t1001.cookie, (f) => f.includes(leave.id), { decision: "APPROVED" });
check((await db.leaveRequest.findUnique({ where: { id: leave.id } })).status === "APPROVED", "the HOD approves the leave");
r = await act("/student/requests", s001.cookie, "Send leave request", { fromDate: addDays(today, 10), toDate: addDays(today, 10), type: "PERSONAL", reason: "Family function" });
const pl = await db.leaveRequest.findFirst({ where: { student: { rollNo: "S26CS001" }, status: "PENDING" } });
r = await act("/student/requests", s001.cookie, (f) => f.includes(pl.id) && f.includes("Cancel"), {});
check((await db.leaveRequest.findUnique({ where: { id: pl.id } })).status === "CANCELLED", "a student can cancel a pending request");

heading("Day 4 · Missed punch-out job (FR-10)");
const cron = fs.readFileSync(path.join(APP, ".env"), "utf8").match(/CRON_SECRET="([^"]+)"/)?.[1];
check((await fetch(`${BASE}/api/jobs/close-sessions`, { method: "POST" })).status === 401, "the job endpoint refuses calls without the secret");
await db.campusSession.create({ data: { studentId: (await db.student.findUnique({ where: { rollNo: "S26CS010" } })).id, dateKey: addDays(today, -2), inAt: new Date(Date.now() - 2 * 86400_000), status: "OPEN" } });
const job = await fetch(`${BASE}/api/jobs/close-sessions`, { method: "POST", headers: { authorization: `Bearer ${cron}` } });
const jobJson = await job.json();
check(job.status === 200 && jobJson.closed >= 1, "the job closes open sessions from earlier days", JSON.stringify(jobJson));

// =============================================================================
heading("Day 5 · Timetable views and permissions");
r = await get("/student/timetable", s001.cookie);
check(r.body.includes("CS101") && r.body.includes("Batch 1") && !r.body.includes("Batch 2"), "student sees their section's grid with only their own lab batch");
check((await get("/teacher/timetable", t1002.cookie)).body.includes("CS 1-A"), "teacher sees their timetable across sections");
check((await get(`/hod/timetable/${cs1A.id}`, t1001.cookie)).body.includes("Editing the version"), "CS HOD can edit a CS timetable");
r = await get(`/hod/timetable/${cs1A.id}`, t2001.cookie);
check(r.status === 404 || r.body.includes("could not be found"), "Commerce HOD cannot open a CS timetable (FR-66)");
check((await get(`/timetable-print/section/${cs1A.id}`, s001.cookie)).body.includes("Section A"), "student can open the printable timetable for their section");
r = await get(`/timetable-print/section/${cs2A.id}`, s001.cookie);
check(r.status === 404 || r.body.includes("could not be found"), "student cannot print another section's timetable");

heading("Day 5 · Clash detection and versioning (FR-58, FR-64)");
const slot = (dayOfWeek, periodNumber, code, teacher, room, extra = {}) => ({
  dayOfWeek, periodNumber, span: 1, type: "LECTURE", subjectId: code, teacherId: teacher, roomId: room, batchId: null, ...extra,
});
const [cs101, cs102, cs201] = [await subjectId("CS101"), await subjectId("CS102"), await subjectId("CS201")];
const [tid1002, tid1003, tid2002] = [await teacherId("T1002"), await teacherId("T1003"), await teacherId("T2002")];
const cr103 = (await db.room.findUnique({ where: { name: "CR-103" } })).id;
const cr101 = (await db.room.findUnique({ where: { name: "CR-101" } })).id;
const save = (slots, effectiveFrom = today) =>
  act(`/admin/timetable/${cs1B.id}`, admin.cookie, "Save timetable", { slots: JSON.stringify(slots), effectiveFrom, note: "" });
r = await save([slot(1, 1, cs101, tid1002, cr103)]);
check(r.body.includes("already teaching CS 1-A"), "a teacher booked in two sections at once is blocked");
r = await save([slot(1, 3, cs101, tid1002, cr101)]);
check(r.body.includes("CR-101 is already used by CS 1-A"), "a double-booked room is blocked");
r = await save([slot(1, 4, cs101, tid1002, cr103), slot(1, 4, cs102, tid2002, null)]);
check(r.body.includes("two classes at the same time"), "two classes for one section in one period is blocked");
r = await save([slot(1, 3, cs201, tid1002, cr103)]);
check(r.body.includes("not a subject of this section"), "a subject from another year is blocked");
r = await save([slot(1, 3, cs101, tid1002, cr103)], addDays(today, -1));
check(r.body.includes("cannot start in the past"), "a new version cannot start in the past");
r = await save([slot(1, 3, cs101, tid1002, cr103), slot(4, 2, cs101, tid1002, cr103)]);
check(r.body.includes("New timetable version saved"), "a clash-free timetable is saved", r.body.match(/role="alert"[\s\S]{0,400}/)?.[0]);
check((await db.timetable.count({ where: { sectionId: cs1B.id, effectiveFrom: today } })) === 1, "the version is stored with today's date");
check((await get("/notifications", (await login("S26CS009", "Demo@1234")).cookie)).body.includes("Timetable updated"), "1-B students are notified");

heading("Day 5 · Changes on the day (FR-63)");
let monday = addDays(today, (8 - weekday(today)) % 7);
if (monday === tomorrow) monday = addDays(monday, 7);
const tt1A = await db.timetable.findFirst({ where: { sectionId: cs1A.id }, orderBy: { effectiveFrom: "desc" }, include: { slots: true } });
const monP1 = tt1A.slots.find((s) => s.dayOfWeek === 1 && s.periodNumber === 1);
const monP3 = tt1A.slots.find((s) => s.dayOfWeek === 1 && s.periodNumber === 3);
await act(`/teacher/timetable?date=${monday}`, t1002.cookie, (f) => f.includes(monP1.id) && f.includes("Cancel"), {}, {}, "/teacher/timetable", t1003.cookie);
check((await db.periodChange.count({ where: { timetableSlotId: monP1.id } })) === 0, "a teacher cannot cancel someone else's period");
r = await act(`/teacher/timetable?date=${monday}`, t1002.cookie, (f) => f.includes(monP1.id) && f.includes("Cancel"), {});
check((await db.periodChange.findFirst({ where: { timetableSlotId: monP1.id } }))?.type === "CANCELLED", "a teacher cancels their own period");
check((await get("/notifications", s001.cookie)).body.includes("Period cancelled"), "students are notified of the cancellation");
check((await get(`/teacher/timetable?date=${monday}`, t1002.cookie)).body.includes("Cancelled"), "the cancelled period shows on the teacher's day view");
r = await act(`/hod/timetable/${cs1A.id}?date=${monday}`, t1001.cookie, (f) => f.includes(monP3.id) && f.includes("Substitute"), { substituteTeacherId: tid1003 });
check(r.body.includes("already has a class"), "a busy teacher cannot be the substitute");
r = await act(`/hod/timetable/${cs1A.id}?date=${monday}`, t1001.cookie, (f) => f.includes(monP3.id) && f.includes("Substitute"), { substituteTeacherId: tid2002 });
check((await db.periodChange.findFirst({ where: { timetableSlotId: monP3.id } }))?.substituteTeacherId === tid2002, "the HOD assigns a free substitute");
check((await get(`/teacher/timetable?date=${monday}`, (await login("T2002", "Demo@1234")).cookie)).body.includes("Covering for Anita Desai"), "the substitute sees the period on their timetable");

await db.$disconnect();
console.log(failures === 0 ? "\nAll Day 2-5 checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures ? 1 : 0);
