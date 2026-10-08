import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./config/env.js";
import { assetRoutes } from "./routes/assets.js";
import { auditRoutes } from "./routes/audits.js";
import { assetTypeRoutes } from "./routes/assetTypes.js";
import { classificationRoutes } from "./routes/classifications.js";
import { auth } from "./routes/auth.js";
import { clientRoutes } from "./routes/clients.js";
import { locationRoutes } from "./routes/locations.js";
import { maintenanceScheduleRoutes } from "./routes/maintenanceSchedules.js";
import { maintenanceTypeRoutes } from "./routes/maintenanceTypes.js";
import { siteRoutes } from "./routes/sites.js";
import { health } from "./routes/health.js";
import { permissionRoutes } from "./routes/permissions.js";
import { roleRoutes } from "./routes/roles.js";
import { userRoutes } from "./routes/users.js";
import { workOrderRoutes } from "./routes/workOrders.js";
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
  app.route("/", userRoutes);
  app.route("/", clientRoutes);
  app.route("/", siteRoutes);
  app.route("/", locationRoutes);
  app.route("/", assetRoutes);
  app.route("/", auditRoutes);
  app.route("/", assetTypeRoutes);
  app.route("/", classificationRoutes);
  app.route("/", maintenanceTypeRoutes);
  app.route("/", maintenanceScheduleRoutes);
  app.route("/", workOrderRoutes);
  app.route("/", roleRoutes);
  app.route("/", permissionRoutes);

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
