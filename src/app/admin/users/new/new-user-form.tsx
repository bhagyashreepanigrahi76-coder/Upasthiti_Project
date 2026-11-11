"use client";

import { useState } from "react";
import { ActionForm } from "@/components/forms";
import { Checkbox, Field, FieldGrid, Input, Select, type Option } from "@/components/form-fields";
import { createUser } from "../actions";

type SectionOption = Option & { departmentId: string; batches: Option[] };

const KINDS = [
  { value: "STUDENT", label: "Student" },
  { value: "TEACHER", label: "Teacher" },
  { value: "PARENT", label: "Parent (with login)" },
  { value: "ADMIN", label: "Admin" },
];

const RELATIONSHIPS = ["Guardian", "Father", "Mother"].map((r) => ({ value: r, label: r }));

export function NewUserForm({
  departments,
  sections,
  teachers,
  defaultAdmissionYear,
}: {
  departments: Option[];
  sections: SectionOption[];
  teachers: Option[];
  defaultAdmissionYear: number;
}) {
  const [kind, setKind] = useState("STUDENT");
  const [sectionId, setSectionId] = useState("");
  const batches = sections.find((s) => s.value === sectionId)?.batches ?? [];

  return (
    <ActionForm action={createUser} submitLabel="Create user" resetOnSuccess>
      <Field label="Type of user" name="kind">
        <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} options={KINDS} />
      </Field>

      <FieldGrid>
        <Field label={kind === "STUDENT" ? "Roll number (college ID)" : "College ID"} name="collegeId">
          <Input name="collegeId" placeholder={kind === "STUDENT" ? "S26BCA050" : kind === "TEACHER" ? "T1010" : ""} />
        </Field>
        <Field label="Full name" name="name">
          <Input name="name" />
        </Field>
        <Field label={kind === "PARENT" ? "Email (reports go here)" : "Email"} name="email" hint="Used for one-time codes.">
          <Input name="email" type="email" />
        </Field>
        <Field label="Phone" name="phone">
          <Input name="phone" type="tel" />
        </Field>
      </FieldGrid>

      {kind === "STUDENT" && (
        <>
          <FieldGrid cols={3}>
            <Field label="Section" name="sectionId">
              <Select
                name="sectionId"
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                placeholder="Choose…"
                options={sections}
              />
            </Field>
            <Field label="Lab batch" name="batchId">
              <Select name="batchId" placeholder={batches.length ? "None" : "No batches"} options={batches} />
            </Field>
            <Field label="Class coordinator" name="mentorId">
              <Select name="mentorId" placeholder="None" options={teachers} />
            </Field>
            <Field label="Admission year" name="admissionYear">
              <Input name="admissionYear" type="number" defaultValue={defaultAdmissionYear} />
            </Field>
            <Field label="Date of birth" name="dateOfBirth">
              <Input name="dateOfBirth" type="date" />
            </Field>
          </FieldGrid>
          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-800">Parent / guardian (receives monthly reports)</legend>
            <FieldGrid>
              <Field label="Name" name="parentName">
                <Input name="parentName" />
              </Field>
              <Field label="Relationship" name="relationship">
                <Select name="relationship" options={RELATIONSHIPS} />
              </Field>
              <Field label="Email" name="parentEmail">
                <Input name="parentEmail" type="email" />
              </Field>
              <Field label="Phone" name="parentPhone">
                <Input name="parentPhone" type="tel" />
              </Field>
            </FieldGrid>
          </fieldset>
        </>
      )}

      {kind === "TEACHER" && (
        <FieldGrid>
          <Field label="Department" name="departmentId">
            <Select name="departmentId" placeholder="Choose…" options={departments} />
          </Field>
          <Field label="Designation" name="designation">
            <Input name="designation" placeholder="Assistant Professor" />
          </Field>
          <Field label="Class coordinator for" name="mentorSectionId" hint="Optional: becomes mentor of that section.">
            <Select name="mentorSectionId" placeholder="None" options={sections} />
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox name="makeHod" label="Head of this department" />
          </div>
        </FieldGrid>
      )}

      {kind === "PARENT" && (
        <FieldGrid>
          <Field label="Children's roll numbers" name="studentRollNos" hint="Separate with commas, e.g. S26BCA001, S24BCA001">
            <Input name="studentRollNos" />
          </Field>
          <Field label="Relationship" name="relationship">
            <Select name="relationship" options={RELATIONSHIPS} />
          </Field>
        </FieldGrid>
      )}
    </ActionForm>
  );
}
