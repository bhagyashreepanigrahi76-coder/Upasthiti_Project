"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getSettings, saveSettings } from "@/lib/settings";
import { addDays, toDateKey } from "@/lib/dates";
import { BOOK_CATEGORIES, canManageLibrary, fineFor } from "@/lib/library";
import { notifyUsers } from "@/lib/notify";
import { isUniqueViolation } from "@/lib/db-errors";
import { type ActionState, failure, formValues, fromZodError, success } from "@/lib/action-state";

async function librarian() {
  const user = await requireUser();
  return canManageLibrary(user) ? user : null;
}

const bookSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(2, "Enter the title").max(200),
  author: z.string().trim().min(2, "Enter the author").max(150),
  isbn: z
    .string()
    .trim()
    .transform((s) => s.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^(\d{9}[\dX]|\d{13})$/, "ISBN is 10 or 13 digits"))
    .optional(),
  publisher: z.string().trim().max(120).optional(),
  edition: z.string().trim().max(40).optional(),
  category: z.enum(BOOK_CATEGORIES),
  departmentId: z.string().optional(),
  shelf: z.string().trim().max(30).optional(),
  totalCopies: z.coerce.number().int().min(1, "At least 1 copy").max(500),
});

export async function saveBook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await librarian();
  if (!user) return failure("Only the librarian or admin can change the catalogue.");
  const parsed = bookSchema.safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { id, ...data } = parsed.data;
  const record = { ...data, isbn: data.isbn ?? null, departmentId: data.departmentId ?? null };
  if (id) {
    const issued = await db.bookLoan.count({ where: { bookId: id, status: "ISSUED" } });
    if (data.totalCopies < issued) return failure(`${issued} copies are issued right now; total copies can't be lower than that.`);
  }
  try {
    const book = id ? await db.book.update({ where: { id }, data: record }) : await db.book.create({ data: record });
    await logAudit({ actorId: user.id, action: id ? "BOOK_UPDATED" : "BOOK_ADDED", entityType: "Book", entityId: book.id, details: { title: data.title } });
  } catch (err) {
    if (isUniqueViolation(err)) return failure("A book with this ISBN is already in the catalogue. Add copies to it instead.");
    throw err;
  }
  refresh();
  return success(id ? "Book updated." : `"${data.title}" added to the catalogue.`);
}

export async function deleteBook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await librarian();
  if (!user) return failure("Not allowed.");
  const id = String(formData.get("id") ?? "");
  if (await db.bookLoan.count({ where: { bookId: id, status: "ISSUED" } })) return failure("Some copies are still issued. Wait until they are returned.");
  await db.book.delete({ where: { id } }).catch(() => null);
  await logAudit({ actorId: user.id, action: "BOOK_REMOVED", entityType: "Book", entityId: id });
  refresh();
  return success("Book removed from the catalogue.");
}

export async function issueBook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await librarian();
  if (!user) return failure("Only the librarian or admin can issue books.");
  const v = formValues(formData);
  const settings = await getSettings();
  const rollNo = (v.rollNo ?? "").toUpperCase();
  const [student, book] = await Promise.all([
    db.student.findUnique({ where: { rollNo }, include: { user: { select: { name: true } }, loans: { where: { OR: [{ status: "ISSUED" }, { fine: { gt: 0 }, finePaid: false }] } } } }),
    v.bookId ? db.book.findUnique({ where: { id: v.bookId }, include: { _count: { select: { loans: { where: { status: "ISSUED" } } } } } }) : null,
  ]);
  if (!student || student.status !== "ACTIVE") return { error: "No active student with that roll number.", fieldErrors: { rollNo: "Check the roll number" } };
  if (!book) return { error: "Choose a book.", fieldErrors: { bookId: "Choose a book" } };
  if (book._count.loans >= book.totalCopies) return failure(`All ${book.totalCopies} copies of "${book.title}" are issued.`);
  const today = toDateKey(new Date());
  const out = student.loans.filter((l) => l.status === "ISSUED");
  if (out.some((l) => l.bookId === book.id)) return failure(`${student.user.name} already has a copy of this book.`);
  if (out.length >= settings.libraryMaxBooks) return failure(`${student.user.name} already has ${out.length} books (limit ${settings.libraryMaxBooks}).`);
  if (out.some((l) => l.dueDate < today)) return failure(`${student.user.name} has an overdue book. It must be returned first.`);
  const unpaid = student.loans.filter((l) => l.status !== "ISSUED").reduce((n, l) => n + l.fine, 0);
  if (unpaid > 0) return failure(`${student.user.name} has an unpaid fine of ₹${unpaid}.`);

  const dueDate = addDays(today, settings.libraryLoanDays);
  await db.bookLoan.create({ data: { bookId: book.id, studentId: student.id, issuedById: user.id, dueDate } });
  await notifyUsers([student.userId], { title: `Library book issued: ${book.title}`, body: `Please return it by ${dueDate}.`, link: "/student/library" });
  await logAudit({ actorId: user.id, action: "BOOK_ISSUED", entityType: "Book", entityId: book.id, details: { rollNo, dueDate } });
  refresh();
  return success(`"${book.title}" issued to ${student.user.name} (${rollNo}). Due back on ${dueDate}.`);
}

export async function returnBook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await librarian();
  if (!user) return failure("Not allowed.");
  const loan = await db.bookLoan.findUnique({ where: { id: String(formData.get("id") ?? "") }, include: { book: true, student: true } });
  if (!loan || loan.status !== "ISSUED") return failure("This book is not issued.");
  const fine = fineFor(loan.dueDate, toDateKey(new Date()), (await getSettings()).libraryFinePerDay);
  await db.bookLoan.update({ where: { id: loan.id }, data: { status: "RETURNED", returnedAt: new Date(), fine, finePaid: fine === 0 } });
  await logAudit({ actorId: user.id, action: "BOOK_RETURNED", entityType: "Book", entityId: loan.bookId, details: { loanId: loan.id, fine } });
  refresh();
  return success(fine ? `Returned late. Fine: ₹${fine} (mark it paid when collected).` : `"${loan.book.title}" returned on time.`);
}

export async function renewLoan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await librarian();
  if (!user) return failure("Not allowed.");
  const settings = await getSettings();
  const loan = await db.bookLoan.findUnique({ where: { id: String(formData.get("id") ?? "") }, include: { book: true } });
  if (!loan || loan.status !== "ISSUED") return failure("This book is not issued.");
  if (loan.renewals >= settings.libraryMaxRenewals) return failure(`Already renewed ${loan.renewals} time(s), the limit.`);
  const today = toDateKey(new Date());
  if (loan.dueDate < today) return failure("Overdue books can't be renewed. Return it and collect the fine.");
  const dueDate = addDays(today, settings.libraryLoanDays);
  await db.bookLoan.update({ where: { id: loan.id }, data: { dueDate, renewals: { increment: 1 }, remindedOn: null } });
  await logAudit({ actorId: user.id, action: "BOOK_RENEWED", entityType: "Book", entityId: loan.bookId, details: { loanId: loan.id, dueDate } });
  refresh();
  return success(`Renewed. New due date ${dueDate}.`);
}

export async function markFinePaid(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await librarian();
  if (!user) return failure("Not allowed.");
  const id = String(formData.get("id") ?? "");
  await db.bookLoan.update({ where: { id }, data: { finePaid: true } });
  await logAudit({ actorId: user.id, action: "LIBRARY_FINE_PAID", entityType: "BookLoan", entityId: id });
  refresh();
  return success("Fine marked as paid.");
}

export async function saveLibrarySettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await librarian();
  if (!user) return failure("Not allowed.");
  const parsed = z
    .object({
      libraryLoanDays: z.coerce.number().int().min(1).max(90),
      libraryFinePerDay: z.coerce.number().int().min(0).max(100),
      libraryMaxBooks: z.coerce.number().int().min(1).max(20),
      libraryMaxRenewals: z.coerce.number().int().min(0).max(5),
    })
    .safeParse(formValues(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  await saveSettings(parsed.data);
  await logAudit({ actorId: user.id, action: "SETTINGS_UPDATED", details: parsed.data });
  refresh();
  return success("Library rules saved.");
}
