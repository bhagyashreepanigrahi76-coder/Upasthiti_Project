import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { daysBetweenInclusive, toDateKey } from "./dates";
import { textContains } from "./db-search";
import { notifyUsers } from "./notify";
import { getSettings } from "./settings";
import type { CurrentUser } from "./auth";

// College library: catalogue, issue / return, renewals and overdue fines.

export const BOOK_CATEGORIES = ["Textbook", "Reference", "Journal", "Competitive exams", "Novel / general"] as const;

export const canManageLibrary = (user: CurrentUser) => user.roles.includes("LIBRARIAN") || user.roles.includes("ADMIN");

/** Late fine in rupees for a loan returned (or still out) on `onDate`. */
export function fineFor(dueDate: string, onDate: string, perDay: number): number {
  return onDate > dueDate ? (daysBetweenInclusive(dueDate, onDate) - 1) * perDay : 0;
}

/** Catalogue search across title, author, ISBN and category, with copies available. */
export async function searchBooks(opts: { q?: string; departmentId?: string; category?: string; take?: number }) {
  const q = opts.q?.trim();
  const where: Prisma.BookWhereInput = {
    ...(q ? { OR: [{ title: textContains(q) }, { author: textContains(q) }, { isbn: textContains(q) }, { category: textContains(q) }, { publisher: textContains(q) }] } : {}),
    ...(opts.departmentId ? { departmentId: opts.departmentId } : {}),
    ...(opts.category ? { category: opts.category } : {}),
  };
  const books = await db.book.findMany({
    where,
    orderBy: { title: "asc" },
    take: opts.take ?? 100,
    include: { department: { select: { code: true } }, _count: { select: { loans: { where: { status: "ISSUED" } } } } },
  });
  return books.map((b) => ({ ...b, available: Math.max(0, b.totalCopies - b._count.loans) }));
}

/** FR-35 style reminders: due tomorrow, and overdue (once a day). */
export async function sendLibraryReminders(now = new Date()): Promise<number> {
  const today = toDateKey(now);
  const tomorrow = toDateKey(new Date(now.getTime() + 86_400_000));
  const loans = await db.bookLoan.findMany({
    where: { status: "ISSUED", dueDate: { lte: tomorrow }, OR: [{ remindedOn: null }, { remindedOn: { lt: today } }] },
    include: { book: { select: { title: true } }, student: { select: { userId: true } } },
  });
  const { libraryFinePerDay } = await getSettings();
  for (const l of loans) {
    const overdue = l.dueDate < today;
    await notifyUsers([l.student.userId], {
      title: overdue ? `Library book overdue: ${l.book.title}` : `Library book due ${l.dueDate === today ? "today" : "tomorrow"}: ${l.book.title}`,
      body: overdue ? `Fine so far: ₹${fineFor(l.dueDate, today, libraryFinePerDay)}. Please return it soon.` : "Return or renew it at the library.",
      link: "/student/library",
    });
    await db.bookLoan.update({ where: { id: l.id }, data: { remindedOn: today } });
  }
  return loans.length;
}
