// Creates the first admin account on a fresh (production) database.
//   npm run admin:create -- ADMIN01 "Office Admin" office@your-college.edu
// Prints a temporary password once. At first sign-in the admin verifies a
// code sent to the email and chooses their own password.
import { randomInt } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const [collegeIdArg, name, email] = process.argv.slice(2);
if (!collegeIdArg || !name || !email) {
  console.error('Usage: npm run admin:create -- <COLLEGE_ID> "<Full name>" <email>');
  process.exit(1);
}
const collegeId = collegeIdArg.toUpperCase();
if (!/^[A-Z0-9-]{3,32}$/.test(collegeId)) {
  console.error("College ID must be 3-32 letters, digits or dashes.");
  process.exit(1);
}

const db = new PrismaClient();
const words = ["Kite", "Moss", "Reef", "Pine", "Lark", "Opal", "Fern", "Dune", "Wren", "Cove", "Sage", "Iris"];
const temp = `${words[randomInt(words.length)]}-${randomInt(1000, 10000)}-${words[randomInt(words.length)]}`;

async function main() {
  if (await db.user.findUnique({ where: { collegeId } })) throw new Error(`${collegeId} already exists.`);
  await db.user.create({
    data: {
      collegeId,
      name,
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(temp, 10),
      mustChangePassword: true,
      roles: { create: [{ role: "ADMIN" }] },
    },
  });
  await db.auditLog.create({ data: { action: "ADMIN_CREATED_FROM_CLI", details: JSON.stringify({ collegeId }) } });
  console.log(`Admin ${collegeId} created. Temporary password (shown once): ${temp}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
