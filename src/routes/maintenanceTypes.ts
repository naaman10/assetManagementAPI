import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  MAINTENANCE_TYPES_CREATE,
  MAINTENANCE_TYPES_DELETE,
  MAINTENANCE_TYPES_EDIT,
  MAINTENANCE_TYPES_VIEW,
} from "../auth/catalog.js";
import { requirePermission } from "../auth/middleware.js";
import { maintenanceTypes } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";

const code = z.string().trim().min(1).max(50);
const name = z.string().trim().min(1).max(255);
const description = z.string().trim().max(5000).nullable().optional();
const sortOrder = z.number().int().min(-2_147_483_648).max(2_147_483_647);

const createMaintenanceTypeSchema = z.object({
  code,
  name,
  description,
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

const updateMaintenanceTypeSchema = z
  .object({
    code: code.optional(),
    name: name.optional(),
    description,
    sortOrder: sortOrder.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

export const maintenanceTypeRoutes = new Hono<AppEnv>();

maintenanceTypeRoutes.get("/maintenance-types", requirePermission(MAINTENANCE_TYPES_VIEW), async (c) => {
  const rows = await c
    .get("services")
    .db.select()
    .from(maintenanceTypes)
    .orderBy(asc(maintenanceTypes.sortOrder), asc(maintenanceTypes.code));
  return c.json({ maintenanceTypes: rows.map(presentMaintenanceType) });
});

maintenanceTypeRoutes.post("/maintenance-types", requirePermission(MAINTENANCE_TYPES_CREATE), async (c) => {
  const parsed = createMaintenanceTypeSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  try {
    const [created] = await c
      .get("services")
      .db.insert(maintenanceTypes)
      .values({
        code: parsed.data.code,
        name: parsed.data.name,
        description: blankToNull(parsed.data.description),
        sortOrder: parsed.data.sortOrder ?? 0,
        isActive: parsed.data.isActive ?? true,
      })
      .returning();

    if (!created) {
      throw new Error("Maintenance type was not created.");
    }

    return c.json({ maintenanceType: presentMaintenanceType(created) }, 201);
  } catch (error) {
    return routeError(c, error);
  }
});

maintenanceTypeRoutes.get("/maintenance-types/:id", requirePermission(MAINTENANCE_TYPES_VIEW), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Maintenance type not found." }, 404);
  }

  const row = await loadMaintenanceType(c.get("services").db, id);

  if (!row) {
    return c.json({ error: "Maintenance type not found." }, 404);
  }

  return c.json({ maintenanceType: row });
});

maintenanceTypeRoutes.patch("/maintenance-types/:id", requirePermission(MAINTENANCE_TYPES_EDIT), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Maintenance type not found." }, 404);
  }

  const parsed = updateMaintenanceTypeSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const current = await loadMaintenanceType(db, id);

  if (!current) {
    return c.json({ error: "Maintenance type not found." }, 404);
  }

  try {
    await db
      .update(maintenanceTypes)
      .set({
        code: parsed.data.code ?? current.code,
        name: parsed.data.name ?? current.name,
        description: parsed.data.description === undefined ? current.description : blankToNull(parsed.data.description),
        sortOrder: parsed.data.sortOrder ?? current.sortOrder,
        isActive: parsed.data.isActive ?? current.isActive,
        updatedAt: new Date(),
      })
      .where(eq(maintenanceTypes.id, id));

    return c.json({ maintenanceType: await loadMaintenanceType(db, id) });
  } catch (error) {
    return routeError(c, error);
  }
});

maintenanceTypeRoutes.delete("/maintenance-types/:id", requirePermission(MAINTENANCE_TYPES_DELETE), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Maintenance type not found." }, 404);
  }

  const db = c.get("services").db;
  const current = await loadMaintenanceType(db, id);

  if (!current) {
    return c.json({ error: "Maintenance type not found." }, 404);
  }

  try {
    await db.delete(maintenanceTypes).where(eq(maintenanceTypes.id, id));
    return c.json({ ok: true });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return c.json({ error: "This maintenance type is still in use." }, 409);
    }

    throw error;
  }
});

async function loadMaintenanceType(db: Database, id: string) {
  const [row] = await db.select().from(maintenanceTypes).where(eq(maintenanceTypes.id, id)).limit(1);
  return row ? presentMaintenanceType(row) : null;
}

function presentMaintenanceType(row: typeof maintenanceTypes.$inferSelect) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
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
