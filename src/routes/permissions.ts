import { Hono } from "hono";
import { PERMISSIONS_VIEW, ROLES_CREATE, ROLES_EDIT } from "../auth/catalog.js";
import { requireAnyPermission } from "../auth/middleware.js";
import { permissions } from "../db/schema/index.js";
import type { AppEnv } from "../types.js";

export const permissionRoutes = new Hono<AppEnv>();

permissionRoutes.get(
  "/permissions",
  requireAnyPermission(PERMISSIONS_VIEW, ROLES_CREATE, ROLES_EDIT),
  async (c) => {
    const rows = await c.get("services").db.select().from(permissions).orderBy(permissions.name);
    return c.json({ permissions: rows.map(presentPermission) });
  },
);

function presentPermission(permission: typeof permissions.$inferSelect) {
  return {
    id: permission.id,
    name: permission.name,
    description: permission.description,
    createdAt: permission.createdAt,
  };
}
