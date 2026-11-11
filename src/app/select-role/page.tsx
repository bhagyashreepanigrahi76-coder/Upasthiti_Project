import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { portalsForRoles } from "@/lib/roles";
import { APP_NAME } from "@/lib/config";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Choose a portal" };

export default function SelectRolePage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <p className="mb-6 text-center text-sm font-semibold text-brand-700">{APP_NAME}</p>
        <Suspense fallback={<Skeleton className="h-64" />}>
          <PortalChoices />
        </Suspense>
      </div>
    </div>
  );
}

async function PortalChoices() {
  const user = await requireUser();
  const portals = portalsForRoles(user.roles);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Welcome, {user.name}</h1>
      <p className="mt-1 text-sm text-slate-500">You have more than one role. Choose where to go.</p>
      <ul className="mt-5 space-y-3">
        {portals.map((p) => (
          <li key={p.key}>
            <Link
              href={p.path}
              className="block rounded-lg border border-slate-200 p-4 hover:border-brand-600 hover:bg-brand-50"
            >
              <span className="block font-medium text-slate-900">{p.label} portal</span>
              <span className="block text-sm text-slate-500">{p.description}</span>
            </Link>
          </li>
        ))}
      </ul>
      {portals.length === 0 && (
        <p className="mt-4 text-sm text-slate-600">No portal is assigned to your account yet.</p>
      )}
    </div>
  );
}
