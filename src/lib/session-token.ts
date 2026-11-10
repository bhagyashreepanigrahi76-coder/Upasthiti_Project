// Signing and verifying the session token (JWT, HS256).
// Kept free of next/headers so proxy.ts can import it too.
import { SignJWT, jwtVerify } from "jose";
import { isRole, type RoleName } from "./roles";

export const SESSION_COOKIE = "cas_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours (FR-3: sessions expire)

export type SessionPayload = {
  userId: string;
  roles: RoleName[];
  /** Must match User.sessionVersion; bumping it signs the user out everywhere. */
  sv: number;
};

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET is missing or shorter than 32 characters. See .env.example.");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ roles: payload.roles, sv: payload.sv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Returns the payload for a valid, unexpired token, otherwise null. */
export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || !Array.isArray(payload.roles)) return null;
    return {
      userId: payload.sub,
      roles: payload.roles.filter(isRole),
      sv: typeof payload.sv === "number" ? payload.sv : -1,
    };
  } catch {
    return null;
  }
}

// Short-lived token between "password correct" and "code verified" for
// staff who use two-step sign-in (FR-3). It is not a session.
export const PENDING_2FA_COOKIE = "cas_2fa";
export const PENDING_2FA_SECONDS = 10 * 60;

export async function signPending2fa(userId: string): Promise<string> {
  return new SignJWT({ pur: "2fa" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${PENDING_2FA_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyPending2fa(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload.pur === "2fa" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
