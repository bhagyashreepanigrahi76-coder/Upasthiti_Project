import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma does not read .env by itself when a config file is used, so load it
// here (Node's built-in loader; real environment variables still win).
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the environment (production).
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});
