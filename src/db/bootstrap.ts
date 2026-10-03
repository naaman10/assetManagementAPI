import { eq, inArray } from "drizzle-orm";
import type { Env } from "../config/env.js";
import type { Database } from "./types.js";
import { permissions, rolePermissions, roles, userRoles, users } from "./schema/index.js";
import { ADMIN_ROLE, SEEDED_PERMISSIONS } from "../auth/catalog.js";
import { hasEnabledManager } from "../auth/access.js";
import { Auth0RequestError } from "../auth/management.js";
import type { Services } from "../services.js";

export async function ensureAccess(env: Env, services: Services) {
  const db = services.db;
  await db
    .insert(permissions)
    .values(SEEDED_PERMISSIONS.map((permission) => ({ ...permission })))
    .onConflictDoNothing({ target: permissions.name });

  if (await hasEnabledManager(db)) {
    return;
  }

  const adminRoleId = await ensureAdminRole(db);

  if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) {
    console.warn(
      "No enabled user can manage users. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD to create the first admin.",
    );
    return;
  }

  const email = env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
  const auth0Sub = await findOrCreateLogin(services, email, env.BOOTSTRAP_ADMIN_PASSWORD);
  const [local] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, email)).limit(1);
  let userId = local?.id;

  if (local) {
    await db
      .update(users)
      .set({
        auth0Sub,
        disabled: false,
        name: local.name ?? "Admin",
        updatedAt: new Date(),
      })
      .where(eq(users.id, local.id));
  } else {
    const [created] = await db
      .insert(users)
      .values({ email, name: "Admin", auth0Sub })
      .returning({ id: users.id });

    if (!created) {
      throw new Error("Bootstrap admin was not created.");
    }

    userId = created.id;
  }

  await db.insert(userRoles).values({ userId, roleId: adminRoleId }).onConflictDoNothing();
  console.log("Bootstrap admin is ready.");
}

async function ensureAdminRole(db: Database) {
  const [existing] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, ADMIN_ROLE)).limit(1);
  const adminRoleId = existing
    ? existing.id
    : (
        await db
          .insert(roles)
          .values({
            name: ADMIN_ROLE,
            description: "Manages users, roles, and permissions.",
          })
          .returning({ id: roles.id })
      )[0]?.id;

  if (!adminRoleId) {
    throw new Error("Admin role was not created.");
  }

  const seeded = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      inArray(
        permissions.name,
        SEEDED_PERMISSIONS.map((permission) => permission.name),
      ),
    );

  await db
    .insert(rolePermissions)
    .values(seeded.map((permission) => ({ roleId: adminRoleId, permissionId: permission.id })))
    .onConflictDoNothing();

  return adminRoleId;
}

async function findOrCreateLogin(services: Services, email: string, password: string) {
  const existing = await services.auth0Management.findByEmail(email);

  if (existing) {
    return existing.userId;
  }

  try {
    const created = await services.auth0Management.createUser({
      email,
      password,
      name: "Admin",
    });
    return created.userId;
  } catch (error) {
    if (!(error instanceof Auth0RequestError) || error.status !== 409) {
      throw error;
    }

    const again = await services.auth0Management.findByEmail(email);

    if (!again) {
      throw error;
    }

    return again.userId;
  }
}
