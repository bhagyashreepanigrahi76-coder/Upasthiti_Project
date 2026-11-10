import type { Metadata } from "next";
import { requireStudent } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { BOOK_CATEGORIES, fineFor, searchBooks } from "@/lib/library";
import { formatDateKey, toDateKey } from "@/lib/dates";
import { Badge, Card, EmptyState, PageHeader, StatCard, Table, td } from "@/components/ui";
import { inputClass } from "@/components/form-fields";

export const metadata: Metadata = { title: "Library" };

type Props = { searchParams: Promise<{ q?: string; category?: string; mine?: string }> };

export default async function StudentLibraryPage({ searchParams }: Props) {
  const { student } = await requireStudent();
  const { q, category, mine } = await searchParams;
  const today = toDateKey(new Date());
  const [settings, loans, books] = await Promise.all([
    getSettings(),
    db.bookLoan.findMany({ where: { studentId: student.id }, orderBy: { issuedAt: "desc" }, take: 20, include: { book: true } }),
    searchBooks({ q, category, departmentId: mine ? student.departmentId : undefined }),
  ]);
  const out = loans.filter((l) => l.status === "ISSUED");
  const fines = loans.filter((l) => l.fine > 0 && !l.finePaid).reduce((n, l) => n + l.fine, 0);
  const runningFine = out.reduce((n, l) => n + fineFor(l.dueDate, today, settings.libraryFinePerDay), 0);

  return (
    <>
      <PageHeader title="Library" subtitle={`Borrow up to ${settings.libraryMaxBooks} books for ${settings.libraryLoanDays} days. Late fine ₹${settings.libraryFinePerDay} per day.`} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Books with you" value={`${out.length} / ${settings.libraryMaxBooks}`} />
        <StatCard label="Overdue" value={out.filter((l) => l.dueDate < today).length} hint={runningFine ? `₹${runningFine} so far` : undefined} />
        <StatCard label="Unpaid fines" value={`₹${fines}`} hint={fines ? "Pay at the library desk" : undefined} />
      </div>

      <Card title="My books" className="mb-6">
        {loans.length === 0 ? (
          <EmptyState>You haven&apos;t borrowed any books yet.</EmptyState>
        ) : (
          <Table head={["Book", "Borrowed", "Due / returned", "Status"]}>
            {loans.map((l) => (
              <tr key={l.id}>
                <td className={td}>
                  <span className="font-medium">{l.book.title}</span>
                  <span className="block text-xs text-slate-500">{l.book.author}</span>
                </td>
                <td className={`${td} text-xs`}>{formatDateKey(toDateKey(l.issuedAt))}</td>
                <td className={`${td} text-xs`}>{l.returnedAt ? `Returned ${formatDateKey(toDateKey(l.returnedAt))}` : `Due ${formatDateKey(l.dueDate)}`}</td>
                <td className={td}>
                  {l.status === "ISSUED" ? (
                    l.dueDate < today ? (
                      <Badge tone="red">Overdue · ₹{fineFor(l.dueDate, today, settings.libraryFinePerDay)}</Badge>
                    ) : (
                      <Badge tone="brand">With you</Badge>
                    )
                  ) : l.fine > 0 ? (
                    <Badge tone={l.finePaid ? "slate" : "amber"}>
                      Fine ₹{l.fine} {l.finePaid ? "paid" : "due"}
                    </Badge>
                  ) : (
                    <Badge tone="green">Returned</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Find a book">
        <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
          <input name="q" defaultValue={q} placeholder="Title, author or ISBN" className={`${inputClass} min-w-56 flex-1`} aria-label="Search books" />
          <select name="category" defaultValue={category ?? ""} className={`${inputClass} max-w-44`} aria-label="Category">
            <option value="">All categories</option>
            {BOOK_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" name="mine" value="1" defaultChecked={Boolean(mine)} className="h-4 w-4" />
            {student.department.code} books only
          </label>
          <button className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white">Search</button>
        </form>
        {books.length === 0 ? (
          <EmptyState>No books match. Try another word.</EmptyState>
        ) : (
          <Table head={["Book", "Category", "Shelf", "Available"]}>
            {books.map((b) => (
              <tr key={b.id}>
                <td className={td}>
                  <span className="font-medium text-slate-900">{b.title}</span>
                  <span className="block text-xs text-slate-500">
                    {b.author}
                    {b.edition && ` · ${b.edition}`}
                  </span>
                </td>
                <td className={`${td} text-xs`}>
                  {b.category}
                  {b.department && ` · ${b.department.code}`}
                </td>
                <td className={`${td} font-mono text-xs`}>{b.shelf ?? "–"}</td>
                <td className={td}>{b.available > 0 ? <Badge tone="green">{b.available} available</Badge> : <Badge tone="red">All issued</Badge>}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-3 text-xs text-slate-500">Take the shelf number to the library desk to borrow a book.</p>
      </Card>
    </>
  );
}
