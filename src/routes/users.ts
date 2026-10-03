import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  assertManagersRemain,
  assertRoleIds,
  loadUserAccess,
  replaceUserRoles,
} from "../auth/access.js";
import { USERS_CREATE, USERS_DELETE, USERS_EDIT, USERS_VIEW } from "../auth/catalog.js";
import { Auth0RequestError } from "../auth/management.js";
import { requirePermission } from "../auth/middleware.js";
import { permissions, rolePermissions, roles, sessions, userRoles, users } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv } from "../types.js";
import { invalidRequest, normalizeEmail, readBody, routeError } from "./http.js";

const createUserSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(200).optional(),
  roleIds: z.array(z.uuid()).max(50).optional().default([]),
});

const updateUserSchema = z
  .object({
    email: z.email().optional(),
    password: z.string().min(8).max(128).optional(),
    name: z.string().trim().min(1).max(200).nullable().optional(),
    disabled: z.boolean().optional(),
    roleIds: z.array(z.uuid()).max(50).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

export const userRoutes = new Hono<AppEnv>();

userRoutes.get("/users", requirePermission(USERS_VIEW), async (c) => {
  return c.json({ users: await listUsers(c.get("services").db) });
});

userRoutes.post("/users", requirePermission(USERS_CREATE), async (c) => {
  const parsed = createUserSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const email = normalizeEmail(parsed.data.email);
  const name = parsed.data.name ?? null;
  const roleIds = [...new Set(parsed.data.roleIds)];
  const db = c.get("services").db;
  const management = c.get("services").auth0Management;

  try {
    await assertRoleIds(db, roleIds);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);

    if (existing) {
      return c.json({ error: "A user with that email already exists." }, 409);
    }

    const account = await management.createUser({ email, password: parsed.data.password, name });
    let createdId: string | undefined;

    try {
      const [created] = await db
        .insert(users)
        .values({ auth0Sub: account.userId, email, name })
        .returning();

      if (!created) {
        throw new Error("User was not created.");
      }

      createdId = created.id;
      await replaceUserRoles(db, created.id, roleIds);
      const access = await loadUserAccess(db, created.id);
      return c.json({ user: presentUser(created, access) }, 201);
    } catch (error) {
      if (createdId) {
        await db.delete(users).where(eq(users.id, createdId)).catch((cleanupError) => {
          console.error("Failed to roll back local user", cleanupError);
        });
      }

      await management.deleteUser(account.userId).catch((cleanupError) => {
        console.error("Failed to roll back Auth0 user", cleanupError);
      });
      throw error;
    }
  } catch (error) {
    return routeError(c, error);
  }
});

userRoutes.get("/users/:id", requirePermission(USERS_VIEW), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "User not found." }, 404);
  }

  const [user] = await c.get("services").db.select().from(users).where(eq(users.id, id)).limit(1);

  if (!user) {
    return c.json({ error: "User not found." }, 404);
  }

  return c.json({ user: presentUser(user, await loadUserAccess(c.get("services").db, user.id)) });
});

userRoutes.patch("/users/:id", requirePermission(USERS_EDIT), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "User not found." }, 404);
  }

  const parsed = updateUserSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  if (parsed.data.disabled === true && id === c.get("user").id) {
    return c.json({ error: "You cannot disable your own account." }, 400);
  }

  const db = c.get("services").db;
  const [current] = await db.select().from(users).where(eq(users.id, id)).limit(1);

  if (!current) {
    return c.json({ error: "User not found." }, 404);
  }

  const email = parsed.data.email ? normalizeEmail(parsed.data.email) : undefined;
  const needsLogin = email !== undefined || parsed.data.password !== undefined || parsed.data.disabled !== undefined;

  if (needsLogin && !current.auth0Sub) {
    return c.json({ error: "This user is not linked to a login." }, 409);
  }

  try {
    const changes = [];

    if (parsed.data.roleIds) {
      await assertRoleIds(db, parsed.data.roleIds);
      changes.push({ type: "user-roles" as const, userId: id, roleIds: parsed.data.roleIds });
    }

    if (parsed.data.disabled === true) {
      changes.push({ type: "user-disabled" as const, userId: id, disabled: true });
    }

    if (changes.length > 0) {
      await assertManagersRemain(db, changes);
    }

    const management = c.get("services").auth0Management;
    const auth0Sub = current.auth0Sub;
    const changesLogin =
      Boolean(auth0Sub) &&
      (email !== undefined || parsed.data.name !== undefined || parsed.data.password !== undefined || parsed.data.disabled !== undefined);
    let auth0Updated = false;

    if (changesLogin && auth0Sub) {
      await management.updateUser(auth0Sub, {
        email: email && email !== current.email ? email : undefined,
        name: parsed.data.name,
        password: parsed.data.password,
        blocked: parsed.data.disabled,
      });
      auth0Updated = true;
    }

    try {
      const [updated] = await db
        .update(users)
        .set({
          email: email ?? current.email,
          name: parsed.data.name === undefined ? current.name : parsed.data.name,
          disabled: parsed.data.disabled ?? current.disabled,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();

      if (!updated) {
        throw new Error("User was not updated.");
      }

      if (parsed.data.roleIds) {
        await replaceUserRoles(db, id, parsed.data.roleIds);
      }

      if (parsed.data.disabled === true) {
        await db.delete(sessions).where(eq(sessions.userId, id));
      }

      return c.json({ user: presentUser(updated, await loadUserAccess(db, id)) });
    } catch (error) {
      if (auth0Updated && auth0Sub) {
        await management
          .updateUser(auth0Sub, {
            email: email && email !== current.email ? current.email : undefined,
            name: parsed.data.name !== undefined ? current.name : undefined,
            blocked: parsed.data.disabled !== undefined ? current.disabled : undefined,
          })
          .catch((cleanupError) => {
            console.error("Failed to roll back Auth0 user", cleanupError);
          });
      }

      throw error;
    }
  } catch (error) {
    return routeError(c, error);
  }
});

userRoutes.delete("/users/:id", requirePermission(USERS_DELETE), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "User not found." }, 404);
  }

  if (id === c.get("user").id) {
    return c.json({ error: "You cannot delete your own account." }, 400);
  }

  const db = c.get("services").db;
  const [current] = await db.select().from(users).where(eq(users.id, id)).limit(1);

  if (!current) {
    return c.json({ error: "User not found." }, 404);
  }

  try {
    await assertManagersRemain(db, [{ type: "delete-user", userId: id }]);

    if (current.auth0Sub) {
      try {
        await c.get("services").auth0Management.deleteUser(current.auth0Sub);
      } catch (error) {
        if (!(error instanceof Auth0RequestError) || error.status !== 404) {
          throw error;
        }
      }
    }

    await db.delete(users).where(eq(users.id, id));
    return c.json({ ok: true });
  } catch (error) {
    return routeError(c, error);
  }
});

function parseId(value: string) {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function listUsers(db: Database) {
  const userRows = await db.select().from(users).orderBy(users.email);
  const roleLinks = await db
    .select({ userId: userRoles.userId, id: roles.id, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id));
  const permissionLinks = await db
    .select({ userId: userRoles.userId, name: permissions.name })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId));

  return userRows.map((user) =>
    presentUser(user, {
      roles: roleLinks.filter((link) => link.userId === user.id).map((link) => ({ id: link.id, name: link.name })),
      permissions: [
        ...new Set(permissionLinks.filter((link) => link.userId === user.id).map((link) => link.name)),
      ].sort(),
    }),
  );
}

function presentUser(
  user: typeof users.$inferSelect,
  access: { roles: { id: string; name: string }[]; permissions: string[] },
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    disabled: user.disabled,
    roles: access.roles,
    permissions: access.permissions,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
