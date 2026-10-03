import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { ROLES_MANAGE, SEEDED_PERMISSION_NAMES, USERS_MANAGE } from "../auth/catalog.js";
import { requireAnyPermission, requirePermission } from "../auth/middleware.js";
import { permissions } from "../db/schema/index.js";
import type { AppEnv } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";

const permissionName = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?::[a-z0-9]+)+$/, "Use a lowercase name such as assets:read.");

const permissionDescription = z.string().trim().max(500).nullable().optional();

const createPermissionSchema = z.object({
  name: permissionName,
  description: permissionDescription,
});

const updatePermissionSchema = z
  .object({
    name: permissionName.optional(),
    description: permissionDescription,
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: "No changes were provided.",
  });

export const permissionRoutes = new Hono<AppEnv>();

permissionRoutes.get("/permissions", requireAnyPermission(USERS_MANAGE, ROLES_MANAGE), async (c) => {
  const rows = await c.get("services").db.select().from(permissions).orderBy(permissions.name);
  return c.json({ permissions: rows.map(presentPermission) });
});

permissionRoutes.post("/permissions", requirePermission(ROLES_MANAGE), async (c) => {
  const parsed = createPermissionSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  try {
    const [created] = await c
      .get("services")
      .db.insert(permissions)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      })
      .returning();

    return c.json({ permission: created ? presentPermission(created) : null }, 201);
  } catch (error) {
    return routeError(c, error);
  }
});

permissionRoutes.patch("/permissions/:id", requirePermission(ROLES_MANAGE), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Permission not found." }, 404);
  }

  const parsed = updatePermissionSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const [current] = await db.select().from(permissions).where(eq(permissions.id, id)).limit(1);

  if (!current) {
    return c.json({ error: "Permission not found." }, 404);
  }

  if (SEEDED_PERMISSION_NAMES.has(current.name) && parsed.data.name && parsed.data.name !== current.name) {
    return c.json({ error: "This permission cannot be renamed." }, 400);
  }

  try {
    const [updated] = await db
      .update(permissions)
      .set({
        name: parsed.data.name ?? current.name,
        description: parsed.data.description === undefined ? current.description : parsed.data.description,
      })
      .where(eq(permissions.id, id))
      .returning();

    return c.json({ permission: updated ? presentPermission(updated) : null });
  } catch (error) {
    return routeError(c, error);
  }
});

permissionRoutes.delete("/permissions/:id", requirePermission(ROLES_MANAGE), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Permission not found." }, 404);
  }

  const db = c.get("services").db;
  const [current] = await db.select().from(permissions).where(eq(permissions.id, id)).limit(1);

  if (!current) {
    return c.json({ error: "Permission not found." }, 404);
  }

  if (SEEDED_PERMISSION_NAMES.has(current.name)) {
    return c.json({ error: "This permission cannot be deleted." }, 400);
  }

  await db.delete(permissions).where(eq(permissions.id, id));
  return c.json({ ok: true });
});

function parseId(value: string) {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function presentPermission(permission: typeof permissions.$inferSelect) {
  return {
    id: permission.id,
    name: permission.name,
    description: permission.description,
    createdAt: permission.createdAt,
  };
}
