import type { CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canDeleteNote, notesScope, searchNotes } from "@/lib/notes";
import { formatDateTime } from "@/lib/config";
import { deleteNote } from "@/app/notes-actions/actions";
import { Badge, Card, EmptyState } from "./ui";
import { ActionButton } from "./forms";
import { inputClass } from "./form-fields";

// Search and browse study notes (students, teachers, HODs, admin).

const KIND: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "Image",
  "image/jpeg": "Image",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.ms-powerpoint": "Slides",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "Slides",
};
const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export async function NotesBrowser({ user, q, subjectId, title = "Find notes" }: { user: CurrentUser; q?: string; subjectId?: string; title?: string }) {
  const scope = await notesScope(user);
  const [notes, subjects] = await Promise.all([
    searchNotes(user, { q, subjectId }),
    scope ? db.subject.findMany({ where: { notes: { some: scope } }, orderBy: { code: "asc" } }) : [],
  ]);
  const uploaders = await db.user.findMany({ where: { id: { in: [...new Set(notes.map((n) => n.uploadedById))] } }, select: { id: true, name: true } });
  const nameOf = (id: string) => uploaders.find((u) => u.id === id)?.name ?? "Teacher";

  return (
    <Card title={title}>
      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search by topic, title or subject, e.g. pointers, marketing mix" className={`${inputClass} min-w-64 flex-1`} aria-label="Search notes" />
        <select name="subject" defaultValue={subjectId ?? ""} className={`${inputClass} max-w-60`} aria-label="Subject">
          <option value="">All subjects</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name}
            </option>
          ))}
        </select>
        <button className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white">Search</button>
      </form>

      {notes.length === 0 ? (
        <EmptyState>{q || subjectId ? "No notes match your search. Try another word." : "No notes have been uploaded yet."}</EmptyState>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">
            {notes.length} note{notes.length === 1 ? "" : "s"}
            {q && ` for "${q}"`}
          </p>
          <ul className="grid gap-3 md:grid-cols-2">
            {notes.map((n) => (
              <li key={n.id} className="flex flex-col rounded-lg border border-brand-100 border-l-4 border-l-haldi-400 bg-white p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="brand">{n.subject.code}</Badge>
                  <Badge>{KIND[n.fileMime] ?? "File"}</Badge>
                  <span className="text-xs text-slate-500">Year {n.year} · Sem {n.subject.semester}</span>
                </div>
                <h3 className="mt-2 font-semibold text-brand-900">{n.title}</h3>
                <p className="text-xs text-slate-500">{n.subject.name}</p>
                {n.description && <p className="mt-2 line-clamp-3 text-sm text-slate-700">{n.description}</p>}
                {n.tags && (
                  <p className="mt-2 flex flex-wrap gap-1">
                    {n.tags.split(",").map((t) => (
                      <span key={t} className="rounded bg-haldi-50 px-1.5 py-0.5 text-[11px] text-haldi-600">
                        #{t.trim()}
                      </span>
                    ))}
                  </p>
                )}
                <p className="mt-3 text-xs text-slate-500">
                  {nameOf(n.uploadedById)} · {formatDateTime(n.createdAt)} · {size(n.fileSize)} · {n.downloads} view{n.downloads === 1 ? "" : "s"}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <a href={`/api/notes/${n.id}/file`} target="_blank" rel="noreferrer" className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600">
                    {KIND[n.fileMime] === "PDF" || KIND[n.fileMime] === "Image" ? "Open" : "Download"}
                  </a>
                  {canDeleteNote(user, n) && <ActionButton action={deleteNote} fields={{ id: n.id }} label="Delete" tone="danger" confirmText={`Delete "${n.title}"?`} />}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
