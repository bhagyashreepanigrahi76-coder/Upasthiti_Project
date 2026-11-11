"use client";

/** Opens the browser's print dialog, where "Save as PDF" is available (FR-65). */
export function PrintButton({ label = "Print / save as PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 print:hidden"
    >
      {label}
    </button>
  );
}
