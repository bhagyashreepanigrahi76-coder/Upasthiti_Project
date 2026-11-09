"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

// Student punch screen (FR-31). Location is read only when the student taps
// (PRD §7 privacy), and offline punches are queued and synced later (FR-12).

type PunchType = "IN" | "OUT";
type Result = {
  accepted: boolean;
  dryRun: boolean;
  code: string;
  message: string;
  inside: boolean;
  distanceMeters: number | null;
  radiusMeters: number | null;
  geofenceName: string | null;
};
type Queued = {
  type: PunchType;
  latitude: number;
  longitude: number;
  accuracy: number;
  deviceTime: number;
  deviceId: string;
  source: "OFFLINE";
};

const DEVICE_KEY = "cas.deviceId";
const QUEUE_KEY = "cas.punchQueue";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getDeviceId(): string {
  const s = storage();
  let id = s?.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    s?.setItem(DEVICE_KEY, id);
  }
  return id;
}

const readQueue = (): Queued[] => {
  try {
    return JSON.parse(storage()?.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
};
const QUEUE_EVENT = "cas-queue-change";
const writeQueue = (q: Queued[]) => {
  storage()?.setItem(QUEUE_KEY, JSON.stringify(q));
  window.dispatchEvent(new Event(QUEUE_EVENT));
};

// Browser state read through useSyncExternalStore (no setState in effects).
function subscribeQueue(onChange: () => void) {
  window.addEventListener(QUEUE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(QUEUE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("This browser cannot read your location."));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
  });
}

function locationError(err: unknown): string {
  if (typeof err === "object" && err && "code" in err) {
    const code = (err as GeolocationPositionError).code;
    if (code === 1) return "Location permission is blocked. Allow location for this site in your browser settings, then try again.";
    if (code === 2) return "Your location is not available. Turn on GPS / location services and try again.";
    if (code === 3) return "Getting your location took too long. Move to an open area and try again.";
  }
  return err instanceof Error ? err.message : "Could not read your location.";
}

async function postPunch(body: object): Promise<Result> {
  const res = await fetch("/api/punch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { http: res.status });
  return data as Result;
}

export function PunchClient({ nextAction, maxAccuracy }: { nextAction: PunchType | "DONE"; maxAccuracy: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"check" | "punch" | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "info" | "ok"; text: string } | null>(null);
  const queued = useSyncExternalStore(subscribeQueue, () => readQueue().length, () => 0);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  const flushQueue = useCallback(async () => {
    const queue = readQueue();
    if (queue.length === 0 || !navigator.onLine) return;
    const remaining: Queued[] = [];
    const messages: string[] = [];
    for (const item of queue) {
      try {
        const r = await postPunch(item);
        messages.push(`${item.type === "IN" ? "Punch in" : "Punch out"} saved offline: ${r.message}`);
      } catch (err) {
        // Keep it only if it never reached the server (network error).
        if (!(err as { http?: number }).http) remaining.push(item);
      }
    }
    writeQueue(remaining);
    if (messages.length) {
      setNotice({ tone: "info", text: messages.join(" ") });
      router.refresh();
    }
  }, [router]);

  // Sync queued offline punches now and whenever the connection returns.
  useEffect(() => {
    const goOnline = () => void flushQueue();
    window.addEventListener("online", goOnline);
    const startup = window.setTimeout(goOnline, 0); // after first paint
    return () => {
      window.clearTimeout(startup);
      window.removeEventListener("online", goOnline);
    };
  }, [flushQueue]);

  async function readLocation() {
    const pos = await getPosition();
    const { latitude, longitude, accuracy } = pos.coords;
    if (accuracy > maxAccuracy) {
      throw new Error(`GPS accuracy is ${Math.round(accuracy)} m; ${maxAccuracy} m or better is needed. Step outside or near a window and try again.`);
    }
    return { latitude, longitude, accuracy };
  }

  async function check() {
    if (nextAction === "DONE") return;
    setBusy("check");
    setNotice(null);
    try {
      const loc = await readLocation();
      setResult(await postPunch({ ...loc, type: nextAction, deviceTime: Date.now(), deviceId: getDeviceId(), dryRun: true }));
    } catch (err) {
      setResult(null);
      setNotice({ tone: "error", text: (err as { http?: number }).http ? (err as Error).message : locationError(err) });
    } finally {
      setBusy(null);
    }
  }

  async function punch() {
    if (nextAction === "DONE") return;
    setBusy("punch");
    setNotice(null);
    let loc;
    try {
      loc = await readLocation();
    } catch (err) {
      setNotice({ tone: "error", text: locationError(err) });
      setBusy(null);
      return;
    }
    const payload = { ...loc, type: nextAction, deviceTime: Date.now(), deviceId: getDeviceId() };
    const queueIt = () => {
      writeQueue([...readQueue(), { ...payload, source: "OFFLINE" }]);
      setNotice({ tone: "info", text: "You're offline. The punch is saved on this phone with its time and will be sent automatically when you're back online." });
    };
    try {
      if (!navigator.onLine) queueIt();
      else {
        const r = await postPunch({ ...payload, source: "LIVE" });
        setResult(r);
        setNotice({ tone: r.accepted ? "ok" : "error", text: r.message });
        if (r.accepted) router.refresh();
      }
    } catch (err) {
      if ((err as { http?: number }).http) setNotice({ tone: "error", text: (err as Error).message });
      else queueIt(); // network failure: keep it for later
    } finally {
      setBusy(null);
    }
  }

  const label = nextAction === "IN" ? "Punch in" : nextAction === "OUT" ? "Punch out" : "Done for today";
  const ring = result?.dryRun ? (result.accepted ? "border-emerald-500" : "border-red-400") : "border-brand-600";

  return (
    <div className="flex flex-col items-center gap-5 py-2 text-center">
      {!online && (
        <p className="w-full rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">You are offline. Punches will be queued.</p>
      )}
      {queued > 0 && (
        <p className="w-full rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800">
          {queued} punch{queued > 1 ? "es" : ""} waiting to sync.
        </p>
      )}

      <button
        type="button"
        onClick={punch}
        disabled={busy !== null || nextAction === "DONE"}
        className={`flex h-40 w-40 flex-col items-center justify-center rounded-full border-8 bg-white text-lg font-semibold shadow-sm transition disabled:opacity-60 ${ring} ${
          nextAction === "OUT" ? "text-amber-700" : "text-brand-700"
        }`}
      >
        {busy === "punch" ? "Checking…" : label}
      </button>

      {nextAction !== "DONE" && (
        <button
          type="button"
          onClick={check}
          disabled={busy !== null}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {busy === "check" ? "Reading location…" : "Check my location first"}
        </button>
      )}

      {result?.dryRun && (
        <div className={`w-full rounded-lg p-3 text-sm ${result.accepted ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          <p className="font-semibold">{result.inside ? "Inside campus" : "Outside campus"}</p>
          {result.distanceMeters !== null && (
            <p>
              {result.distanceMeters} m from {result.geofenceName} (limit {result.radiusMeters} m)
            </p>
          )}
          <p className="mt-1">{result.message}</p>
        </div>
      )}

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`w-full rounded-md px-3 py-2 text-sm ${
            notice.tone === "error" ? "bg-red-50 text-red-700" : notice.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-sky-50 text-sky-800"
          }`}
        >
          {notice.text}
        </p>
      )}

      <p className="text-xs text-slate-500">
        Your location is read only when you tap a button, never in the background.
      </p>
    </div>
  );
}
