import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./config/env.js";
import { auth } from "./routes/auth.js";
import { health } from "./routes/health.js";
import type { Services } from "./services.js";
import type { AppEnv } from "./types.js";

export function createApp(services: Services) {
  const app = new Hono<AppEnv>();

  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: env.WEB_APP_ORIGIN,
      credentials: true,
    }),
  );
  app.use("*", async (c, next) => {
    c.set("services", services);
    await next();
  });

  app.route("/", health);
  app.route("/", auth);

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
