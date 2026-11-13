"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { currentQrLink } from "@/app/attendance-actions/qr-actions";

const SLOT_SECONDS = 60;

/**
 * The teacher's rotating attendance QR. It asks the server for the current
 * signed link, draws it as a QR code, and swaps it for a fresh one every
 * 60 seconds. Students scan it with their phone camera.
 */
export function QrDisplay({ dateKey, periodKey }: { dateKey: string; periodKey: string }) {
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(SLOT_SECONDS);
  const [counts, setCounts] = useState<{ present: number; total: number } | null>(null);
  const clock = useRef({ slot: -1, expiresAt: 0, offset: 0, busy: false });

  useEffect(() => {
    let stopped = false;

    async function refresh() {
      const c = clock.current;
      if (c.busy) return;
      c.busy = true;
      try {
        const r = await currentQrLink(dateKey, periodKey);
        if (stopped) return;
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setError(null);
        c.offset = r.serverNow - Date.now(); // keep the countdown on the server's clock
        c.expiresAt = r.expiresAt;
        setCounts({ present: r.present, total: r.total });
        if (r.slot !== c.slot) {
          c.slot = r.slot;
          const data = await QRCode.toDataURL(window.location.origin + r.path, { width: 520, margin: 2, errorCorrectionLevel: "M" });
          if (!stopped) setImage(data);
        }
      } catch {
        if (!stopped) setError("Could not reach the server. Check the internet connection.");
      } finally {
        c.busy = false;
      }
    }

    refresh();
    const poll = setInterval(refresh, 4000); // also keeps the scanned count live
    const tick = setInterval(() => {
      const c = clock.current;
      const left = Math.max(0, Math.ceil((c.expiresAt - (Date.now() + c.offset)) / 1000));
      setSecondsLeft(left);
      if (left === 0) refresh();
    }, 250);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [dateKey, periodKey]);

  if (error) {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
        {error}
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
      <div className="rounded-2xl border border-slate-300 bg-white p-3 shadow-md">
        {image ? (
          // A plain <img>: the QR is a data URL made in the browser, so next/image has nothing to optimise.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="Attendance QR code" width={320} height={320} className="h-72 w-72 sm:h-80 sm:w-80" style={{ background: "#fff" }} />
        ) : (
          <div className="flex h-72 w-72 items-center justify-center text-sm text-slate-500 sm:h-80 sm:w-80">Making QR code…</div>
        )}
      </div>

      <div className="w-full">
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
          <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${(secondsLeft / SLOT_SECONDS) * 100}%` }} />
        </div>
        <p className="mt-1 text-xs text-slate-500">New code in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</p>
      </div>

      <p className="text-sm text-slate-700">Students: open your phone camera, scan this code and tap the link. Sign in if asked.</p>
      {counts && (
        <p className="rounded-full bg-green-50 px-4 py-1.5 text-sm font-semibold text-green-800">
          {counts.present} of {counts.total} students marked present
        </p>
      )}
      <p className="text-xs text-slate-500">The code changes every 60 seconds, so an old photo of it will not work later.</p>
    </div>
  );
}
