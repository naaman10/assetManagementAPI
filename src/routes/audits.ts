import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible, clientVisibility } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import { AUDIT_STATUSES, assets, auditAssets, audits, clients, locations, sites, users } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv, AuthUser } from "../types.js";
import { invalidRequest, readBody } from "./http.js";

const title = z.string().trim().min(1).max(200);
const projectReference = z.string().trim().min(1).max(100);
const description = z.string().trim().max(5000).nullable().optional();
const optionalDate = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine((value) => value == null || value.length === 0 || isCalendarDate(value), {
    message: "Enter a date as YYYY-MM-DD.",
  });
const assetIds = z.array(z.uuid()).max(500);

const createAuditSchema = z.object({
  title,
  projectReference,
  status: z.enum(AUDIT_STATUSES).optional(),
  description,
  startDate: optionalDate,
  dueDate: optionalDate,
  leadUserId: z.uuid().nullable().optional(),
  assetIds: assetIds.optional(),
});

const updateAuditSchema = z
  .object({
    title: title.optional(),
    projectReference: projectReference.optional(),
    status: z.enum(AUDIT_STATUSES).optional(),
    description,
    startDate: optionalDate,
    dueDate: optionalDate,
    leadUserId: z.uuid().nullable().optional(),
    assetIds: assetIds.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

export const auditRoutes = new Hono<AppEnv>();

auditRoutes.get("/clients/:id/audits", requireUser, async (c) => {
  const clientId = parseId(c.req.param("id"));

  if (!clientId) {
    return c.json({ error: "Client not found." }, 404);
  }

  const db = c.get("services").db;
  const client = await visibleClient(db, c.get("user"), clientId);

  if (!client) {
    return c.json({ error: "Client not found." }, 404);
  }

  const rows = await auditsForClient(db, clientId);
  return c.json({ auditCount: rows.length, audits: rows });
});

auditRoutes.post("/clients/:id/audits", requireUser, async (c) => {
  const clientId = parseId(c.req.param("id"));

  if (!clientId) {
    return c.json({ error: "Client not found." }, 404);
  }

  const parsed = createAuditSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const client = await visibleClient(db, c.get("user"), clientId);

  if (!client) {
    return c.json({ error: "Client not found." }, 404);
  }

  const startDate = blankToNull(parsed.data.startDate);
  const dueDate = blankToNull(parsed.data.dueDate);

  if (!datesAreOrdered(startDate, dueDate)) {
    return c.json({ error: "The due date must be on or after the start date." }, 400);
  }

  const leadUserId = parsed.data.leadUserId ?? null;

  if (leadUserId && !(await userExists(db, leadUserId))) {
    return c.json({ error: "Lead not found." }, 404);
  }

  const linkedAssetIds = await assetsOnClient(db, clientId, parsed.data.assetIds ?? []);

  if (!linkedAssetIds) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const [created] = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(audits)
      .values({
        clientId,
        leadUserId,
        title: parsed.data.title,
        projectReference: parsed.data.projectReference,
        status: parsed.data.status ?? "scheduled",
        description: blankToNull(parsed.data.description),
        startDate,
        dueDate,
      })
      .returning({ id: audits.id });

    if (row && linkedAssetIds.length > 0) {
      await tx.insert(auditAssets).values(linkedAssetIds.map((assetId) => ({ auditId: row.id, assetId })));
    }

    return [row];
  });

  if (!created) {
    throw new Error("Audit was not created.");
  }

  const audit = await loadAudit(db, c.get("user"), created.id);

  if (!audit) {
    throw new Error("Audit was not created.");
  }

  return c.json({ audit }, 201);
});

auditRoutes.get("/audits", requireUser, async (c) => {
  const db = c.get("services").db;
  const rows = await auditQuery(db)
    .where(clientVisibility(db, c.get("user")))
    .orderBy(sql`${audits.dueDate} ASC NULLS LAST`, asc(audits.title));
  const listed = await presentAudits(db, rows);
  return c.json({ auditCount: listed.length, audits: listed });
});

auditRoutes.get("/audits/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Audit not found." }, 404);
  }

  const audit = await loadAudit(c.get("services").db, c.get("user"), id);

  if (!audit) {
    return c.json({ error: "Audit not found." }, 404);
  }

  return c.json({ audit });
});

auditRoutes.patch("/audits/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Audit not found." }, 404);
  }

  const parsed = updateAuditSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const current = await loadAudit(db, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Audit not found." }, 404);
  }

  const startDate = parsed.data.startDate === undefined ? current.startDate : blankToNull(parsed.data.startDate);
  const dueDate = parsed.data.dueDate === undefined ? current.dueDate : blankToNull(parsed.data.dueDate);

  if (!datesAreOrdered(startDate, dueDate)) {
    return c.json({ error: "The due date must be on or after the start date." }, 400);
  }

  const leadUserId = parsed.data.leadUserId === undefined ? current.lead?.id ?? null : parsed.data.leadUserId;

  if (leadUserId && !(await userExists(db, leadUserId))) {
    return c.json({ error: "Lead not found." }, 404);
  }

  const linkedAssetIds =
    parsed.data.assetIds === undefined ? null : await assetsOnClient(db, current.client.id, parsed.data.assetIds);

  if (parsed.data.assetIds !== undefined && !linkedAssetIds) {
    return c.json({ error: "Asset not found." }, 404);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(audits)
      .set({
        title: parsed.data.title ?? current.title,
        projectReference: parsed.data.projectReference ?? current.projectReference,
        status: parsed.data.status ?? current.status,
        description: parsed.data.description === undefined ? current.description : blankToNull(parsed.data.description),
        startDate,
        dueDate,
        leadUserId,
        updatedAt: new Date(),
      })
      .where(eq(audits.id, id));

    if (linkedAssetIds) {
      await tx.delete(auditAssets).where(eq(auditAssets.auditId, id));

      if (linkedAssetIds.length > 0) {
        await tx.insert(auditAssets).values(linkedAssetIds.map((assetId) => ({ auditId: id, assetId })));
      }
    }
  });

  return c.json({ audit: await loadAudit(db, c.get("user"), id) });
});

auditRoutes.delete("/audits/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Audit not found." }, 404);
  }

  const db = c.get("services").db;
  const current = await loadAudit(db, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Audit not found." }, 404);
  }

  await db.delete(audits).where(eq(audits.id, id));
  return c.json({ ok: true });
});

async function auditsForClient(db: Database, clientId: string) {
  const rows = await auditQuery(db).where(eq(audits.clientId, clientId)).orderBy(sql`${audits.dueDate} ASC NULLS LAST`, asc(audits.title));
  return presentAudits(db, rows);
}

async function loadAudit(db: Database, user: AuthUser, id: string) {
  const [row] = await auditQuery(db).where(eq(audits.id, id)).limit(1);

  if (!row || !(await clientIsVisible(db, user, row.clientId))) {
    return null;
  }

  const [audit] = await presentAudits(db, [row]);
  return audit ?? null;
}

function auditQuery(db: Database) {
  return db
    .select({
      id: audits.id,
      clientId: audits.clientId,
      clientName: clients.name,
      leadUserId: audits.leadUserId,
      leadEmail: users.email,
      leadName: users.name,
      title: audits.title,
      projectReference: audits.projectReference,
      status: audits.status,
      description: audits.description,
      startDate: audits.startDate,
      dueDate: audits.dueDate,
      createdAt: audits.createdAt,
      updatedAt: audits.updatedAt,
    })
    .from(audits)
    .innerJoin(clients, eq(audits.clientId, clients.id))
    .leftJoin(users, eq(audits.leadUserId, users.id));
}

async function presentAudits(db: Database, rows: AuditRow[]) {
  const ids = rows.map((row) => row.id);
  const links =
    ids.length === 0
      ? []
      : await db
          .select({
            auditId: auditAssets.auditId,
            id: assets.id,
            assetRef: assets.assetRef,
            assetName: assets.assetName,
            locationId: assets.locationId,
          })
          .from(auditAssets)
          .innerJoin(assets, eq(auditAssets.assetId, assets.id))
          .where(inArray(auditAssets.auditId, ids))
          .orderBy(asc(assets.assetRef), asc(assets.assetName));
  const assetsByAudit = new Map<string, AuditAsset[]>();

  for (const link of links) {
    const list = assetsByAudit.get(link.auditId) ?? [];
    list.push({
      id: link.id,
      assetRef: link.assetRef,
      assetName: link.assetName,
      locationId: link.locationId,
    });
    assetsByAudit.set(link.auditId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    projectReference: row.projectReference,
    status: row.status,
    description: row.description,
    startDate: row.startDate,
    dueDate: row.dueDate,
    lead: row.leadUserId && row.leadEmail ? { id: row.leadUserId, email: row.leadEmail, name: row.leadName } : null,
    client: { id: row.clientId, name: row.clientName },
    assets: assetsByAudit.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

async function visibleClient(db: Database, user: AuthUser, clientId: string) {
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1);

  if (!client || !(await clientIsVisible(db, user, clientId))) {
    return null;
  }

  return client;
}

async function userExists(db: Database, id: string) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  return Boolean(row);
}

async function assetsOnClient(db: Database, clientId: string, ids: string[]) {
  const unique = [...new Set(ids)];

  if (unique.length === 0) {
    return unique;
  }

  const rows = await db
    .select({ id: assets.id })
    .from(assets)
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .where(and(eq(sites.clientId, clientId), inArray(assets.id, unique)));

  return rows.length === unique.length ? unique : null;
}

type AuditRow = {
  id: string;
  clientId: string;
  clientName: string;
  leadUserId: string | null;
  leadEmail: string | null;
  leadName: string | null;
  title: string;
  projectReference: string;
  status: string;
  description: string | null;
  startDate: string | null;
  dueDate: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AuditAsset = {
  id: string;
  assetRef: string;
  assetName: string | null;
  locationId: string;
};

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

function datesAreOrdered(startDate: string | null, dueDate: string | null) {
  if (!startDate || !dueDate) {
    return true;
  }

  return dueDate >= startDate;
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
