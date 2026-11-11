import { Prisma } from "@prisma/client";

/** True when a write failed because of a unique constraint (duplicate value). */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** True when a delete failed because other rows still point at the record. */
export function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2003" || err.code === "P2014");
}
