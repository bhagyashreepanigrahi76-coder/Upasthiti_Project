// Demo helper: makes today a teachable day so the rotating-QR attendance can be shown.
// Idempotent. Adds only what is missing: a working-Saturday event (if today is a Saturday),
// one long teaching period beside the existing ones, and one extra class for the BCA Year 1 section.
// Scan window = period start - 10 min to period end + 15 min, so 07:40-13:30 allows 07:30-13:45.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const START = process.env.DEMO_START ?? "07:40";
const END = process.env.DEMO_END ?? "13:30";

async function main() {
  const ist = new Date(Date.now() + 5.5 * 3_600_000);
  const dateKey = process.env.DEMO_DATE ?? ist.toISOString().slice(0, 10);
  const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay(); // 0 Sun .. 6 Sat
  if (dow === 0) return console.log("Sunday: nothing to do.");
  const dayType = dow === 6 ? "SATURDAY" : "WEEKDAY";

  if (dow === 6 && !(await db.calendarEvent.findFirst({ where: { type: "WORKING_SATURDAY", startDate: dateKey } }))) {
    await db.calendarEvent.create({
      data: { title: "Demo day (working Saturday)", type: "WORKING_SATURDAY", startDate: dateKey, endDate: dateKey },
    });
    console.log("Added working Saturday", dateKey);
  }

  // A dedicated long period (added beside the existing ones, never editing them).
  const timings = await db.periodTiming.findMany({ where: { dayType } });
  let demo = timings.find((t) => t.startTime === START && t.endTime === END && t.periodNumber != null);
  if (!demo) {
    demo = await db.periodTiming.create({
      data: {
        dayType,
        sortOrder: Math.max(0, ...timings.map((t) => t.sortOrder)) + 1,
        periodNumber: Math.max(0, ...timings.map((t) => t.periodNumber ?? 0)) + 1,
        startTime: START,
        endTime: END,
      },
    });
    console.log("Added", dayType, "period", demo.periodNumber, START + "-" + END);
  }
  const periodNumber = demo.periodNumber!;

  const student = await db.student.findFirst({ where: { user: { collegeId: "S26BCA001" } } });
  const teacher = await db.teacher.findFirst({ where: { user: { collegeId: "T1001" } } });
  const admin = await db.user.findFirst({ where: { collegeId: "ADMIN01" } });
  if (!student?.sectionId || !teacher || !admin) return console.log("Demo accounts not found; skipped extra class.");
  const section = await db.section.findUnique({ where: { id: student.sectionId } });
  const subject = await db.subject.findFirst({ where: { departmentId: section!.departmentId }, orderBy: { code: "asc" } });

  const has = await db.periodChange.findFirst({ where: { sectionId: student.sectionId, dateKey, type: "EXTRA", periodNumber } });
  if (!has) {
    await db.periodChange.create({
      data: {
        dateKey,
        sectionId: student.sectionId,
        periodNumber,
        type: "EXTRA",
        substituteTeacherId: teacher.id,
        subjectId: subject?.id ?? null,
        note: "Demo class",
        createdById: admin.id,
      },
    });
    console.log("Added extra class for", dateKey);
  } else {
    console.log("Extra class already present for", dateKey);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
