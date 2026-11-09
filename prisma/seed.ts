// Demo data for development. Run with: npm run db:seed
// WARNING: wipes all existing data first. Never run against production.
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDays, toDateKey, weekdayOf } from "../src/lib/dates";

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
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production.");

  console.log("Clearing existing data…");
  await db.$transaction([
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
    data: { code: "CS", name: "Computer Science", programme: "B.Sc. Computer Science" },
  });
  const com = await db.department.create({
    data: { code: "COM", name: "Commerce", programme: "B.Com." },
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
    ["CS101", "Programming in C", cs.id, 1, 1, "THEORY"],
    ["CS102", "Digital Electronics", cs.id, 1, 1, "THEORY"],
    ["CS103", "Discrete Mathematics", cs.id, 1, 1, "THEORY"],
    ["CS104", "C Programming Lab", cs.id, 1, 1, "PRACTICAL"],
    ["CS201", "Data Structures", cs.id, 2, 3, "THEORY"],
    ["CS202", "Database Management Systems", cs.id, 2, 3, "THEORY"],
    ["CS203", "Data Structures Lab", cs.id, 2, 3, "PRACTICAL"],
    ["CS301", "Operating Systems", cs.id, 3, 5, "THEORY"],
    ["CS302", "Computer Networks", cs.id, 3, 5, "THEORY"],
    ["CS303", "Web Technologies Lab", cs.id, 3, 5, "PRACTICAL"],
    ["COM101", "Financial Accounting", com.id, 1, 1, "THEORY"],
    ["COM102", "Business Economics", com.id, 1, 1, "THEORY"],
    ["COM201", "Corporate Accounting", com.id, 2, 3, "THEORY"],
    ["COM202", "Business Law", com.id, 2, 3, "THEORY"],
    ["COM301", "Income Tax", com.id, 3, 5, "THEORY"],
    ["COM302", "Auditing", com.id, 3, 5, "THEORY"],
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
      teaches: [["CS201", sec.cs2A.id], ["CS301", sec.cs3A.id]],
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
      teaches: [["CS101", sec.cs1A.id], ["CS104", sec.cs1A.id], ["CS101", sec.cs1B.id], ["CS104", sec.cs1B.id]],
    },
    {
      collegeId: "T1003",
      name: "Anita Desai",
      departmentId: cs.id,
      designation: "Assistant Professor",
      roles: [{ role: "TEACHER", departmentId: cs.id }],
      teaches: [
        ["CS102", sec.cs1A.id], ["CS103", sec.cs1A.id], ["CS102", sec.cs1B.id], ["CS103", sec.cs1B.id],
        ["CS202", sec.cs2A.id], ["CS203", sec.cs2A.id], ["CS302", sec.cs3A.id], ["CS303", sec.cs3A.id],
      ],
    },
    {
      collegeId: "T2001",
      name: "Prof. Suresh Nair",
      departmentId: com.id,
      designation: "Professor & HOD",
      roles: [{ role: "TEACHER", departmentId: com.id }, { role: "HOD", departmentId: com.id }],
      teaches: [["COM301", sec.com3A.id], ["COM302", sec.com3A.id]],
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
        ["COM101", sec.com1A.id], ["COM102", sec.com1A.id], ["COM201", sec.com2A.id], ["COM202", sec.com2A.id],
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
    [sec.cs1A, "CS", 1, 2026, 8, "T1002"],
    [sec.cs1B, "CS", 1, 2026, 4, null],
    [sec.cs2A, "CS", 2, 2025, 4, null],
    [sec.cs3A, "CS", 3, 2024, 4, null],
    [sec.com1A, "COM", 1, 2026, 4, "T2002"],
    [sec.com2A, "COM", 2, 2025, 2, null],
    [sec.com3A, "COM", 3, 2024, 2, null],
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
      collegeId: "P26CS001",
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
              { studentId: studentIds["S26CS001"], relationship: "Mother" },
              { studentId: studentIds["S24CS001"], relationship: "Mother" },
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
      [1, 1, 1, "CS101", "T1002", "CR-101"], [1, 2, 1, "CS102", "T1003", "CR-101"], [1, 3, 1, "CS103", "T1003", "CR-101"],
      [1, 5, 2, "CS104", "T1002", "LAB-1", b1.id],
      [2, 1, 1, "CS102", "T1003", "CR-101"], [2, 2, 1, "CS101", "T1002", "CR-101"], [2, 3, 1, "CS103", "T1003", "CR-101"],
      [2, 5, 2, "CS104", "T1002", "LAB-1", b2.id],
      [3, 1, 1, "CS103", "T1003", "CR-101"], [3, 2, 1, "CS101", "T1002", "CR-101"], [3, 4, 1, "CS102", "T1003", "CR-101"],
      [4, 1, 1, "CS101", "T1002", "CR-101"], [4, 2, 1, "CS103", "T1003", "CR-101"], [4, 3, 1, "CS102", "T1003", "CR-101"],
      [5, 1, 1, "CS102", "T1003", "CR-101"], [5, 2, 1, "CS101", "T1002", "CR-101"], [5, 3, 1, "CS103", "T1003", "CR-101"],
    ]],
    [sec.cs2A, [
      [1, 1, 1, "CS201", "T1001", "CR-102"], [1, 4, 1, "CS202", "T1003", "CR-102"],
      [2, 2, 1, "CS202", "T1003", "CR-102"], [2, 3, 1, "CS201", "T1001", "CR-102"],
      [3, 2, 1, "CS201", "T1001", "CR-102"], [3, 3, 1, "CS202", "T1003", "CR-102"], [3, 5, 2, "CS203", "T1003", "LAB-2"],
      [4, 1, 1, "CS201", "T1001", "CR-102"], [4, 4, 1, "CS202", "T1003", "CR-102"],
      [5, 2, 1, "CS202", "T1003", "CR-102"], [5, 4, 1, "CS201", "T1001", "CR-102"],
    ]],
  ];
  for (const [s, slots] of timetables) {
    await db.timetable.create({
      data: {
        sectionId: s.id,
        academicYearId: ay.id,
        semester: s.year * 2 - 1,
        effectiveFrom: monday,
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
      studentId: studentIds["S26CS001"],
      dateKey: lastWorkday,
      inAt: new Date(`${lastWorkday}T03:40:00Z`), // 09:10 IST
      status: "INCOMPLETE",
      closedReason: "No punch-out before the cut-off",
    },
  });

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
