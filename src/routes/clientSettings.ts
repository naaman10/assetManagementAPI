import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { clientContacts, clientMembers, clientSettings, clients, users } from "../db/schema/index.js";
import type { Database } from "../db/types.js";

export const updateSettingsSchema = z
  .object({
    leadContactId: z.uuid().nullable().optional(),
    sponsorUserId: z.uuid().nullable().optional(),
    memberIds: z.array(z.uuid()).max(100).optional(),
  })
  .refine(
    (value) => value.leadContactId !== undefined || value.sponsorUserId !== undefined || value.memberIds !== undefined,
    { message: "No changes were provided." },
  );

export async function saveClientSettings(
  db: Database,
  clientId: string,
  input: z.infer<typeof updateSettingsSchema>,
) {
  if (input.leadContactId) {
    const [contact] = await db
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(and(eq(clientContacts.id, input.leadContactId), eq(clientContacts.clientId, clientId)))
      .limit(1);

    if (!contact) {
      return "contact" as const;
    }
  }

  const userIds = new Set<string>();

  if (input.sponsorUserId) {
    userIds.add(input.sponsorUserId);
  }

  for (const userId of input.memberIds ?? []) {
    userIds.add(userId);
  }

  if (userIds.size > 0) {
    const rows = await db.select({ id: users.id }).from(users).where(inArray(users.id, [...userIds]));

    if (rows.length !== userIds.size) {
      return "user" as const;
    }
  }

  const memberIds = input.memberIds === undefined ? undefined : [...new Set(input.memberIds)];

  await db.transaction(async (tx) => {
    await tx.insert(clientSettings).values({ clientId }).onConflictDoNothing({ target: clientSettings.clientId });

    const settingsPatch: { leadContactId?: string | null; sponsorUserId?: string | null } = {};

    if (input.leadContactId !== undefined) {
      settingsPatch.leadContactId = input.leadContactId;
    }

    if (input.sponsorUserId !== undefined) {
      settingsPatch.sponsorUserId = input.sponsorUserId;
    }

    if (settingsPatch.leadContactId !== undefined || settingsPatch.sponsorUserId !== undefined) {
      await tx.update(clientSettings).set(settingsPatch).where(eq(clientSettings.clientId, clientId));
    }

    if (memberIds !== undefined) {
      await tx.delete(clientMembers).where(eq(clientMembers.clientId, clientId));

      if (memberIds.length > 0) {
        await tx.insert(clientMembers).values(memberIds.map((userId) => ({ clientId, userId })));
      }
    }

    await tx.update(clients).set({ updatedAt: new Date() }).where(eq(clients.id, clientId));
  });

  return "ok" as const;
}

export async function loadClientSettings(db: Database, clientId: string) {
  const [settings] = await db.select().from(clientSettings).where(eq(clientSettings.clientId, clientId)).limit(1);
  let leadContact: {
    id: string;
    name: string;
    role: string | null;
    email: string | null;
    telephone: string | null;
  } | null = null;

  if (settings?.leadContactId) {
    const [contact] = await db
      .select({
        id: clientContacts.id,
        name: clientContacts.name,
        role: clientContacts.role,
        email: clientContacts.email,
        telephone: clientContacts.telephone,
      })
      .from(clientContacts)
      .where(and(eq(clientContacts.id, settings.leadContactId), eq(clientContacts.clientId, clientId)))
      .limit(1);
    leadContact = contact ?? null;
  }

  let sponsor: { id: string; email: string; name: string | null } | null = null;

  if (settings?.sponsorUserId) {
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, settings.sponsorUserId))
      .limit(1);
    sponsor = user ?? null;
  }

  const members = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(clientMembers)
    .innerJoin(users, eq(clientMembers.userId, users.id))
    .where(eq(clientMembers.clientId, clientId))
    .orderBy(asc(users.name), asc(users.email));

  return { leadContact, sponsor, members };
}
