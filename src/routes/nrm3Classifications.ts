import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  NRM3_CLASSIFICATIONS_CREATE,
  NRM3_CLASSIFICATIONS_DELETE,
  NRM3_CLASSIFICATIONS_EDIT,
  NRM3_CLASSIFICATIONS_VIEW,
} from "../auth/catalog.js";
import { requirePermission } from "../auth/middleware.js";
import { assets, nrm3Classifications } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";

const code = z.string().trim().min(1).max(100);
const name = z.string().trim().min(1).max(5000);
const level = z.number().int().min(1).max(5);
const optionalText = z.string().trim().max(5000).nullable().optional();
const sourceVersion = z.string().trim().min(1).max(100);
const sourceRow = z.number().int().min(0).max(2_147_483_647).nullable().optional();

const createSchema = z.object({
  code,
  name,
  level,
  parentCode: z.string().trim().min(1).max(100).nullable().optional(),
  maintainableAssetDescription: optionalText,
  renewalUom: optionalText,
  maintenanceUom: optionalText,
  productMaterialType: optionalText,
  workPackage: optionalText,
  sourceVersion: sourceVersion.optional(),
  sourceRow,
});

const updateSchema = z
  .object({
    name: name.optional(),
    level: level.optional(),
    parentCode: z.string().trim().min(1).max(100).nullable().optional(),
    maintainableAssetDescription: optionalText,
    renewalUom: optionalText,
    maintenanceUom: optionalText,
    productMaterialType: optionalText,
    workPackage: optionalText,
    sourceVersion: sourceVersion.optional(),
    sourceRow,
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

const listQuerySchema = z.object({
  parentCode: z.string().optional(),
  level: z.number().int().min(1).max(5).optional(),
});

export const nrm3ClassificationRoutes = new Hono<AppEnv>();

nrm3ClassificationRoutes.get("/nrm3-classifications", requirePermission(NRM3_CLASSIFICATIONS_VIEW), async (c) => {
  const levelQuery = c.req.query("level");
  const parsed = listQuerySchema.safeParse({
    parentCode: c.req.query("parentCode"),
    level: levelQuery === undefined || levelQuery === "" ? undefined : Number(levelQuery),
  });

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const filters = [];

  if (parsed.data.parentCode !== undefined) {
    if (parsed.data.parentCode === "" || parsed.data.parentCode === "null") {
      filters.push(isNull(nrm3Classifications.parentCode));
    } else {
      filters.push(eq(nrm3Classifications.parentCode, parsed.data.parentCode));
    }
  }

  if (parsed.data.level !== undefined) {
    filters.push(eq(nrm3Classifications.level, parsed.data.level));
  }

  const rows = await c
    .get("services")
    .db.select()
    .from(nrm3Classifications)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(nrm3Classifications.code));

  return c.json({ nrm3Classifications: rows.map(present) });
});

nrm3ClassificationRoutes.post("/nrm3-classifications", requirePermission(NRM3_CLASSIFICATIONS_CREATE), async (c) => {
  const parsed = createSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const parentCode = blankToNull(parsed.data.parentCode);

  if (parentCode && parentCode === parsed.data.code) {
    return c.json({ error: "A classification cannot be its own parent." }, 400);
  }

  const db = c.get("services").db;

  if (parentCode && !(await classificationExists(db, parentCode))) {
    return c.json({ error: "Parent classification not found." }, 404);
  }

  try {
    const [created] = await db
      .insert(nrm3Classifications)
      .values({
        code: parsed.data.code,
        name: parsed.data.name,
        level: parsed.data.level,
        parentCode,
        maintainableAssetDescription: blankToNull(parsed.data.maintainableAssetDescription),
        renewalUom: blankToNull(parsed.data.renewalUom),
        maintenanceUom: blankToNull(parsed.data.maintenanceUom),
        productMaterialType: blankToNull(parsed.data.productMaterialType),
        workPackage: blankToNull(parsed.data.workPackage),
        sourceVersion: parsed.data.sourceVersion ?? "2026-01",
        sourceRow: parsed.data.sourceRow ?? null,
      })
      .returning();

    if (!created) {
      throw new Error("NRM3 classification was not created.");
    }

    return c.json({ nrm3Classification: present(created) }, 201);
  } catch (error) {
    return routeError(c, error);
  }
});

nrm3ClassificationRoutes.get("/nrm3-classifications/:code", requirePermission(NRM3_CLASSIFICATIONS_VIEW), async (c) => {
  const codeValue = decodeCode(c.req.param("code"));

  if (!codeValue) {
    return c.json({ error: "NRM3 classification not found." }, 404);
  }

  const row = await loadClassification(c.get("services").db, codeValue);

  if (!row) {
    return c.json({ error: "NRM3 classification not found." }, 404);
  }

  return c.json({ nrm3Classification: row });
});

nrm3ClassificationRoutes.patch("/nrm3-classifications/:code", requirePermission(NRM3_CLASSIFICATIONS_EDIT), async (c) => {
  const codeValue = decodeCode(c.req.param("code"));

  if (!codeValue) {
    return c.json({ error: "NRM3 classification not found." }, 404);
  }

  const parsed = updateSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const current = await loadClassification(db, codeValue);

  if (!current) {
    return c.json({ error: "NRM3 classification not found." }, 404);
  }

  const nextParentCode =
    parsed.data.parentCode === undefined ? current.parentCode : blankToNull(parsed.data.parentCode);

  if (nextParentCode && nextParentCode === codeValue) {
    return c.json({ error: "A classification cannot be its own parent." }, 400);
  }

  if (nextParentCode && nextParentCode !== current.parentCode) {
    if (!(await classificationExists(db, nextParentCode))) {
      return c.json({ error: "Parent classification not found." }, 404);
    }

    if (await assetUsesClassification(db, codeValue)) {
      return c.json({ error: "This NRM3 classification is still used by assets." }, 409);
    }
  }

  try {
    await db
      .update(nrm3Classifications)
      .set({
        name: parsed.data.name ?? current.name,
        level: parsed.data.level ?? current.level,
        parentCode: nextParentCode,
        maintainableAssetDescription:
          parsed.data.maintainableAssetDescription === undefined
            ? current.maintainableAssetDescription
            : blankToNull(parsed.data.maintainableAssetDescription),
        renewalUom: parsed.data.renewalUom === undefined ? current.renewalUom : blankToNull(parsed.data.renewalUom),
        maintenanceUom:
          parsed.data.maintenanceUom === undefined ? current.maintenanceUom : blankToNull(parsed.data.maintenanceUom),
        productMaterialType:
          parsed.data.productMaterialType === undefined
            ? current.productMaterialType
            : blankToNull(parsed.data.productMaterialType),
        workPackage: parsed.data.workPackage === undefined ? current.workPackage : blankToNull(parsed.data.workPackage),
        sourceVersion: parsed.data.sourceVersion ?? current.sourceVersion,
        sourceRow: parsed.data.sourceRow === undefined ? current.sourceRow : parsed.data.sourceRow,
        updatedAt: new Date(),
      })
      .where(eq(nrm3Classifications.code, codeValue));

    return c.json({ nrm3Classification: await loadClassification(db, codeValue) });
  } catch (error) {
    return routeError(c, error);
  }
});

nrm3ClassificationRoutes.delete("/nrm3-classifications/:code", requirePermission(NRM3_CLASSIFICATIONS_DELETE), async (c) => {
  const codeValue = decodeCode(c.req.param("code"));

  if (!codeValue) {
    return c.json({ error: "NRM3 classification not found." }, 404);
  }

  const db = c.get("services").db;
  const current = await loadClassification(db, codeValue);

  if (!current) {
    return c.json({ error: "NRM3 classification not found." }, 404);
  }

  const [child] = await db
    .select({ code: nrm3Classifications.code })
    .from(nrm3Classifications)
    .where(eq(nrm3Classifications.parentCode, codeValue))
    .limit(1);

  if (child) {
    return c.json({ error: "This NRM3 classification has child classifications." }, 409);
  }

  if (await assetUsesClassification(db, codeValue)) {
    return c.json({ error: "This NRM3 classification is still used by assets." }, 409);
  }

  try {
    await db.delete(nrm3Classifications).where(eq(nrm3Classifications.code, codeValue));
    return c.json({ ok: true });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return c.json({ error: "This NRM3 classification is still in use." }, 409);
    }

    throw error;
  }
});

async function loadClassification(db: Database, codeValue: string) {
  const [row] = await db.select().from(nrm3Classifications).where(eq(nrm3Classifications.code, codeValue)).limit(1);
  return row ? present(row) : null;
}

async function classificationExists(db: Database, codeValue: string) {
  const [row] = await db.select({ code: nrm3Classifications.code }).from(nrm3Classifications).where(eq(nrm3Classifications.code, codeValue)).limit(1);
  return Boolean(row);
}

async function assetUsesClassification(db: Database, codeValue: string) {
  const [row] = await db.select({ id: assets.id }).from(assets).where(eq(assets.nrm3Code, codeValue)).limit(1);
  return Boolean(row);
}

function present(row: typeof nrm3Classifications.$inferSelect) {
  return {
    code: row.code,
    name: row.name,
    level: row.level,
    parentCode: row.parentCode,
    maintainableAssetDescription: row.maintainableAssetDescription,
    renewalUom: row.renewalUom,
    maintenanceUom: row.maintenanceUom,
    productMaterialType: row.productMaterialType,
    workPackage: row.workPackage,
    sourceVersion: row.sourceVersion,
    sourceRow: row.sourceRow,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function decodeCode(value: string) {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
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
