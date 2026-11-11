import "server-only";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

const ROUNDS = 10;

// Hash of a random value nobody knows. Compared against when the college ID
// does not exist, so a failed login takes the same time either way and
// response timing does not reveal which IDs are valid.
const DUMMY_HASH = "$2b$10$eUjV61QTgsxk98xJuuS.COR6jl8hrE6l3H8.0jUGxSNlIpzf0/A1O";

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

/** Stored for accounts that have never set a password (e.g. bulk-imported). */
export const UNUSABLE_PASSWORD = "!unset";

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  const usable = typeof hash === "string" && hash.startsWith("$2");
  const ok = await bcrypt.compare(plain, usable ? hash : DUMMY_HASH);
  return usable && ok;
}

/** Readable temporary password for admin resets, e.g. "Kite-4821-Moss". */
export function temporaryPassword(): string {
  const words = ["Kite", "Moss", "Reef", "Pine", "Lark", "Opal", "Fern", "Dune", "Wren", "Cove", "Sage", "Iris"];
  const pick = () => words[randomInt(words.length)];
  return `${pick()}-${String(randomInt(1000, 10000))}-${pick()}`;
}
