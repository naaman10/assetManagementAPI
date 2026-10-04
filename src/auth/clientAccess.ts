import { and, eq, exists, or } from "drizzle-orm";
import { ADMIN_ROLE } from "./catalog.js";
import { clientMembers, clientSettings, clients } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AuthUser } from "../types.js";

export function isAdmin(user: AuthUser) {
  return user.roles.some((role) => role.name === ADMIN_ROLE);
}

export function clientVisibility(db: Database, user: AuthUser) {
  if (isAdmin(user)) {
    return undefined;
  }

  return or(
    exists(
      db
        .select({ clientId: clientMembers.clientId })
        .from(clientMembers)
        .where(and(eq(clientMembers.clientId, clients.id), eq(clientMembers.userId, user.id))),
    ),
    exists(
      db
        .select({ clientId: clientSettings.clientId })
        .from(clientSettings)
        .where(and(eq(clientSettings.clientId, clients.id), eq(clientSettings.sponsorUserId, user.id))),
    ),
  );
}

export async function clientIsVisible(db: Database, user: AuthUser, clientId: string) {
  if (isAdmin(user)) {
    return true;
  }

  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), clientVisibility(db, user)))
    .limit(1);

  return Boolean(row);
}
