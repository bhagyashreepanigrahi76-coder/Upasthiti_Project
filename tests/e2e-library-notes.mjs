// End-to-end checks for the library and study notes, on freshly seeded data:
//   npm run db:seed && npm run build && npm start      (then, in another terminal)
//   node tests/e2e-library-notes.mjs . http://localhost:3000
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
const IST = 5.5 * 3600_000;
const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
const addDays = (k, n) => {
  const d = new Date(k + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const cron = fs.readFileSync(path.join(APP, ".env"), "utf8").match(/CRON_SECRET="([^"]+)"/)?.[1];
const tick = () => fetch(`${BASE}/api/jobs/tick`, { method: "POST", headers: { authorization: `Bearer ${cron}` } }).then((r) => r.json());
const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const book = async (title) => db.book.findFirst({ where: { title } });

// =============================================================================
heading("Library · access and catalogue");
const lib = await as("L1001");
let r = await get("/library", lib);
check(r.status === 200 && r.body.includes("Issued now") && r.body.includes("Fines to collect") && r.body.includes("₹8"), "the librarian sees the library dashboard with counts and fines");
check((await get("/admin", lib)).location?.endsWith("/forbidden"), "the librarian cannot open the admin portal");
const s003 = await as("S26BCA003");
check((await get("/library", s003)).location?.endsWith("/forbidden"), "students cannot open the library desk");
// A student with no loans, so the page lists only search results (the librarian page also has an issue dropdown of every book).
r = await get("/student/library?q=kanetkar", await as("S26BCA010"));
check(r.body.includes("Let Us C") && r.body.includes("Data Structures Through C") && !r.body.includes("Paraja"), "catalogue search finds books by author, ignoring case");
r = await act("/library", lib, 'name="author"', { title: "Java: The Complete Reference", author: "Herbert Schildt", isbn: "978-1260440232", category: "Textbook", totalCopies: "2" });
check(r.body.includes("added to the catalogue"), "the librarian adds a book (ISBN with dashes accepted)");
r = await act("/library", lib, 'name="author"', { title: "Java again", author: "Someone Else", isbn: "9781260440232", category: "Textbook", totalCopies: "1" });
check(r.body.includes("already in the catalogue"), "a duplicate ISBN is refused");
r = await act("/library", lib, 'name="author"', { title: "Bad ISBN", author: "Someone", isbn: "12345", category: "Textbook", totalCopies: "1" });
check(r.body.includes("ISBN is 10 or 13 digits"), "an invalid ISBN is refused");

heading("Library · issue rules");
const issue = (rollNo, title) => book(title).then((b) => act("/library", lib, 'name="rollNo"', { rollNo, bookId: b.id }));
r = await issue("S26BCA008", "Wings of Fire");
check(r.body.includes("has an overdue book"), "a student with an overdue book can't borrow more");
r = await issue("S24BCA001", "Wings of Fire");
check(r.body.includes("unpaid fine of ₹8"), "a student with an unpaid fine can't borrow");
r = await issue("s26bca003", "Paraja");
check(r.body.includes("issued to") && r.body.includes("Due back on"), "the librarian issues a book (roll number in any case)");
r = await issue("S26BCA004", "Paraja");
check(r.body.includes("All 1 copies"), "a book with no copies left can't be issued");
for (const t of ["Wings of Fire", "Business Law", "Managerial Economics"]) await issue("S26BCA005", t);
r = await issue("S26BCA005", "Financial Management");
check(r.body.includes("limit 3"), "the per-student limit of 3 books is enforced");
const t1002 = await as("T1002");
const before = await db.bookLoan.count();
await act("/library", lib, 'name="rollNo"', { rollNo: "S26BCA006", bookId: (await book("Financial Management")).id }, {}, "/teacher", t1002);
check((await db.bookLoan.count()) === before, "a teacher can't issue books by calling the action directly");
check((await get("/notifications", s003)).body.includes("Library book issued: Paraja"), "the student is notified of the issue");
r = await get("/student/library", s003);
check(r.body.includes("Paraja") && r.body.includes("With you") && r.body.includes("1 / 3"), "the student sees the book and their limit");
r = await get("/student/library?q=tanenbaum", s003);
check(r.body.includes("Computer Networks") && r.body.includes("available"), "students search the catalogue with live availability");

heading("Library · renew, return, fines, reminders");
const loan003 = await db.bookLoan.findFirst({ where: { student: { rollNo: "S26BCA003" }, status: "ISSUED" } });
r = await act("/library", lib, (f) => f.includes(loan003.id) && f.includes("Renew"), {});
check(r.body.includes("Renewed. New due date"), "the librarian renews a loan");
check(!forms((await get("/library", lib)).body).some((f) => f.includes(loan003.id) && f.includes("Renew")), "the renewal limit hides a second renewal");
const overdue = await db.bookLoan.findFirst({ where: { student: { rollNo: "S26BCA008" }, status: "ISSUED" } });
r = await act("/library", lib, (f) => f.includes(overdue.id) && f.includes("Return"), {});
check(r.body.includes("Fine: ₹12"), "a book returned 6 days late carries a ₹12 fine (₹2/day)");
const fined = await db.bookLoan.findUnique({ where: { id: overdue.id } });
await act("/library", lib, (f) => f.includes(fined.id) && f.includes("Mark paid"), {});
check((await db.bookLoan.findUnique({ where: { id: overdue.id } })).finePaid, "the fine is marked as paid when collected");
const ontime = await db.bookLoan.findFirst({ where: { student: { rollNo: "S26BCA002" }, status: "ISSUED" } });
r = await act("/library", lib, (f) => f.includes(ontime.id) && f.includes("Return"), {});
check(r.body.includes("returned on time"), "an on-time return has no fine");
await db.bookLoan.updateMany({ where: { student: { rollNo: "S26BCA001" }, status: "ISSUED" }, data: { dueDate: addDays(today, 1), remindedOn: null } });
await tick();
const s001 = await as("S26BCA001");
check((await get("/notifications", s001)).body.includes("Library book due tomorrow: Let Us C"), "the tick job reminds a student the day before the due date");
const n1 = await db.notification.count({ where: { title: { startsWith: "Library book due" } } });
await tick();
check((await db.notification.count({ where: { title: { startsWith: "Library book due" } } })) === n1, "reminders are sent at most once a day");
check((await get("/admin/library", await as("ADMIN01"))).body.includes("Books out"), "the admin can run the library too");

// =============================================================================
heading("Notes · who sees what");
r = await get("/student/notes", s001);
check(r.body.includes("Unit 2: Pointers and arrays") && !r.body.includes("Stacks and queues") && !r.body.includes("POSDCORB"), "a BCA Year 1 student sees only BCA Year 1 notes");
r = await get("/student/notes?q=pointers", s001);
check(r.body.includes("Pointers and arrays") && !r.body.includes("Unit 1: Introduction"), "search by topic finds the right notes");
check((await get("/student/notes?q=zzzz", s001)).body.includes("No notes match"), "a search with no results says so");
const bba = await as("S26BBA001");
check((await get("/student/notes", bba)).body.includes("POSDCORB") && !(await get("/student/notes", bba)).body.includes("Pointers"), "a BBA student sees BBA notes only");
const ptr = await db.note.findFirst({ where: { title: { contains: "Pointers" } } });
const file = (c) => fetch(`${BASE}/api/notes/${ptr.id}/file`, { headers: c ? { cookie: c } : {} });
let res = await file(s001);
check(res.status === 200 && res.headers.get("content-type") === "application/pdf", "the student opens the PDF");
check((await db.note.findUnique({ where: { id: ptr.id } })).downloads === 1, "views are counted");
check((await file(await as("S25BCA001"))).status === 404, "a Year 2 student cannot open Year 1 notes");
check((await file(bba)).status === 404, "a BBA student cannot open BCA notes");
check((await file(null)).status === 401, "notes need sign-in");
check((await file(await as("P26BCA001"))).status === 404, "parents don't see notes");
check((await get("/hod/notes", await as("T2001"))).body.includes("POSDCORB") && !(await get("/hod/notes", await as("T2001"))).body.includes("Pointers"), "the BBA HOD sees BBA notes only");

heading("Notes · upload and delete");
const subj = async (code) => (await db.subject.findUnique({ where: { code } })).id;
r = await act("/teacher/notes", t1002, 'name="tags"', { subjectId: await subj("BCA104"), title: "Lab manual: experiments 1-5", tags: "lab, experiments", description: "Programs with expected output." }, { file: { data: pdf, type: "application/pdf", name: "lab-manual.pdf" } });
check(r.body.includes("uploaded") && r.body.includes("notified"), "a teacher uploads notes for a subject they teach");
check((await get("/notifications", s001)).body.includes("New notes: Lab manual"), "students of that subject are notified");
r = await act("/teacher/notes", t1002, 'name="tags"', { subjectId: await subj("BCA201"), title: "Not my subject" }, { file: { data: pdf, type: "application/pdf", name: "x.pdf" } });
check(r.body.includes("only for subjects you teach"), "a teacher can't upload for a subject they don't teach");
r = await act("/teacher/notes", t1002, 'name="tags"', { subjectId: await subj("BCA101"), title: "Fake file" }, { file: { data: new TextEncoder().encode("hello"), type: "application/pdf", name: "x.pdf" } });
check(r.body.includes("Only PDF, Word, PowerPoint"), "files are checked by their content");
const pptx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
const s1B = await db.section.findFirst({ where: { year: 1, name: "B", department: { code: "BCA" } } });
r = await act("/teacher/notes", t1002, 'name="tags"', { subjectId: await subj("BCA101"), sectionId: s1B.id, title: "Section B revision slides" }, { file: { data: pptx, type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", name: "revision.pptx" } });
check(r.body.includes("uploaded"), "PowerPoint slides can be uploaded for one section");
check(!(await get("/student/notes", s001)).body.includes("Section B revision slides"), "a student in section A doesn't see section B's notes");
check((await get("/student/notes", await as("S26BCA009"))).body.includes("Section B revision slides"), "a student in section B does");
const lab = await db.note.findFirst({ where: { title: { startsWith: "Lab manual" } } });
const t1003 = await as("T1003");
await act("/teacher/notes", t1002, (f) => f.includes(lab.id) && f.includes("Delete"), {}, {}, "/teacher/notes", t1003);
check(Boolean(await db.note.findUnique({ where: { id: lab.id } })), "another teacher can't delete someone's notes");
await act("/teacher/notes", t1002, (f) => f.includes(lab.id) && f.includes("Delete"), {});
check(!(await db.note.findUnique({ where: { id: lab.id } })), "the uploader deletes their notes");
const qb = await db.note.findFirst({ where: { title: { contains: "question bank" } } });
await act("/hod/notes", await as("T1001"), (f) => f.includes(qb.id) && f.includes("Delete"), {});
check(!(await db.note.findUnique({ where: { id: qb.id } })), "the department's HOD can remove any of its notes");

await db.$disconnect();
console.log(failures === 0 ? "\nAll library and notes checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures ? 1 : 0);
