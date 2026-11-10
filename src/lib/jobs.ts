import "server-only";
import { db } from "./db";
import { getSettings } from "./settings";
import { getDayStatus } from "./calendar";
import { minutesOfDay, parseHHMM, toDateKey, zonedDateTime } from "./dates";
import { notifyUsers } from "./notify";
import { autoCloseSessions } from "./punch";
import { publishDueResults } from "./results";
import { deliverDueNotices } from "./notices";
import { maybeRunScheduledReports } from "./reports";
import { completeFinishedRuns, processEmailQueue } from "./email-queue";
import { sendLibraryReminders } from "./library";

const REMINDER_TITLE = "Punch-in reminder";

/**
 * FR-35: remind students who have not punched in, once per working day,
 * between 30 minutes after college starts and college end.
 */
export async function sendPunchReminders(now = new Date()): Promise<number> {
  const settings = await getSettings();
  const minute = minutesOfDay(now);
  if (minute < parseHHMM(settings.collegeStart) + 30 || minute > parseHHMM(settings.collegeEnd)) return 0;
  const today = toDateKey(now);
  const startOfDay = zonedDateTime(today, "00:00");

  const students = await db.student.findMany({
    where: {
      status: "ACTIVE",
      campusSessions: { none: { dateKey: today } },
      user: { isActive: true, notifications: { none: { title: REMINDER_TITLE, createdAt: { gte: startOfDay } } } },
    },
    select: { userId: true, departmentId: true, year: true },
  });
  const dayCache = new Map<string, boolean>();
  const due: string[] = [];
  for (const s of students) {
    const key = `${s.departmentId}:${s.year}`;
    if (!dayCache.has(key)) {
      const day = await getDayStatus(today, { departmentId: s.departmentId, year: s.year });
      dayCache.set(key, day.working && !day.exam);
    }
    if (dayCache.get(key)) due.push(s.userId);
  }
  return notifyUsers(due, { title: REMINDER_TITLE, body: "You have not punched in today. Open the punch screen when you reach campus.", link: "/student/punch" });
}

/** Everything that runs on a schedule. Safe to call often (every 10-15 minutes). */
export async function runScheduledJobs(now = new Date()) {
  const result = {
    sessionsClosed: await autoCloseSessions(now),
    resultsPublished: await publishDueResults(now),
    noticesDelivered: await deliverDueNotices(now),
    punchReminders: await sendPunchReminders(now),
    reportEmailsQueued: await maybeRunScheduledReports(now), // FR-36
    emails: await processEmailQueue(now), // FR-39
    libraryReminders: await sendLibraryReminders(now),
  };
  await completeFinishedRuns();
  return result;
}
