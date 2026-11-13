"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { scanAttendance } from "@/app/attendance-actions/qr-actions";
import type { ScanResult } from "@/lib/qr-attendance";

/** Runs once when the student opens the scanned link, and shows the result. */
export function QrScanResult({ date, periodKey, slot, sig }: { date: string; periodKey: string; slot: number; sig: string }) {
  const [result, setResult] = useState<ScanResult | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    scanAttendance(date, periodKey, slot, sig)
      .then(setResult)
      .catch(() => setResult({ ok: false, message: "Something went wrong. Check your internet connection and scan the code again." }));
  }, [date, periodKey, slot, sig]);

  if (!result) return <p className="text-sm text-slate-600">Marking your attendance…</p>;

  return (
    <div className="space-y-4">
      <p
        role={result.ok ? "status" : "alert"}
        className={`rounded-md px-4 py-3 text-base font-medium ${result.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
      >
        {result.ok ? "✓ " : ""}
        {result.message}
      </p>
      <Link href="/student" className="inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
        Go to my dashboard
      </Link>
    </div>
  );
}
