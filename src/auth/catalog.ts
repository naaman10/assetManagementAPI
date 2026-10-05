export const USERS_VIEW = "users:view";
export const USERS_CREATE = "users:create";
export const USERS_EDIT = "users:edit";
export const USERS_DELETE = "users:delete";
export const ROLES_VIEW = "roles:view";
export const ROLES_CREATE = "roles:create";
export const ROLES_EDIT = "roles:edit";
export const ROLES_DELETE = "roles:delete";
export const PERMISSIONS_VIEW = "permissions:view";
export const CLIENTS_VIEW = "clients:view";
export const CLIENTS_CREATE = "clients:create";
export const CLIENTS_EDIT = "clients:edit";
export const CLIENTS_DELETE = "clients:delete";
export const ADMIN_ROLE = "admin";

export const SEEDED_PERMISSIONS = [
  { name: USERS_VIEW, description: "List and read users." },
  { name: USERS_CREATE, description: "Create users and assign their roles." },
  { name: USERS_EDIT, description: "Update users, disable them, and change their roles." },
  { name: USERS_DELETE, description: "Delete users." },
  { name: ROLES_VIEW, description: "List and read roles." },
  { name: ROLES_CREATE, description: "Create roles and assign their permissions." },
  { name: ROLES_EDIT, description: "Update roles and their permissions." },
  { name: ROLES_DELETE, description: "Delete roles." },
  { name: PERMISSIONS_VIEW, description: "List the permission catalog." },
  { name: CLIENTS_VIEW, description: "List and read clients the user can access, including their contacts, sites, locations, and settings." },
  { name: CLIENTS_CREATE, description: "Create clients and sites." },
  { name: CLIENTS_EDIT, description: "Update clients, logos, contacts, sites, and settings." },
  { name: CLIENTS_DELETE, description: "Delete clients." },
] as const;

export const LEGACY_PERMISSIONS: Record<string, readonly string[]> = {
  "users:manage": [USERS_VIEW, USERS_CREATE, USERS_EDIT, USERS_DELETE],
  "roles:manage": [ROLES_VIEW, ROLES_CREATE, ROLES_EDIT, ROLES_DELETE],
};
