import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible, clientVisibility } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import {
  PROJECT_STATUSES,
  assets,
  clients,
  locations,
  projectAssets,
  projectMembers,
  projectTypes,
  projects,
  sites,
  users,
} from "../db/schema/index.js";
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
const memberIds = z.array(z.uuid()).max(500);

const createProjectSchema = z.object({
  title,
  projectReference,
  projectTypeId: z.uuid(),
  status: z.enum(PROJECT_STATUSES).optional(),
  description,
  startDate: optionalDate,
  dueDate: optionalDate,
  leadUserId: z.uuid().nullable().optional(),
  memberIds: memberIds.optional(),
  assetIds: assetIds.optional(),
});

const updateProjectSchema = z
  .object({
    title: title.optional(),
    projectReference: projectReference.optional(),
    projectTypeId: z.uuid().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    description,
    startDate: optionalDate,
    dueDate: optionalDate,
    leadUserId: z.uuid().nullable().optional(),
    memberIds: memberIds.optional(),
    assetIds: assetIds.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

export const projectRoutes = new Hono<AppEnv>();

projectRoutes.get("/clients/:id/projects", requireUser, async (c) => {
  const clientId = parseId(c.req.param("id"));

  if (!clientId) {
    return c.json({ error: "Client not found." }, 404);
  }

  const db = c.get("services").db;
  const client = await visibleClient(db, c.get("user"), clientId);

  if (!client) {
    return c.json({ error: "Client not found." }, 404);
  }

  const rows = await projectsForClient(db, clientId);
  return c.json({ projectCount: rows.length, projects: rows });
});

projectRoutes.post("/clients/:id/projects", requireUser, async (c) => {
  const clientId = parseId(c.req.param("id"));

  if (!clientId) {
    return c.json({ error: "Client not found." }, 404);
  }

  const parsed = createProjectSchema.safeParse(await readBody(c));

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

  if (!(await projectTypeExists(db, parsed.data.projectTypeId))) {
    return c.json({ error: "Project type not found." }, 404);
  }

  const leadUserId = parsed.data.leadUserId ?? null;

  if (leadUserId && !(await userExists(db, leadUserId))) {
    return c.json({ error: "Lead not found." }, 404);
  }

  const linkedMemberIds = await usersExist(db, parsed.data.memberIds ?? []);

  if (!linkedMemberIds) {
    return c.json({ error: "Member not found." }, 404);
  }

  const linkedAssetIds = await assetsOnClient(db, clientId, parsed.data.assetIds ?? []);

  if (!linkedAssetIds) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const [created] = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values({
        clientId,
        projectTypeId: parsed.data.projectTypeId,
        leadUserId,
        title: parsed.data.title,
        projectReference: parsed.data.projectReference,
        status: parsed.data.status ?? "scheduled",
        description: blankToNull(parsed.data.description),
        startDate,
        dueDate,
      })
      .returning({ id: projects.id });

    if (row && linkedMemberIds.length > 0) {
      await tx.insert(projectMembers).values(linkedMemberIds.map((userId) => ({ projectId: row.id, userId })));
    }

    if (row && linkedAssetIds.length > 0) {
      await tx.insert(projectAssets).values(linkedAssetIds.map((assetId) => ({ projectId: row.id, assetId })));
    }

    return [row];
  });

  if (!created) {
    throw new Error("Project was not created.");
  }

  const project = await loadProject(db, c.get("user"), created.id);

  if (!project) {
    throw new Error("Project was not created.");
  }

  return c.json({ project }, 201);
});

projectRoutes.get("/projects", requireUser, async (c) => {
  const db = c.get("services").db;
  const rows = await projectQuery(db)
    .where(clientVisibility(db, c.get("user")))
    .orderBy(sql`${projects.dueDate} ASC NULLS LAST`, asc(projects.title));
  const listed = await presentProjects(db, rows);
  return c.json({ projectCount: listed.length, projects: listed });
});

projectRoutes.get("/projects/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Project not found." }, 404);
  }

  const project = await loadProject(c.get("services").db, c.get("user"), id);

  if (!project) {
    return c.json({ error: "Project not found." }, 404);
  }

  return c.json({ project });
});

projectRoutes.patch("/projects/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Project not found." }, 404);
  }

  const parsed = updateProjectSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const current = await loadProject(db, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Project not found." }, 404);
  }

  const startDate = parsed.data.startDate === undefined ? current.startDate : blankToNull(parsed.data.startDate);
  const dueDate = parsed.data.dueDate === undefined ? current.dueDate : blankToNull(parsed.data.dueDate);

  if (!datesAreOrdered(startDate, dueDate)) {
    return c.json({ error: "The due date must be on or after the start date." }, 400);
  }

  if (parsed.data.projectTypeId && !(await projectTypeExists(db, parsed.data.projectTypeId))) {
    return c.json({ error: "Project type not found." }, 404);
  }

  const leadUserId = parsed.data.leadUserId === undefined ? (current.lead?.id ?? null) : parsed.data.leadUserId;

  if (leadUserId && !(await userExists(db, leadUserId))) {
    return c.json({ error: "Lead not found." }, 404);
  }

  const linkedMemberIds =
    parsed.data.memberIds === undefined ? null : await usersExist(db, parsed.data.memberIds);

  if (parsed.data.memberIds !== undefined && !linkedMemberIds) {
    return c.json({ error: "Member not found." }, 404);
  }

  const linkedAssetIds =
    parsed.data.assetIds === undefined ? null : await assetsOnClient(db, current.client.id, parsed.data.assetIds);

  if (parsed.data.assetIds !== undefined && !linkedAssetIds) {
    return c.json({ error: "Asset not found." }, 404);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({
        title: parsed.data.title ?? current.title,
        projectReference: parsed.data.projectReference ?? current.projectReference,
        projectTypeId: parsed.data.projectTypeId ?? current.projectTypeId,
        status: parsed.data.status ?? current.status,
        description: parsed.data.description === undefined ? current.description : blankToNull(parsed.data.description),
        startDate,
        dueDate,
        leadUserId,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    if (linkedMemberIds) {
      await tx.delete(projectMembers).where(eq(projectMembers.projectId, id));

      if (linkedMemberIds.length > 0) {
        await tx.insert(projectMembers).values(linkedMemberIds.map((userId) => ({ projectId: id, userId })));
      }
    }

    if (linkedAssetIds) {
      await tx.delete(projectAssets).where(eq(projectAssets.projectId, id));

      if (linkedAssetIds.length > 0) {
        await tx.insert(projectAssets).values(linkedAssetIds.map((assetId) => ({ projectId: id, assetId })));
      }
    }
  });

  return c.json({ project: await loadProject(db, c.get("user"), id) });
});

projectRoutes.delete("/projects/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Project not found." }, 404);
  }

  const db = c.get("services").db;
  const current = await loadProject(db, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Project not found." }, 404);
  }

  await db.delete(projects).where(eq(projects.id, id));
  return c.json({ ok: true });
});

async function projectsForClient(db: Database, clientId: string) {
  const rows = await projectQuery(db)
    .where(eq(projects.clientId, clientId))
    .orderBy(sql`${projects.dueDate} ASC NULLS LAST`, asc(projects.title));
  return presentProjects(db, rows);
}

async function loadProject(db: Database, user: AuthUser, id: string) {
  const [row] = await projectQuery(db).where(eq(projects.id, id)).limit(1);

  if (!row || !(await clientIsVisible(db, user, row.clientId))) {
    return null;
  }

  const [project] = await presentProjects(db, [row]);
  return project ?? null;
}

function projectQuery(db: Database) {
  return db
    .select({
      id: projects.id,
      clientId: projects.clientId,
      clientName: clients.name,
      projectTypeId: projects.projectTypeId,
      projectTypeCode: projectTypes.code,
      projectTypeName: projectTypes.name,
      leadUserId: projects.leadUserId,
      leadEmail: users.email,
      leadName: users.name,
      title: projects.title,
      projectReference: projects.projectReference,
      status: projects.status,
      description: projects.description,
      startDate: projects.startDate,
      dueDate: projects.dueDate,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(projectTypes, eq(projects.projectTypeId, projectTypes.id))
    .leftJoin(users, eq(projects.leadUserId, users.id));
}

async function presentProjects(db: Database, rows: ProjectRow[]) {
  const ids = rows.map((row) => row.id);
  const links =
    ids.length === 0
      ? []
      : await db
          .select({
            projectId: projectAssets.projectId,
            id: assets.id,
            tag: assets.tag,
            assetName: assets.assetName,
            locationId: assets.locationId,
          })
          .from(projectAssets)
          .innerJoin(assets, eq(projectAssets.assetId, assets.id))
          .where(inArray(projectAssets.projectId, ids))
          .orderBy(asc(assets.tag), asc(assets.assetName));
  const assetsByProject = new Map<string, ProjectAsset[]>();

  for (const link of links) {
    const list = assetsByProject.get(link.projectId) ?? [];
    list.push({
      id: link.id,
      tag: link.tag,
      assetName: link.assetName,
      locationId: link.locationId,
    });
    assetsByProject.set(link.projectId, list);
  }

  const memberLinks =
    ids.length === 0
      ? []
      : await db
          .select({
            projectId: projectMembers.projectId,
            id: users.id,
            email: users.email,
            name: users.name,
          })
          .from(projectMembers)
          .innerJoin(users, eq(projectMembers.userId, users.id))
          .where(inArray(projectMembers.projectId, ids))
          .orderBy(asc(users.name), asc(users.email));
  const membersByProject = new Map<string, ProjectMember[]>();

  for (const link of memberLinks) {
    const list = membersByProject.get(link.projectId) ?? [];
    list.push({
      id: link.id,
      email: link.email,
      name: link.name,
    });
    membersByProject.set(link.projectId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    projectReference: row.projectReference,
    projectTypeId: row.projectTypeId,
    projectType: {
      id: row.projectTypeId,
      code: row.projectTypeCode,
      name: row.projectTypeName,
    },
    status: row.status,
    description: row.description,
    startDate: row.startDate,
    dueDate: row.dueDate,
    lead: row.leadUserId && row.leadEmail ? { id: row.leadUserId, email: row.leadEmail, name: row.leadName } : null,
    members: membersByProject.get(row.id) ?? [],
    client: { id: row.clientId, name: row.clientName },
    assets: assetsByProject.get(row.id) ?? [],
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

async function projectTypeExists(db: Database, id: string) {
  const [row] = await db.select({ id: projectTypes.id }).from(projectTypes).where(eq(projectTypes.id, id)).limit(1);
  return Boolean(row);
}

async function userExists(db: Database, id: string) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  return Boolean(row);
}

async function usersExist(db: Database, ids: string[]) {
  const unique = [...new Set(ids)];

  if (unique.length === 0) {
    return unique;
  }

  const rows = await db.select({ id: users.id }).from(users).where(inArray(users.id, unique));
  return rows.length === unique.length ? unique : null;
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

type ProjectRow = {
  id: string;
  clientId: string;
  clientName: string;
  projectTypeId: string;
  projectTypeCode: string;
  projectTypeName: string;
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

type ProjectAsset = {
  id: string;
  tag: string;
  assetName: string | null;
  locationId: string;
};

type ProjectMember = {
  id: string;
  email: string;
  name: string | null;
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
