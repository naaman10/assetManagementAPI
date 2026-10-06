import { asc, eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import {
  BCIS_REFS_CREATE,
  BCIS_REFS_DELETE,
  BCIS_REFS_EDIT,
  BCIS_REFS_VIEW,
  BCIS_SUB_REFS_CREATE,
  BCIS_SUB_REFS_DELETE,
  BCIS_SUB_REFS_EDIT,
  BCIS_SUB_REFS_VIEW,
  ELEMENTS_CREATE,
  ELEMENTS_DELETE,
  ELEMENTS_EDIT,
  ELEMENTS_VIEW,
  GROUPS_CREATE,
  GROUPS_DELETE,
  GROUPS_EDIT,
  GROUPS_VIEW,
  SUB_ELEMENTS_CREATE,
  SUB_ELEMENTS_DELETE,
  SUB_ELEMENTS_EDIT,
  SUB_ELEMENTS_VIEW,
} from "../auth/catalog.js";
import { requirePermission } from "../auth/middleware.js";
import { assets, bcisRefs, bcisSubRefs, elements, groups, subElements } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";

const code = z.string().trim().min(1).max(50);
const name = z.string().trim().min(1).max(255);
const description = z.string().trim().max(5000).nullable().optional();

type CatalogRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  parentId?: string;
};

type CatalogInput = {
  code: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  parentId?: string;
};

type Blocker = {
  message: string;
  exists: (db: Database, id: string) => Promise<boolean>;
};

const classificationRoutes = new Hono<AppEnv>();

mountCatalog(classificationRoutes, {
  path: "/groups",
  listKey: "groups",
  recordKey: "group",
  notFound: "Group not found.",
  permissions: { view: GROUPS_VIEW, create: GROUPS_CREATE, edit: GROUPS_EDIT, remove: GROUPS_DELETE },
  table: groups,
  blockers: [
    { message: "This group has elements.", exists: (db, id) => referenced(db, elements, elements.groupId, id) },
    { message: "This group is still used by assets.", exists: (db, id) => referenced(db, assets, assets.groupId, id) },
  ],
});

mountCatalog(classificationRoutes, {
  path: "/elements",
  listKey: "elements",
  recordKey: "element",
  notFound: "Element not found.",
  parentKey: "groupId",
  parentMissing: "Group not found.",
  parentInUse: "This element is still used by assets.",
  permissions: { view: ELEMENTS_VIEW, create: ELEMENTS_CREATE, edit: ELEMENTS_EDIT, remove: ELEMENTS_DELETE },
  table: elements,
  parentTable: groups,
  assetColumn: assets.elementId,
  blockers: [
    { message: "This element has sub elements.", exists: (db, id) => referenced(db, subElements, subElements.elementId, id) },
    { message: "This element is still used by assets.", exists: (db, id) => referenced(db, assets, assets.elementId, id) },
  ],
});

mountCatalog(classificationRoutes, {
  path: "/sub-elements",
  listKey: "subElements",
  recordKey: "subElement",
  notFound: "Sub element not found.",
  parentKey: "elementId",
  parentMissing: "Element not found.",
  parentInUse: "This sub element is still used by assets.",
  permissions: { view: SUB_ELEMENTS_VIEW, create: SUB_ELEMENTS_CREATE, edit: SUB_ELEMENTS_EDIT, remove: SUB_ELEMENTS_DELETE },
  table: subElements,
  parentTable: elements,
  assetColumn: assets.subElementId,
  blockers: [
    {
      message: "This sub element is still used by assets.",
      exists: (db, id) => referenced(db, assets, assets.subElementId, id),
    },
  ],
});

mountCatalog(classificationRoutes, {
  path: "/bcis-refs",
  listKey: "bcisRefs",
  recordKey: "bcisRef",
  notFound: "BCIS reference not found.",
  permissions: { view: BCIS_REFS_VIEW, create: BCIS_REFS_CREATE, edit: BCIS_REFS_EDIT, remove: BCIS_REFS_DELETE },
  table: bcisRefs,
  blockers: [
    {
      message: "This BCIS reference has sub references.",
      exists: (db, id) => referenced(db, bcisSubRefs, bcisSubRefs.bcisRefId, id),
    },
    {
      message: "This BCIS reference is still used by assets.",
      exists: (db, id) => referenced(db, assets, assets.bcisRefId, id),
    },
  ],
});

mountCatalog(classificationRoutes, {
  path: "/bcis-sub-refs",
  listKey: "bcisSubRefs",
  recordKey: "bcisSubRef",
  notFound: "BCIS sub reference not found.",
  parentKey: "bcisRefId",
  parentMissing: "BCIS reference not found.",
  parentInUse: "This BCIS sub reference is still used by assets.",
  permissions: {
    view: BCIS_SUB_REFS_VIEW,
    create: BCIS_SUB_REFS_CREATE,
    edit: BCIS_SUB_REFS_EDIT,
    remove: BCIS_SUB_REFS_DELETE,
  },
  table: bcisSubRefs,
  parentTable: bcisRefs,
  assetColumn: assets.bcisSubRefId,
  blockers: [
    {
      message: "This BCIS sub reference is still used by assets.",
      exists: (db, id) => referenced(db, assets, assets.bcisSubRefId, id),
    },
  ],
});

export { classificationRoutes };

function mountCatalog(
  app: Hono<AppEnv>,
  config: {
    path: string;
    listKey: string;
    recordKey: string;
    notFound: string;
    parentKey?: "groupId" | "elementId" | "bcisRefId";
    parentMissing?: string;
    parentInUse?: string;
    permissions: { view: string; create: string; edit: string; remove: string };
    table: PgTable;
    parentTable?: PgTable;
    assetColumn?: PgColumn;
    blockers: Blocker[];
  },
) {
  const createSchema = z.object({
    ...(config.parentKey ? { [config.parentKey]: z.uuid() } : {}),
    code,
    name,
    description,
    isActive: z.boolean().optional(),
  });
  const updateSchema = z
    .object({
      ...(config.parentKey ? { [config.parentKey]: z.uuid().optional() } : {}),
      code: code.optional(),
      name: name.optional(),
      description,
      isActive: z.boolean().optional(),
    })
    .refine((value) => Object.values(value).some((item) => item !== undefined), {
      message: "No changes were provided.",
    });

  app.get(config.path, requirePermission(config.permissions.view), async (c) => {
    const rows = await listRows(c.get("services").db, config.table, config.parentKey);
    return c.json({ [config.listKey]: rows.map((row) => presentCatalog(row, config.parentKey)) });
  });

  app.post(config.path, requirePermission(config.permissions.create), async (c) => {
    const parsed = createSchema.safeParse(await readBody(c));

    if (!parsed.success) {
      return invalidRequest(c, parsed.error);
    }

    const db = c.get("services").db;
    const parentId = config.parentKey ? parentValue(parsed.data, config.parentKey) : undefined;

    if (parentId && !(await parentExists(db, config, parentId))) {
      return c.json({ error: config.parentMissing }, 404);
    }

    try {
      const created = await insertRow(db, config.table, config.parentKey, {
        code: parsed.data.code,
        name: parsed.data.name,
        description: blankToNull(parsed.data.description),
        isActive: parsed.data.isActive ?? true,
        parentId,
      });
      return c.json({ [config.recordKey]: presentCatalog(created, config.parentKey) }, 201);
    } catch (error) {
      return routeError(c, error);
    }
  });

  app.get(`${config.path}/:id`, requirePermission(config.permissions.view), async (c) => {
    const id = parseId(c.req.param("id"));

    if (!id) {
      return c.json({ error: config.notFound }, 404);
    }

    const row = await findRow(c.get("services").db, config.table, id, config.parentKey);

    if (!row) {
      return c.json({ error: config.notFound }, 404);
    }

    return c.json({ [config.recordKey]: presentCatalog(row, config.parentKey) });
  });

  app.patch(`${config.path}/:id`, requirePermission(config.permissions.edit), async (c) => {
    const id = parseId(c.req.param("id"));

    if (!id) {
      return c.json({ error: config.notFound }, 404);
    }

    const parsed = updateSchema.safeParse(await readBody(c));

    if (!parsed.success) {
      return invalidRequest(c, parsed.error);
    }

    const db = c.get("services").db;
    const current = await findRow(db, config.table, id, config.parentKey);

    if (!current) {
      return c.json({ error: config.notFound }, 404);
    }

    const nextParentId = config.parentKey ? parentValue(parsed.data, config.parentKey) : undefined;

    if (config.parentKey && nextParentId && nextParentId !== current.parentId) {
      if (!(await parentExists(db, config, nextParentId))) {
        return c.json({ error: config.parentMissing }, 404);
      }

      if (config.assetColumn && (await referenced(db, assets, config.assetColumn, id))) {
        return c.json({ error: config.parentInUse }, 409);
      }
    }

    try {
      await updateRow(db, config.table, id, config.parentKey, {
        code: parsed.data.code ?? current.code,
        name: parsed.data.name ?? current.name,
        description: parsed.data.description === undefined ? current.description : blankToNull(parsed.data.description),
        isActive: parsed.data.isActive ?? current.isActive,
        parentId: nextParentId ?? current.parentId,
      });
      const updated = await findRow(db, config.table, id, config.parentKey);
      return c.json({ [config.recordKey]: presentCatalog(updated ?? current, config.parentKey) });
    } catch (error) {
      return routeError(c, error);
    }
  });

  app.delete(`${config.path}/:id`, requirePermission(config.permissions.remove), async (c) => {
    const id = parseId(c.req.param("id"));

    if (!id) {
      return c.json({ error: config.notFound }, 404);
    }

    const db = c.get("services").db;
    const current = await findRow(db, config.table, id, config.parentKey);

    if (!current) {
      return c.json({ error: config.notFound }, 404);
    }

    for (const blocker of config.blockers) {
      if (await blocker.exists(db, id)) {
        return c.json({ error: blocker.message }, 409);
      }
    }

    try {
      await db.delete(config.table).where(eq(idColumn(config.table), id));
      return c.json({ ok: true });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return c.json({ error: "This record is still in use." }, 409);
      }

      throw error;
    }
  });
}

async function listRows(db: Database, table: PgTable, parentKey?: "groupId" | "elementId" | "bcisRefId"): Promise<CatalogRow[]> {
  const rows = await db.select().from(table).orderBy(asc(codeColumn(table)));
  return rows.map((row) => readRow(row, parentKey));
}

async function findRow(
  db: Database,
  table: PgTable,
  id: string,
  parentKey?: "groupId" | "elementId" | "bcisRefId",
): Promise<CatalogRow | null> {
  const [row] = await db.select().from(table).where(eq(idColumn(table), id)).limit(1);
  return row ? readRow(row, parentKey) : null;
}

async function insertRow(
  db: Database,
  table: PgTable,
  parentKey: "groupId" | "elementId" | "bcisRefId" | undefined,
  input: CatalogInput,
): Promise<CatalogRow> {
  const values: Record<string, unknown> = {
    code: input.code,
    name: input.name,
    description: input.description ?? null,
    isActive: input.isActive ?? true,
  };

  if (parentKey && input.parentId) {
    values[parentKey] = input.parentId;
  }

  const [created] = await db.insert(table).values(values as never).returning();

  if (!created) {
    throw new Error("Catalog record was not created.");
  }

  return readRow(created, parentKey);
}

async function updateRow(
  db: Database,
  table: PgTable,
  id: string,
  parentKey: "groupId" | "elementId" | "bcisRefId" | undefined,
  input: CatalogInput,
) {
  const values: Record<string, unknown> = {
    code: input.code,
    name: input.name,
    description: input.description ?? null,
    isActive: input.isActive ?? true,
    updatedAt: new Date(),
  };

  if (parentKey && input.parentId) {
    values[parentKey] = input.parentId;
  }

  await db.update(table).set(values as never).where(eq(idColumn(table), id));
}

async function parentExists(db: Database, config: { parentTable?: PgTable }, id: string) {
  if (!config.parentTable) {
    return false;
  }

  const [row] = await db.select({ id: idColumn(config.parentTable) }).from(config.parentTable).where(eq(idColumn(config.parentTable), id)).limit(1);
  return Boolean(row);
}

async function referenced(db: Database, table: PgTable, column: PgColumn, id: string) {
  const [row] = await db.select({ id: column }).from(table).where(eq(column, id)).limit(1);
  return Boolean(row);
}

function presentCatalog(row: CatalogRow, parentKey?: "groupId" | "elementId" | "bcisRefId") {
  return {
    id: row.id,
    ...(parentKey ? { [parentKey]: row.parentId ?? null } : {}),
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function readRow(row: object, parentKey?: "groupId" | "elementId" | "bcisRefId"): CatalogRow {
  const record = row as Record<string, unknown>;
  const parentId = parentKey ? record[parentKey] : undefined;

  return {
    id: stringField(record, "id"),
    code: stringField(record, "code"),
    name: stringField(record, "name"),
    description: typeof record.description === "string" ? record.description : null,
    isActive: record.isActive === true,
    createdAt: record.createdAt instanceof Date ? record.createdAt : new Date(),
    updatedAt: record.updatedAt instanceof Date ? record.updatedAt : new Date(),
    parentId: typeof parentId === "string" ? parentId : undefined,
  };
}

function idColumn(table: PgTable) {
  return column(table, "id");
}

function codeColumn(table: PgTable) {
  return column(table, "code");
}

function column(table: PgTable, name: string) {
  const fields = table as unknown as Record<string, PgColumn>;
  const field = fields[name];

  if (!field) {
    throw new Error(`Missing ${name} column.`);
  }

  return field;
}

function parentValue(value: object, key: "groupId" | "elementId" | "bcisRefId") {
  const parentId = (value as Record<string, unknown>)[key];
  return typeof parentId === "string" ? parentId : undefined;
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (typeof value !== "string") {
    throw new Error("Catalog record could not be read.");
  }

  return value;
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
