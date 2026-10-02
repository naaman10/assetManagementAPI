import { createGoogleAuth } from "./auth/google.js";
import type { Env } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { createEmailClient } from "./email/resend.js";

export function createServices(env: Env) {
  const database = createDatabase(env.DATABASE_URL);

  return {
    db: database.db,
    pool: database.pool,
    googleAuth: createGoogleAuth(env),
    email: createEmailClient(env),
  };
}

export type Services = ReturnType<typeof createServices>;
