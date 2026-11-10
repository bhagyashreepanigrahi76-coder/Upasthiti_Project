// In-memory sliding-window rate limiter (PRD §7 "rate limiting").
// Per server instance: with several instances, move the counters to Redis
// or similar (see DEPLOYMENT.md).

type Store = Map<string, number[]>;
const g = globalThis as unknown as { __rateLimit?: Store };
const store: Store = g.__rateLimit ?? (g.__rateLimit = new Map());

export type LimitResult = { ok: boolean; retryAfterSec: number };

/** Records a hit and says whether the key is still within `limit` hits per `windowMs`. */
export function hit(key: string, limit: number, windowMs: number, now = Date.now()): LimitResult {
  const recent = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    store.set(key, recent);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  store.set(key, recent);
  if (store.size > 50_000) prune(now, windowMs);
  return { ok: true, retryAfterSec: 0 };
}

/** Checks without recording (e.g. "is this IP blocked for failed sign-ins?"). */
export function peek(key: string, limit: number, windowMs: number, now = Date.now()): LimitResult {
  const recent = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  return recent.length >= limit ? { ok: false, retryAfterSec: Math.ceil((windowMs - (now - recent[0])) / 1000) } : { ok: true, retryAfterSec: 0 };
}

function prune(now: number, windowMs: number) {
  for (const [k, v] of store) if (v.every((t) => now - t >= windowMs)) store.delete(k);
}

export function resetRateLimits() {
  store.clear();
}

/** Best-effort client IP from proxy headers. */
export function clientIpFrom(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}
