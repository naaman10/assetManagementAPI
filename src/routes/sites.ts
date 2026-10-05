import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible } from "../auth/clientAccess.js";
import { CLIENTS_CREATE, CLIENTS_EDIT, CLIENTS_VIEW } from "../auth/catalog.js";
import { requirePermission } from "../auth/middleware.js";
import { clientContacts, clients, sites } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AssetStorage } from "../storage/assets.js";
import type { AppEnv } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";
import { locationsForSite } from "./locations.js";

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

const optionalReference = z.string().trim().max(200).nullable().optional();

const createSiteSchema = z.object({
  name: z.string().trim().min(1).max(200),
  reference: optionalReference,
  address: addressSchema,
  contactId: z.uuid(),
});

const updateSiteSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    reference: optionalReference,
    address: addressPatchSchema.optional(),
    contactId: z.uuid().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.reference !== undefined ||
      value.address !== undefined ||
      value.contactId !== undefined,
    {
      message: "No changes were provided.",
    },
  );

const siteColumns = {
  id: sites.id,
  name: sites.name,
  reference: sites.reference,
  addressLine1: sites.addressLine1,
  addressLine2: sites.addressLine2,
  city: sites.city,
  county: sites.county,
  postcode: sites.postcode,
  country: sites.country,
  createdAt: sites.createdAt,
  updatedAt: sites.updatedAt,
  contactId: clientContacts.id,
  contactName: clientContacts.name,
  contactRole: clientContacts.role,
  contactEmail: clientContacts.email,
  contactTelephone: clientContacts.telephone,
};

type SiteRow = {
  id: string;
  name: string;
  reference: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  county: string | null;
  postcode: string;
  country: string;
  createdAt: Date;
  updatedAt: Date;
  contactId: string;
  contactName: string;
  contactRole: string | null;
  contactEmail: string | null;
  contactTelephone: string | null;
};

export const siteRoutes = new Hono<AppEnv>();

siteRoutes.post("/clients/:id/sites", requirePermission(CLIENTS_CREATE), async (c) => {
  const clientId = parseId(c.req.param("id"));

  if (!clientId) {
    return c.json({ error: "Client not found." }, 404);
  }

  const parsed = createSiteSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1);

  if (!client || !(await clientIsVisible(db, c.get("user"), clientId))) {
    return c.json({ error: "Client not found." }, 404);
  }

  const contact = await contactOnClient(db, clientId, parsed.data.contactId);

  if (!contact) {
    return c.json({ error: "Contact not found." }, 404);
  }

  const address = parsed.data.address;

  try {
    const [created] = await db
      .insert(sites)
      .values({
        clientId,
        contactId: parsed.data.contactId,
        name: parsed.data.name,
        reference: blankToNull(parsed.data.reference),
        addressLine1: address.line1,
        addressLine2: blankToNull(address.line2),
        city: address.city,
        county: blankToNull(address.county),
        postcode: address.postcode,
        country: address.country,
      })
      .returning({ id: sites.id });

    if (!created) {
      throw new Error("Site was not created.");
    }

    return c.json({ site: await loadSite(db, created.id) }, 201);
  } catch (error) {
    return routeError(c, error);
  }
});

siteRoutes.get("/sites/:id", requirePermission(CLIENTS_VIEW), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Site not found." }, 404);
  }

  const db = c.get("services").db;
  const [current] = await db.select({ clientId: sites.clientId }).from(sites).where(eq(sites.id, id)).limit(1);
  const site =
    current && (await clientIsVisible(db, c.get("user"), current.clientId))
      ? await loadSite(db, id, c.get("services").assets)
      : null;

  if (!site) {
    return c.json({ error: "Site not found." }, 404);
  }

  return c.json({ site });
});

siteRoutes.patch("/sites/:id", requirePermission(CLIENTS_EDIT), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Site not found." }, 404);
  }

  const parsed = updateSiteSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const [current] = await db.select().from(sites).where(eq(sites.id, id)).limit(1);

  if (!current || !(await clientIsVisible(db, c.get("user"), current.clientId))) {
    return c.json({ error: "Site not found." }, 404);
  }

  if (parsed.data.contactId) {
    const contact = await contactOnClient(db, current.clientId, parsed.data.contactId);

    if (!contact) {
      return c.json({ error: "Contact not found." }, 404);
    }
  }

  const address = parsed.data.address;

  await db
    .update(sites)
    .set({
      name: parsed.data.name ?? current.name,
      reference: parsed.data.reference === undefined ? current.reference : blankToNull(parsed.data.reference),
      contactId: parsed.data.contactId ?? current.contactId,
      addressLine1: address?.line1 ?? current.addressLine1,
      addressLine2: address?.line2 === undefined ? current.addressLine2 : blankToNull(address.line2),
      city: address?.city ?? current.city,
      county: address?.county === undefined ? current.county : blankToNull(address.county),
      postcode: address?.postcode ?? current.postcode,
      country: address?.country ?? current.country,
      updatedAt: new Date(),
    })
    .where(eq(sites.id, id));

  return c.json({ site: await loadSite(db, id, c.get("services").assets) });
});

export async function sitesForClient(db: Database, clientId: string) {
  const rows = await db
    .select(siteColumns)
    .from(sites)
    .innerJoin(clientContacts, eq(sites.contactId, clientContacts.id))
    .where(eq(sites.clientId, clientId))
    .orderBy(asc(sites.name));

  return rows.map((row) => presentSite(row));
}

async function contactOnClient(db: Database, clientId: string, contactId: string) {
  const [contact] = await db
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)))
    .limit(1);

  return contact ?? null;
}

async function loadSite(db: Database, id: string, storage?: AssetStorage) {
  const [row] = await db
    .select({
      ...siteColumns,
      clientId: clients.id,
      clientName: clients.name,
      clientReference: clients.reference,
      logoKey: clients.logoKey,
    })
    .from(sites)
    .innerJoin(clientContacts, eq(sites.contactId, clientContacts.id))
    .innerJoin(clients, eq(sites.clientId, clients.id))
    .where(eq(sites.id, id))
    .limit(1);

  if (!row) {
    return null;
  }

  const site = presentSite(row);
  const siteLocations = await locationsForSite(db, row.id);

  if (!storage) {
    return {
      id: site.id,
      name: site.name,
      reference: site.reference,
      address: site.address,
      contact: site.contact,
      locationCount: siteLocations.length,
      locations: siteLocations,
      createdAt: site.createdAt,
      updatedAt: site.updatedAt,
    };
  }

  return {
    id: site.id,
    name: site.name,
    reference: site.reference,
    address: site.address,
    contact: site.contact,
    client: {
      id: row.clientId,
      name: row.clientName,
      reference: row.clientReference,
      logoUrl: await storage.logoUrl(row.logoKey),
    },
    locationCount: siteLocations.length,
    locations: siteLocations,
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
  };
}

function presentSite(row: SiteRow) {
  return {
    id: row.id,
    name: row.name,
    reference: row.reference,
    address: {
      line1: row.addressLine1,
      line2: row.addressLine2,
      city: row.city,
      county: row.county,
      postcode: row.postcode,
      country: row.country,
    },
    contact: {
      id: row.contactId,
      name: row.contactName,
      role: row.contactRole,
      email: row.contactEmail,
      telephone: row.contactTelephone,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

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
