import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { KIND_LABEL, KIND_ORDER } from "@/lib/results";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { Checkbox, Field, Input, Textarea } from "@/components/form-fields";
import { AssessmentList, assessmentListInclude } from "@/components/assessment-list";
import { saveResultSettings } from "@/app/marks-actions/actions";

export const metadata: Metadata = { title: "Results publishing" };

export default async function AdminResultsPage() {
  await requireRole("ADMIN");
  const now = new Date();
  const [settings, verified, locked, published] = await Promise.all([
    getSettings(),
    db.assessment.findMany({ where: { status: "VERIFIED" }, include: assessmentListInclude, orderBy: { verifiedAt: "asc" } }),
    db.assessment.findMany({ where: { status: "LOCKED" }, include: assessmentListInclude, orderBy: { lockedAt: "asc" } }),
    db.assessment.findMany({ where: { status: "PUBLISHED" }, include: assessmentListInclude, orderBy: { publishedAt: "desc" }, take: 20 }),
  ]);
  const scheduled = locked.filter((a) => a.publishAt && a.publishAt > now);
  const toSchedule = locked.filter((a) => !a.publishAt || a.publishAt <= now);

  return (
    <>
      <PageHeader title="Results publishing" subtitle="Verified marks are locked, then published at a chosen time (FR-23, FR-24)." />
      <div className="space-y-6">
        <Card title={`Verified, ready to lock (${verified.length})`}>
          <AssessmentList rows={verified} basePath="/admin/results" empty="Nothing waiting to be locked." />
        </Card>
        <Card title={`Locked, not scheduled (${toSchedule.length})`}>
          <AssessmentList rows={toSchedule} basePath="/admin/results" empty="Nothing to schedule." />
        </Card>
        <Card title={`Scheduled (${scheduled.length})`}>
          <AssessmentList rows={scheduled} basePath="/admin/results" empty="No scheduled results." />
        </Card>
        <Card title="Recently published">
          <AssessmentList rows={published} basePath="/admin/results" empty="Nothing published yet." />
        </Card>

        <Card title="Assessment scheme, pass mark and grades">
          <ActionForm action={saveResultSettings} submitLabel="Save result settings">
            <div className="grid gap-6 lg:grid-cols-2">
              {(["THEORY", "PRACTICAL"] as const).map((type) => (
                <div key={type}>
                  <h3 className="mb-2 text-sm font-semibold text-slate-800">{type === "THEORY" ? "Theory subjects" : "Practical subjects"}</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-1 font-medium">Assessment</th>
                        <th className="py-1 font-medium">Max marks</th>
                        <th className="py-1 font-medium">Weight %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {KIND_ORDER.map((kind) => {
                        const item = settings.assessmentScheme[type].find((i) => i.kind === kind);
                        return (
                          <tr key={kind}>
                            <td className="py-1 pr-2">{KIND_LABEL[kind]}</td>
                            <td className="py-1 pr-2">
                              <input name={`${type}.${kind}.max`} type="number" min={1} max={200} defaultValue={item?.maxMarks ?? ""} aria-label={`${KIND_LABEL[kind]} max marks`} className="w-20 rounded-md border border-slate-300 px-2 py-1" />
                            </td>
                            <td className="py-1">
                              <input name={`${type}.${kind}.weight`} type="number" min={0} max={100} defaultValue={item?.weightage ?? ""} aria-label={`${KIND_LABEL[kind]} weightage`} className="w-20 rounded-md border border-slate-300 px-2 py-1" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-1 text-xs text-slate-500">Leave the weight empty to drop an assessment. Weights must add up to 100.</p>
                </div>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Grade scale (one per line: grade, from %, points)" name="gradeScale">
                <Textarea name="gradeScale" rows={8} defaultValue={settings.gradeScale.map((g) => `${g.grade} ${g.minPercent} ${g.points}`).join("\n")} className="font-mono" />
              </Field>
              <div className="space-y-4">
                <Field label="Pass mark (% of subject total)" name="passPercent">
                  <Input name="passPercent" type="number" defaultValue={settings.passPercent} />
                </Field>
                <Checkbox name="showGpa" label="Show SGPA / CGPA to students" defaultChecked={settings.showGpa} />
              </div>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
