import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { activitySummary, actorDisplayName } from "./auditSummary.js";
import { CATALOG_ENTITY_PERMISSION, CLIENT_ENTITY_TYPES } from "./auditedTables.js";
import {
  assetCommentMentions,
  assetComments,
  assetTypes,
  assets,
  auditEvents,
  clientContacts,
  clientMembers,
  clientSettings,
  clients,
  elements,
  groups,
  locationPlanFeatures,
  locationPlans,
  locations,
  maintenanceHistory,
  maintenanceHistoryPhotos,
  maintenanceSchedules,
  maintenanceTypes,
  nrm3Classifications,
  permissions,
  projectAssets,
  projectMembers,
  projectTypeFieldDefinitions,
  projectTypeFields,
  projectTypes,
  projects,
  rolePermissions,
  roles,
  sites,
  subElements,
  surveyRecordPhotos,
  surveyRecordUsers,
  surveyRecords,
  userRoles,
  users,
  workOrders,
} from "./schema/index.js";
import type { AuditChanges, AuditScope } from "./schema/auditEvents.js";
import type { Database } from "./types.js";

const CURSOR_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export type AuditCursor = {
  occurredAt: string;
  id: string;
};

export type AuditAudience =
  | { kind: "client"; clientId: string }
  | { kind: "catalog" }
  | { kind: "missing" }
  | { kind: "unknown" };

export function parseAuditCursor(value: string | undefined): AuditCursor | null | undefined {
  if (value == null || value === "") return undefined;

  const match = CURSOR_PATTERN.exec(value);
  const occurredAt = match?.[1];
  const id = match?.[2];
  if (!occurredAt || !id || Number.isNaN(Date.parse(occurredAt)) || !z.uuid().safeParse(id).success) {
    return null;
  }

  return { occurredAt, id: id.toLowerCase() };
}

export async function resolveAuditAudience(
  db: Database,
  entityType: string,
  entityId: string,
): Promise<AuditAudience> {
  if (CATALOG_ENTITY_PERMISSION[entityType]) {
    const exists = (await catalogExists(db, entityType, entityId)) || (await auditEventExists(db, entityType, entityId));
    return exists ? { kind: "catalog" } : { kind: "missing" };
  }

  if (!CLIENT_ENTITY_TYPES.has(entityType as never)) {
    return { kind: "unknown" };
  }

  const liveClientId = await liveClientIdFor(db, entityType, entityId);
  if (liveClientId) return { kind: "client", clientId: liveClientId };

  const historicalClientId = await latestAuditClientId(db, entityType, entityId);
  if (historicalClientId) return { kind: "client", clientId: historicalClientId };

  return { kind: "missing" };
}

export async function listClientActivity(
  db: Database,
  clientId: string,
  options: { limit: number; cursor?: AuditCursor },
) {
  const result = await db.execute<{
    group_key: string;
    head_id: string;
    occurred_at_text: string;
  }>(sql`
    select group_key, head_id, occurred_at_text
    from (
      select
        coalesce(request_id, id) as group_key,
        (array_agg(id order by occurred_at desc, id desc))[1] as head_id,
        to_char(
          (array_agg(occurred_at order by occurred_at desc, id desc))[1] at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) as occurred_at_text,
        max(occurred_at) as occurred_at
      from audit_events
      where client_id = ${clientId}::uuid
      group by coalesce(request_id, id)
    ) grouped
    where ${
      options.cursor
        ? sql`(occurred_at, head_id) < (${options.cursor.occurredAt}::timestamptz, ${options.cursor.id}::uuid)`
        : sql`true`
    }
    order by occurred_at desc, head_id desc
    limit ${options.limit + 1}
  `);

  const heads = result.rows;
  const page = heads.slice(0, options.limit);
  const hasMore = heads.length > options.limit;
  if (page.length === 0) {
    return { activity: [], nextCursor: null };
  }

  const groupKeys = page.map((head) => head.group_key);
  const rows = await db
    .select({
      id: auditEvents.id,
      occurredAt: auditEvents.occurredAt,
      requestId: auditEvents.requestId,
      actorUserId: auditEvents.actorUserId,
      actorEmail: auditEvents.actorEmail,
      actorName: auditEvents.actorName,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      entityLabel: auditEvents.entityLabel,
      subjectType: auditEvents.subjectType,
      subjectId: auditEvents.subjectId,
      scope: auditEvents.scope,
      changes: auditEvents.changes,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.clientId, clientId),
        sql`coalesce(${auditEvents.requestId}, ${auditEvents.id}) in (${sql.join(
          groupKeys.map((key) => sql`${key}::uuid`),
          sql`, `,
        )})`,
      ),
    )
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id));

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.requestId ?? row.id;
    const list = grouped.get(key);
    if (list) list.push(row);
    else grouped.set(key, [row]);
  }

  const activity = page.flatMap((head) => {
    const events = grouped.get(head.group_key);
    if (!events || events.length === 0) return [];

    const actorSource = events[0];
    if (!actorSource) return [];

    const actor = {
      id: actorSource.actorUserId,
      email: actorSource.actorEmail,
      name: actorSource.actorName,
    };

    return [
      {
        id: head.head_id,
        requestId: events.find((event) => event.requestId)?.requestId ?? null,
        occurredAt: actorSource.occurredAt,
        actor,
        summary: activitySummary(
          actorDisplayName(actor),
          events.map((event) => ({
            id: event.id,
            occurredAt: event.occurredAt,
            action: event.action,
            entityType: event.entityType,
            entityLabel: event.entityLabel,
            changes: asChanges(event.changes),
          })),
        ),
        events: events.map((event) => ({
          id: event.id,
          occurredAt: event.occurredAt,
          action: event.action,
          entityType: event.entityType,
          entityId: event.entityId,
          entityLabel: event.entityLabel,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          scope: asScope(event.scope),
          changes: asChanges(event.changes),
        })),
      },
    ];
  });

  const last = page.at(-1);
  return {
    activity,
    nextCursor: hasMore && last ? `${last.occurred_at_text}|${last.head_id}` : null,
  };
}

export async function listEntityHistory(
  db: Database,
  entityType: string,
  entityId: string,
  options: { limit: number; cursor?: AuditCursor },
) {
  const cursorAt = sql<string>`to_char(${auditEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const rows = await db
    .select({
      id: auditEvents.id,
      occurredAt: auditEvents.occurredAt,
      cursorAt: cursorAt.as("cursor_at"),
      requestId: auditEvents.requestId,
      actorUserId: auditEvents.actorUserId,
      actorEmail: auditEvents.actorEmail,
      actorName: auditEvents.actorName,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      entityLabel: auditEvents.entityLabel,
      subjectType: auditEvents.subjectType,
      subjectId: auditEvents.subjectId,
      scope: auditEvents.scope,
      before: auditEvents.before,
      after: auditEvents.after,
      changes: auditEvents.changes,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityType, entityType),
        eq(auditEvents.entityId, entityId),
        options.cursor
          ? sql`(${auditEvents.occurredAt}, ${auditEvents.id}) < (${options.cursor.occurredAt}::timestamptz, ${options.cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(options.limit + 1);

  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  const last = page.at(-1);

  return {
    events: page.map((event) => ({
      id: event.id,
      occurredAt: event.occurredAt,
      requestId: event.requestId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      entityLabel: event.entityLabel,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      scope: asScope(event.scope),
      actor: {
        id: event.actorUserId,
        email: event.actorEmail,
        name: event.actorName,
      },
      before: event.before,
      after: event.after,
      changes: asChanges(event.changes),
    })),
    nextCursor: hasMore && last ? `${last.cursorAt}|${last.id}` : null,
  };
}

async function auditEventExists(db: Database, entityType: string, entityId: string) {
  const [row] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)))
    .limit(1);

  return Boolean(row);
}

async function latestAuditClientId(db: Database, entityType: string, entityId: string) {
  const [row] = await db
    .select({ clientId: auditEvents.clientId })
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)))
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(1);

  return row?.clientId ?? undefined;
}

async function catalogExists(db: Database, entityType: string, entityId: string) {
  switch (entityType) {
    case "asset_types":
      return uuidRowExists(db, assetTypes, entityId);
    case "groups":
      return uuidRowExists(db, groups, entityId);
    case "elements":
      return uuidRowExists(db, elements, entityId);
    case "sub_elements":
      return uuidRowExists(db, subElements, entityId);
    case "maintenance_types":
      return uuidRowExists(db, maintenanceTypes, entityId);
    case "project_types":
      return uuidRowExists(db, projectTypes, entityId);
    case "project_type_fields":
      return uuidRowExists(db, projectTypeFields, entityId);
    case "users":
      return uuidRowExists(db, users, entityId);
    case "roles":
      return uuidRowExists(db, roles, entityId);
    case "permissions":
      return uuidRowExists(db, permissions, entityId);
    case "nrm3_classifications": {
      if (!entityId) return false;
      const [row] = await db
        .select({ code: nrm3Classifications.code })
        .from(nrm3Classifications)
        .where(eq(nrm3Classifications.code, entityId))
        .limit(1);
      return Boolean(row);
    }
    case "project_type_field_definitions": {
      const pair = splitDefinition(entityId);
      if (!pair) return false;
      const [row] = await db
        .select({ source: projectTypeFieldDefinitions.source })
        .from(projectTypeFieldDefinitions)
        .where(
          and(eq(projectTypeFieldDefinitions.source, pair[0]), eq(projectTypeFieldDefinitions.fieldKey, pair[1])),
        )
        .limit(1);
      return Boolean(row);
    }
    case "user_roles": {
      const pair = splitUuidPair(entityId);
      if (!pair) return false;
      const [row] = await db
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(and(eq(userRoles.userId, pair[0]), eq(userRoles.roleId, pair[1])))
        .limit(1);
      return Boolean(row);
    }
    case "role_permissions": {
      const pair = splitUuidPair(entityId);
      if (!pair) return false;
      const [row] = await db
        .select({ roleId: rolePermissions.roleId })
        .from(rolePermissions)
        .where(and(eq(rolePermissions.roleId, pair[0]), eq(rolePermissions.permissionId, pair[1])))
        .limit(1);
      return Boolean(row);
    }
    default:
      return false;
  }
}

async function uuidRowExists(
  db: Database,
  table: typeof assetTypes | typeof groups | typeof elements | typeof subElements | typeof maintenanceTypes | typeof projectTypes | typeof projectTypeFields | typeof users | typeof roles | typeof permissions,
  entityId: string,
) {
  const id = parseUuid(entityId);
  if (!id) return false;
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  return Boolean(row);
}

async function liveClientIdFor(db: Database, entityType: string, entityId: string) {
  switch (entityType) {
    case "clients":
      return idIfExists(db, clients, entityId);
    case "client_contacts":
      return clientIdFrom(db, clientContacts, clientContacts.id, clientContacts.clientId, entityId);
    case "client_settings":
      return clientIdFrom(db, clientSettings, clientSettings.clientId, clientSettings.clientId, entityId);
    case "client_members": {
      const pair = splitUuidPair(entityId);
      if (!pair) return undefined;
      const [row] = await db
        .select({ clientId: clientMembers.clientId })
        .from(clientMembers)
        .where(and(eq(clientMembers.clientId, pair[0]), eq(clientMembers.userId, pair[1])))
        .limit(1);
      return row?.clientId;
    }
    case "sites":
      return clientIdFrom(db, sites, sites.id, sites.clientId, entityId);
    case "locations":
      return clientIdThroughLocation(db, locations.id, entityId);
    case "location_plans":
      return clientIdThroughLocation(db, locationPlans.locationId, entityId, locationPlans.id);
    case "location_plan_features":
      return clientIdThroughLocation(db, locationPlanFeatures.locationId, entityId, locationPlanFeatures.id);
    case "assets":
      return clientIdThroughAsset(db, assets.id, entityId);
    case "asset_comments":
      return clientIdThroughAsset(db, assetComments.assetId, entityId, assetComments.id);
    case "maintenance_schedules":
      return clientIdThroughAsset(db, maintenanceSchedules.assetId, entityId, maintenanceSchedules.id);
    case "work_orders":
      return clientIdThroughAsset(db, workOrders.assetId, entityId, workOrders.id);
    case "maintenance_history":
      return clientIdThroughAsset(db, maintenanceHistory.assetId, entityId, maintenanceHistory.id);
    case "asset_comment_mentions": {
      const pair = splitUuidPair(entityId);
      if (!pair) return undefined;
      const [row] = await db
        .select({ clientId: sites.clientId })
        .from(assetCommentMentions)
        .innerJoin(assetComments, eq(assetComments.id, assetCommentMentions.commentId))
        .innerJoin(assets, eq(assets.id, assetComments.assetId))
        .innerJoin(locations, eq(locations.id, assets.locationId))
        .innerJoin(sites, eq(sites.id, locations.siteId))
        .where(and(eq(assetCommentMentions.commentId, pair[0]), eq(assetCommentMentions.userId, pair[1])))
        .limit(1);
      return row?.clientId;
    }
    case "maintenance_history_photos": {
      const id = parseUuid(entityId);
      if (!id) return undefined;
      const [row] = await db
        .select({ clientId: sites.clientId })
        .from(maintenanceHistoryPhotos)
        .innerJoin(maintenanceHistory, eq(maintenanceHistory.id, maintenanceHistoryPhotos.maintenanceHistoryId))
        .innerJoin(assets, eq(assets.id, maintenanceHistory.assetId))
        .innerJoin(locations, eq(locations.id, assets.locationId))
        .innerJoin(sites, eq(sites.id, locations.siteId))
        .where(eq(maintenanceHistoryPhotos.id, id))
        .limit(1);
      return row?.clientId;
    }
    case "projects":
      return clientIdFrom(db, projects, projects.id, projects.clientId, entityId);
    case "project_members":
      return clientIdFromProjectLink(db, projectMembers.projectId, projectMembers.userId, entityId);
    case "project_assets":
      return clientIdFromProjectLink(db, projectAssets.projectId, projectAssets.assetId, entityId);
    case "survey_records": {
      const id = parseUuid(entityId);
      if (!id) return undefined;
      const [row] = await db
        .select({ clientId: projects.clientId })
        .from(surveyRecords)
        .innerJoin(projects, eq(projects.id, surveyRecords.projectId))
        .where(eq(surveyRecords.id, id))
        .limit(1);
      return row?.clientId;
    }
    case "survey_record_users": {
      const pair = splitUuidPair(entityId);
      if (!pair) return undefined;
      const [row] = await db
        .select({ clientId: projects.clientId })
        .from(surveyRecordUsers)
        .innerJoin(projects, eq(projects.id, surveyRecordUsers.projectId))
        .where(and(eq(surveyRecordUsers.surveyRecordId, pair[0]), eq(surveyRecordUsers.userId, pair[1])))
        .limit(1);
      return row?.clientId;
    }
    case "survey_record_photos": {
      const id = parseUuid(entityId);
      if (!id) return undefined;
      const [row] = await db
        .select({ clientId: projects.clientId })
        .from(surveyRecordPhotos)
        .innerJoin(surveyRecords, eq(surveyRecords.id, surveyRecordPhotos.surveyRecordId))
        .innerJoin(projects, eq(projects.id, surveyRecords.projectId))
        .where(eq(surveyRecordPhotos.id, id))
        .limit(1);
      return row?.clientId;
    }
    default:
      return undefined;
  }
}

async function idIfExists(db: Database, table: typeof clients, entityId: string) {
  const id = parseUuid(entityId);
  if (!id) return undefined;
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  return row?.id;
}

async function clientIdFrom(
  db: Database,
  table: typeof clientContacts | typeof clientSettings | typeof sites | typeof projects,
  idColumn: typeof clientContacts.id | typeof clientSettings.clientId | typeof sites.id | typeof projects.id,
  clientColumn:
    | typeof clientContacts.clientId
    | typeof clientSettings.clientId
    | typeof sites.clientId
    | typeof projects.clientId,
  entityId: string,
) {
  const id = parseUuid(entityId);
  if (!id) return undefined;
  const [row] = await db.select({ clientId: clientColumn }).from(table).where(eq(idColumn, id)).limit(1);
  return row?.clientId;
}

async function clientIdThroughLocation(
  db: Database,
  locationColumn: typeof locations.id | typeof locationPlans.locationId | typeof locationPlanFeatures.locationId,
  entityId: string,
  idColumn?: typeof locationPlans.id | typeof locationPlanFeatures.id,
) {
  const id = parseUuid(entityId);
  if (!id) return undefined;

  if (idColumn) {
    const table = idColumn === locationPlans.id ? locationPlans : locationPlanFeatures;
    const [row] = await db
      .select({ clientId: sites.clientId })
      .from(table)
      .innerJoin(locations, eq(locations.id, locationColumn))
      .innerJoin(sites, eq(sites.id, locations.siteId))
      .where(eq(idColumn, id))
      .limit(1);
    return row?.clientId;
  }

  const [row] = await db
    .select({ clientId: sites.clientId })
    .from(locations)
    .innerJoin(sites, eq(sites.id, locations.siteId))
    .where(eq(locations.id, id))
    .limit(1);
  return row?.clientId;
}

async function clientIdThroughAsset(
  db: Database,
  assetColumn:
    | typeof assets.id
    | typeof assetComments.assetId
    | typeof maintenanceSchedules.assetId
    | typeof workOrders.assetId
    | typeof maintenanceHistory.assetId,
  entityId: string,
  idColumn?: typeof assetComments.id | typeof maintenanceSchedules.id | typeof workOrders.id | typeof maintenanceHistory.id,
) {
  const id = parseUuid(entityId);
  if (!id) return undefined;

  if (!idColumn) {
    const [row] = await db
      .select({ clientId: sites.clientId })
      .from(assets)
      .innerJoin(locations, eq(locations.id, assets.locationId))
      .innerJoin(sites, eq(sites.id, locations.siteId))
      .where(eq(assets.id, id))
      .limit(1);
    return row?.clientId;
  }

  const table =
    idColumn === assetComments.id
      ? assetComments
      : idColumn === maintenanceSchedules.id
        ? maintenanceSchedules
        : idColumn === workOrders.id
          ? workOrders
          : maintenanceHistory;

  const [row] = await db
    .select({ clientId: sites.clientId })
    .from(table)
    .innerJoin(assets, eq(assets.id, assetColumn))
    .innerJoin(locations, eq(locations.id, assets.locationId))
    .innerJoin(sites, eq(sites.id, locations.siteId))
    .where(eq(idColumn, id))
    .limit(1);
  return row?.clientId;
}

async function clientIdFromProjectLink(
  db: Database,
  projectColumn: typeof projectMembers.projectId | typeof projectAssets.projectId,
  otherColumn: typeof projectMembers.userId | typeof projectAssets.assetId,
  entityId: string,
) {
  const pair = splitUuidPair(entityId);
  if (!pair) return undefined;
  const table = projectColumn === projectMembers.projectId ? projectMembers : projectAssets;
  const [row] = await db
    .select({ clientId: projects.clientId })
    .from(table)
    .innerJoin(projects, eq(projects.id, projectColumn))
    .where(and(eq(projectColumn, pair[0]), eq(otherColumn, pair[1])))
    .limit(1);
  return row?.clientId;
}

function parseUuid(value: string) {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function splitUuidPair(entityId: string): [string, string] | undefined {
  const separator = entityId.indexOf(":");
  if (separator <= 0) return undefined;
  const left = parseUuid(entityId.slice(0, separator));
  const right = parseUuid(entityId.slice(separator + 1));
  if (!left || !right) return undefined;
  return [left, right];
}

function splitDefinition(entityId: string): [string, string] | undefined {
  const separator = entityId.indexOf(":");
  if (separator <= 0 || separator === entityId.length - 1) return undefined;
  return [entityId.slice(0, separator), entityId.slice(separator + 1)];
}

function asChanges(value: unknown): AuditChanges | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as AuditChanges;
}

function asScope(value: unknown): AuditScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as AuditScope;
}
