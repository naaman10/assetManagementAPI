import { asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import { FREQUENCY_UNITS, assets, clients, locations, maintenanceSchedules, maintenanceTypes, sites } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv, AuthUser } from "../types.js";
import { invalidRequest, readBody } from "./http.js";

const name = z.string().trim().min(1).max(255);
const description = z.string().trim().max(5000).nullable().optional();
const frequencyValue = z.number().int().min(1).max(2_147_483_647);
const frequencyUnit = z.enum(FREQUENCY_UNITS);
const duration = z.number().int().min(0).max(2_147_483_647).nullable().optional();
const estimatedCost = z
  .number()
  .finite()
  .gte(-9_999_999_999.99)
  .lte(9_999_999_999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: "Use at most 2 decimal places.",
  })
  .nullable()
  .optional();
const calendarDate = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine((value) => value == null || value.length === 0 || isCalendarDate(value), {
    message: "Enter a date as YYYY-MM-DD.",
  });

const createScheduleSchema = z.object({
  name,
  description,
  maintenanceTypeId: z.uuid(),
  frequencyValue,
  frequencyUnit,
  autoWorkorder: z.boolean().optional(),
  startDate: calendarDate,
  lastCompletedDate: calendarDate,
  nextDueDate: calendarDate,
  estimatedDurationMinutes: duration,
  estimatedCost,
  isActive: z.boolean().optional(),
});

const updateScheduleSchema = z
  .object({
    name: name.optional(),
    description,
    maintenanceTypeId: z.uuid().optional(),
    frequencyValue: frequencyValue.optional(),
    frequencyUnit: frequencyUnit.optional(),
    autoWorkorder: z.boolean().optional(),
    startDate: calendarDate,
    lastCompletedDate: calendarDate,
    nextDueDate: calendarDate,
    estimatedDurationMinutes: duration,
    estimatedCost,
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

export const maintenanceScheduleRoutes = new Hono<AppEnv>();

maintenanceScheduleRoutes.get("/assets/:id/maintenance-schedules", requireUser, async (c) => {
  const assetId = parseId(c.req.param("id"));

  if (!assetId) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const db = c.get("services").db;
  const asset = await visibleAsset(db, c.get("user"), assetId);

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const rows = await schedulesForAsset(db, assetId);
  return c.json({ maintenanceScheduleCount: rows.length, maintenanceSchedules: rows });
});

maintenanceScheduleRoutes.post("/assets/:id/maintenance-schedules", requireUser, async (c) => {
  const assetId = parseId(c.req.param("id"));

  if (!assetId) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const parsed = createScheduleSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const user = c.get("user");
  const asset = await visibleAsset(db, user, assetId);

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  if (!(await maintenanceTypeExists(db, parsed.data.maintenanceTypeId))) {
    return c.json({ error: "Maintenance type not found." }, 404);
  }

  const [created] = await db
    .insert(maintenanceSchedules)
    .values({
      assetId,
      maintenanceTypeId: parsed.data.maintenanceTypeId,
      name: parsed.data.name,
      description: blankToNull(parsed.data.description),
      frequencyValue: parsed.data.frequencyValue,
      frequencyUnit: parsed.data.frequencyUnit,
      autoWorkorder: parsed.data.autoWorkorder ?? false,
      startDate: blankToNull(parsed.data.startDate),
      lastCompletedDate: blankToNull(parsed.data.lastCompletedDate),
      nextDueDate: blankToNull(parsed.data.nextDueDate),
      estimatedDurationMinutes: parsed.data.estimatedDurationMinutes ?? null,
      estimatedCost: parsed.data.estimatedCost ?? null,
      isActive: parsed.data.isActive ?? true,
    })
    .returning({ id: maintenanceSchedules.id });

  if (!created) {
    throw new Error("Maintenance schedule was not created.");
  }

  const schedule = await loadSchedule(db, user, created.id);

  if (!schedule) {
    throw new Error("Maintenance schedule was not created.");
  }

  return c.json({ maintenanceSchedule: schedule }, 201);
});

maintenanceScheduleRoutes.get("/maintenance-schedules/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Maintenance schedule not found." }, 404);
  }

  const schedule = await loadSchedule(c.get("services").db, c.get("user"), id);

  if (!schedule) {
    return c.json({ error: "Maintenance schedule not found." }, 404);
  }

  return c.json({ maintenanceSchedule: schedule });
});

maintenanceScheduleRoutes.patch("/maintenance-schedules/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Maintenance schedule not found." }, 404);
  }

  const parsed = updateScheduleSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const user = c.get("user");
  const current = await loadSchedule(db, user, id);

  if (!current) {
    return c.json({ error: "Maintenance schedule not found." }, 404);
  }

  if (parsed.data.maintenanceTypeId && !(await maintenanceTypeExists(db, parsed.data.maintenanceTypeId))) {
    return c.json({ error: "Maintenance type not found." }, 404);
  }

  await db
    .update(maintenanceSchedules)
    .set({
      name: parsed.data.name ?? current.name,
      description: parsed.data.description === undefined ? current.description : blankToNull(parsed.data.description),
      maintenanceTypeId: parsed.data.maintenanceTypeId ?? current.maintenanceTypeId,
      frequencyValue: parsed.data.frequencyValue ?? current.frequencyValue,
      frequencyUnit: parsed.data.frequencyUnit ?? current.frequencyUnit,
      autoWorkorder: parsed.data.autoWorkorder ?? current.autoWorkorder,
      startDate: parsed.data.startDate === undefined ? current.startDate : blankToNull(parsed.data.startDate),
      lastCompletedDate:
        parsed.data.lastCompletedDate === undefined ? current.lastCompletedDate : blankToNull(parsed.data.lastCompletedDate),
      nextDueDate: parsed.data.nextDueDate === undefined ? current.nextDueDate : blankToNull(parsed.data.nextDueDate),
      estimatedDurationMinutes:
        parsed.data.estimatedDurationMinutes === undefined ? current.estimatedDurationMinutes : parsed.data.estimatedDurationMinutes,
      estimatedCost: parsed.data.estimatedCost === undefined ? current.estimatedCost : parsed.data.estimatedCost,
      isActive: parsed.data.isActive ?? current.isActive,
      updatedAt: new Date(),
    })
    .where(eq(maintenanceSchedules.id, id));

  return c.json({ maintenanceSchedule: await loadSchedule(db, user, id) });
});

maintenanceScheduleRoutes.delete("/maintenance-schedules/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Maintenance schedule not found." }, 404);
  }

  const db = c.get("services").db;
  const current = await loadSchedule(db, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Maintenance schedule not found." }, 404);
  }

  await db.delete(maintenanceSchedules).where(eq(maintenanceSchedules.id, id));
  return c.json({ ok: true });
});

const scheduleColumns = {
  id: maintenanceSchedules.id,
  assetId: maintenanceSchedules.assetId,
  assetRef: assets.assetRef,
  assetName: assets.assetName,
  locationId: locations.id,
  siteId: locations.siteId,
  locationCode: locations.locationCode,
  locationName: locations.name,
  clientId: clients.id,
  clientName: clients.name,
  maintenanceTypeId: maintenanceSchedules.maintenanceTypeId,
  maintenanceTypeCode: maintenanceTypes.code,
  maintenanceTypeName: maintenanceTypes.name,
  name: maintenanceSchedules.name,
  description: maintenanceSchedules.description,
  frequencyValue: maintenanceSchedules.frequencyValue,
  frequencyUnit: maintenanceSchedules.frequencyUnit,
  autoWorkorder: maintenanceSchedules.autoWorkorder,
  startDate: maintenanceSchedules.startDate,
  lastCompletedDate: maintenanceSchedules.lastCompletedDate,
  nextDueDate: maintenanceSchedules.nextDueDate,
  estimatedDurationMinutes: maintenanceSchedules.estimatedDurationMinutes,
  estimatedCost: maintenanceSchedules.estimatedCost,
  isActive: maintenanceSchedules.isActive,
  createdAt: maintenanceSchedules.createdAt,
  updatedAt: maintenanceSchedules.updatedAt,
};

function scheduleQuery(db: Database) {
  return db
    .select(scheduleColumns)
    .from(maintenanceSchedules)
    .innerJoin(assets, eq(maintenanceSchedules.assetId, assets.id))
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .innerJoin(clients, eq(sites.clientId, clients.id))
    .innerJoin(maintenanceTypes, eq(maintenanceSchedules.maintenanceTypeId, maintenanceTypes.id));
}

async function schedulesForAsset(db: Database, assetId: string) {
  const rows = await scheduleQuery(db)
    .where(eq(maintenanceSchedules.assetId, assetId))
    .orderBy(sql`${maintenanceSchedules.nextDueDate} ASC NULLS LAST`, asc(maintenanceSchedules.name));

  return rows.map((row) => presentSchedule(row));
}

async function loadSchedule(db: Database, user: AuthUser, id: string) {
  const [row] = await scheduleQuery(db).where(eq(maintenanceSchedules.id, id)).limit(1);

  if (!row || !(await clientIsVisible(db, user, row.clientId))) {
    return null;
  }

  return presentSchedule(row);
}

async function visibleAsset(db: Database, user: AuthUser, assetId: string) {
  const [asset] = await db
    .select({ id: assets.id, clientId: sites.clientId })
    .from(assets)
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .where(eq(assets.id, assetId))
    .limit(1);

  if (!asset || !(await clientIsVisible(db, user, asset.clientId))) {
    return null;
  }

  return asset;
}

async function maintenanceTypeExists(db: Database, id: string) {
  const [row] = await db.select({ id: maintenanceTypes.id }).from(maintenanceTypes).where(eq(maintenanceTypes.id, id)).limit(1);
  return Boolean(row);
}

function presentSchedule(row: {
  id: string;
  assetId: string;
  assetRef: string;
  assetName: string | null;
  locationId: string;
  siteId: string;
  locationCode: string | null;
  locationName: string | null;
  clientId: string;
  clientName: string;
  maintenanceTypeId: string;
  maintenanceTypeCode: string;
  maintenanceTypeName: string;
  name: string;
  description: string | null;
  frequencyValue: number;
  frequencyUnit: string;
  autoWorkorder: boolean;
  startDate: string | null;
  lastCompletedDate: string | null;
  nextDueDate: string | null;
  estimatedDurationMinutes: number | null;
  estimatedCost: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    assetId: row.assetId,
    asset: {
      id: row.assetId,
      assetRef: row.assetRef,
      assetName: row.assetName,
      locationId: row.locationId,
    },
    location: {
      id: row.locationId,
      siteId: row.siteId,
      locationCode: row.locationCode,
      name: row.locationName,
    },
    client: {
      id: row.clientId,
      name: row.clientName,
    },
    maintenanceTypeId: row.maintenanceTypeId,
    maintenanceType: {
      id: row.maintenanceTypeId,
      code: row.maintenanceTypeCode,
      name: row.maintenanceTypeName,
    },
    name: row.name,
    description: row.description,
    frequencyValue: row.frequencyValue,
    frequencyUnit: row.frequencyUnit,
    autoWorkorder: row.autoWorkorder,
    startDate: row.startDate,
    lastCompletedDate: row.lastCompletedDate,
    nextDueDate: row.nextDueDate,
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    estimatedCost: row.estimatedCost,
    isActive: row.isActive,
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

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
