import type { createDatabase } from "./client.js";

export type Database = ReturnType<typeof createDatabase>["db"];
