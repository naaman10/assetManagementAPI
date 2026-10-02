import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { createDatabase } from "./client.js";

type Database = ReturnType<typeof createDatabase>["db"];

export async function migrateDatabase(db: Database) {
  const migrationsFolder = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../drizzle",
  );

  await migrate(db, { migrationsFolder });
}
