import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible, clientVisibility } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import {
  PROJECT_STATUSES,
  assetTypes,
  assets,
  clients,
  locations,
  nrm3Classifications,
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

const parentAssets = alias(assets, "parent_assets");
const DOWNLOAD_SCHEMA_VERSION = 1;

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

projectRoutes.get("/projects/:id/download", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Project not found." }, 404);
  }

  const db = c.get("services").db;
  const row = await loadProjectRow(db, id);

  if (!row || !(await canDownloadProject(db, c.get("user"), row))) {
    return c.json({ error: "Project not found." }, 404);
  }

  const project = await buildProjectDownload(db, row);

  return c.json({
    downloadedAt: new Date().toISOString(),
    schemaVersion: DOWNLOAD_SCHEMA_VERSION,
    project,
  });
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

async function loadProjectRow(db: Database, id: string) {
  const [row] = await projectQuery(db).where(eq(projects.id, id)).limit(1);
  return row ?? null;
}

async function canDownloadProject(db: Database, user: AuthUser, project: { id: string; clientId: string; leadUserId: string | null }) {
  if (await clientIsVisible(db, user, project.clientId)) {
    return true;
  }

  if (project.leadUserId && project.leadUserId === user.id) {
    return true;
  }

  const [member] = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, user.id)))
    .limit(1);

  return Boolean(member);
}

async function loadProject(db: Database, user: AuthUser, id: string) {
  const row = await loadProjectRow(db, id);

  if (!row || !(await clientIsVisible(db, user, row.clientId))) {
    return null;
  }

  const [project] = await presentProjects(db, [row]);
  return project ?? null;
}

async function buildProjectDownload(db: Database, row: ProjectRow) {
  const memberRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, row.id))
    .orderBy(asc(users.name), asc(users.email));

  const linkedAssets = await db
    .select({
      id: assets.id,
      locationId: assets.locationId,
      assetTypeId: assets.assetTypeId,
      tag: assets.tag,
      assetName: assets.assetName,
      description: assets.description,
      manufacturer: assets.manufacturer,
      model: assets.model,
      serialNumber: assets.serialNumber,
      yearOfManufacture: assets.yearOfManufacture,
      quantity: assets.quantity,
      unitOfMeasure: assets.unitOfMeasure,
      installationDate: assets.installationDate,
      estimatedAgeYears: assets.estimatedAgeYears,
      expectedLifeYears: assets.expectedLifeYears,
      status: assets.status,
      createdAt: assets.createdAt,
      updatedAt: assets.updatedAt,
      nrm3Code: assets.nrm3Code,
      parentAssetId: assets.parentAssetId,
      siteId: sites.id,
      siteName: sites.name,
      siteReference: sites.reference,
      siteAddressLine1: sites.addressLine1,
      siteAddressLine2: sites.addressLine2,
      siteCity: sites.city,
      siteCounty: sites.county,
      sitePostcode: sites.postcode,
      siteCountry: sites.country,
      assetTypeCode: assetTypes.code,
      assetTypeName: assetTypes.name,
      nrm3Name: nrm3Classifications.name,
      nrm3Level: nrm3Classifications.level,
      parentAssetTag: parentAssets.tag,
      parentAssetName: parentAssets.assetName,
    })
    .from(projectAssets)
    .innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .innerJoin(assetTypes, eq(assets.assetTypeId, assetTypes.id))
    .leftJoin(nrm3Classifications, eq(assets.nrm3Code, nrm3Classifications.code))
    .leftJoin(parentAssets, eq(assets.parentAssetId, parentAssets.id))
    .where(eq(projectAssets.projectId, row.id))
    .orderBy(asc(assets.tag), asc(assets.assetName));

  const downloadAssets = linkedAssets.map((asset) => presentDownloadAsset(asset));
  const assetsById = new Map(downloadAssets.map((asset) => [asset.id, asset]));

  const siteIds = [...new Set(linkedAssets.map((asset) => asset.siteId))];
  const siteMeta = new Map<
    string,
    {
      id: string;
      name: string;
      reference: string | null;
      address: {
        line1: string;
        line2: string | null;
        city: string;
        county: string | null;
        postcode: string;
        country: string;
      };
    }
  >();

  for (const asset of linkedAssets) {
    if (!siteMeta.has(asset.siteId)) {
      siteMeta.set(asset.siteId, {
        id: asset.siteId,
        name: asset.siteName,
        reference: asset.siteReference,
        address: {
          line1: asset.siteAddressLine1,
          line2: asset.siteAddressLine2,
          city: asset.siteCity,
          county: asset.siteCounty,
          postcode: asset.sitePostcode,
          country: asset.siteCountry,
        },
      });
    }
  }

  const locationRows =
    siteIds.length === 0
      ? []
      : await db
          .select({
            id: locations.id,
            siteId: locations.siteId,
            parentLocationId: locations.parentLocationId,
            locationCode: locations.locationCode,
            name: locations.name,
            locationType: locations.locationType,
            status: locations.status,
            description: locations.description,
            department: locations.department,
            uprn: locations.uprn,
            address: locations.address,
            latitude: locations.latitude,
            longitude: locations.longitude,
          })
          .from(locations)
          .where(inArray(locations.siteId, siteIds))
          .orderBy(asc(locations.name), asc(locations.locationCode));

  const locationsById = new Map(locationRows.map((location) => [location.id, location]));
  const assetIdsByLocation = new Map<string, string[]>();

  for (const asset of linkedAssets) {
    const list = assetIdsByLocation.get(asset.locationId) ?? [];
    list.push(asset.id);
    assetIdsByLocation.set(asset.locationId, list);
  }

  const downloadSites = buildDownloadSites(siteMeta, locationsById, assetIdsByLocation, assetsById);

  return {
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
    members: memberRows.map((member) => ({
      id: member.id,
      email: member.email,
      name: member.name,
    })),
    client: { id: row.clientId, name: row.clientName },
    assets: downloadAssets,
    sites: downloadSites,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function presentDownloadAsset(asset: {
  id: string;
  locationId: string;
  assetTypeId: string;
  tag: string;
  assetName: string | null;
  description: string | null;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  yearOfManufacture: number | null;
  quantity: number | null;
  unitOfMeasure: string | null;
  installationDate: string | null;
  estimatedAgeYears: number | null;
  expectedLifeYears: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  nrm3Code: string | null;
  parentAssetId: string | null;
  assetTypeCode: string;
  assetTypeName: string;
  nrm3Name: string | null;
  nrm3Level: number | null;
  parentAssetTag: string | null;
  parentAssetName: string | null;
}): DownloadAsset {
  return {
    id: asset.id,
    locationId: asset.locationId,
    assetTypeId: asset.assetTypeId,
    assetType: {
      id: asset.assetTypeId,
      code: asset.assetTypeCode,
      name: asset.assetTypeName,
    },
    nrm3Code: asset.nrm3Code,
    nrm3Classification: nrm3Ref(asset.nrm3Code, asset.nrm3Name, asset.nrm3Level),
    parentAssetId: asset.parentAssetId,
    parentAsset: parentAssetSummary(asset.parentAssetId, asset.parentAssetTag, asset.parentAssetName),
    tag: asset.tag,
    assetName: asset.assetName,
    description: asset.description,
    manufacturer: asset.manufacturer,
    model: asset.model,
    serialNumber: asset.serialNumber,
    yearOfManufacture: asset.yearOfManufacture,
    quantity: asset.quantity,
    unitOfMeasure: asset.unitOfMeasure,
    installationDate: asset.installationDate,
    estimatedAgeYears: asset.estimatedAgeYears,
    expectedLifeYears: asset.expectedLifeYears,
    status: asset.status,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function buildDownloadSites(
  siteMeta: Map<
    string,
    {
      id: string;
      name: string;
      reference: string | null;
      address: {
        line1: string;
        line2: string | null;
        city: string;
        county: string | null;
        postcode: string;
        country: string;
      };
    }
  >,
  locationsById: Map<
    string,
    {
      id: string;
      siteId: string;
      parentLocationId: string | null;
      locationCode: string | null;
      name: string | null;
      locationType: string | null;
      status: string;
      description: string | null;
      department: string | null;
      uprn: string | null;
      address: string | null;
      latitude: number | null;
      longitude: number | null;
    }
  >,
  assetIdsByLocation: Map<string, string[]>,
  assetsById: Map<string, DownloadAsset>,
): DownloadSite[] {
  const includedLocationIds = new Set<string>();

  for (const locationId of assetIdsByLocation.keys()) {
    let currentId: string | null = locationId;
    while (currentId && !includedLocationIds.has(currentId)) {
      includedLocationIds.add(currentId);
      currentId = locationsById.get(currentId)?.parentLocationId ?? null;
    }
  }

  const nodes = new Map<string, DownloadLocationNode>();

  for (const locationId of includedLocationIds) {
    const location = locationsById.get(locationId);

    if (!location) {
      continue;
    }

    const locationAssetIds = assetIdsByLocation.get(locationId) ?? [];
    nodes.set(locationId, {
      id: location.id,
      parentLocationId: location.parentLocationId,
      locationCode: location.locationCode,
      name: location.name,
      locationType: location.locationType,
      status: location.status,
      description: location.description,
      department: location.department,
      uprn: location.uprn,
      address: location.address,
      latitude: location.latitude,
      longitude: location.longitude,
      assets: locationAssetIds.map((assetId) => assetsById.get(assetId)).filter((asset): asset is DownloadAsset => Boolean(asset)),
      locations: [],
    });
  }

  const rootsBySite = new Map<string, DownloadLocationNode[]>();

  for (const node of nodes.values()) {
    const location = locationsById.get(node.id);

    if (!location) {
      continue;
    }

    const parent = node.parentLocationId ? nodes.get(node.parentLocationId) : undefined;

    if (parent) {
      parent.locations.push(node);
      continue;
    }

    const roots = rootsBySite.get(location.siteId) ?? [];
    roots.push(node);
    rootsBySite.set(location.siteId, roots);
  }

  const sortLocationNodes = (list: DownloadLocationNode[]) => {
    list.sort((a, b) => {
      const nameCompare = (a.name ?? "").localeCompare(b.name ?? "");
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return (a.locationCode ?? "").localeCompare(b.locationCode ?? "");
    });

    for (const node of list) {
      node.assets.sort((a, b) => {
        const tagCompare = a.tag.localeCompare(b.tag);
        if (tagCompare !== 0) {
          return tagCompare;
        }
        return (a.assetName ?? "").localeCompare(b.assetName ?? "");
      });
      sortLocationNodes(node.locations);
    }
  };

  const result: DownloadSite[] = [];

  for (const site of [...siteMeta.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const roots = rootsBySite.get(site.id) ?? [];
    sortLocationNodes(roots);
    result.push({
      id: site.id,
      name: site.name,
      reference: site.reference,
      address: site.address,
      locations: roots,
    });
  }

  return result;
}

function nrm3Ref(code: string | null, name: string | null, level: number | null) {
  if (!code || !name || level == null) {
    return null;
  }

  return { code, name, level };
}

function parentAssetSummary(id: string | null, tagValue: string | null, assetName: string | null) {
  if (!id || !tagValue) {
    return null;
  }

  return { id, tag: tagValue, assetName };
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
            siteId: sites.id,
            siteName: sites.name,
            siteReference: sites.reference,
          })
          .from(projectAssets)
          .innerJoin(assets, eq(projectAssets.assetId, assets.id))
          .innerJoin(locations, eq(assets.locationId, locations.id))
          .innerJoin(sites, eq(locations.siteId, sites.id))
          .where(inArray(projectAssets.projectId, ids))
          .orderBy(asc(assets.tag), asc(assets.assetName));

  const assetsByProject = new Map<string, ProjectAsset[]>();
  const linksByProject = new Map<string, typeof links>();

  for (const link of links) {
    const assetList = assetsByProject.get(link.projectId) ?? [];
    assetList.push({
      id: link.id,
      tag: link.tag,
      assetName: link.assetName,
      locationId: link.locationId,
    });
    assetsByProject.set(link.projectId, assetList);

    const projectLinks = linksByProject.get(link.projectId) ?? [];
    projectLinks.push(link);
    linksByProject.set(link.projectId, projectLinks);
  }

  const siteIds = [...new Set(links.map((link) => link.siteId))];
  const locationRows =
    siteIds.length === 0
      ? []
      : await db
          .select({
            id: locations.id,
            siteId: locations.siteId,
            parentLocationId: locations.parentLocationId,
            locationCode: locations.locationCode,
            name: locations.name,
            locationType: locations.locationType,
            status: locations.status,
          })
          .from(locations)
          .where(inArray(locations.siteId, siteIds))
          .orderBy(asc(locations.name), asc(locations.locationCode));

  const locationsById = new Map(locationRows.map((row) => [row.id, row]));
  const sitesByProject = new Map<string, ProjectSite[]>();

  for (const [projectId, projectLinks] of linksByProject) {
    sitesByProject.set(projectId, buildProjectSites(projectLinks, locationsById));
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
    sites: sitesByProject.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

function buildProjectSites(
  projectLinks: {
    id: string;
    tag: string;
    assetName: string | null;
    locationId: string;
    siteId: string;
    siteName: string;
    siteReference: string | null;
  }[],
  locationsById: Map<
    string,
    {
      id: string;
      siteId: string;
      parentLocationId: string | null;
      locationCode: string | null;
      name: string | null;
      locationType: string | null;
      status: string;
    }
  >,
): ProjectSite[] {
  const assetsByLocation = new Map<string, ProjectSiteAsset[]>();
  const includedLocationIds = new Set<string>();
  const siteMeta = new Map<string, { id: string; name: string; reference: string | null }>();

  for (const link of projectLinks) {
    siteMeta.set(link.siteId, {
      id: link.siteId,
      name: link.siteName,
      reference: link.siteReference,
    });

    const assetList = assetsByLocation.get(link.locationId) ?? [];
    assetList.push({
      id: link.id,
      tag: link.tag,
      assetName: link.assetName,
    });
    assetsByLocation.set(link.locationId, assetList);

    let currentId: string | null = link.locationId;
    while (currentId && !includedLocationIds.has(currentId)) {
      includedLocationIds.add(currentId);
      currentId = locationsById.get(currentId)?.parentLocationId ?? null;
    }
  }

  const nodes = new Map<string, ProjectLocationNode>();

  for (const locationId of includedLocationIds) {
    const location = locationsById.get(locationId);

    if (!location) {
      continue;
    }

    nodes.set(locationId, {
      id: location.id,
      parentLocationId: location.parentLocationId,
      locationCode: location.locationCode,
      name: location.name,
      locationType: location.locationType,
      status: location.status,
      assets: assetsByLocation.get(locationId) ?? [],
      locations: [],
    });
  }

  const rootsBySite = new Map<string, ProjectLocationNode[]>();

  for (const node of nodes.values()) {
    const location = locationsById.get(node.id);

    if (!location) {
      continue;
    }

    const parentId = node.parentLocationId;
    const parent = parentId ? nodes.get(parentId) : undefined;

    if (parent) {
      parent.locations.push(node);
      continue;
    }

    const roots = rootsBySite.get(location.siteId) ?? [];
    roots.push(node);
    rootsBySite.set(location.siteId, roots);
  }

  const sortLocationNodes = (list: ProjectLocationNode[]) => {
    list.sort((a, b) => {
      const nameCompare = (a.name ?? "").localeCompare(b.name ?? "");
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return (a.locationCode ?? "").localeCompare(b.locationCode ?? "");
    });

    for (const node of list) {
      node.assets.sort((a, b) => {
        const tagCompare = a.tag.localeCompare(b.tag);
        if (tagCompare !== 0) {
          return tagCompare;
        }
        return (a.assetName ?? "").localeCompare(b.assetName ?? "");
      });
      sortLocationNodes(node.locations);
    }
  };

  const result: ProjectSite[] = [];

  for (const site of [...siteMeta.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const roots = rootsBySite.get(site.id) ?? [];
    sortLocationNodes(roots);
    result.push({
      id: site.id,
      name: site.name,
      reference: site.reference,
      locations: roots,
    });
  }

  return result;
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

type ProjectSiteAsset = {
  id: string;
  tag: string;
  assetName: string | null;
};

type ProjectLocationNode = {
  id: string;
  parentLocationId: string | null;
  locationCode: string | null;
  name: string | null;
  locationType: string | null;
  status: string;
  assets: ProjectSiteAsset[];
  locations: ProjectLocationNode[];
};

type ProjectSite = {
  id: string;
  name: string;
  reference: string | null;
  locations: ProjectLocationNode[];
};

type ProjectMember = {
  id: string;
  email: string;
  name: string | null;
};

type DownloadAsset = {
  id: string;
  locationId: string;
  assetTypeId: string;
  assetType: { id: string; code: string; name: string };
  nrm3Code: string | null;
  nrm3Classification: { code: string; name: string; level: number } | null;
  parentAssetId: string | null;
  parentAsset: { id: string; tag: string; assetName: string | null } | null;
  tag: string;
  assetName: string | null;
  description: string | null;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  yearOfManufacture: number | null;
  quantity: number | null;
  unitOfMeasure: string | null;
  installationDate: string | null;
  estimatedAgeYears: number | null;
  expectedLifeYears: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type DownloadLocationNode = {
  id: string;
  parentLocationId: string | null;
  locationCode: string | null;
  name: string | null;
  locationType: string | null;
  status: string;
  description: string | null;
  department: string | null;
  uprn: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  assets: DownloadAsset[];
  locations: DownloadLocationNode[];
};

type DownloadSite = {
  id: string;
  name: string;
  reference: string | null;
  address: {
    line1: string;
    line2: string | null;
    city: string;
    county: string | null;
    postcode: string;
    country: string;
  };
  locations: DownloadLocationNode[];
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
