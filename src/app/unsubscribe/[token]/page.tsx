import { Suspense } from "react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { APP_NAME, COLLEGE_NAME } from "@/lib/config";
import { ActionForm } from "@/components/forms";
import { Skeleton } from "@/components/ui";
import { setParentSubscription } from "@/app/report-actions/actions";

export const metadata: Metadata = { title: "Email preferences" };

type Props = { params: Promise<{ token: string }> };

// FR-40: parents can stop monthly reports with the link in each email.
// Critical alerts keep coming unless the college approves otherwise.
export default function UnsubscribePage({ params }: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-brand-700">{APP_NAME}</p>
        <p className="mb-4 text-xs text-slate-500">{COLLEGE_NAME}</p>
        <Suspense fallback={<Skeleton className="h-40" />}>
          <Preferences params={params} />
        </Suspense>
      </div>
    </div>
  );
}

async function Preferences({ params }: Props) {
  const { token } = await params;
  const parent = /^[a-z0-9]{20,40}$/i.test(token) ? await db.parent.findUnique({ where: { unsubscribeToken: token } }) : null;
  if (!parent) return <p className="text-sm text-slate-700">This link is not valid. Please use the link from a recent email.</p>;
  return (
    <>
      <h1 className="text-lg font-semibold text-slate-900">Email preferences</h1>
      <p className="mt-1 text-sm text-slate-600">
        Monthly attendance reports are currently <strong>{parent.unsubscribedNonCritical ? "off" : "on"}</strong> for this address.
      </p>
      <ActionForm action={setParentSubscription} submitLabel={parent.unsubscribedNonCritical ? "Turn monthly reports back on" : "Stop monthly reports"} tone={parent.unsubscribedNonCritical ? "primary" : "danger"} className="mt-4 space-y-3">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="subscribe" value={parent.unsubscribedNonCritical ? "yes" : "no"} />
      </ActionForm>
      <p className="mt-4 text-xs text-slate-500">Critical low-attendance alerts are always sent. To stop those, contact the college office.</p>
    </>
  );
}
