export const USERS_MANAGE = "users:manage";
export const ROLES_MANAGE = "roles:manage";
export const ADMIN_ROLE = "admin";

export const SEEDED_PERMISSIONS = [
  {
    name: USERS_MANAGE,
    description: "Create, update, disable, and delete users, and assign their roles.",
  },
  {
    name: ROLES_MANAGE,
    description: "Create and edit roles and permissions.",
  },
] as const;

export const SEEDED_PERMISSION_NAMES = new Set<string>(SEEDED_PERMISSIONS.map((permission) => permission.name));
