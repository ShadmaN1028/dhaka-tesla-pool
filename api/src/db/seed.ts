import { hash } from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "./client";
import { areaDistances, areas, users, vehicles } from "./schema";

const AREA_NAMES = [
  "Banani",
  "Gulshan 1",
  "Gulshan 2",
  "Mohakhali",
  "Dhanmondi",
  "Mirpur",
  "Uttara",
  "Farmgate",
  "Bashundhara",
];

// One entry per unordered pair (whole km); each is stored in both directions.
const DISTANCES: [string, string, number][] = [
  ["Banani", "Gulshan 1", 2],
  ["Banani", "Gulshan 2", 3],
  ["Banani", "Mohakhali", 3],
  ["Banani", "Dhanmondi", 8],
  ["Banani", "Mirpur", 10],
  ["Banani", "Uttara", 10],
  ["Banani", "Farmgate", 5],
  ["Banani", "Bashundhara", 6],
  ["Gulshan 1", "Gulshan 2", 2],
  ["Gulshan 1", "Mohakhali", 4],
  ["Gulshan 1", "Dhanmondi", 8],
  ["Gulshan 1", "Mirpur", 11],
  ["Gulshan 1", "Uttara", 11],
  ["Gulshan 1", "Farmgate", 6],
  ["Gulshan 1", "Bashundhara", 5],
  ["Gulshan 2", "Mohakhali", 5],
  ["Gulshan 2", "Dhanmondi", 10],
  ["Gulshan 2", "Mirpur", 12],
  ["Gulshan 2", "Uttara", 9],
  ["Gulshan 2", "Farmgate", 8],
  ["Gulshan 2", "Bashundhara", 3],
  ["Mohakhali", "Dhanmondi", 6],
  ["Mohakhali", "Mirpur", 8],
  ["Mohakhali", "Uttara", 11],
  ["Mohakhali", "Farmgate", 3],
  ["Mohakhali", "Bashundhara", 8],
  ["Dhanmondi", "Mirpur", 8],
  ["Dhanmondi", "Uttara", 16],
  ["Dhanmondi", "Farmgate", 4],
  ["Dhanmondi", "Bashundhara", 13],
  ["Mirpur", "Uttara", 12],
  ["Mirpur", "Farmgate", 6],
  ["Mirpur", "Bashundhara", 15],
  ["Uttara", "Farmgate", 13],
  ["Uttara", "Bashundhara", 8],
  ["Farmgate", "Bashundhara", 10],
];

const DEMO_PASSWORD = "tesla1234";

const USERS = [
  { name: "Jashim", email: "jashim@teslapool.dev", role: "DRIVER" },
  { name: "Nusrat", email: "nusrat@teslapool.dev", role: "PASSENGER" },
  { name: "Rafiq", email: "rafiq@teslapool.dev", role: "PASSENGER" },
  { name: "Shirin", email: "shirin@teslapool.dev", role: "PASSENGER" },
] as const;

async function main() {
  await db.transaction(async (tx) => {
    await tx
      .insert(areas)
      .values(AREA_NAMES.map((name) => ({ name })))
      .onConflictDoNothing({ target: areas.name });

    const areaIds = new Map((await tx.select().from(areas)).map((a) => [a.name, a.id]));

    const distanceRows = DISTANCES.flatMap(([a, b, km]) => {
      const from = areaIds.get(a);
      const to = areaIds.get(b);
      if (from === undefined || to === undefined) {
        throw new Error(`Unknown area in DISTANCES: ${a} / ${b}`);
      }
      return [
        { fromAreaId: from, toAreaId: to, km },
        { fromAreaId: to, toAreaId: from, km },
      ];
    });
    await tx
      .insert(areaDistances)
      .values(distanceRows)
      .onConflictDoUpdate({
        target: [areaDistances.fromAreaId, areaDistances.toAreaId],
        set: { km: sql`excluded.km` },
      });

    const userRows = await Promise.all(
      USERS.map(async (u) => ({ ...u, passwordHash: await hash(DEMO_PASSWORD, 10) })),
    );
    await tx.insert(users).values(userRows).onConflictDoNothing({ target: users.email });

    const [jashim] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "jashim@teslapool.dev"));
    if (!jashim) throw new Error("Jashim was not seeded");
    await tx
      .insert(vehicles)
      .values({ driverId: jashim.id, name: "Bullet", capacity: 3 })
      .onConflictDoNothing({ target: vehicles.driverId });
  });

  console.log(
    `Seeded: ${await db.$count(areas)} areas, ${await db.$count(areaDistances)} area distances, ` +
      `${await db.$count(users)} users, ${await db.$count(vehicles)} vehicles`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
