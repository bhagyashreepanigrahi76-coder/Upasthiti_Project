import "server-only";
import { cookies } from "next/headers";
import type { RoleName } from "./roles";
import {
  PENDING_2FA_COOKIE,
  PENDING_2FA_SECONDS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  signPending2fa,
  signSession,
  verifyPending2fa,
  verifySession,
  type SessionPayload,
} from "./session-token";

export async function createSession(userId: string, roles: RoleName[], sv: number): Promise<void> {
  const token = await signSession({ userId, roles, sv });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

export async function deleteSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function setPending2fa(userId: string): Promise<void> {
  (await cookies()).set(PENDING_2FA_COOKIE, await signPending2fa(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_2FA_SECONDS,
  });
}

export async function readPending2fa(): Promise<string | null> {
  return verifyPending2fa((await cookies()).get(PENDING_2FA_COOKIE)?.value);
}

export async function clearPending2fa(): Promise<void> {
  (await cookies()).delete(PENDING_2FA_COOKIE);
}
