import { eq, inArray } from "drizzle-orm";
import type { Database } from "../db/types.js";
import { permissions, rolePermissions, roles, userRoles, users } from "../db/schema/index.js";
import { USERS_MANAGE } from "./catalog.js";

export type RoleSummary = {
  id: string;
  name: string;
};

export type UserAccess = {
  roles: RoleSummary[];
  permissions: string[];
};

export class AccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessError";
  }
}

type AssignmentChange =
  | { type: "user-roles"; userId: string; roleIds: string[] }
  | { type: "user-disabled"; userId: string; disabled: boolean }
  | { type: "delete-user"; userId: string }
  | { type: "role-permissions"; roleId: string; permissionNames: string[] }
  | { type: "delete-role"; roleId: string };

type Assignment = {
  users: { id: string; disabled: boolean; roleIds: string[] }[];
  rolePermissions: Map<string, Set<string>>;
};

export async function loadUserAccess(db: Database, userId: string): Promise<UserAccess> {
  const roleRows = await db
    .select({ id: roles.id, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  const permissionRows = await db
    .selectDistinct({ name: permissions.name })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));

  return {
    roles: roleRows,
    permissions: permissionRows.map((row) => row.name).sort(),
  };
}

export async function hasEnabledManager(db: Database) {
  const assignment = await loadAssignment(db);
  return countManagers(assignment) > 0;
}

export async function assertRoleIds(db: Database, roleIds: string[]) {
  const unique = [...new Set(roleIds)];

  if (unique.length === 0) {
    return;
  }

  const rows = await db.select({ id: roles.id }).from(roles).where(inArray(roles.id, unique));

  if (rows.length !== unique.length) {
    throw new AccessError("One or more roles do not exist.");
  }
}

export async function permissionNamesForIds(db: Database, permissionIds: string[]) {
  const unique = [...new Set(permissionIds)];

  if (unique.length === 0) {
    return [];
  }

  const rows = await db
    .select({ name: permissions.name })
    .from(permissions)
    .where(inArray(permissions.id, unique));

  if (rows.length !== unique.length) {
    throw new AccessError("One or more permissions do not exist.");
  }

  return rows.map((row) => row.name);
}

export async function assertManagersRemain(db: Database, changes: AssignmentChange[]) {
  const assignment = await loadAssignment(db);

  for (const change of changes) {
    applyChange(assignment, change);
  }

  if (countManagers(assignment) === 0) {
    throw new AccessError("At least one enabled user must be able to manage users.");
  }
}

export async function replaceUserRoles(db: Database, userId: string, roleIds: string[]) {
  const unique = [...new Set(roleIds)];
  await db.delete(userRoles).where(eq(userRoles.userId, userId));

  if (unique.length > 0) {
    await db.insert(userRoles).values(unique.map((roleId) => ({ userId, roleId })));
  }
}

async function loadAssignment(db: Database): Promise<Assignment> {
  const userRows = await db.select({ id: users.id, disabled: users.disabled }).from(users);
  const linkRows = await db
    .select({ userId: userRoles.userId, roleId: userRoles.roleId })
    .from(userRoles);
  const permissionRows = await db
    .select({ roleId: rolePermissions.roleId, name: permissions.name })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId));
  const rolesByUser = new Map<string, string[]>();

  for (const link of linkRows) {
    const list = rolesByUser.get(link.userId) ?? [];
    list.push(link.roleId);
    rolesByUser.set(link.userId, list);
  }

  const permissionsByRole = new Map<string, Set<string>>();

  for (const row of permissionRows) {
    const names = permissionsByRole.get(row.roleId) ?? new Set<string>();
    names.add(row.name);
    permissionsByRole.set(row.roleId, names);
  }

  return {
    users: userRows.map((user) => ({
      id: user.id,
      disabled: user.disabled,
      roleIds: rolesByUser.get(user.id) ?? [],
    })),
    rolePermissions: permissionsByRole,
  };
}

function applyChange(assignment: Assignment, change: AssignmentChange) {
  if (change.type === "user-roles") {
    const user = assignment.users.find((item) => item.id === change.userId);

    if (user) {
      user.roleIds = [...new Set(change.roleIds)];
    }

    return;
  }

  if (change.type === "user-disabled") {
    const user = assignment.users.find((item) => item.id === change.userId);

    if (user) {
      user.disabled = change.disabled;
    }

    return;
  }

  if (change.type === "delete-user") {
    assignment.users = assignment.users.filter((user) => user.id !== change.userId);
    return;
  }

  if (change.type === "role-permissions") {
    assignment.rolePermissions.set(change.roleId, new Set(change.permissionNames));
    return;
  }

  assignment.rolePermissions.delete(change.roleId);

  for (const user of assignment.users) {
    user.roleIds = user.roleIds.filter((roleId) => roleId !== change.roleId);
  }
}

function countManagers(assignment: Assignment) {
  let count = 0;

  for (const user of assignment.users) {
    if (user.disabled) {
      continue;
    }

    const names = new Set<string>();

    for (const roleId of user.roleIds) {
      for (const name of assignment.rolePermissions.get(roleId) ?? []) {
        names.add(name);
      }
    }

    if (names.has(USERS_MANAGE)) {
      count += 1;
    }
  }

  return count;
}
