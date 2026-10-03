import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { assertManagersRemain, permissionNamesForIds } from "../auth/access.js";
import { ADMIN_ROLE, ROLES_MANAGE, USERS_MANAGE } from "../auth/catalog.js";
import { requireAnyPermission, requirePermission } from "../auth/middleware.js";
import { permissions, rolePermissions, roles } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";

const roleName = z.string().trim().min(1).max(80);
const roleDescription = z.string().trim().max(500).nullable().optional();

const createRoleSchema = z.object({
  name: roleName,
  description: roleDescription,
  permissionIds: z.array(z.uuid()).max(100).optional().default([]),
});

const updateRoleSchema = z
  .object({
    name: roleName.optional(),
    description: roleDescription,
    permissionIds: z.array(z.uuid()).max(100).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

export const roleRoutes = new Hono<AppEnv>();

roleRoutes.get("/roles", requireAnyPermission(USERS_MANAGE, ROLES_MANAGE), async (c) => {
  return c.json({ roles: await listRoles(c.get("services").db) });
});

roleRoutes.post("/roles", requirePermission(ROLES_MANAGE), async (c) => {
  const parsed = createRoleSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const permissionIds = [...new Set(parsed.data.permissionIds)];
  const db = c.get("services").db;

  try {
    await permissionNamesForIds(db, permissionIds);
    const [created] = await db
      .insert(roles)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      })
      .returning();

    if (!created) {
      throw new Error("Role was not created.");
    }

    if (permissionIds.length > 0) {
      await db.insert(rolePermissions).values(permissionIds.map((permissionId) => ({ roleId: created.id, permissionId })));
    }

    const [role] = await listRoles(db, created.id);
    return c.json({ role }, 201);
  } catch (error) {
    return routeError(c, error);
  }
});

roleRoutes.get("/roles/:id", requireAnyPermission(USERS_MANAGE, ROLES_MANAGE), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Role not found." }, 404);
  }

  const [role] = await listRoles(c.get("services").db, id);

  if (!role) {
    return c.json({ error: "Role not found." }, 404);
  }

  return c.json({ role });
});

roleRoutes.patch("/roles/:id", requirePermission(ROLES_MANAGE), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Role not found." }, 404);
  }

  const parsed = updateRoleSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const [current] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);

  if (!current) {
    return c.json({ error: "Role not found." }, 404);
  }

  if (current.name === ADMIN_ROLE && parsed.data.name && parsed.data.name !== ADMIN_ROLE) {
    return c.json({ error: "The admin role cannot be renamed." }, 400);
  }

  try {
    if (parsed.data.permissionIds) {
      const names = await permissionNamesForIds(db, parsed.data.permissionIds);
      await assertManagersRemain(db, [{ type: "role-permissions", roleId: id, permissionNames: names }]);
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, id));

      if (parsed.data.permissionIds.length > 0) {
        await db.insert(rolePermissions).values(
          [...new Set(parsed.data.permissionIds)].map((permissionId) => ({ roleId: id, permissionId })),
        );
      }
    }

    await db
      .update(roles)
      .set({
        name: parsed.data.name ?? current.name,
        description: parsed.data.description === undefined ? current.description : parsed.data.description,
        updatedAt: new Date(),
      })
      .where(eq(roles.id, id));

    const [role] = await listRoles(db, id);
    return c.json({ role });
  } catch (error) {
    return routeError(c, error);
  }
});

roleRoutes.delete("/roles/:id", requirePermission(ROLES_MANAGE), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Role not found." }, 404);
  }

  const db = c.get("services").db;
  const [current] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);

  if (!current) {
    return c.json({ error: "Role not found." }, 404);
  }

  if (current.name === ADMIN_ROLE) {
    return c.json({ error: "The admin role cannot be deleted." }, 400);
  }

  try {
    await assertManagersRemain(db, [{ type: "delete-role", roleId: id }]);
    await db.delete(roles).where(eq(roles.id, id));
    return c.json({ ok: true });
  } catch (error) {
    return routeError(c, error);
  }
});

function parseId(value: string) {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function listRoles(db: Database, roleId?: string) {
  const roleRows = await db.select().from(roles).where(roleId ? eq(roles.id, roleId) : undefined).orderBy(roles.name);
  const links = await db
    .select({
      roleId: rolePermissions.roleId,
      id: permissions.id,
      name: permissions.name,
      description: permissions.description,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId));

  return roleRows.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: links
      .filter((link) => link.roleId === role.id)
      .map((link) => ({ id: link.id, name: link.name, description: link.description }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  }));
}
