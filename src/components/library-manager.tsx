import Link from "next/link";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { BOOK_CATEGORIES, fineFor, searchBooks } from "@/lib/library";
import { formatDateKey, toDateKey } from "@/lib/dates";
import { deleteBook, issueBook, markFinePaid, renewLoan, returnBook, saveBook, saveLibrarySettings } from "@/app/library-actions/actions";
import { Badge, Card, EmptyState, PageHeader, StatCard, Table, td } from "./ui";
import { ActionButton, ActionForm } from "./forms";
import { Field, FieldGrid, Input, Select, inputClass } from "./form-fields";

// Librarian / admin library desk: catalogue, issue and return, fines.
export async function LibraryManager({ basePath, q, category, editId }: { basePath: string; q?: string; category?: string; editId?: string }) {
  const today = toDateKey(new Date());
  const [settings, books, departments, loans, unpaid, titles, copies, editing, allBooks] = await Promise.all([
    getSettings(),
    searchBooks({ q, category }),
    db.department.findMany({ orderBy: { code: "asc" } }),
    db.bookLoan.findMany({
      where: { status: "ISSUED" },
      orderBy: { dueDate: "asc" },
      include: { book: true, student: { include: { user: { select: { name: true } }, section: true, department: true } } },
    }),
    db.bookLoan.findMany({ where: { fine: { gt: 0 }, finePaid: false }, include: { book: true, student: { include: { user: { select: { name: true } } } } } }),
    db.book.count(),
    db.book.aggregate({ _sum: { totalCopies: true } }),
    editId ? db.book.findUnique({ where: { id: editId } }) : null,
    searchBooks({ take: 500 }),
  ]);
  const overdue = loans.filter((l) => l.dueDate < today);
  const unpaidTotal = unpaid.reduce((n, l) => n + l.fine, 0);

  return (
    <>
      <PageHeader title="Library" subtitle={`Loan period ${settings.libraryLoanDays} days · fine ₹${settings.libraryFinePerDay}/day · up to ${settings.libraryMaxBooks} books per student`} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Titles" value={titles} />
        <StatCard label="Copies" value={copies._sum.totalCopies ?? 0} />
        <StatCard label="Issued now" value={loans.length} />
        <StatCard label="Overdue" value={overdue.length} />
        <StatCard label="Fines to collect" value={`₹${unpaidTotal}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Issue a book">
          <ActionForm action={issueBook} submitLabel="Issue book" resetOnSuccess>
            <Field label="Student roll number" name="rollNo">
              <Input name="rollNo" placeholder="S26BCA001" className="uppercase" autoComplete="off" />
            </Field>
            <Field label="Book" name="bookId">
              <Select
                name="bookId"
                placeholder="Choose a book…"
                options={allBooks.filter((b) => b.available > 0).map((b) => ({ value: b.id, label: `${b.title} · ${b.author} (${b.available} left)` }))}
              />
            </Field>
          </ActionForm>
        </Card>

        <Card title={`Books out (${loans.length})`} className="xl:col-span-2">
          {loans.length === 0 ? (
            <EmptyState>No books are issued.</EmptyState>
          ) : (
            <Table head={["Student", "Book", "Due", ""]}>
              {loans.map((l) => {
                const late = l.dueDate < today;
                return (
                  <tr key={l.id}>
                    <td className={td}>
                      {l.student.user.name}
                      <span className="block text-xs text-slate-500">
                        {l.student.rollNo} · {l.student.department.code} {l.student.year}-{l.student.section.name}
                      </span>
                    </td>
                    <td className={td}>{l.book.title}</td>
                    <td className={`${td} whitespace-nowrap text-xs`}>
                      {formatDateKey(l.dueDate)}
                      {late ? (
                        <Badge tone="red">Overdue · ₹{fineFor(l.dueDate, today, settings.libraryFinePerDay)}</Badge>
                      ) : l.renewals > 0 ? (
                        <Badge>Renewed</Badge>
                      ) : null}
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <ActionButton action={returnBook} fields={{ id: l.id }} label="Return" tone="success" />{" "}
                      {!late && l.renewals < settings.libraryMaxRenewals && <ActionButton action={renewLoan} fields={{ id: l.id }} label="Renew" />}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Catalogue" className="xl:col-span-2">
          <form method="get" className="mb-3 flex flex-wrap gap-2">
            <input name="q" defaultValue={q} placeholder="Search title, author, ISBN, publisher" className={`${inputClass} min-w-56 flex-1`} aria-label="Search books" />
            <select name="category" defaultValue={category ?? ""} className={`${inputClass} max-w-44`} aria-label="Category">
              <option value="">All categories</option>
              {BOOK_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button className="rounded-md bg-brand-700 px-4 text-sm font-medium text-white">Search</button>
          </form>
          {books.length === 0 ? (
            <EmptyState>No books match.</EmptyState>
          ) : (
            <Table head={["Book", "Category", "Shelf", "Available", ""]}>
              {books.map((b) => (
                <tr key={b.id}>
                  <td className={td}>
                    <span className="font-medium text-slate-900">{b.title}</span>
                    <span className="block text-xs text-slate-500">
                      {b.author}
                      {b.edition && ` · ${b.edition}`}
                      {b.isbn && ` · ISBN ${b.isbn}`}
                    </span>
                  </td>
                  <td className={`${td} text-xs`}>
                    {b.category}
                    {b.department && <span className="block text-slate-500">{b.department.code}</span>}
                  </td>
                  <td className={`${td} font-mono text-xs`}>{b.shelf ?? "–"}</td>
                  <td className={td}>
                    <Badge tone={b.available > 0 ? "green" : "red"}>
                      {b.available}/{b.totalCopies}
                    </Badge>
                  </td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <Link href={`${basePath}?edit=${b.id}`} className="mr-2 text-xs font-medium text-brand-700 hover:underline">
                      Edit
                    </Link>
                    <ActionButton action={deleteBook} fields={{ id: b.id }} label="Remove" tone="danger" confirmText={`Remove "${b.title}" from the catalogue?`} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <div className="space-y-6">
          <Card title={editing ? "Edit book" : "Add a book"}>
            <ActionForm key={editing?.id ?? "new"} action={saveBook} submitLabel={editing ? "Save changes" : "Add book"} resetOnSuccess={!editing}>
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <Field label="Title" name="title">
                <Input name="title" defaultValue={editing?.title} />
              </Field>
              <Field label="Author" name="author">
                <Input name="author" defaultValue={editing?.author} />
              </Field>
              <FieldGrid>
                <Field label="ISBN" name="isbn">
                  <Input name="isbn" defaultValue={editing?.isbn ?? ""} inputMode="numeric" />
                </Field>
                <Field label="Copies" name="totalCopies">
                  <Input name="totalCopies" type="number" min={1} defaultValue={editing?.totalCopies ?? 1} />
                </Field>
                <Field label="Category" name="category">
                  <Select name="category" defaultValue={editing?.category ?? "Textbook"} options={BOOK_CATEGORIES.map((c) => ({ value: c, label: c }))} />
                </Field>
                <Field label="Department" name="departmentId">
                  <Select name="departmentId" defaultValue={editing?.departmentId ?? ""} placeholder="General" options={departments.map((d) => ({ value: d.id, label: d.code }))} />
                </Field>
                <Field label="Publisher" name="publisher">
                  <Input name="publisher" defaultValue={editing?.publisher ?? ""} />
                </Field>
                <Field label="Edition" name="edition">
                  <Input name="edition" defaultValue={editing?.edition ?? ""} />
                </Field>
              </FieldGrid>
              <Field label="Shelf" name="shelf" hint="e.g. BCA-R2-S3">
                <Input name="shelf" defaultValue={editing?.shelf ?? ""} />
              </Field>
            </ActionForm>
          </Card>

          <Card title={`Fines to collect (₹${unpaidTotal})`}>
            {unpaid.length === 0 ? (
              <EmptyState>No unpaid fines.</EmptyState>
            ) : (
              <ul className="space-y-2 text-sm">
                {unpaid.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <span>
                      {l.student.user.name} <span className="text-xs text-slate-500">({l.student.rollNo})</span> · ₹{l.fine}
                      <span className="block text-xs text-slate-500">{l.book.title}</span>
                    </span>
                    <ActionButton action={markFinePaid} fields={{ id: l.id }} label="Mark paid" tone="success" />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Library rules">
            <ActionForm action={saveLibrarySettings} submitLabel="Save rules" tone="secondary">
              <FieldGrid>
                <Field label="Loan days" name="libraryLoanDays">
                  <Input name="libraryLoanDays" type="number" defaultValue={settings.libraryLoanDays} />
                </Field>
                <Field label="Fine ₹/day" name="libraryFinePerDay">
                  <Input name="libraryFinePerDay" type="number" defaultValue={settings.libraryFinePerDay} />
                </Field>
                <Field label="Books per student" name="libraryMaxBooks">
                  <Input name="libraryMaxBooks" type="number" defaultValue={settings.libraryMaxBooks} />
                </Field>
                <Field label="Renewals allowed" name="libraryMaxRenewals">
                  <Input name="libraryMaxRenewals" type="number" defaultValue={settings.libraryMaxRenewals} />
                </Field>
              </FieldGrid>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
