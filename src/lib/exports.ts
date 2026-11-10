import "server-only";
import { NextResponse } from "next/server";
import { toCsv, toXlsx } from "./spreadsheet";

// File downloads for exports (PRD §5 feature 13: records for accreditation and audits).

export function fileResponse(rows: (string | number | null | undefined)[][], baseName: string, format: string, sheetName = "Sheet1") {
  const safe = baseName.replace(/[^\w.-]+/g, "_").slice(0, 80);
  if (format === "xlsx") {
    return new NextResponse(new Uint8Array(toXlsx(rows, sheetName)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safe}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return new NextResponse("﻿" + toCsv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safe}.csv"`, "Cache-Control": "no-store" },
  });
}

export const forbidden = () => new NextResponse("Not allowed", { status: 403 });
