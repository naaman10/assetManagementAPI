import { createAuth0 } from "./auth/auth0.js";
import { createAuth0Management } from "./auth/management.js";
import type { Env } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { createEmailClient } from "./email/resend.js";
import { createAssetStorage } from "./storage/assets.js";

export function createServices(env: Env) {
  const database = createDatabase(env.DATABASE_URL);

  return {
    db: database.db,
    pool: database.pool,
    email: createEmailClient(env),
    auth0: createAuth0(env),
    auth0Management: createAuth0Management(env),
    assets: createAssetStorage(env),
  };
}

export type Services = ReturnType<typeof createServices>;
