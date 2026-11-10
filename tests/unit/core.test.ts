// Unit tests for the rules the PRD depends on. Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { distanceMeters, nearestGeofence } from "../../src/lib/geo";
import { addDays, formatHHMM, isDateKey, monthWeeks, parseHHMM, toDateKey, weekdayOf, zonedDateTime } from "../../src/lib/dates";
import { classify, classesNeeded, riskLevel, type Tally } from "../../src/lib/attendance";
import { classStats, gradeFor, isVisible, parseMark } from "../../src/lib/results";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";
import { canOpenPortal, homePathForRoles, portalForPath, safeNextPath } from "../../src/lib/roles";
import { canSee, type AudienceContext, type NoticeScope } from "../../src/lib/audience";
import { parseCsv, parseFlexibleDate, readTable, toCsv, toXlsx } from "../../src/lib/spreadsheet";
import { hit, resetRateLimits } from "../../src/lib/rate-limit";
import { isUnder18 } from "../../src/lib/privacy";

test("geofence distance (FR-5): 0.001° of latitude is about 111 m", () => {
  const d = distanceMeters({ latitude: 12.9716, longitude: 77.5946 }, { latitude: 12.9726, longitude: 77.5946 });
  assert.ok(Math.abs(d - 111.2) < 0.5, `got ${d}`);
  assert.equal(distanceMeters({ latitude: 10, longitude: 10 }, { latitude: 10, longitude: 10 }), 0);
});

test("nearest geofence is chosen by distance to its edge, not its centre", () => {
  const small = { id: "a", latitude: 0, longitude: 0, radiusMeters: 50 };
  const big = { id: "b", latitude: 0, longitude: 0.004, radiusMeters: 500 }; // centre ~445 m away
  const r = nearestGeofence([small, big], { latitude: 0, longitude: 0.0015 }); // 167 m from a, 278 m from b
  assert.equal(r?.fence.id, "b"); // inside b's 500 m radius, outside a's 50 m
});

test("dates are computed in the college time zone (Asia/Kolkata)", () => {
  assert.equal(zonedDateTime("2026-11-09", "09:00").toISOString(), "2026-11-09T03:30:00.000Z");
  assert.equal(toDateKey(new Date("2026-11-09T20:00:00Z")), "2026-11-10"); // 01:30 IST next day
  assert.equal(weekdayOf("2026-11-09"), 1); // Monday
  assert.equal(weekdayOf("2026-11-15"), 7); // Sunday
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29"); // leap year
  assert.ok(isDateKey("2026-02-28") && !isDateKey("2026-02-30") && !isDateKey("2026-2-1"));
  assert.equal(parseHHMM("08:30"), 510);
  assert.ok(Number.isNaN(parseHHMM("24:00")));
  assert.equal(formatHHMM(510), "08:30");
  const weeks = monthWeeks("2026-11");
  assert.equal(weeks[0][6], "2026-11-01"); // 1 Nov 2026 is a Sunday
  assert.ok(weeks.every((w) => w.length === 7));
});

test("attendance outcome rules (§4.3, §6)", () => {
  assert.equal(classify("PRESENT", true, false, true), "ATTENDED");
  assert.equal(classify("LATE", true, false, true), "ATTENDED"); // late counts as attended
  assert.equal(classify("PRESENT", false, false, true), "NO_PUNCH"); // no campus punch
  assert.equal(classify("PRESENT", false, false, false), "ATTENDED"); // rule turned off
  assert.equal(classify("ABSENT", true, true, true), "LEAVE"); // approved leave overrides
  assert.equal(classify("MEDICAL", false, false, true), "LEAVE");
  assert.equal(classify("ABSENT", true, false, true), "ABSENT");
});

test("warning ladder and classes needed (FR-32, FR-41)", () => {
  const s = DEFAULT_SETTINGS;
  assert.equal(riskLevel(null, s), "NONE");
  assert.equal(riskLevel(29.9, s), "CRITICAL");
  assert.equal(riskLevel(74.9, s), "WARNING");
  assert.equal(riskLevel(75, s), "OK");
  const t: Tally = { held: 10, attended: 6, leave: 0, absent: 4, noPunch: 0, percent: 60 };
  assert.equal(classesNeeded(t, 75), 6); // (6+6)/(10+6) = 75 %
  assert.equal(classesNeeded({ ...t, attended: 8, percent: 80 }, 75), 0);
});

test("marks parsing, grades and visibility (FR-22, FR-24, FR-33)", () => {
  assert.deepEqual(parseMark("ab", 25), { ok: true, empty: false, marks: null, absent: true });
  assert.deepEqual(parseMark(" 12.5 ", 25), { ok: true, empty: false, marks: 12.5, absent: false });
  assert.equal(parseMark("26", 25).ok, false);
  assert.equal(parseMark("1e2", 25).ok, false);
  assert.equal(parseMark("12.345", 25).ok, false);
  assert.deepEqual(parseMark("", 25), { ok: true, empty: true, marks: null, absent: false });
  assert.equal(gradeFor(70.8, DEFAULT_SETTINGS).grade, "A");
  assert.equal(gradeFor(39.9, DEFAULT_SETTINGS).grade, "F");
  assert.equal(gradeFor(100, DEFAULT_SETTINGS).points, 10);
  const now = new Date("2026-11-09T10:00:00Z");
  assert.equal(isVisible({ status: "LOCKED", publishAt: new Date("2026-11-09T09:59:00Z") }, now), true);
  assert.equal(isVisible({ status: "LOCKED", publishAt: new Date("2026-11-09T10:01:00Z") }, now), false);
  assert.equal(isVisible({ status: "VERIFIED", publishAt: new Date("2026-01-01") }, now), false);
  const st = classStats([{ marks: 20, absent: false }, { marks: 5, absent: false }, { marks: null, absent: true }], 25, 40);
  assert.equal(st.average, 12.5);
  assert.equal(st.passPercent, 33.3); // 1 of 3 (absent counts as not passed)
});

test("redirects and portal access (§3, open-redirect protection)", () => {
  assert.equal(safeNextPath("//evil.example", ["STUDENT"]), null);
  assert.equal(safeNextPath("https://evil.example", ["STUDENT"]), null);
  assert.equal(safeNextPath("/\\evil.example", ["STUDENT"]), null);
  assert.equal(safeNextPath("/admin", ["STUDENT"]), null);
  assert.equal(safeNextPath("/student/punch", ["STUDENT"]), "/student/punch");
  assert.equal(portalForPath("/teacherx"), null);
  assert.ok(canOpenPortal(["MENTOR"], "teacher"));
  assert.ok(!canOpenPortal(["TEACHER"], "hod"));
  assert.equal(homePathForRoles(["TEACHER", "HOD"]), "/select-role");
  assert.equal(homePathForRoles([]), "/forbidden");
});

test("notice audiences (FR-44)", () => {
  const year1Student: AudienceContext = { userId: "s1", isAdmin: false, student: { departmentId: "cs", year: 1, sectionId: "1a", subjectIds: ["cs101"] }, children: [], teacher: null };
  const parentOfYear3: AudienceContext = { userId: "p1", isAdmin: false, student: null, children: [{ departmentId: "cs", year: 3, sectionId: "3a", subjectIds: [] }], teacher: null };
  const csTeacher: AudienceContext = { userId: "t1", isAdmin: false, student: null, children: [], teacher: { departmentId: "cs", sectionIds: ["1a"], subjectIds: ["cs101"] } };
  const n = (over: Partial<NoticeScope>): NoticeScope => ({ audience: "EVERYONE", departmentId: null, year: null, sectionId: null, subjectId: null, createdById: "admin", ...over });
  assert.ok(canSee(n({ audience: "STUDENTS", year: 1 }), year1Student));
  assert.ok(!canSee(n({ audience: "STUDENTS", year: 3 }), year1Student));
  assert.ok(!canSee(n({ audience: "TEACHERS" }), year1Student));
  assert.ok(canSee(n({ audience: "PARENTS", year: 3 }), parentOfYear3));
  assert.ok(!canSee(n({ audience: "STUDENTS", year: 3 }), parentOfYear3)); // parents only see parent notices
  assert.ok(canSee(n({ audience: "TEACHERS", departmentId: "cs" }), csTeacher));
  assert.ok(!canSee(n({ audience: "TEACHERS", departmentId: "com" }), csTeacher));
  assert.ok(canSee(n({ audience: "STUDENTS", subjectId: "cs101" }), year1Student));
  assert.ok(canSee(n({ audience: "STUDENTS", year: 3, createdById: "s1" }), year1Student)); // authors see their own
});

test("CSV and Excel files round-trip (FR-2, exports)", async () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\r\n'), [["a", "b"], ["x, y", 'say "hi"']]);
  assert.equal(toCsv([["=1+1", "ok"]]), "'=1+1,ok\r\n"); // formula injection neutralised
  const bytes = toXlsx([["name", "marks"], ["Asha <A&B>", 24], ["Ravi", null]], "Marks");
  const table = await readTable(new File([new Uint8Array(bytes)], "marks.xlsx"));
  assert.deepEqual(table.headers, ["name", "marks"]);
  assert.deepEqual(table.rows, [{ name: "Asha <A&B>", marks: "24" }, { name: "Ravi", marks: "" }]);
  assert.equal(parseFlexibleDate("17/09/2008"), "2008-09-17");
  assert.equal(parseFlexibleDate("31/02/2008"), null);
});

test("rate limiter allows the limit, then blocks until the window passes", () => {
  resetRateLimits();
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) assert.ok(hit("k", 3, 60_000, t + i).ok);
  const blocked = hit("k", 3, 60_000, t + 10);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec > 0);
  assert.ok(hit("k", 3, 60_000, t + 60_001).ok);
});

test("students under 18 need guardian consent (PRD §7)", () => {
  const now = new Date("2026-11-09T00:00:00Z");
  assert.equal(isUnder18(new Date("2009-01-01"), now), true);
  assert.equal(isUnder18(new Date("2008-11-08"), now), false);
  assert.equal(isUnder18(null, now), false);
});
