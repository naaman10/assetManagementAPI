import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { ASSET_TYPES_CREATE, ASSET_TYPES_DELETE, ASSET_TYPES_EDIT, ASSET_TYPES_VIEW } from "../auth/catalog.js";
import { requirePermission } from "../auth/middleware.js";
import { assetTypes, assets } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";

const classificationType = z.enum(["group", "system", "element", "asset", "component"]);
const code = z.string().trim().min(1).max(50);
const name = z.string().trim().min(1).max(255);
const description = z.string().trim().max(5000).nullable().optional();

const createAssetTypeSchema = z.object({
  parentId: z.uuid().nullable().optional(),
  code,
  name,
  description,
  classificationType: classificationType.optional(),
  isActive: z.boolean().optional(),
});

const updateAssetTypeSchema = z
  .object({
    parentId: z.uuid().nullable().optional(),
    code: code.optional(),
    name: name.optional(),
    description,
    classificationType: classificationType.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

export const assetTypeRoutes = new Hono<AppEnv>();

assetTypeRoutes.get("/asset-types", requirePermission(ASSET_TYPES_VIEW), async (c) => {
  const rows = await c.get("services").db.select().from(assetTypes).orderBy(asc(assetTypes.code));
  return c.json({ assetTypes: rows.map(presentAssetType) });
});

assetTypeRoutes.post("/asset-types", requirePermission(ASSET_TYPES_CREATE), async (c) => {
  const parsed = createAssetTypeSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;

  if (parsed.data.parentId && !(await assetTypeExists(db, parsed.data.parentId))) {
    return c.json({ error: "Parent asset type not found." }, 404);
  }

  try {
    const [created] = await db
      .insert(assetTypes)
      .values({
        parentId: parsed.data.parentId ?? null,
        code: parsed.data.code,
        name: parsed.data.name,
        description: blankToNull(parsed.data.description),
        classificationType: parsed.data.classificationType ?? "asset",
        isActive: parsed.data.isActive ?? true,
      })
      .returning();

    if (!created) {
      throw new Error("Asset type was not created.");
    }

    return c.json({ assetType: presentAssetType(created) }, 201);
  } catch (error) {
    return routeError(c, error);
  }
});

assetTypeRoutes.get("/asset-types/:id", requirePermission(ASSET_TYPES_VIEW), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Asset type not found." }, 404);
  }

  const assetType = await loadAssetType(c.get("services").db, id);

  if (!assetType) {
    return c.json({ error: "Asset type not found." }, 404);
  }

  return c.json({ assetType });
});

assetTypeRoutes.patch("/asset-types/:id", requirePermission(ASSET_TYPES_EDIT), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Asset type not found." }, 404);
  }

  const parsed = updateAssetTypeSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const [current] = await db.select().from(assetTypes).where(eq(assetTypes.id, id)).limit(1);

  if (!current) {
    return c.json({ error: "Asset type not found." }, 404);
  }

  if (parsed.data.parentId) {
    if (!(await assetTypeExists(db, parsed.data.parentId))) {
      return c.json({ error: "Parent asset type not found." }, 404);
    }

    if (await parentCreatesCycle(db, id, parsed.data.parentId)) {
      return c.json({ error: "An asset type cannot be nested under itself." }, 400);
    }
  }

  try {
    await db
      .update(assetTypes)
      .set({
        parentId: parsed.data.parentId === undefined ? current.parentId : parsed.data.parentId,
        code: parsed.data.code ?? current.code,
        name: parsed.data.name ?? current.name,
        description: parsed.data.description === undefined ? current.description : blankToNull(parsed.data.description),
        classificationType: parsed.data.classificationType ?? current.classificationType,
        isActive: parsed.data.isActive ?? current.isActive,
        updatedAt: new Date(),
      })
      .where(eq(assetTypes.id, id));

    return c.json({ assetType: await loadAssetType(db, id) });
  } catch (error) {
    return routeError(c, error);
  }
});

assetTypeRoutes.delete("/asset-types/:id", requirePermission(ASSET_TYPES_DELETE), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Asset type not found." }, 404);
  }

  const db = c.get("services").db;
  const [current] = await db.select({ id: assetTypes.id }).from(assetTypes).where(eq(assetTypes.id, id)).limit(1);

  if (!current) {
    return c.json({ error: "Asset type not found." }, 404);
  }

  const [child] = await db.select({ id: assetTypes.id }).from(assetTypes).where(eq(assetTypes.parentId, id)).limit(1);

  if (child) {
    return c.json({ error: "This asset type has child asset types." }, 409);
  }

  const [usedByAsset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.assetTypeId, id)).limit(1);

  if (usedByAsset) {
    return c.json({ error: "This asset type is still used by assets." }, 409);
  }

  try {
    await db.delete(assetTypes).where(eq(assetTypes.id, id));
    return c.json({ ok: true });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return c.json({ error: "This asset type is still in use." }, 409);
    }

    throw error;
  }
});

async function loadAssetType(db: Database, id: string) {
  const [row] = await db.select().from(assetTypes).where(eq(assetTypes.id, id)).limit(1);
  return row ? presentAssetType(row) : null;
}

async function assetTypeExists(db: Database, id: string) {
  const [row] = await db.select({ id: assetTypes.id }).from(assetTypes).where(eq(assetTypes.id, id)).limit(1);
  return Boolean(row);
}

async function parentCreatesCycle(db: Database, id: string, parentId: string) {
  let current: string | null = parentId;
  const seen = new Set<string>();

  while (current) {
    if (current === id || seen.has(current)) {
      return true;
    }

    seen.add(current);
    const [row] = await db.select({ parentId: assetTypes.parentId }).from(assetTypes).where(eq(assetTypes.id, current)).limit(1);
    current = row?.parentId ?? null;
  }

  return false;
}

function presentAssetType(assetType: typeof assetTypes.$inferSelect) {
  return {
    id: assetType.id,
    parentId: assetType.parentId,
    code: assetType.code,
    name: assetType.name,
    description: assetType.description,
    classificationType: assetType.classificationType,
    isActive: assetType.isActive,
    createdAt: assetType.createdAt,
    updatedAt: assetType.updatedAt,
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
