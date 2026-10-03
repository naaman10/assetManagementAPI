import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { ensureAccess } from "./db/bootstrap.js";
import { migrateDatabase } from "./db/migrate.js";
import { createServices } from "./services.js";

const services = createServices(env);
await migrateDatabase(services.db);
await ensureAccess(env, services);
const app = createApp(services);

const server = serve(
  {
    fetch: app.fetch,
    hostname: "0.0.0.0",
    port: env.PORT,
  },
  (info) => {
    console.log(`API listening on port ${info.port}`);
  },
);

async function shutdown() {
  server.close();
  await services.pool.end();
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
