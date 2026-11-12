// Demo data for development. Run with: npm run db:seed
// WARNING: wipes all existing data first. Never run against production.
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addDays, toDateKey, weekdayOf } from "../src/lib/dates";
import { PRIVACY_VERSION } from "../src/lib/privacy";

const db = new PrismaClient();
const DEMO_PASSWORD = "Demo@1234";

const STUDENT_NAMES = [
  "Aarav Sharma", "Diya Patel", "Ishaan Gupta", "Ananya Rao", "Vihaan Singh", "Saanvi Menon",
  "Arjun Nair", "Kavya Pillai", "Reyansh Joshi", "Meera Kulkarni", "Aditya Bose", "Riya Chatterjee",
  "Kabir Malhotra", "Tara Hegde", "Rohan Das", "Nisha Fernandes", "Dev Mehta", "Pooja Iyer",
  "Siddharth Rao", "Lakshmi Krishnan", "Yash Agarwal", "Sneha Banerjee", "Manav Kapoor", "Isha Reddy",
  "Karthik Subramanian", "Neha Saxena", "Arnav Mishra", "Zoya Khan",
];

async function main() {
  if (process.env.ALLOW_DEMO_SEED === "1") {
    // Demo hosting only: load demo data once, never wipe a database that already has users.
    if ((await db.user.count()) > 0) {
      console.log("Database already has users; skipping demo seed.");
      return;
    }
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed in production.");
  }

  console.log("Clearing existing data…");
  await db.$transaction([
    db.bookLoan.deleteMany(),
    db.book.deleteMany(),
    db.note.deleteMany(),
    db.noticeRead.deleteMany(),
    db.noticeHistory.deleteMany(),
    db.notice.deleteMany(),
    db.markRevision.deleteMany(),
    db.markEntry.deleteMany(),
    db.assessment.deleteMany(),
    db.attendanceEditRequest.deleteMany(),
    db.attendanceRecord.deleteMany(),
    db.classSession.deleteMany(),
    db.periodChange.deleteMany(),
    db.timetableSlot.deleteMany(),
    db.timetable.deleteMany(),
    db.periodTiming.deleteMany(),
    db.room.deleteMany(),
    db.punchRecord.deleteMany(),
    db.regularisationRequest.deleteMany(),
    db.leaveRequest.deleteMany(),
    db.campusSession.deleteMany(),
    db.calendarEvent.deleteMany(),
    db.notification.deleteMany(),
    db.otpToken.deleteMany(),
    db.importJob.deleteMany(),
    db.geofence.deleteMany(),
    db.batch.deleteMany(),
    db.auditLog.deleteMany(),
    db.parentStudent.deleteMany(),
    db.parent.deleteMany(),
    db.teacherSubject.deleteMany(),
    db.student.deleteMany(),
    db.teacher.deleteMany(),
    db.device.deleteMany(),
    db.userRole.deleteMany(),
    db.user.deleteMany(),
    db.subject.deleteMany(),
    db.section.deleteMany(),
    db.department.deleteMany(),
    db.academicYear.deleteMany(),
    db.setting.deleteMany(),
  ]);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // --- Academic structure -------------------------------------------------
  const ay = await db.academicYear.create({
    data: {
      name: "2026-27",
      startDate: new Date("2026-06-15"),
      endDate: new Date("2027-04-30"),
      isCurrent: true,
    },
  });

  const cs = await db.department.create({
    data: { code: "BCA", name: "Computer Applications", programme: "Bachelor of Computer Applications (BCA)" },
  });
  const com = await db.department.create({
    data: { code: "BBA", name: "Business Administration", programme: "Bachelor of Business Administration (BBA)" },
  });

  const section = (departmentId: string, year: number, name: string) =>
    db.section.create({ data: { departmentId, academicYearId: ay.id, year, name } });

  const sec = {
    cs1A: await section(cs.id, 1, "A"),
    cs1B: await section(cs.id, 1, "B"),
    cs2A: await section(cs.id, 2, "A"),
    cs3A: await section(cs.id, 3, "A"),
    com1A: await section(com.id, 1, "A"),
    com2A: await section(com.id, 2, "A"),
    com3A: await section(com.id, 3, "A"),
  };

  const subjectRows: [string, string, string, number, number, "THEORY" | "PRACTICAL"][] = [
    // code, name, deptId, year, semester, type
    ["BCA101", "Programming in C", cs.id, 1, 1, "THEORY"],
    ["BCA102", "Digital Electronics", cs.id, 1, 1, "THEORY"],
    ["BCA103", "Discrete Mathematics", cs.id, 1, 1, "THEORY"],
    ["BCA104", "C Programming Lab", cs.id, 1, 1, "PRACTICAL"],
    ["BCA201", "Data Structures", cs.id, 2, 3, "THEORY"],
    ["BCA202", "Database Management Systems", cs.id, 2, 3, "THEORY"],
    ["BCA203", "Data Structures Lab", cs.id, 2, 3, "PRACTICAL"],
    ["BCA301", "Operating Systems", cs.id, 3, 5, "THEORY"],
    ["BCA302", "Computer Networks", cs.id, 3, 5, "THEORY"],
    ["BCA303", "Web Technologies Lab", cs.id, 3, 5, "PRACTICAL"],
    ["BBA101", "Principles of Management", com.id, 1, 1, "THEORY"],
    ["BBA102", "Business Economics", com.id, 1, 1, "THEORY"],
    ["BBA201", "Marketing Management", com.id, 2, 3, "THEORY"],
    ["BBA202", "Business Law", com.id, 2, 3, "THEORY"],
    ["BBA301", "Financial Management", com.id, 3, 5, "THEORY"],
    ["BBA302", "Human Resource Management", com.id, 3, 5, "THEORY"],
  ];
  const subj: Record<string, string> = {};
  for (const [code, name, departmentId, year, semester, type] of subjectRows) {
    const s = await db.subject.create({
      data: { code, name, departmentId, year, semester, type, credits: type === "PRACTICAL" ? 2 : 4 },
    });
    subj[code] = s.id;
  }

  // --- Admin ------------------------------------------------------------------
  const admin = await db.user.create({
    data: {
      collegeId: "ADMIN01",
      name: "Office Admin",
      email: "admin@college.example.edu",
      passwordHash,
      mustChangePassword: false,
      roles: { create: [{ role: "ADMIN" }] },
    },
  });

  // --- Teachers ---------------------------------------------------------------
  type TeacherSeed = {
    collegeId: string;
    name: string;
    departmentId: string;
    designation: string;
    roles: { role: Role; departmentId?: string; year?: number; sectionId?: string }[];
    teaches: [subjectCode: string, sectionId: string][];
  };
  const teacherSeeds: TeacherSeed[] = [
    {
      collegeId: "T1001",
      name: "Dr. Meera Iyer",
      departmentId: cs.id,
      designation: "Professor & HOD",
      roles: [{ role: "TEACHER", departmentId: cs.id }, { role: "HOD", departmentId: cs.id }],
      teaches: [["BCA201", sec.cs2A.id], ["BCA301", sec.cs3A.id]],
    },
    {
      collegeId: "T1002",
      name: "Rahul Verma",
      departmentId: cs.id,
      designation: "Assistant Professor",
      roles: [
        { role: "TEACHER", departmentId: cs.id },
        { role: "MENTOR", departmentId: cs.id, year: 1, sectionId: sec.cs1A.id },
      ],
      teaches: [["BCA101", sec.cs1A.id], ["BCA104", sec.cs1A.id], ["BCA101", sec.cs1B.id], ["BCA104", sec.cs1B.id]],
    },
    {
      collegeId: "T1003",
      name: "Anita Desai",
      departmentId: cs.id,
      designation: "Assistant Professor",
      roles: [{ role: "TEACHER", departmentId: cs.id }],
      teaches: [
        ["BCA102", sec.cs1A.id], ["BCA103", sec.cs1A.id], ["BCA102", sec.cs1B.id], ["BCA103", sec.cs1B.id],
        ["BCA202", sec.cs2A.id], ["BCA203", sec.cs2A.id], ["BCA302", sec.cs3A.id], ["BCA303", sec.cs3A.id],
      ],
    },
    {
      collegeId: "T2001",
      name: "Prof. Suresh Nair",
      departmentId: com.id,
      designation: "Professor & HOD",
      roles: [{ role: "TEACHER", departmentId: com.id }, { role: "HOD", departmentId: com.id }],
      teaches: [["BBA301", sec.com3A.id], ["BBA302", sec.com3A.id]],
    },
    {
      collegeId: "T2002",
      name: "Kavya Reddy",
      departmentId: com.id,
      designation: "Assistant Professor",
      roles: [
        { role: "TEACHER", departmentId: com.id },
        { role: "MENTOR", departmentId: com.id, year: 1, sectionId: sec.com1A.id },
      ],
      teaches: [
        ["BBA101", sec.com1A.id], ["BBA102", sec.com1A.id], ["BBA201", sec.com2A.id], ["BBA202", sec.com2A.id],
      ],
    },
  ];

  const teacherIdByCollegeId: Record<string, string> = {};
  for (const t of teacherSeeds) {
    const user = await db.user.create({
      data: {
        collegeId: t.collegeId,
        name: t.name,
        email: `${t.collegeId.toLowerCase()}@college.example.edu`,
        passwordHash,
        mustChangePassword: false,
        roles: { create: t.roles },
        teacher: { create: { departmentId: t.departmentId, designation: t.designation } },
      },
      include: { teacher: true },
    });
    const teacherId = user.teacher!.id;
    teacherIdByCollegeId[t.collegeId] = teacherId;
    for (const [code, sectionId] of t.teaches) {
      await db.teacherSubject.create({
        data: { teacherId, subjectId: subj[code], sectionId, academicYearId: ay.id },
      });
    }
  }

  // --- Students and parents ---------------------------------------------------
  // [section, dept code, year, admission year, how many, mentor collegeId]
  const cohorts: [typeof sec.cs1A, string, number, number, number, string | null][] = [
    [sec.cs1A, "BCA", 1, 2026, 8, "T1002"],
    [sec.cs1B, "BCA", 1, 2026, 4, null],
    [sec.cs2A, "BCA", 2, 2025, 4, null],
    [sec.cs3A, "BCA", 3, 2024, 4, null],
    [sec.com1A, "BBA", 1, 2026, 4, "T2002"],
    [sec.com2A, "BBA", 2, 2025, 2, null],
    [sec.com3A, "BBA", 3, 2024, 2, null],
  ];

  let nameIndex = 0;
  const counters: Record<string, number> = {};
  const studentIds: Record<string, string> = {};

  for (const [s, deptCode, year, admissionYear, count, mentorCode] of cohorts) {
    for (let i = 0; i < count; i++) {
      const key = `${admissionYear}${deptCode}`;
      counters[key] = (counters[key] ?? 0) + 1;
      const rollNo = `S${String(admissionYear).slice(2)}${deptCode}${String(counters[key]).padStart(3, "0")}`;
      const name = STUDENT_NAMES[nameIndex++ % STUDENT_NAMES.length];

      const user = await db.user.create({
        data: {
          collegeId: rollNo,
          name,
          email: `${rollNo.toLowerCase()}@student.example.edu`,
          passwordHash,
          mustChangePassword: false,
          roles: { create: [{ role: "STUDENT", departmentId: s.departmentId, year, sectionId: s.id }] },
          student: {
            create: {
              rollNo,
              departmentId: s.departmentId,
              sectionId: s.id,
              year,
              admissionYear,
              mentorId: mentorCode ? teacherIdByCollegeId[mentorCode] : null,
            },
          },
        },
        include: { student: true },
      });
      studentIds[rollNo] = user.student!.id;

      // Every student gets a parent contact for monthly emails (no login).
      await db.parent.create({
        data: {
          name: `Parent of ${name}`,
          email: `parent.${rollNo.toLowerCase()}@example.com`,
          phone: `+91 90000 ${String(nameIndex).padStart(5, "0")}`,
          students: { create: [{ studentId: user.student!.id, relationship: "Guardian" }] },
        },
      });
    }
  }

  // One parent with a login, linked to two children (siblings in Year 1 and Year 3).
  await db.user.create({
    data: {
      collegeId: "P26BCA001",
      name: "Sunita Sharma",
      email: "sunita.sharma@example.com",
      passwordHash,
      mustChangePassword: false,
      roles: { create: [{ role: "PARENT" }] },
      parent: {
        create: {
          name: "Sunita Sharma",
          email: "sunita.sharma@example.com",
          phone: "+91 98000 12345",
          students: {
            create: [
              { studentId: studentIds["S26BCA001"], relationship: "Mother" },
              { studentId: studentIds["S24BCA001"], relationship: "Mother" },
            ],
          },
        },
      },
    },
  });

  // --- Settings (edited by admin from Day 2/3 onwards) ------------------------
  // Same keys as src/lib/settings.ts; anything not stored uses its default.
  const settings: Record<string, unknown> = {
    warningThreshold: 75, // FR-41 early warning
    criticalThreshold: 30, // FR-38 critical parent alert
    leavePolicy: "EXCLUDE_FROM_DENOMINATOR", // FR-17
    maxAccuracyMeters: 30, // FR-8
    collegeStart: "08:30",
    collegeEnd: "17:00",
    punchCutoff: "18:00", // FR-10 auto-close time
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.setting.create({ data: { key, value: JSON.stringify(value) } });
  }

  // --- Day 3: campus point (replace with the real campus coordinates) ---------
  await db.geofence.create({ data: { name: "Main campus", latitude: 12.9716, longitude: 77.5946, radiusMeters: 100 } });

  // --- Day 5: period timings, rooms, batches, timetables ----------------------
  const weekday: [string, string, number | null, string | null][] = [
    ["09:00", "09:55", 1, null], ["09:55", "10:50", 2, null], ["10:50", "11:05", null, "Short break"],
    ["11:05", "12:00", 3, null], ["12:00", "12:55", 4, null], ["12:55", "13:40", null, "Lunch"],
    ["13:40", "14:35", 5, null], ["14:35", "15:30", 6, null],
  ];
  const saturday: [string, string, number | null, string | null][] = [
    ["09:00", "09:55", 1, null], ["09:55", "10:50", 2, null], ["10:50", "11:05", null, "Short break"],
    ["11:05", "12:00", 3, null], ["12:00", "12:55", 4, null],
  ];
  for (const [dayType, rows] of [["WEEKDAY", weekday], ["SATURDAY", saturday]] as const) {
    for (const [i, [startTime, endTime, periodNumber, label]] of rows.entries()) {
      await db.periodTiming.create({ data: { dayType, sortOrder: i + 1, startTime, endTime, periodNumber, label } });
    }
  }
  const room: Record<string, string> = {};
  for (const [name, type, capacity] of [
    ["CR-101", "CLASSROOM", 60], ["CR-102", "CLASSROOM", 60], ["CR-103", "CLASSROOM", 60],
    ["LAB-1", "LAB", 30], ["LAB-2", "LAB", 30],
  ] as const) {
    room[name] = (await db.room.create({ data: { name, type, capacity } })).id;
  }

  // CS Year 1-A splits into two lab batches by roll number (FR-56).
  const b1 = await db.batch.create({ data: { sectionId: sec.cs1A.id, name: "Batch 1" } });
  const b2 = await db.batch.create({ data: { sectionId: sec.cs1A.id, name: "Batch 2" } });
  const cs1aStudents = await db.student.findMany({ where: { sectionId: sec.cs1A.id }, orderBy: { rollNo: "asc" } });
  for (const [i, s] of cs1aStudents.entries()) {
    await db.student.update({ where: { id: s.id }, data: { batchId: i < cs1aStudents.length / 2 ? b1.id : b2.id } });
  }

  // Timetables in force from Monday of this week. Teachers never clash.
  const today = toDateKey(new Date());
  const monday = addDays(today, 1 - weekdayOf(today));
  const T = teacherIdByCollegeId;
  type SeedSlot = [day: number, period: number, span: number, subject: string, teacher: string, room: string, batch?: string];
  const timetables: [typeof sec.cs1A, SeedSlot[]][] = [
    [sec.cs1A, [
      [1, 1, 1, "BCA101", "T1002", "CR-101"], [1, 2, 1, "BCA102", "T1003", "CR-101"], [1, 3, 1, "BCA103", "T1003", "CR-101"],
      [1, 5, 2, "BCA104", "T1002", "LAB-1", b1.id],
      [2, 1, 1, "BCA102", "T1003", "CR-101"], [2, 2, 1, "BCA101", "T1002", "CR-101"], [2, 3, 1, "BCA103", "T1003", "CR-101"],
      [2, 5, 2, "BCA104", "T1002", "LAB-1", b2.id],
      [3, 1, 1, "BCA103", "T1003", "CR-101"], [3, 2, 1, "BCA101", "T1002", "CR-101"], [3, 4, 1, "BCA102", "T1003", "CR-101"],
      [4, 1, 1, "BCA101", "T1002", "CR-101"], [4, 2, 1, "BCA103", "T1003", "CR-101"], [4, 3, 1, "BCA102", "T1003", "CR-101"],
      [5, 1, 1, "BCA102", "T1003", "CR-101"], [5, 2, 1, "BCA101", "T1002", "CR-101"], [5, 3, 1, "BCA103", "T1003", "CR-101"],
    ]],
    [sec.cs2A, [
      [1, 1, 1, "BCA201", "T1001", "CR-102"], [1, 4, 1, "BCA202", "T1003", "CR-102"],
      [2, 2, 1, "BCA202", "T1003", "CR-102"], [2, 3, 1, "BCA201", "T1001", "CR-102"],
      [3, 2, 1, "BCA201", "T1001", "CR-102"], [3, 3, 1, "BCA202", "T1003", "CR-102"], [3, 5, 2, "BCA203", "T1003", "LAB-2"],
      [4, 1, 1, "BCA201", "T1001", "CR-102"], [4, 4, 1, "BCA202", "T1003", "CR-102"],
      [5, 2, 1, "BCA202", "T1003", "CR-102"], [5, 4, 1, "BCA201", "T1001", "CR-102"],
    ]],
  ];
  for (const [s, slots] of timetables) {
    await db.timetable.create({
      data: {
        sectionId: s.id,
        academicYearId: ay.id,
        semester: s.year * 2 - 1,
        effectiveFrom: addDays(monday, -21), // three weeks back, so the demo attendance days are covered
        note: "Demo timetable",
        slots: {
          create: slots.map(([dayOfWeek, periodNumber, span, code, teacher, r, batchId]) => ({
            dayOfWeek,
            periodNumber,
            span,
            type: subjectRows.find((x) => x[0] === code)![5] === "PRACTICAL" ? "PRACTICAL" : "LECTURE",
            subjectId: subj[code],
            teacherId: T[teacher],
            roomId: room[r],
            batchId: batchId ?? null,
          })),
        },
      },
    });
  }

  // --- Day 4: calendar entries and an incomplete campus day -------------------
  const nextWeekday = (from: string, target: number) => addDays(from, ((target - weekdayOf(from) + 7) % 7) || 7);
  const holiday = nextWeekday(addDays(today, 7), 3); // a Wednesday in 1-2 weeks
  const workingSat = nextWeekday(today, 6);
  const examStart = nextWeekday(addDays(today, 21), 1);
  await db.calendarEvent.createMany({
    data: [
      { academicYearId: ay.id, title: "Founders' Day", type: "HOLIDAY", startDate: holiday, endDate: holiday },
      { academicYearId: ay.id, title: "Working Saturday", type: "WORKING_SATURDAY", startDate: workingSat, endDate: workingSat },
      { academicYearId: ay.id, title: "Internal Assessment 1", type: "EXAM", startDate: examStart, endDate: addDays(examStart, 4) },
      { academicYearId: ay.id, title: "Tech fest", type: "EVENT", startDate: addDays(examStart, 10), endDate: addDays(examStart, 11), departmentId: cs.id },
    ],
  });
  let lastWorkday = addDays(today, -1);
  while (weekdayOf(lastWorkday) > 5) lastWorkday = addDays(lastWorkday, -1);
  await db.campusSession.create({
    data: {
      studentId: studentIds["S26BCA001"],
      dateKey: lastWorkday,
      inAt: new Date(`${lastWorkday}T03:40:00Z`), // 09:10 IST
      status: "INCOMPLETE",
      closedReason: "No punch-out before the cut-off",
    },
  });

  // --- Day 6: two weeks of class attendance for CS 1-A -------------------------
  // Deterministic "random" so every seed gives the same picture: S26BCA008 is
  // critical, S26BCA007 is below 75 %, S26BCA005 was marked present one day
  // without a campus punch.
  const teacherUser = new Map((await db.teacher.findMany({ select: { id: true, userId: true } })).map((t) => [t.id, t.userId]));
  const roster1A = await db.student.findMany({ where: { sectionId: sec.cs1A.id }, orderBy: { rollNo: "asc" } });
  const slots1A = await db.timetableSlot.findMany({ where: { timetable: { sectionId: sec.cs1A.id } } });
  const absentRate = (i: number) => (i === 7 ? 75 : i === 6 ? 35 : i === 5 ? 12 : 5);
  const roll = (i: number, d: string, p: number) => {
    let h = 2166136261;
    for (const ch of `${i}|${d}|${p}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return (h >>> 0) % 100;
  };
  const pastDays: string[] = [];
  for (let d = addDays(today, -1); pastDays.length < 10; d = addDays(d, -1)) if (weekdayOf(d) <= 5) pastDays.push(d);
  for (const [dayIndex, d] of pastDays.entries()) {
    const onCampus = new Set<string>();
    for (const slot of slots1A.filter((s) => s.dayOfWeek === weekdayOf(d))) {
      const students = roster1A.filter((s) => !slot.batchId || s.batchId === slot.batchId);
      const takenBy = teacherUser.get(slot.teacherId!)!;
      await db.classSession.create({
        data: {
          dateKey: d,
          periodKey: slot.id,
          sectionId: sec.cs1A.id,
          subjectId: slot.subjectId,
          batchId: slot.batchId,
          periodNumber: slot.periodNumber,
          span: slot.span,
          teacherId: slot.teacherId!,
          takenById: takenBy,
          takenAt: new Date(`${d}T05:00:00Z`),
          records: {
            create: students.map((s) => {
              const i = roster1A.findIndex((r) => r.id === s.id);
              const v = roll(i, d, slot.periodNumber);
              const status = v < absentRate(i) ? ("ABSENT" as const) : v < absentRate(i) + 6 ? ("LATE" as const) : ("PRESENT" as const);
              if (status !== "ABSENT") onCampus.add(s.id);
              return { studentId: s.id, status, markedById: takenBy };
            }),
          },
        },
      });
    }
    for (const sid of onCampus) {
      if (sid === studentIds["S26BCA001"] && d === lastWorkday) continue; // keeps the incomplete day to regularise
      if (sid === roster1A[4].id && dayIndex === 1) continue; // marked present, but no campus punch
      await db.campusSession.create({
        data: { studentId: sid, dateKey: d, inAt: new Date(`${d}T03:25:00Z`), outAt: new Date(`${d}T10:35:00Z`), status: "COMPLETE", minutesOnCampus: 430 },
      });
    }
  }

  // --- Day 7: one published result, one waiting for the HOD, one draft --------
  const adminId = admin.id;
  const t1002User = teacherUser.get(T["T1002"])!;
  const t1003User = teacherUser.get(T["T1003"])!;
  const t1001User = teacherUser.get(T["T1001"])!;
  const published = await db.assessment.create({
    data: {
      subjectId: subj["BCA101"], sectionId: sec.cs1A.id, academicYearId: ay.id, kind: "INTERNAL1", maxMarks: 25, weightage: 15,
      status: "PUBLISHED", submittedById: t1002User, submittedAt: new Date(Date.now() - 5 * 86400_000),
      verifiedById: t1001User, verifiedAt: new Date(Date.now() - 4 * 86400_000), lockedById: adminId, lockedAt: new Date(Date.now() - 3 * 86400_000),
      publishAt: new Date(Date.now() - 2 * 86400_000), publishedAt: new Date(Date.now() - 2 * 86400_000), notifiedAt: new Date(Date.now() - 2 * 86400_000),
    },
  });
  const submitted = await db.assessment.create({
    data: {
      subjectId: subj["BCA102"], sectionId: sec.cs1A.id, academicYearId: ay.id, kind: "INTERNAL1", maxMarks: 25, weightage: 15,
      status: "SUBMITTED", submittedById: t1003User, submittedAt: new Date(Date.now() - 86400_000),
    },
  });
  const draft = await db.assessment.create({
    data: { subjectId: subj["BCA101"], sectionId: sec.cs1A.id, academicYearId: ay.id, kind: "ASSIGNMENT", maxMarks: 10, weightage: 10 },
  });
  for (const [i, s] of roster1A.entries()) {
    await db.markEntry.create({ data: { assessmentId: published.id, studentId: s.id, marks: i === 7 ? null : i === 6 ? 8 : 14 + ((i * 7) % 11), absent: i === 7, updatedById: t1002User } });
    await db.markEntry.create({ data: { assessmentId: submitted.id, studentId: s.id, marks: 12 + ((i * 5) % 13), absent: false, updatedById: t1003User } });
    if (i < 4) await db.markEntry.create({ data: { assessmentId: draft.id, studentId: s.id, marks: 6 + (i % 4), absent: false, updatedById: t1002User } });
  }

  // --- Day 8: notices ---------------------------------------------------------
  const examEvent = await db.calendarEvent.findFirst({ where: { title: "Internal Assessment 1" } });
  const hodCs = await db.user.findUnique({ where: { collegeId: "T1001" } });
  await db.notice.create({
    data: {
      title: "Welcome to the 2026-27 academic year",
      body: "Classes run Monday to Friday, 09:00 to 15:30. Punch in on the app when you reach campus and punch out when you leave.\n\nCheck this board for exam schedules, holidays and events.",
      category: "GENERAL", audience: "EVERYONE", isPublic: true, pinned: true, createdById: adminId, notifiedAt: new Date(),
    },
  });
  await db.notice.create({
    data: {
      title: "Internal Assessment 1 timetable",
      body: "Internal Assessment 1 for all Year 1 students starts on the date shown in the calendar. Bring your ID card; latecomers will not be allowed after 15 minutes.",
      category: "EXAM", audience: "STUDENTS", year: 1, urgent: true, calendarEventId: examEvent?.id, createdById: adminId, notifiedAt: new Date(),
    },
  });
  await db.notice.create({
    data: {
      title: "Department meeting on Friday",
      body: "All BCA teachers: department meeting on Friday at 15:45 in CR-101 to plan Internal Assessment 1.",
      category: "GENERAL", audience: "TEACHERS", departmentId: cs.id, createdById: hodCs!.id, notifiedAt: new Date(),
    },
  });

  // --- Library: librarian, catalogue, loans (one overdue) ------------------------
  const librarian = await db.user.create({
    data: {
      collegeId: "L1001",
      name: "Ramesh Patra",
      email: "library@college.example.edu",
      passwordHash,
      mustChangePassword: false,
      roles: { create: [{ role: "LIBRARIAN" }] },
    },
  });
  const bookRows: [string, string, string, string | null, string | null, string, number][] = [
    // title, author, category, edition, dept (code), shelf, copies
    ["Let Us C", "Yashavant Kanetkar", "Textbook", "17th ed.", "BCA", "BCA-R1-S1", 6],
    ["Programming in ANSI C", "E. Balagurusamy", "Textbook", "8th ed.", "BCA", "BCA-R1-S1", 4],
    ["Data Structures Through C", "Yashavant Kanetkar", "Textbook", "4th ed.", "BCA", "BCA-R1-S2", 3],
    ["Database System Concepts", "Silberschatz, Korth, Sudarshan", "Textbook", "7th ed.", "BCA", "BCA-R1-S3", 3],
    ["Operating System Concepts", "Silberschatz, Galvin, Gagne", "Textbook", "10th ed.", "BCA", "BCA-R2-S1", 3],
    ["Computer Networks", "Andrew S. Tanenbaum", "Textbook", "5th ed.", "BCA", "BCA-R2-S2", 2],
    ["Digital Logic and Computer Design", "M. Morris Mano", "Textbook", null, "BCA", "BCA-R2-S3", 2],
    ["Discrete Mathematics and Its Applications", "Kenneth H. Rosen", "Reference", "8th ed.", "BCA", "BCA-R3-S1", 2],
    ["HTML and CSS: Design and Build Websites", "Jon Duckett", "Reference", null, "BCA", "BCA-R3-S2", 1],
    ["Principles of Management", "Harold Koontz, Heinz Weihrich", "Textbook", "11th ed.", "BBA", "BBA-R1-S1", 5],
    ["Marketing Management", "Philip Kotler, Kevin Lane Keller", "Textbook", "16th ed.", "BBA", "BBA-R1-S2", 4],
    ["Financial Management", "Prasanna Chandra", "Textbook", "10th ed.", "BBA", "BBA-R1-S3", 3],
    ["Human Resource Management", "Gary Dessler", "Textbook", "16th ed.", "BBA", "BBA-R2-S1", 3],
    ["Organizational Behavior", "Stephen P. Robbins", "Reference", "18th ed.", "BBA", "BBA-R2-S2", 2],
    ["Business Law", "N. D. Kapoor", "Textbook", null, "BBA", "BBA-R2-S3", 3],
    ["Managerial Economics", "D. N. Dwivedi", "Textbook", "9th ed.", "BBA", "BBA-R3-S1", 2],
    ["Quantitative Aptitude for Competitive Examinations", "R. S. Aggarwal", "Competitive exams", null, null, "GEN-R1-S1", 4],
    ["Wings of Fire", "A. P. J. Abdul Kalam", "Novel / general", null, null, "GEN-R2-S1", 2],
    ["Paraja", "Gopinath Mohanty", "Novel / general", "English translation", null, "GEN-R2-S2", 1],
  ];
  const bookIds: Record<string, string> = {};
  for (const [title, author, category, edition, dept, shelf, totalCopies] of bookRows) {
    const b = await db.book.create({
      data: { title, author, category, edition, shelf, totalCopies, departmentId: dept === "BCA" ? cs.id : dept === "BBA" ? com.id : null, publisher: null },
    });
    bookIds[title] = b.id;
  }
  const loanRows: [string, string, number, number][] = [
    // roll no, book, issued days ago, due in days (negative = overdue)
    ["S26BCA001", "Let Us C", 5, 9],
    ["S26BCA002", "Programming in ANSI C", 10, 4],
    ["S26BCA008", "Let Us C", 20, -6],
    ["S25BCA001", "Database System Concepts", 3, 11],
    ["S26BBA001", "Principles of Management", 7, 7],
  ];
  for (const [roll, title, ago, dueIn] of loanRows) {
    await db.bookLoan.create({
      data: {
        bookId: bookIds[title],
        studentId: studentIds[roll],
        issuedById: librarian.id,
        issuedAt: new Date(Date.now() - ago * 86_400_000),
        dueDate: addDays(today, dueIn),
      },
    });
  }
  // One returned late with an unpaid fine.
  await db.bookLoan.create({
    data: {
      bookId: bookIds["Computer Networks"],
      studentId: studentIds["S24BCA001"],
      issuedById: librarian.id,
      issuedAt: new Date(Date.now() - 30 * 86_400_000),
      dueDate: addDays(today, -16),
      returnedAt: new Date(Date.now() - 12 * 86_400_000),
      status: "RETURNED",
      fine: 8,
    },
  });

  // --- Study notes (small demo PDFs in the private uploads folder) ---------------
  const notesDir = path.join(process.cwd(), "uploads", "notes");
  mkdirSync(notesDir, { recursive: true });
  const demoPdf = (title: string) =>
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${44 + title.length}>>stream\nBT /F1 20 Tf 60 760 Td (${title.replace(/[()\\]/g, "")}) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
  const noteRows: [string, string, string, string, string][] = [
    // subject, uploader college ID, title, description, tags
    ["BCA101", "T1002", "Unit 1: Introduction to C and data types", "Variables, constants, data types and operators with solved examples.", "data types, operators, unit 1"],
    ["BCA101", "T1002", "Unit 2: Pointers and arrays", "Pointer arithmetic, arrays of pointers, and 20 practice questions.", "pointers, arrays, unit 2"],
    ["BCA103", "T1003", "Sets, relations and functions: question bank", "Previous years' questions with answers.", "sets, relations, question bank"],
    ["BCA201", "T1001", "Stacks and queues", "Array and linked-list implementations, with diagrams.", "stack, queue, linked list"],
    ["BBA101", "T2002", "Functions of management (POSDCORB)", "Planning, organising, staffing, directing, coordinating, reporting, budgeting.", "planning, organising, posdcorb"],
    ["BBA102", "T2002", "Demand and supply: short notes", "Law of demand, elasticity, and market equilibrium.", "demand, supply, elasticity"],
  ];
  const userIdOf = async (cid: string) => (await db.user.findUniqueOrThrow({ where: { collegeId: cid } })).id;
  for (const [code, uploader, title, description, tags] of noteRows) {
    const subject = await db.subject.findUniqueOrThrow({ where: { code } });
    const file = `notes/${randomUUID()}.pdf`;
    const bytes = Buffer.from(demoPdf(title));
    writeFileSync(path.join(process.cwd(), "uploads", file), bytes);
    await db.note.create({
      data: {
        title,
        description,
        tags,
        subjectId: subject.id,
        departmentId: subject.departmentId,
        year: subject.year,
        uploadedById: await userIdOf(uploader),
        filePath: file,
        fileName: `${code}-${title.replace(/[^\w]+/g, "-").slice(0, 40)}.pdf`,
        fileMime: "application/pdf",
        fileSize: bytes.length,
      },
    });
  }

  // Demo accounts have already accepted the privacy notice (PRD §7).
  await db.user.updateMany({ data: { consentAt: new Date(), consentVersion: PRIVACY_VERSION } });

  await db.auditLog.create({
    data: { actorId: admin.id, action: "SEED", details: JSON.stringify({ note: "Demo data loaded" }) },
  });

  const [users, students, teachers, parents] = await Promise.all([
    db.user.count(),
    db.student.count(),
    db.teacher.count(),
    db.parent.count(),
  ]);
  console.log(`Seeded ${users} users: ${students} students, ${teachers} teachers, ${parents} parent contacts.`);
  console.log(`All demo accounts use the password: ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
