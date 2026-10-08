import { asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible, clientVisibility } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import {
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  assets,
  clients,
  locations,
  maintenanceSchedules,
  maintenanceTypes,
  sites,
  users,
  workOrders,
} from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv, AuthUser } from "../types.js";
import { invalidRequest, readBody } from "./http.js";

const title = z.string().trim().min(1).max(255);
const description = z.string().trim().max(5000).nullable().optional();
const priority = z.enum(WORK_ORDER_PRIORITIES);
const status = z.enum(WORK_ORDER_STATUSES);
const calendarDate = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine((value) => value == null || value.length === 0 || isCalendarDate(value), {
    message: "Enter a date as YYYY-MM-DD.",
  });
const completedAt = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine((value) => value == null || value.length === 0 || isTimestamp(value), {
    message: "Enter a date and time.",
  });
const optionalId = z.uuid().nullable().optional();

const createWorkOrderSchema = z.object({
  title,
  description,
  maintenanceTypeId: z.uuid(),
  scheduleId: optionalId,
  priority: priority.optional(),
  status: status.optional(),
  dueDate: calendarDate,
  scheduledDate: calendarDate,
  assignedTo: optionalId,
  completedAt,
});

const updateWorkOrderSchema = z
  .object({
    title: title.optional(),
    description,
    maintenanceTypeId: z.uuid().optional(),
    scheduleId: optionalId,
    priority: priority.optional(),
    status: status.optional(),
    dueDate: calendarDate,
    scheduledDate: calendarDate,
    assignedTo: optionalId,
    completedAt,
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

export const workOrderRoutes = new Hono<AppEnv>();

workOrderRoutes.get("/assets/:id/work-orders", requireUser, async (c) => {
  const assetId = parseId(c.req.param("id"));

  if (!assetId) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const db = c.get("services").db;
  const asset = await visibleAsset(db, c.get("user"), assetId);

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const rows = await workOrdersForAsset(db, assetId);
  return c.json({ workOrderCount: rows.length, workOrders: rows });
});

workOrderRoutes.post("/assets/:id/work-orders", requireUser, async (c) => {
  const assetId = parseId(c.req.param("id"));

  if (!assetId) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const parsed = createWorkOrderSchema.safeParse(await readBody(c));

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

  const schedule = await resolveSchedule(db, user, assetId, parsed.data.scheduleId ?? null);

  if ("error" in schedule) {
    return c.json({ error: schedule.error }, schedule.status);
  }

  const assignedTo = parsed.data.assignedTo ?? null;

  if (assignedTo && !(await userExists(db, assignedTo))) {
    return c.json({ error: "Assignee not found." }, 404);
  }

  const [created] = await db
    .insert(workOrders)
    .values({
      assetId,
      scheduleId: schedule.scheduleId,
      maintenanceTypeId: parsed.data.maintenanceTypeId,
      assignedTo,
      title: parsed.data.title,
      description: blankToNull(parsed.data.description),
      priority: parsed.data.priority ?? "medium",
      status: parsed.data.status ?? "open",
      dueDate: blankToNull(parsed.data.dueDate),
      scheduledDate: blankToNull(parsed.data.scheduledDate),
      completedAt: timestampOrNull(parsed.data.completedAt),
    })
    .returning({ id: workOrders.id });

  if (!created) {
    throw new Error("Work order was not created.");
  }

  const workOrder = await loadWorkOrder(db, user, created.id);

  if (!workOrder) {
    throw new Error("Work order was not created.");
  }

  return c.json({ workOrder }, 201);
});

workOrderRoutes.get("/work-orders", requireUser, async (c) => {
  const db = c.get("services").db;
  const rows = await workOrderQuery(db)
    .where(clientVisibility(db, c.get("user")))
    .orderBy(sql`${workOrders.dueDate} ASC NULLS LAST`, asc(workOrders.title));

  return c.json({ workOrderCount: rows.length, workOrders: rows.map((row) => presentWorkOrder(row)) });
});

workOrderRoutes.get("/work-orders/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Work order not found." }, 404);
  }

  const workOrder = await loadWorkOrder(c.get("services").db, c.get("user"), id);

  if (!workOrder) {
    return c.json({ error: "Work order not found." }, 404);
  }

  return c.json({ workOrder });
});

workOrderRoutes.patch("/work-orders/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Work order not found." }, 404);
  }

  const parsed = updateWorkOrderSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const user = c.get("user");
  const current = await loadWorkOrder(db, user, id);

  if (!current) {
    return c.json({ error: "Work order not found." }, 404);
  }

  if (parsed.data.maintenanceTypeId && !(await maintenanceTypeExists(db, parsed.data.maintenanceTypeId))) {
    return c.json({ error: "Maintenance type not found." }, 404);
  }

  const scheduleId = parsed.data.scheduleId === undefined ? current.scheduleId : parsed.data.scheduleId;
  const schedule = await resolveSchedule(db, user, current.assetId, scheduleId);

  if ("error" in schedule) {
    return c.json({ error: schedule.error }, schedule.status);
  }

  const assignedTo = parsed.data.assignedTo === undefined ? current.assignedTo : parsed.data.assignedTo;

  if (assignedTo && !(await userExists(db, assignedTo))) {
    return c.json({ error: "Assignee not found." }, 404);
  }

  await db
    .update(workOrders)
    .set({
      title: parsed.data.title ?? current.title,
      description: parsed.data.description === undefined ? current.description : blankToNull(parsed.data.description),
      maintenanceTypeId: parsed.data.maintenanceTypeId ?? current.maintenanceTypeId,
      scheduleId: schedule.scheduleId,
      assignedTo,
      priority: parsed.data.priority ?? current.priority,
      status: parsed.data.status ?? current.status,
      dueDate: parsed.data.dueDate === undefined ? current.dueDate : blankToNull(parsed.data.dueDate),
      scheduledDate: parsed.data.scheduledDate === undefined ? current.scheduledDate : blankToNull(parsed.data.scheduledDate),
      completedAt: parsed.data.completedAt === undefined ? current.completedAt : timestampOrNull(parsed.data.completedAt),
      updatedAt: new Date(),
    })
    .where(eq(workOrders.id, id));

  return c.json({ workOrder: await loadWorkOrder(db, user, id) });
});

workOrderRoutes.delete("/work-orders/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Work order not found." }, 404);
  }

  const db = c.get("services").db;
  const current = await loadWorkOrder(db, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Work order not found." }, 404);
  }

  await db.delete(workOrders).where(eq(workOrders.id, id));
  return c.json({ ok: true });
});

const workOrderColumns = {
  id: workOrders.id,
  assetId: workOrders.assetId,
  assetRef: assets.assetRef,
  assetName: assets.assetName,
  locationId: locations.id,
  siteId: locations.siteId,
  locationCode: locations.locationCode,
  locationName: locations.name,
  clientId: clients.id,
  clientName: clients.name,
  scheduleId: workOrders.scheduleId,
  scheduleName: maintenanceSchedules.name,
  maintenanceTypeId: workOrders.maintenanceTypeId,
  maintenanceTypeCode: maintenanceTypes.code,
  maintenanceTypeName: maintenanceTypes.name,
  assignedTo: workOrders.assignedTo,
  assigneeEmail: users.email,
  assigneeName: users.name,
  title: workOrders.title,
  description: workOrders.description,
  priority: workOrders.priority,
  status: workOrders.status,
  dueDate: workOrders.dueDate,
  scheduledDate: workOrders.scheduledDate,
  completedAt: workOrders.completedAt,
  createdAt: workOrders.createdAt,
  updatedAt: workOrders.updatedAt,
};

function workOrderQuery(db: Database) {
  return db
    .select(workOrderColumns)
    .from(workOrders)
    .innerJoin(assets, eq(workOrders.assetId, assets.id))
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .innerJoin(clients, eq(sites.clientId, clients.id))
    .innerJoin(maintenanceTypes, eq(workOrders.maintenanceTypeId, maintenanceTypes.id))
    .leftJoin(maintenanceSchedules, eq(workOrders.scheduleId, maintenanceSchedules.id))
    .leftJoin(users, eq(workOrders.assignedTo, users.id));
}

async function workOrdersForAsset(db: Database, assetId: string) {
  const rows = await workOrderQuery(db)
    .where(eq(workOrders.assetId, assetId))
    .orderBy(sql`${workOrders.dueDate} ASC NULLS LAST`, asc(workOrders.title));

  return rows.map((row) => presentWorkOrder(row));
}

async function loadWorkOrder(db: Database, user: AuthUser, id: string) {
  const [row] = await workOrderQuery(db).where(eq(workOrders.id, id)).limit(1);

  if (!row || !(await clientIsVisible(db, user, row.clientId))) {
    return null;
  }

  return presentWorkOrder(row);
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

async function resolveSchedule(db: Database, user: AuthUser, assetId: string, scheduleId: string | null) {
  if (!scheduleId) {
    return { scheduleId: null };
  }

  const [schedule] = await db
    .select({ id: maintenanceSchedules.id, assetId: maintenanceSchedules.assetId, clientId: sites.clientId })
    .from(maintenanceSchedules)
    .innerJoin(assets, eq(maintenanceSchedules.assetId, assets.id))
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .where(eq(maintenanceSchedules.id, scheduleId))
    .limit(1);

  if (!schedule || !(await clientIsVisible(db, user, schedule.clientId))) {
    return { status: 404 as const, error: "Maintenance schedule not found." };
  }

  if (schedule.assetId !== assetId) {
    return { status: 400 as const, error: "That maintenance schedule belongs to another asset." };
  }

  return { scheduleId: schedule.id };
}

async function maintenanceTypeExists(db: Database, id: string) {
  const [row] = await db.select({ id: maintenanceTypes.id }).from(maintenanceTypes).where(eq(maintenanceTypes.id, id)).limit(1);
  return Boolean(row);
}

async function userExists(db: Database, id: string) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  return Boolean(row);
}

function presentWorkOrder(row: {
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
  scheduleId: string | null;
  scheduleName: string | null;
  maintenanceTypeId: string;
  maintenanceTypeCode: string;
  maintenanceTypeName: string;
  assignedTo: string | null;
  assigneeEmail: string | null;
  assigneeName: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dueDate: string | null;
  scheduledDate: string | null;
  completedAt: Date | null;
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
    scheduleId: row.scheduleId,
    schedule: row.scheduleId && row.scheduleName ? { id: row.scheduleId, name: row.scheduleName } : null,
    maintenanceTypeId: row.maintenanceTypeId,
    maintenanceType: {
      id: row.maintenanceTypeId,
      code: row.maintenanceTypeCode,
      name: row.maintenanceTypeName,
    },
    assignedTo: row.assignedTo,
    assignee: row.assignedTo && row.assigneeEmail ? { id: row.assignedTo, email: row.assigneeEmail, name: row.assigneeName } : null,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    dueDate: row.dueDate,
    scheduledDate: row.scheduledDate,
    completedAt: row.completedAt,
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

function timestampOrNull(value: string | null | undefined) {
  const trimmed = blankToNull(value);
  return trimmed ? new Date(trimmed) : null;
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isTimestamp(value: string) {
  return z.iso.datetime().safeParse(value).success;
}
