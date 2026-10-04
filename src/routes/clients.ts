import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible, clientVisibility, isAdmin } from "../auth/clientAccess.js";
import { CLIENTS_CREATE, CLIENTS_DELETE, CLIENTS_EDIT, CLIENTS_VIEW } from "../auth/catalog.js";
import { requirePermission } from "../auth/middleware.js";
import { clientContacts, clientMembers, clientSettings, clients, sites } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AssetStorage } from "../storage/assets.js";
import type { AppEnv } from "../types.js";
import { invalidRequest, normalizeEmail, readBody, routeError } from "./http.js";
import { loadClientSettings, saveClientSettings, updateSettingsSchema } from "./clientSettings.js";
import { sitesForClient } from "./sites.js";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const requiredLine = z.string().trim().min(1).max(200);
const optionalLine = z.string().trim().max(200).nullable().optional();

const addressSchema = z.object({
  line1: requiredLine,
  line2: optionalLine,
  city: z.string().trim().min(1).max(120),
  county: optionalLine,
  postcode: z.string().trim().min(1).max(20),
  country: z.string().trim().min(1).max(120),
});

const addressPatchSchema = z.object({
  line1: requiredLine.optional(),
  line2: optionalLine,
  city: z.string().trim().min(1).max(120).optional(),
  county: optionalLine,
  postcode: z.string().trim().min(1).max(20).optional(),
  country: z.string().trim().min(1).max(120).optional(),
});

const contactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().max(80).nullable().optional(),
  email: z.email().nullable().optional(),
  telephone: z.string().trim().max(40).nullable().optional(),
});

const contactPatchSchema = contactSchema
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

const createClientSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: addressSchema,
  contacts: z.array(contactSchema).max(50).optional().default([]),
});

const updateClientSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    address: addressPatchSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.address !== undefined, {
    message: "No changes were provided.",
  });

export const clientRoutes = new Hono<AppEnv>();

clientRoutes.get("/clients", requirePermission(CLIENTS_VIEW), async (c) => {
  const db = c.get("services").db;
  const rows = await db.select().from(clients).where(clientVisibility(db, c.get("user"))).orderBy(asc(clients.name));
  const contacts = await listContacts(db);
  const presented = await Promise.all(
    rows.map((client) => presentClient(c.get("services").assets, client, contacts.get(client.id) ?? [])),
  );
  return c.json({ clients: presented });
});

clientRoutes.post("/clients", requirePermission(CLIENTS_CREATE), async (c) => {
  const parsed = createClientSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const address = parsed.data.address;

  try {
    const created = await db.transaction(async (tx) => {
      const [client] = await tx
        .insert(clients)
        .values({
          name: parsed.data.name,
          addressLine1: address.line1,
          addressLine2: blankToNull(address.line2),
          city: address.city,
          county: blankToNull(address.county),
          postcode: address.postcode,
          country: address.country,
        })
        .returning();

      if (!client) {
        throw new Error("Client was not created.");
      }

      if (parsed.data.contacts.length > 0) {
        await tx.insert(clientContacts).values(parsed.data.contacts.map((contact) => contactValues(client.id, contact)));
      }

      await tx.insert(clientSettings).values({ clientId: client.id });

      if (!isAdmin(c.get("user"))) {
        await tx.insert(clientMembers).values({ clientId: client.id, userId: c.get("user").id });
      }

      return client;
    });

    return c.json({ client: await loadClient(db, c.get("services").assets, created.id) }, 201);
  } catch (error) {
    return routeError(c, error);
  }
});

clientRoutes.get("/clients/:id", requirePermission(CLIENTS_VIEW), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Client not found." }, 404);
  }

  const db = c.get("services").db;

  if (!(await clientIsVisible(db, c.get("user"), id))) {
    return c.json({ error: "Client not found." }, 404);
  }

  const client = await loadClient(db, c.get("services").assets, id);

  if (!client) {
    return c.json({ error: "Client not found." }, 404);
  }

  return c.json({ client });
});

clientRoutes.patch("/clients/:id", requirePermission(CLIENTS_EDIT), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Client not found." }, 404);
  }

  const parsed = updateClientSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const [current] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);

  if (!current || !(await clientIsVisible(db, c.get("user"), id))) {
    return c.json({ error: "Client not found." }, 404);
  }

  const address = parsed.data.address;

  await db
    .update(clients)
    .set({
      name: parsed.data.name ?? current.name,
      addressLine1: address?.line1 ?? current.addressLine1,
      addressLine2: address?.line2 === undefined ? current.addressLine2 : blankToNull(address.line2),
      city: address?.city ?? current.city,
      county: address?.county === undefined ? current.county : blankToNull(address.county),
      postcode: address?.postcode ?? current.postcode,
      country: address?.country ?? current.country,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, id));

  return c.json({ client: await loadClient(db, c.get("services").assets, id) });
});

clientRoutes.put("/clients/:id/logo", requirePermission(CLIENTS_EDIT), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Client not found." }, 404);
  }

  const db = c.get("services").db;
  const [current] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);

  if (!current || !(await clientIsVisible(db, c.get("user"), id))) {
    return c.json({ error: "Client not found." }, 404);
  }

  let body: Record<string, unknown>;

  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "Invalid request" }, 400);
  }

  const logo = body.logo;

  if (!(logo instanceof File)) {
    return c.json({ error: "A logo image is required." }, 400);
  }

  if (logo.size > MAX_LOGO_BYTES) {
    return c.json({ error: "Logo must be 2 MB or smaller." }, 400);
  }

  const bytes = new Uint8Array(await logo.arrayBuffer());
  const contentType = imageType(bytes);

  if (!contentType) {
    return c.json({ error: "Logo must be a JPEG, PNG, or WebP image." }, 400);
  }

  const storage = c.get("services").assets;

  try {
    const key = await storage.putLogo(id, bytes, contentType);

    await db.update(clients).set({ logoKey: key, updatedAt: new Date() }).where(eq(clients.id, id));

    if (current.logoKey && current.logoKey !== key) {
      await storage.deleteObject(current.logoKey);
    }

    return c.json({ client: await loadClient(db, storage, id) });
  } catch (error) {
    return routeError(c, error);
  }
});

clientRoutes.delete("/clients/:id", requirePermission(CLIENTS_DELETE), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Client not found." }, 404);
  }

  const db = c.get("services").db;
  const [current] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);

  if (!current || !(await clientIsVisible(db, c.get("user"), id))) {
    return c.json({ error: "Client not found." }, 404);
  }

  try {
    if (current.logoKey) {
      await c.get("services").assets.deleteObject(current.logoKey);
    }

    await db.transaction(async (tx) => {
      await tx.delete(sites).where(eq(sites.clientId, id));
      await tx.delete(clients).where(eq(clients.id, id));
    });
    return c.json({ ok: true });
  } catch (error) {
    return routeError(c, error);
  }
});

clientRoutes.patch("/clients/:id/settings", requirePermission(CLIENTS_EDIT), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Client not found." }, 404);
  }

  const parsed = updateSettingsSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, id)).limit(1);

  if (!client || !(await clientIsVisible(db, c.get("user"), id))) {
    return c.json({ error: "Client not found." }, 404);
  }

  const saved = await saveClientSettings(db, id, parsed.data);

  if (saved === "contact") {
    return c.json({ error: "Contact not found." }, 404);
  }

  if (saved === "user") {
    return c.json({ error: "User not found." }, 404);
  }

  return c.json({ client: await loadClient(db, c.get("services").assets, id) });
});

clientRoutes.post("/clients/:id/contacts", requirePermission(CLIENTS_EDIT), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Client not found." }, 404);
  }

  const parsed = contactSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, id)).limit(1);

  if (!client || !(await clientIsVisible(db, c.get("user"), id))) {
    return c.json({ error: "Client not found." }, 404);
  }

  await db.insert(clientContacts).values(contactValues(id, parsed.data));
  return c.json({ client: await loadClient(db, c.get("services").assets, id) }, 201);
});

clientRoutes.patch("/clients/:id/contacts/:contactId", requirePermission(CLIENTS_EDIT), async (c) => {
  const id = parseId(c.req.param("id"));
  const contactId = parseId(c.req.param("contactId"));

  if (!id || !contactId) {
    return c.json({ error: "Contact not found." }, 404);
  }

  const parsed = contactPatchSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const [current] = await db
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.id, contactId))
    .limit(1);

  if (!current || current.clientId !== id || !(await clientIsVisible(db, c.get("user"), id))) {
    return c.json({ error: "Contact not found." }, 404);
  }

  await db
    .update(clientContacts)
    .set({
      name: parsed.data.name ?? current.name,
      role: parsed.data.role === undefined ? current.role : blankToNull(parsed.data.role),
      email: parsed.data.email === undefined ? current.email : parsed.data.email ? normalizeEmail(parsed.data.email) : null,
      telephone: parsed.data.telephone === undefined ? current.telephone : blankToNull(parsed.data.telephone),
      updatedAt: new Date(),
    })
    .where(eq(clientContacts.id, contactId));

  return c.json({ client: await loadClient(db, c.get("services").assets, id) });
});

clientRoutes.delete("/clients/:id/contacts/:contactId", requirePermission(CLIENTS_EDIT), async (c) => {
  const id = parseId(c.req.param("id"));
  const contactId = parseId(c.req.param("contactId"));

  if (!id || !contactId) {
    return c.json({ error: "Contact not found." }, 404);
  }

  const db = c.get("services").db;
  const [current] = await db.select().from(clientContacts).where(eq(clientContacts.id, contactId)).limit(1);

  if (!current || current.clientId !== id || !(await clientIsVisible(db, c.get("user"), id))) {
    return c.json({ error: "Contact not found." }, 404);
  }

  try {
    await db.delete(clientContacts).where(eq(clientContacts.id, contactId));
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return c.json({ error: "This contact is assigned to a site." }, 409);
    }

    throw error;
  }

  return c.json({ ok: true });
});

function parseId(value: string) {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function blankToNull(value: string | null | undefined) {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function contactValues(
  clientId: string,
  contact: { name: string; role?: string | null; email?: string | null; telephone?: string | null },
) {
  return {
    clientId,
    name: contact.name,
    role: blankToNull(contact.role),
    email: contact.email ? normalizeEmail(contact.email) : null,
    telephone: blankToNull(contact.telephone),
  };
}

async function listContacts(db: Database) {
  const rows = await db.select().from(clientContacts).orderBy(asc(clientContacts.name));
  const grouped = new Map<string, (typeof rows)[number][]>();

  for (const row of rows) {
    const list = grouped.get(row.clientId) ?? [];
    list.push(row);
    grouped.set(row.clientId, list);
  }

  return grouped;
}

async function loadClient(db: Database, storage: AssetStorage, id: string) {
  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);

  if (!client) {
    return null;
  }

  const contacts = await db
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.clientId, id))
    .orderBy(asc(clientContacts.name));
  const clientSites = await sitesForClient(db, id);
  const settings = await loadClientSettings(db, id);

  return presentClient(storage, client, contacts, clientSites, settings);
}

async function presentClient(
  storage: AssetStorage,
  client: typeof clients.$inferSelect,
  contacts: (typeof clientContacts.$inferSelect)[],
  clientSites?: Awaited<ReturnType<typeof sitesForClient>>,
  settings?: Awaited<ReturnType<typeof loadClientSettings>>,
) {
  return {
    id: client.id,
    name: client.name,
    logoUrl: await storage.logoUrl(client.logoKey),
    address: {
      line1: client.addressLine1,
      line2: client.addressLine2,
      city: client.city,
      county: client.county,
      postcode: client.postcode,
      country: client.country,
    },
    contacts: contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      role: contact.role,
      email: contact.email,
      telephone: contact.telephone,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    })),
    ...(clientSites !== undefined ? { sites: clientSites } : {}),
    ...(settings !== undefined ? { settings } : {}),
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

function isForeignKeyViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  if ("code" in error && error.code === "23503") {
    return true;
  }

  if ("cause" in error) {
    return isForeignKeyViolation(error.cause);
  }

  return false;
}

function imageType(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}
