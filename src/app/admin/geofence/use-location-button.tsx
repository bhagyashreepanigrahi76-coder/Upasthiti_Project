"use client";

import { useState } from "react";

/** Fills the latitude/longitude inputs with the admin's current position. */
export function UseLocationButton() {
  const [status, setStatus] = useState<string | null>(null);

  function fill() {
    if (!("geolocation" in navigator)) return setStatus("This browser cannot read location.");
    setStatus("Reading location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const set = (id: string, value: number) => {
          const el = document.getElementById(id) as HTMLInputElement | null;
          if (el) el.value = value.toFixed(6);
        };
        set("latitude", pos.coords.latitude);
        set("longitude", pos.coords.longitude);
        setStatus(`Filled in (accuracy ±${Math.round(pos.coords.accuracy)} m). Stand at the centre of the campus for best results.`);
      },
      (err) => setStatus(err.code === 1 ? "Location permission was blocked." : "Could not read location. Try again outdoors."),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={fill}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Use my current location
      </button>
      {status && <p className="mt-1 text-xs text-slate-500">{status}</p>}
    </div>
  );
}
