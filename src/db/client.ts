import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { auditStorage, type Database } from "./auditContext.js";
import * as schema from "./schema/index.js";

export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  const root = drizzle({ client: pool, schema });
  const db = new Proxy(root, {
    get(target, prop) {
      const current = auditStorage.getStore() ?? target;
      const value = Reflect.get(current, prop, current);
      return typeof value === "function" ? value.bind(current) : value;
    },
  }) as Database;

  return { pool, db };
}
