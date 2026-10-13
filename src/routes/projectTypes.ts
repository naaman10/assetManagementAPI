import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { PROJECT_TYPES_CREATE, PROJECT_TYPES_DELETE, PROJECT_TYPES_EDIT, PROJECT_TYPES_VIEW } from "../auth/catalog.js";
import { requirePermission } from "../auth/middleware.js";
import { projectTypes } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";

const code = z.string().trim().min(1).max(50);
const name = z.string().trim().min(1).max(255);
const description = z.string().trim().max(5000).nullable().optional();
const sortOrder = z.number().int().min(-2_147_483_648).max(2_147_483_647);

const createProjectTypeSchema = z.object({
  code,
  name,
  description,
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

const updateProjectTypeSchema = z
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

export const projectTypeRoutes = new Hono<AppEnv>();

projectTypeRoutes.get("/project-types", requirePermission(PROJECT_TYPES_VIEW), async (c) => {
  const rows = await c
    .get("services")
    .db.select()
    .from(projectTypes)
    .orderBy(asc(projectTypes.sortOrder), asc(projectTypes.code));
  return c.json({ projectTypes: rows.map(presentProjectType) });
});

projectTypeRoutes.post("/project-types", requirePermission(PROJECT_TYPES_CREATE), async (c) => {
  const parsed = createProjectTypeSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  try {
    const [created] = await c
      .get("services")
      .db.insert(projectTypes)
      .values({
        code: parsed.data.code,
        name: parsed.data.name,
        description: blankToNull(parsed.data.description),
        sortOrder: parsed.data.sortOrder ?? 0,
        isActive: parsed.data.isActive ?? true,
      })
      .returning();

    if (!created) {
      throw new Error("Project type was not created.");
    }

    return c.json({ projectType: presentProjectType(created) }, 201);
  } catch (error) {
    return routeError(c, error);
  }
});

projectTypeRoutes.get("/project-types/:id", requirePermission(PROJECT_TYPES_VIEW), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Project type not found." }, 404);
  }

  const row = await loadProjectType(c.get("services").db, id);

  if (!row) {
    return c.json({ error: "Project type not found." }, 404);
  }

  return c.json({ projectType: row });
});

projectTypeRoutes.patch("/project-types/:id", requirePermission(PROJECT_TYPES_EDIT), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Project type not found." }, 404);
  }

  const parsed = updateProjectTypeSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const current = await loadProjectType(db, id);

  if (!current) {
    return c.json({ error: "Project type not found." }, 404);
  }

  try {
    await db
      .update(projectTypes)
      .set({
        code: parsed.data.code ?? current.code,
        name: parsed.data.name ?? current.name,
        description: parsed.data.description === undefined ? current.description : blankToNull(parsed.data.description),
        sortOrder: parsed.data.sortOrder ?? current.sortOrder,
        isActive: parsed.data.isActive ?? current.isActive,
        updatedAt: new Date(),
      })
      .where(eq(projectTypes.id, id));

    return c.json({ projectType: await loadProjectType(db, id) });
  } catch (error) {
    return routeError(c, error);
  }
});

projectTypeRoutes.delete("/project-types/:id", requirePermission(PROJECT_TYPES_DELETE), async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Project type not found." }, 404);
  }

  const db = c.get("services").db;
  const current = await loadProjectType(db, id);

  if (!current) {
    return c.json({ error: "Project type not found." }, 404);
  }

  await db.delete(projectTypes).where(eq(projectTypes.id, id));
  return c.json({ ok: true });
});

async function loadProjectType(db: Database, id: string) {
  const [row] = await db.select().from(projectTypes).where(eq(projectTypes.id, id)).limit(1);
  return row ? presentProjectType(row) : null;
}

function presentProjectType(row: typeof projectTypes.$inferSelect) {
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
