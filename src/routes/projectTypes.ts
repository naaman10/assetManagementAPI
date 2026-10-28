import { asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { PROJECT_TYPES_CREATE, PROJECT_TYPES_DELETE, PROJECT_TYPES_EDIT, PROJECT_TYPES_VIEW } from "../auth/catalog.js";
import { requirePermission } from "../auth/middleware.js";
import {
  PROJECT_TYPE_FIELD_DEFINITIONS,
  PROJECT_TYPE_FIELD_SOURCES,
  catalogKey,
  type ProjectTypeFieldSource,
} from "../db/projectTypeFieldCatalog.js";
import { projectTypeFields, projectTypes, projects } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";

const code = z.string().trim().min(1).max(50);
const name = z.string().trim().min(1).max(255);
const description = z.string().trim().max(5000).nullable().optional();
const sortOrder = z.number().int().min(-2_147_483_648).max(2_147_483_647);

const fieldSource = z.enum(PROJECT_TYPE_FIELD_SOURCES);
const configuredFieldSchema = z.object({
  source: fieldSource,
  key: z.string().trim().min(1).max(100),
  sortOrder: z.number().int().optional(),
});

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
    fields: z.array(configuredFieldSchema).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

const catalogByKey = new Map(
  PROJECT_TYPE_FIELD_DEFINITIONS.map((definition) => [
    catalogKey(definition.source, definition.fieldKey),
    definition,
  ]),
);

export const projectTypeRoutes = new Hono<AppEnv>();

projectTypeRoutes.get("/project-type-field-catalog", requirePermission(PROJECT_TYPES_VIEW), async (c) => {
  return c.json({
    fields: PROJECT_TYPE_FIELD_DEFINITIONS.map((definition) => ({
      source: definition.source,
      key: definition.fieldKey,
      label: definition.label,
      description: definition.description,
    })),
  });
});

projectTypeRoutes.get("/project-types", requirePermission(PROJECT_TYPES_VIEW), async (c) => {
  const db = c.get("services").db;
  const rows = await db.select().from(projectTypes).orderBy(asc(projectTypes.sortOrder), asc(projectTypes.code));
  const fieldsByTypeId = await loadFieldsByProjectTypeIds(
    db,
    rows.map((row) => row.id),
  );
  return c.json({
    projectTypes: rows.map((row) => presentProjectType(row, fieldsByTypeId.get(row.id) ?? [])),
  });
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

    return c.json({ projectType: presentProjectType(created, []) }, 201);
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

  if (parsed.data.fields !== undefined) {
    const fieldErrors = validateConfiguredFields(parsed.data.fields);

    if (fieldErrors) {
      return c.json({ error: "Invalid request", details: { fields: fieldErrors } }, 400);
    }
  }

  try {
    await db.transaction(async (tx) => {
      const hasMetadataChange =
        parsed.data.code !== undefined ||
        parsed.data.name !== undefined ||
        parsed.data.description !== undefined ||
        parsed.data.sortOrder !== undefined ||
        parsed.data.isActive !== undefined;

      if (hasMetadataChange) {
        await tx
          .update(projectTypes)
          .set({
            code: parsed.data.code ?? current.code,
            name: parsed.data.name ?? current.name,
            description:
              parsed.data.description === undefined ? current.description : blankToNull(parsed.data.description),
            sortOrder: parsed.data.sortOrder ?? current.sortOrder,
            isActive: parsed.data.isActive ?? current.isActive,
            updatedAt: new Date(),
          })
          .where(eq(projectTypes.id, id));
      } else if (parsed.data.fields !== undefined) {
        await tx.update(projectTypes).set({ updatedAt: new Date() }).where(eq(projectTypes.id, id));
      }

      if (parsed.data.fields !== undefined) {
        await tx.delete(projectTypeFields).where(eq(projectTypeFields.projectTypeId, id));

        if (parsed.data.fields.length > 0) {
          await tx.insert(projectTypeFields).values(
            parsed.data.fields.map((field, index) => ({
              projectTypeId: id,
              source: field.source,
              fieldKey: field.key,
              sortOrder: index,
            })),
          );
        }
      }
    });

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

  const [usedByProject] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.projectTypeId, id))
    .limit(1);

  if (usedByProject) {
    return c.json({ error: "This project type is still used by projects." }, 409);
  }

  try {
    await db.delete(projectTypes).where(eq(projectTypes.id, id));
    return c.json({ ok: true });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return c.json({ error: "This project type is still in use." }, 409);
    }

    throw error;
  }
});

async function loadProjectType(db: Database, id: string) {
  const [row] = await db.select().from(projectTypes).where(eq(projectTypes.id, id)).limit(1);

  if (!row) {
    return null;
  }

  const fieldsByTypeId = await loadFieldsByProjectTypeIds(db, [id]);
  return presentProjectType(row, fieldsByTypeId.get(id) ?? []);
}

async function loadFieldsByProjectTypeIds(db: Database, projectTypeIds: string[]) {
  const fieldsByTypeId = new Map<string, PresentProjectTypeField[]>();

  for (const projectTypeId of projectTypeIds) {
    fieldsByTypeId.set(projectTypeId, []);
  }

  if (projectTypeIds.length === 0) {
    return fieldsByTypeId;
  }

  const rows = await db
    .select()
    .from(projectTypeFields)
    .where(inArray(projectTypeFields.projectTypeId, projectTypeIds))
    .orderBy(asc(projectTypeFields.sortOrder), asc(projectTypeFields.fieldKey));

  for (const row of rows) {
    const list = fieldsByTypeId.get(row.projectTypeId) ?? [];
    list.push(presentConfiguredField(row));
    fieldsByTypeId.set(row.projectTypeId, list);
  }

  return fieldsByTypeId;
}

type PresentProjectTypeField = {
  source: string;
  key: string;
  label: string;
  sortOrder: number;
};

function presentConfiguredField(row: typeof projectTypeFields.$inferSelect): PresentProjectTypeField {
  const definition = catalogByKey.get(catalogKey(row.source, row.fieldKey));
  return {
    source: row.source,
    key: row.fieldKey,
    label: definition?.label ?? row.fieldKey,
    sortOrder: row.sortOrder,
  };
}

function presentProjectType(row: typeof projectTypes.$inferSelect, fields: PresentProjectTypeField[]) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    fields,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validateConfiguredFields(fields: Array<{ source: ProjectTypeFieldSource; key: string }>) {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    const key = catalogKey(field.source, field.key);

    if (seen.has(key)) {
      errors.push(`Duplicate field ${field.source}.${field.key}.`);
      continue;
    }

    seen.add(key);

    if (!catalogByKey.has(key)) {
      errors.push(`Unknown field ${field.source}.${field.key}.`);
    }
  }

  return errors.length > 0 ? errors : null;
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
