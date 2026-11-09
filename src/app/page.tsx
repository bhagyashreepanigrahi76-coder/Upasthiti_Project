import Link from "next/link";
import { APP_NAME, COLLEGE_NAME } from "@/lib/config";

const features = [
  {
    title: "Geofenced punch in / out",
    body: "Students mark campus attendance from their phone, accepted only within 100 m of campus.",
  },
  {
    title: "Attendance and results",
    body: "Teachers record class attendance and marks; students see their reports once results are published.",
  },
  {
    title: "Monthly parent reports",
    body: "Parents get an attendance email every month, and an alert when attendance falls too low.",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-10 sm:px-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-brand-700">{APP_NAME}</p>
          <p className="text-xs text-slate-500">{COLLEGE_NAME}</p>
        </div>
        <Link
          href="/login"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Sign in
        </Link>
      </header>

      <main className="flex flex-1 flex-col justify-center py-16">
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Attendance, timetable and results in one place.
        </h1>
        <p className="mt-4 max-w-xl text-slate-600">
          For students, teachers, heads of department, parents and the college office.
        </p>
        <div className="mt-8">
          <Link
            href="/login"
            className="inline-block rounded-md bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Sign in with your college ID
          </Link>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">{f.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
