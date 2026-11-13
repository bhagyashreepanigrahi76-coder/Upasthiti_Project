import type { Metadata } from "next";
import { requireStudent } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { QrScanResult } from "@/components/qr-scan-result";

export const metadata: Metadata = { title: "Scan attendance" };

type Props = { searchParams: Promise<{ d?: string; p?: string; s?: string; k?: string }> };

export default async function ScanAttendancePage({ searchParams }: Props) {
  await requireStudent();
  const { d, p, s, k } = await searchParams;
  const slot = Number(s);

  return (
    <>
      <PageHeader title="Class attendance" subtitle="Scan the QR code on the teacher's screen to mark yourself present." />
      <Card>
        {d && p && k && Number.isInteger(slot) ? (
          <QrScanResult date={d} periodKey={p} slot={slot} sig={k} />
        ) : (
          <p className="text-sm text-slate-700">Open your phone camera, point it at the QR code on the teacher&apos;s screen and tap the link that appears.</p>
        )}
      </Card>
    </>
  );
}
