// End-to-end checks for Days 6-8 against a running server, on freshly seeded data:
//   npm run db:seed && npm run build && npm start      (then, in another terminal)
//   node tests/e2e-days6-8.mjs . http://localhost:3000
// It changes data. Run npm run db:seed afterwards.
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

// --- helpers (same approach as e2e-days2-5.mjs) -------------------------------
const clean = (h) => h.replace(/<!-- -->/g, "");
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const IST = 5.5 * 3600_000;
const dateKey = (ms = Date.now()) => new Date(ms + IST).toISOString().slice(0, 10);
const addDays = (k, n) => {
  const d = new Date(k + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (k) => ((new Date(k + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
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
  return { status: res.status, location: res.headers.get("location"), body: clean(await res.text()) };
}
const cookies = {};
async function as(id) {
  if (cookies[id]) return cookies[id];
  const page = await get("/login");
  const form = forms(page.body).find((f) => f.includes('name="collegeId"'));
  const fd = new FormData();
  for (const [k, v] of hidden(form)) fd.append(k, v);
  fd.set("collegeId", id);
  fd.set("password", "Demo@1234");
  fd.set("next", "");
  const res = await fetch(BASE + "/login", { method: "POST", body: fd, redirect: "manual" });
  cookies[id] = (res.headers.get("set-cookie") ?? "").match(/cas_session=[^;]+/)?.[0];
  return cookies[id];
}
async function setSetting(key, value) {
  if (value === undefined) return db.setting.deleteMany({ where: { key } });
  await db.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
}
const percentOn = (html) => html.match(/Overall<\/p><p[^>]*>([\d.]+)%/)?.[1];
const cron = fs.readFileSync(path.join(APP, ".env"), "utf8").match(/CRON_SECRET="([^"]+)"/)?.[1];
const tick = () => fetch(`${BASE}/api/jobs/tick`, { method: "POST", headers: { authorization: `Bearer ${cron}` } }).then((r) => r.json());
const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const sections = await db.section.findMany({ include: { department: true } });
const sec = (code, year, name) => sections.find((s) => s.department.code === code && s.year === year && s.name === name);
const cs1A = sec("BCA", 1, "A");
const cs1B = sec("BCA", 1, "B");
const com1A = sec("BBA", 1, "A");
const teacher = async (cid) => db.teacher.findFirst({ where: { user: { collegeId: cid } } });
const T1002 = await teacher("T1002");
const T1003 = await teacher("T1003");
const studentByRoll = async (r) => db.student.findUnique({ where: { rollNo: r } });

// =============================================================================
heading("Day 6 · Attendance engine and reports (demo data)");
const s001 = await as("S26BCA001");
let r = await get("/student/attendance", s001);
check(percentOn(r.body) !== undefined && r.body.includes("By subject") && r.body.includes("BCA101"), "student sees overall and subject-wise attendance", r.status);
check((await get("/student/attendance", await as("S26BCA008"))).body.includes("Critical"), "a student far below the threshold is marked critical (FR-41)");
r = await get("/student/attendance", await as("S26BCA007"));
check(r.body.includes("below the required 75%") && /Attending the next \d+ class/.test(r.body), "a student below 75% sees the shortage warning and classes needed (FR-32)");
r = await get("/student/attendance", await as("S26BCA005"));
check(r.body.includes("Marked present, no campus punch"), "a class marked present without a campus punch does not count (§4.3)");
const pctWithRule = Number(percentOn(r.body));
await setSetting("requireCampusPunch", false);
const pctWithoutRule = Number(percentOn((await get("/student/attendance", await as("S26BCA005"))).body));
check(pctWithoutRule > pctWithRule, `turning the campus-punch rule off counts that class (${pctWithRule}% → ${pctWithoutRule}%)`);
await setSetting("requireCampusPunch", undefined);

const s008 = await studentByRoll("S26BCA008");
const absentDay = await db.attendanceRecord.findFirst({ where: { studentId: s008.id, status: "ABSENT" }, include: { session: true } });
const before8 = Number(percentOn((await get("/student/attendance", await as("S26BCA008"))).body));
await db.leaveRequest.create({ data: { studentId: s008.id, fromDate: absentDay.session.dateKey, toDate: absentDay.session.dateKey, type: "MEDICAL", reason: "Test", status: "APPROVED" } });
const after8 = Number(percentOn((await get("/student/attendance", await as("S26BCA008"))).body));
check(after8 > before8, `approved leave is taken out of the calculation (${before8}% → ${after8}%) (FR-17)`);

const t1002 = await as("T1002");
r = await get("/teacher/mentees", t1002);
// S26BCA008 (Kavya Pillai) is the seeded critical case; S26BCA001 (Aarav Sharma) is on track.
check(r.body.includes("Critical") && r.body.indexOf(">Kavya Pillai<") > -1 && r.body.indexOf(">Kavya Pillai<") < r.body.indexOf(">Aarav Sharma<"), "class coordinator's risk list puts the most at-risk mentee first");
r = await get(`/teacher/mentees/${s008.id}`, t1002);
check(r.body.includes("Parent") && r.body.includes("By subject"), "coordinator opens a mentee's full attendance with parent contact");
check((await get(`/teacher/mentees/${s008.id}`, await as("T1003"))).body.includes("could not be found"), "a teacher who is not the coordinator cannot open it");
const p26 = await as("P26BCA001");
check(percentOn((await get("/parent/attendance", p26)).body) !== undefined, "parent sees their child's attendance");

heading("Day 6 · Marking attendance (FR-61, FR-20)");
const lastWorkday = (await db.campusSession.findFirst({ where: { student: { rollNo: "S26BCA001" }, status: "INCOMPLETE" } })).dateKey;
const slots1A = await db.timetableSlot.findMany({ where: { timetable: { sectionId: cs1A.id } } });
const mySlot = slots1A.find((s) => s.teacherId === T1002.id && s.dayOfWeek === weekday(lastWorkday) && !s.batchId);
const otherSlot = slots1A.find((s) => s.teacherId === T1003.id && s.dayOfWeek === weekday(lastWorkday));
await db.classSession.deleteMany({ where: { dateKey: lastWorkday, periodKey: { in: [mySlot.id, otherSlot.id] } } });
r = await get(`/teacher/attendance?date=${lastWorkday}`, t1002);
check(r.body.includes("Not taken") && r.body.includes("Not yet marked in the last 7 days"), "teacher sees the unmarked period as a pending task (FR-19)");
const markPath = `/teacher/attendance/${lastWorkday}/${mySlot.id}`;
const roster = await db.student.findMany({ where: { sectionId: cs1A.id, status: "ACTIVE" }, orderBy: { rollNo: "asc" } });
const entries = Object.fromEntries(roster.map((s, i) => [s.id, i === 2 ? "ABSENT" : "PRESENT"]));
r = await act(markPath, t1002, 'name="entries"', { entries: JSON.stringify({ [roster[0].id]: "PRESENT" }) });
check(r.body.includes("Choose a status for every student"), "every student needs a status");
const t1003 = await as("T1003");
await act(markPath, t1002, 'name="entries"', { entries: JSON.stringify(entries) }, {}, "/teacher/attendance", t1003);
check((await db.classSession.count({ where: { dateKey: lastWorkday, periodKey: mySlot.id } })) === 0, "another teacher cannot mark this period by calling the action directly");
r = await act(markPath, t1002, 'name="entries"', { entries: JSON.stringify(entries) });
check(r.body.includes("Attendance saved"), "teacher marks the period", r.body.match(/"error":"[^"]*"/)?.[0]);
let session = await db.classSession.findUnique({ where: { dateKey_periodKey: { dateKey: lastWorkday, periodKey: mySlot.id } }, include: { records: true } });
check(session?.records.length === roster.length && session.records.filter((x) => x.status === "ABSENT").length === 1, "one record per student is stored");
r = await act(markPath, t1002, 'name="entries"', { entries: JSON.stringify({ ...entries, [roster[3].id]: "LATE" }) });
check(r.body.includes("1 change saved"), "edits within the window apply directly");
await db.classSession.update({ where: { id: session.id }, data: { takenAt: new Date(Date.now() - 2 * 86400_000) } });
r = await act(markPath, t1002, 'name="entries"', { entries: JSON.stringify({ ...entries, [roster[2].id]: "PRESENT" }) });
check(r.body.includes("older than 24 hours"), "after 24 hours a reason is required");
r = await act(markPath, t1002, 'name="entries"', { entries: JSON.stringify({ ...entries, [roster[2].id]: "PRESENT" }), reason: "Was in the library on a lab pass" });
check(r.body.includes("sent to the HOD"), "the late change goes to the HOD for approval");
check((await db.attendanceRecord.findFirst({ where: { classSessionId: session.id, studentId: roster[2].id } })).status === "ABSENT", "attendance is unchanged until the HOD approves");
r = await act(markPath, t1002, 'name="entries"', { entries: JSON.stringify({ ...entries, [roster[4].id]: "ABSENT" }), reason: "Another change" });
check(r.body.includes("already waiting for the HOD"), "only one pending edit request per period");
const t1001 = await as("T1001");
r = await get("/hod/attendance-edits", t1001);
check(r.body.includes("Was in the library on a lab pass"), "the HOD sees the request with the reason and changes");
const editReq = await db.attendanceEditRequest.findFirst({ where: { status: "PENDING" } });
check((await get("/hod/attendance-edits", await as("T2001"))).body.includes("No edit requests"), "another department's HOD does not see it");
r = await act("/hod/attendance-edits", t1001, (f) => f.includes(editReq.id), { decision: "APPROVED" });
check((await db.attendanceRecord.findFirst({ where: { classSessionId: session.id, studentId: roster[2].id } })).status === "PRESENT", "HOD approval applies the change");
await db.periodChange.create({ data: { dateKey: lastWorkday, sectionId: cs1A.id, timetableSlotId: otherSlot.id, periodNumber: otherSlot.periodNumber, type: "CANCELLED", createdById: (await db.user.findUnique({ where: { collegeId: "T1003" } })).id } });
r = await get(`/teacher/attendance/${lastWorkday}/${otherSlot.id}`, t1003);
check(r.status === 404 || r.body.includes("could not be found"), "a cancelled period cannot be marked (FR-63)");
check((await get(`/teacher/attendance/${tomorrow}/${mySlot.id}`, t1002)).body.includes("could not be found") || weekday(tomorrow) === mySlot.dayOfWeek, "periods not on that day's timetable cannot be marked");

// =============================================================================
heading("Day 7 · Results visible to students (FR-24, FR-33)");
r = await get("/student/results", s001);
check(r.body.includes("BCA101") && r.body.includes("Internal 1"), "student sees the published Internal 1 result");
check(!r.body.includes("BCA102"), "submitted-but-unpublished marks stay hidden");
check((await get(`/report-card/${(await studentByRoll("S26BCA001")).id}`, s001)).body.includes("Report card"), "student opens their report card");
check((await get(`/report-card/${(await studentByRoll("S26BCA001")).id}`, await as("S26BCA002"))).body.includes("could not be found"), "another student cannot open it");
check((await get(`/report-card/${(await studentByRoll("S26BCA001")).id}`, p26)).body.includes("Report card"), "the parent can open it");

heading("Day 7 · Marks entry and workflow (FR-21..23)");
const map101 = await db.teacherSubject.findFirst({ where: { teacherId: T1002.id, sectionId: cs1A.id, subject: { code: "BCA101" } } });
const entryPath = `/teacher/marks/${map101.id}/INTERNAL2`;
check((await get(entryPath, t1003)).body.includes("could not be found"), "a teacher cannot open another teacher's marks sheet");
const marks = Object.fromEntries(roster.map((s, i) => [s.id, i === 7 ? "AB" : String(10 + i)]));
r = await act(entryPath, t1002, 'name="entries"', { entries: JSON.stringify({ ...marks, [roster[0].id]: "30" }), intent: "save" });
check(r.body.includes("above the maximum of 25"), "marks above the maximum are rejected");
r = await act(entryPath, t1002, 'name="entries"', { entries: JSON.stringify({ [roster[0].id]: "20", [roster[1].id]: "ab" }), intent: "save" });
check(r.body.includes("Draft saved (2 of 8 entered)"), "a partial draft saves, with AB accepted in any case");
r = await act(entryPath, t1002, 'name="entries"', { entries: JSON.stringify({ [roster[0].id]: "20" }), intent: "submit" });
check(r.body.includes("for every student before submitting"), "submitting needs every student's mark or AB");
r = await act(entryPath, t1002, 'name="entries"', { entries: JSON.stringify(marks), intent: "submit" });
check(r.body.includes("submitted for verification"), "teacher submits the marks");
const a2 = await db.assessment.findFirst({ where: { sectionId: cs1A.id, kind: "INTERNAL2" } });
check(a2?.status === "SUBMITTED", "status becomes Submitted");
check((await get(entryPath, t1002)).body.includes("can no longer be edited"), "submitted marks are read-only for the teacher");

const map104 = await db.teacherSubject.findFirst({ where: { teacherId: T1002.id, sectionId: cs1A.id, subject: { code: "BCA104" } } });
const csvBad = `college_id,marks\n${roster[0].rollNo},60\nS99XX999,10\n`;
r = await act(`/teacher/marks/${map104.id}/PRACTICAL`, t1002, 'name="file"', {}, { file: { data: csvBad, type: "text/csv", name: "m.csv" } });
check(r.body.includes("Nothing imported") && r.body.includes("above the maximum of 50") && r.body.includes("not in this class"), "upload with errors imports nothing and lists the problems");
const csvOk = `college_id,marks\n${roster.map((s, i) => `${s.rollNo},${i === 1 ? "AB" : 30 + i}`).join("\n")}\n`;
r = await act(`/teacher/marks/${map104.id}/PRACTICAL`, t1002, 'name="file"', {}, { file: { data: csvOk, type: "text/csv", name: "m.csv" } });
check(r.body.includes("Imported 8 marks into the draft"), "marks upload from CSV fills the draft (FR-22)");

const t2001 = await as("T2001");
check((await get(`/hod/marks/${a2.id}`, t2001)).body.includes("could not be found"), "another department's HOD cannot open these marks");
r = await act(`/hod/marks/${a2.id}`, t1001, 'name="note"', { intent: "return", note: "" });
check(r.body.includes("Say what needs correcting"), "sending back needs a note");
r = await act(`/hod/marks/${a2.id}`, t1001, 'name="note"', { intent: "return", note: "Recheck roll 3" });
check((await db.assessment.findUnique({ where: { id: a2.id } })).status === "DRAFT", "HOD sends the marks back to draft");
check((await get(entryPath, t1002)).body.includes("Recheck roll 3"), "the teacher sees the HOD's note");
await act(entryPath, t1002, 'name="entries"', { entries: JSON.stringify(marks), intent: "submit" });
r = await act(`/hod/marks/${a2.id}`, t1001, 'name="note"', { intent: "verify" });
check((await db.assessment.findUnique({ where: { id: a2.id } })).status === "VERIFIED", "HOD verifies the resubmitted marks");
r = await get(`/admin/results/${a2.id}`, await as("ADMIN01"));
check(r.body.includes("Class analytics") && r.body.includes("Pass rate") && r.body.includes("At risk"), "review page shows class analytics and the at-risk list (FR-25)");

heading("Day 7 · Lock, schedule, publish, revise (FR-23, FR-24)");
const admin = await as("ADMIN01");
await act(`/admin/results/${a2.id}`, admin, 'value="lock"', {}, {}, "/hod/marks", t1001);
check((await db.assessment.findUnique({ where: { id: a2.id } })).status === "VERIFIED", "a HOD cannot lock marks by calling the admin action");
await act(`/admin/results/${a2.id}`, admin, 'value="lock"', {});
check((await db.assessment.findUnique({ where: { id: a2.id } })).status === "LOCKED", "admin locks the marks");
r = await act(`/admin/results/${a2.id}`, admin, 'value="schedule"', { date: addDays(today, -1), time: "10:00" });
check(r.body.includes("Choose a time in the future"), "a schedule in the past is refused");
r = await act(`/admin/results/${a2.id}`, admin, 'value="schedule"', { date: tomorrow, time: "10:00" });
check(r.body.includes("will be visible to students from"), "admin schedules publication");
check(!(await get("/student/results", s001)).body.includes("Internal 2"), "students can't see it before the scheduled time");
await db.assessment.update({ where: { id: a2.id }, data: { publishAt: new Date(Date.now() - 60_000) } });
check((await get("/student/results", s001)).body.includes("Internal 2"), "it becomes visible the moment the time passes, even before the job runs");
let job = await tick();
check(job.resultsPublished >= 1 && (await db.assessment.findUnique({ where: { id: a2.id } })).status === "PUBLISHED", "the scheduled job marks it published", JSON.stringify(job));
check((await get("/notifications", s001)).body.includes("Result published: BCA101 Internal 2"), "students are notified when the result is published (FR-35)");
check((await get("/notifications", p26)).body.includes("Result published"), "linked parents are notified too");
await act(`/admin/results/${a2.id}`, admin, 'value="unpublish"', {});
check(!(await get("/student/results", s001)).body.includes("Internal 2"), "admin can unpublish a result");
await act(`/admin/results/${a2.id}`, admin, 'value="publish"', {});
check((await get("/student/results", s001)).body.includes("Internal 2"), "publish now shows it again");
r = await act(`/admin/results/${a2.id}`, admin, 'name="reason"', { studentId: roster[0].id, value: "24", reason: "" });
check(r.body.includes("Give the reason"), "a revision needs a reason");
r = await act(`/admin/results/${a2.id}`, admin, 'name="reason"', { studentId: roster[0].id, value: "24", reason: "Re-totalling" });
const rev = await db.markRevision.findFirst({ where: { assessmentId: a2.id } });
check(rev?.oldMarks === 10 && rev.newMarks === 24, "locked marks change only through a logged revision");
check((await get("/notifications", s001)).body.includes("Result revised"), "the student is told about the revision");

heading("Day 7 · Grades, SGPA and settings");
const sem = await db.assessment.create({ data: { subjectId: a2.subjectId, sectionId: cs1A.id, academicYearId: a2.academicYearId, kind: "SEMESTER", maxMarks: 100, weightage: 60, status: "PUBLISHED", publishedAt: new Date(), notifiedAt: new Date(), publishAt: new Date() } });
await db.markEntry.create({ data: { assessmentId: sem.id, studentId: roster[0].id, marks: 80, updatedById: rev.revisedById } });
r = await get("/student/results", s001);
check(/SGPA · Semester 1<\/p><p[^>]*>\d/.test(r.body) && r.body.includes("Pass"), "a published semester exam gives a grade, pass/fail and SGPA");
const scheme = { THEORY: { INTERNAL1: [25, 15], INTERNAL2: [25, 15], ASSIGNMENT: [10, 10], SEMESTER: [100, 60] }, PRACTICAL: { ASSIGNMENT: [10, 10], PRACTICAL: [50, 40], SEMESTER: [50, 50] } };
const schemeFields = (bad) => {
  const f = { passPercent: "40", gradeScale: "O 90 10\nA 70 8\nP 40 4\nF 0 0", showGpa: "on" };
  for (const [type, items] of Object.entries(scheme)) for (const [kind, [max, w]] of Object.entries(items)) {
    f[`${type}.${kind}.max`] = String(max);
    f[`${type}.${kind}.weight`] = String(bad && kind === "SEMESTER" && type === "THEORY" ? 50 : w);
  }
  return f;
};
r = await act("/admin/results", admin, 'name="gradeScale"', schemeFields(true));
check(r.body.includes("must total 100"), "scheme weightages must add up to 100");
r = await act("/admin/results", admin, 'name="gradeScale"', schemeFields(false));
check(r.body.includes("Result settings saved"), "admin saves the assessment scheme and grade scale");

// =============================================================================
heading("Day 8 · Notice board visibility (FR-42..45)");
r = await get("/notice-board");
check(r.status === 200 && r.body.includes("Welcome to the 2026-27 academic year") && !r.body.includes("Internal Assessment 1 timetable"), "the public board shows only public notices, without signing in");
check((await get("/login")).body.includes("Latest announcements"), "the login page shows the latest announcements strip");
r = await get("/student", s001);
check(r.body.includes("Urgent:") && r.body.includes("Internal Assessment 1 timetable"), "a Year 1 student sees the urgent banner on the dashboard");
const s24 = await as("S24BCA001");
check(!(await get("/notices", s24)).body.includes("Internal Assessment 1 timetable"), "a Year 3 student does not see the Year 1 notice (FR-44)");
check((await get("/notices", t1003)).body.includes("Department meeting on Friday"), "CS teachers see the department notice");
check(!(await get("/notices", s001)).body.includes("Department meeting on Friday"), "students don't see the teachers-only notice");
check((await get("/notices?q=Welcome", s001)).body.includes("Welcome to the 2026-27") && (await get("/notices?q=zzzz", s001)).body.includes("No notices match"), "search by keyword works (FR-51)");

heading("Day 8 · Posting, attachments, scheduling, approval (FR-46..50)");
const noticeFields = (extra) => ({ title: "", body: "Details inside.", category: "GENERAL", audience: "EVERYONE", notifyOnPublish: "on", publishTime: "09:00", ...extra });
r = await act("/admin/notices", admin, 'name="title"', noticeFields({ title: "Year 3 project fair", audience: "STUDENTS", year: "3", urgent: "on", category: "EVENT" }), { attachment: { data: pdf, type: "application/pdf", name: "fair.pdf" } });
check(r.body.includes("Notice published"), "admin publishes a targeted urgent notice with an attachment");
const fair = await db.notice.findFirst({ where: { title: "Year 3 project fair" } });
check((await get("/notifications", s24)).body.includes("URGENT: Year 3 project fair"), "Year 3 students are notified immediately (FR-48)");
check(!(await get("/notifications", s001)).body.includes("Year 3 project fair"), "Year 1 students are not");
const att = (c) => fetch(`${BASE}/api/notices/${fair.id}/attachment`, { headers: c ? { cookie: c } : {} });
let d = await att(s24);
check(d.status === 200 && d.headers.get("content-type") === "application/pdf", "the audience can open the attachment");
check((await att(s001)).status === 404, "students outside the audience cannot");
check((await att(null)).status === 401, "the attachment needs sign-in when the notice isn't public");
r = await act("/admin/notices", admin, 'name="title"', noticeFields({ title: "Fake doc" }), { attachment: { data: new TextEncoder().encode("hello"), type: "application/pdf", name: "x.pdf" } });
check(r.body.includes("Only PDF, JPEG, PNG or Word"), "attachments are checked by content");
r = await act("/admin/notices", admin, 'name="title"', noticeFields({ title: "Public circular", isPublic: "on" }), { attachment: { data: pdf, type: "application/pdf", name: "circular.pdf" } });
const circ = await db.notice.findFirst({ where: { title: "Public circular" } });
check((await fetch(`${BASE}/api/notices/${circ.id}/attachment`)).status === 200, "a public notice's attachment opens without signing in");

r = await act("/admin/notices", admin, 'name="title"', noticeFields({ title: "Sports day schedule", publishDate: tomorrow, publishTime: "08:00" }));
check(r.body.includes("Notice scheduled"), "admin schedules a notice (FR-47)");
const sports = await db.notice.findFirst({ where: { title: "Sports day schedule" } });
check(!(await get("/notices", s001)).body.includes("Sports day schedule"), "it is hidden before its publish time");
await db.notice.update({ where: { id: sports.id }, data: { publishAt: new Date(Date.now() - 60_000) } });
check((await get("/notices", s001)).body.includes("Sports day schedule"), "it appears once the time passes");
job = await tick();
check(job.noticesDelivered >= 1 && (await get("/notifications", s001)).body.includes("Sports day schedule"), "the job sends its notification", JSON.stringify(job));
await db.notice.update({ where: { id: sports.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
check(!(await get("/notices", s001)).body.includes("Sports day schedule") && (await get("/notices?view=archive", s001)).body.includes("Sports day schedule"), "expired notices move to the archive (FR-47)");

const com = await db.department.findUnique({ where: { code: "BBA" } });
r = await act("/hod/notices", t1001, 'name="title"', noticeFields({ title: "Commerce notice", departmentId: com.id }));
check(r.body.includes("only for their own department"), "a HOD cannot post for another department (FR-50)");
r = await act("/hod/notices", t1001, 'name="title"', noticeFields({ title: "CS lab maintenance", audience: "STUDENTS" }));
check(r.body.includes("once the admin approves"), "HOD notices wait for admin approval");
const lab = await db.notice.findFirst({ where: { title: "CS lab maintenance" } });
check(!(await get("/notices", s001)).body.includes("CS lab maintenance"), "students don't see it before approval");
r = await act("/admin/notices", admin, (f) => f.includes(lab.id) && f.includes("Approve"), { decision: "APPROVED" });
check((await get("/notices", s001)).body.includes("CS lab maintenance"), "after approval CS students see it");
check(!(await get("/notices", await as("S26BBA001"))).body.includes("CS lab maintenance"), "it stays within the HOD's department");

check((await get("/teacher/notices", t1003)).body.includes("Posting notices is turned off"), "teachers cannot post until the admin allows it");
await act("/admin/notices", admin, 'name="teachersCanPostNotices"', { teachersCanPostNotices: "on", noticeApprovalRequired: "on" });
r = await act("/teacher/notices", t1003, 'name="title"', noticeFields({ title: "Wrong class", audience: "STUDENTS", sectionId: com1A.id }));
check(r.body.includes("Choose one of your sections"), "a teacher can post only to classes they teach");
r = await act("/teacher/notices", t1003, 'name="title"', noticeFields({ title: "Bring calculators tomorrow", audience: "STUDENTS", sectionId: cs1A.id }));
check(r.body.includes("once the admin approves"), "once allowed, a teacher posts to their own class (pending approval)");

heading("Day 8 · Edit history, withdraw, read stats, timetable notice (FR-49, FR-52, FR-65)");
r = await act(`/admin/notices?edit=${fair.id}`, admin, 'name="title"', noticeFields({ title: "Year 3 project fair (moved to Hall B)", audience: "STUDENTS", year: "3", urgent: "on", category: "EVENT" }));
check(r.body.includes("Notice updated"), "admin edits a published notice");
check((await get(`/notices/${fair.id}`, s24)).body.includes("Updated"), "edited notices show an Updated label");
check((await db.noticeHistory.count({ where: { noticeId: fair.id, action: "EDITED" } })) === 1, "the edit is kept in the notice history");
check((await get(`/notices/${fair.id}`, admin)).body.includes("Opened by"), "admin sees how many opened the urgent notice (FR-52)");
await act("/admin/notices", admin, (f) => f.includes(fair.id) && f.includes("Withdraw"), {});
check((await get(`/notices/${fair.id}`, s24)).body.includes("could not be found"), "a withdrawn notice is no longer shown");
const cr = await db.room.findUnique({ where: { name: "CR-103" } });
const cs101 = await db.subject.findUnique({ where: { code: "BCA101" } });
await act(`/admin/timetable/${cs1B.id}`, admin, "Save timetable", {
  slots: JSON.stringify([{ dayOfWeek: 1, periodNumber: 3, span: 1, type: "LECTURE", subjectId: cs101.id, teacherId: T1002.id, roomId: cr.id, batchId: null }]),
  effectiveFrom: today,
  note: "",
});
check((await get("/notices", await as("S26BCA009"))).body.includes("Timetable for BCA Year 1-B"), "saving a timetable posts it to the section's notice board (FR-65)");

heading("Day 8 · Scheduled tick and punch reminders (FR-35)");
check((await fetch(`${BASE}/api/jobs/tick`, { method: "POST" })).status === 401, "the tick endpoint refuses calls without the secret");
await setSetting("collegeStart", "00:00");
await setSetting("collegeEnd", "23:59");
await setSetting("punchCutoff", "23:59");
await setSetting("workingDays", [1, 2, 3, 4, 5, 6, 7]);
// Earlier ticks in this run may already have sent today's reminders during college hours.
await db.notification.deleteMany({ where: { title: "Punch-in reminder" } });
job = await tick();
const reminders = await db.notification.count({ where: { title: "Punch-in reminder" } });
check(job.punchReminders > 0 && reminders === job.punchReminders, "students who haven't punched in get a reminder", JSON.stringify(job));
job = await tick();
check(job.punchReminders === 0 && (await db.notification.count({ where: { title: "Punch-in reminder" } })) === reminders, "reminders are sent at most once a day");
for (const k of ["collegeEnd", "workingDays"]) await setSetting(k, undefined);
await setSetting("collegeStart", "08:30");
await setSetting("punchCutoff", "18:00");

await db.$disconnect();
console.log(failures === 0 ? "\nAll Day 6-8 checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures ? 1 : 0);
