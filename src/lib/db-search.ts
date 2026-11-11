import type { Prisma } from "@prisma/client";

const onPostgres = () => (process.env.DATABASE_URL ?? "").startsWith("postgres");

/**
 * Case-insensitive "contains" filter. SQLite's LIKE already ignores ASCII case;
 * PostgreSQL needs mode: "insensitive" (not available in the SQLite client types).
 */
export function textContains(value: string): Prisma.StringFilter {
  return (onPostgres() ? { contains: value, mode: "insensitive" } : { contains: value }) as Prisma.StringFilter;
}
