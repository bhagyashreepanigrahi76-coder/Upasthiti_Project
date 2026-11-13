// Runs on every deploy. Adds the Jajpur campus point if it is missing, and
// never changes or deletes anything else, so it is safe to run again and again.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const NAME = "Main campus (Jajpur)";

async function main() {
  const exists = await db.geofence.findFirst({ where: { name: NAME } });
  if (exists) {
    console.log("Campus point already present; nothing to do.");
    return;
  }
  await db.geofence.create({ data: { name: NAME, latitude: 20.8379093, longitude: 86.3112435, radiusMeters: 100, isActive: true } });
  console.log("Campus point added.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
