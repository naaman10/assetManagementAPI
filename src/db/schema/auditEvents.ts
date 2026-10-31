import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export type AuditChange = {
  from: unknown;
  to: unknown;
};

export type AuditChanges = Record<string, AuditChange>;

export type AuditScope = {
  clientId?: string;
  siteId?: string;
  locationId?: string;
  assetId?: string;
  projectId?: string;
  subjectId?: string;
};

export const auditControl = pgTable(
  "audit_control",
  {
    id: boolean("id").primaryKey().default(true),
    enabled: boolean("enabled").notNull().default(true),
  },
  (table) => [check("audit_control_id_check", sql`${table.id} = true`)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    requestId: uuid("request_id"),
    actorUserId: uuid("actor_user_id"),
    actorEmail: text("actor_email"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    entityLabel: text("entity_label"),
    clientId: uuid("client_id"),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    scope: jsonb("scope").$type<AuditScope>().notNull().default({}),
    before: jsonb("before"),
    after: jsonb("after"),
    changes: jsonb("changes").$type<AuditChanges>(),
  },
  (table) => [
    check("audit_events_action_check", sql`${table.action} IN ('created', 'updated', 'deleted')`),
    index("audit_events_client_occurred_idx").on(table.clientId, table.occurredAt.desc(), table.id.desc()),
    index("audit_events_entity_occurred_idx").on(
      table.entityType,
      table.entityId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index("audit_events_actor_occurred_idx").on(table.actorUserId, table.occurredAt.desc()),
    index("audit_events_subject_occurred_idx").on(table.subjectType, table.subjectId, table.occurredAt.desc()),
    index("audit_events_request_idx").on(table.requestId),
    index("audit_events_scope_gin").using("gin", table.scope),
  ],
);
