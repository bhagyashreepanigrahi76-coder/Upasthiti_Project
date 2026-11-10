import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { KIND_LABEL, STATUS_LABEL } from "@/lib/results";
import { formatDateTime } from "@/lib/config";
import { Badge, EmptyState, Table, td } from "./ui";

export type AssessmentRow = Prisma.AssessmentGetPayload<{
  include: { subject: true; section: { include: { department: true } }; _count: { select: { marks: true } } };
}>;

/** Compact list of assessments with links to the review page. */
export function AssessmentList({ rows, basePath, empty }: { rows: AssessmentRow[]; basePath: string; empty: string }) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <Table head={["Class", "Subject", "Assessment", "Entries", "Status", ""]}>
      {rows.map((a) => (
        <tr key={a.id}>
          <td className={td}>
            {a.section.department.code} {a.section.year}-{a.section.name}
          </td>
          <td className={td}>
            <span className="font-mono text-xs text-slate-500">{a.subject.code}</span> {a.subject.name}
          </td>
          <td className={td}>{KIND_LABEL[a.kind]}</td>
          <td className={`${td} tabular-nums`}>{a._count.marks}</td>
          <td className={td}>
            <Badge tone={a.status === "PUBLISHED" ? "green" : a.status === "SUBMITTED" ? "amber" : "brand"}>{STATUS_LABEL[a.status]}</Badge>
            {a.status === "LOCKED" && a.publishAt && <span className="block text-xs text-slate-500">from {formatDateTime(a.publishAt)}</span>}
          </td>
          <td className={`${td} text-right`}>
            <Link href={`${basePath}/${a.id}`} className="text-sm font-medium text-brand-700 hover:underline">
              Open
            </Link>
          </td>
        </tr>
      ))}
    </Table>
  );
}

export const assessmentListInclude = {
  subject: true,
  section: { include: { department: true } },
  _count: { select: { marks: true } },
} as const;
