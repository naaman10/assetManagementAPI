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
export const ASSET_TYPES_VIEW = "assetType:view";
export const ASSET_TYPES_CREATE = "assetType:create";
export const ASSET_TYPES_EDIT = "assetType:edit";
export const ASSET_TYPES_DELETE = "assetType:delete";
export const GROUPS_VIEW = "group:view";
export const GROUPS_CREATE = "group:create";
export const GROUPS_EDIT = "group:edit";
export const GROUPS_DELETE = "group:delete";
export const ELEMENTS_VIEW = "element:view";
export const ELEMENTS_CREATE = "element:create";
export const ELEMENTS_EDIT = "element:edit";
export const ELEMENTS_DELETE = "element:delete";
export const SUB_ELEMENTS_VIEW = "subElement:view";
export const SUB_ELEMENTS_CREATE = "subElement:create";
export const SUB_ELEMENTS_EDIT = "subElement:edit";
export const SUB_ELEMENTS_DELETE = "subElement:delete";
export const BCIS_REFS_VIEW = "bcisRef:view";
export const BCIS_REFS_CREATE = "bcisRef:create";
export const BCIS_REFS_EDIT = "bcisRef:edit";
export const BCIS_REFS_DELETE = "bcisRef:delete";
export const BCIS_SUB_REFS_VIEW = "bcisSubRef:view";
export const BCIS_SUB_REFS_CREATE = "bcisSubRef:create";
export const BCIS_SUB_REFS_EDIT = "bcisSubRef:edit";
export const BCIS_SUB_REFS_DELETE = "bcisSubRef:delete";
export const MAINTENANCE_TYPES_VIEW = "maintenanceTypes:view";
export const MAINTENANCE_TYPES_CREATE = "maintenanceTypes:create";
export const MAINTENANCE_TYPES_EDIT = "maintenanceTypes:edit";
export const MAINTENANCE_TYPES_DELETE = "maintenanceTypes:delete";
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
  { name: ASSET_TYPES_VIEW, description: "List and read asset types." },
  { name: ASSET_TYPES_CREATE, description: "Create asset types." },
  { name: ASSET_TYPES_EDIT, description: "Update asset types." },
  { name: ASSET_TYPES_DELETE, description: "Delete asset types." },
  { name: GROUPS_VIEW, description: "List and read groups." },
  { name: GROUPS_CREATE, description: "Create groups." },
  { name: GROUPS_EDIT, description: "Update groups." },
  { name: GROUPS_DELETE, description: "Delete groups." },
  { name: ELEMENTS_VIEW, description: "List and read elements." },
  { name: ELEMENTS_CREATE, description: "Create elements." },
  { name: ELEMENTS_EDIT, description: "Update elements." },
  { name: ELEMENTS_DELETE, description: "Delete elements." },
  { name: SUB_ELEMENTS_VIEW, description: "List and read sub elements." },
  { name: SUB_ELEMENTS_CREATE, description: "Create sub elements." },
  { name: SUB_ELEMENTS_EDIT, description: "Update sub elements." },
  { name: SUB_ELEMENTS_DELETE, description: "Delete sub elements." },
  { name: BCIS_REFS_VIEW, description: "List and read BCIS references." },
  { name: BCIS_REFS_CREATE, description: "Create BCIS references." },
  { name: BCIS_REFS_EDIT, description: "Update BCIS references." },
  { name: BCIS_REFS_DELETE, description: "Delete BCIS references." },
  { name: BCIS_SUB_REFS_VIEW, description: "List and read BCIS sub references." },
  { name: BCIS_SUB_REFS_CREATE, description: "Create BCIS sub references." },
  { name: BCIS_SUB_REFS_EDIT, description: "Update BCIS sub references." },
  { name: BCIS_SUB_REFS_DELETE, description: "Delete BCIS sub references." },
  { name: MAINTENANCE_TYPES_VIEW, description: "List and read maintenance types." },
  { name: MAINTENANCE_TYPES_CREATE, description: "Create maintenance types." },
  { name: MAINTENANCE_TYPES_EDIT, description: "Update maintenance types." },
  { name: MAINTENANCE_TYPES_DELETE, description: "Delete maintenance types." },
] as const;

export const LEGACY_PERMISSIONS: Record<string, readonly string[]> = {
  "users:manage": [USERS_VIEW, USERS_CREATE, USERS_EDIT, USERS_DELETE],
  "roles:manage": [ROLES_VIEW, ROLES_CREATE, ROLES_EDIT, ROLES_DELETE],
};
