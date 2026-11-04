import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { assets } from "./assets.js";
import { clients } from "./clients.js";
import { locations } from "./locations.js";
import { projectTypes } from "./projectTypes.js";
import { sites } from "./sites.js";
import { users } from "./users.js";

export const PROJECT_STATUSES = ["scheduled", "in_progress", "completed"] as const;

export const PROJECT_ASSET_REVIEW_STATUSES = ["todo", "in_progress", "done"] as const;

export const PROJECT_LOCATION_REVIEW_STATUSES = PROJECT_ASSET_REVIEW_STATUSES;

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    projectTypeId: uuid("project_type_id")
      .notNull()
      .references(() => projectTypes.id, { onDelete: "restrict" }),
    leadUserId: uuid("lead_user_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 200 }).notNull(),
    projectReference: varchar("project_reference", { length: 100 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("scheduled"),
    description: text("description"),
    startDate: date("start_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("projects_client_id_idx").on(table.clientId),
    index("projects_project_type_id_idx").on(table.projectTypeId),
    index("projects_lead_user_id_idx").on(table.leadUserId),
    check("projects_status_check", sql`${table.status} IN ('scheduled', 'in_progress', 'completed')`),
    check(
      "projects_due_date_check",
      sql`${table.dueDate} IS NULL OR ${table.startDate} IS NULL OR ${table.dueDate} >= ${table.startDate}`,
    ),
  ],
);

export const projectAssets = pgTable(
  "project_assets",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    reviewStatus: varchar("review_status", { length: 30 }).notNull().default("todo"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.assetId] }),
    index("project_assets_asset_id_idx").on(table.assetId),
    index("project_assets_project_review_status_idx").on(table.projectId, table.reviewStatus),
    check(
      "project_assets_review_status_check",
      sql`${table.reviewStatus} IN ('todo', 'in_progress', 'done')`,
    ),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("project_members_user_id_idx").on(table.userId),
  ],
);

export const projectSites = pgTable(
  "project_sites",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.siteId] }),
    index("project_sites_site_id_idx").on(table.siteId),
  ],
);

export const projectLocations = pgTable(
  "project_locations",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    reviewStatus: varchar("review_status", { length: 30 }).notNull().default("todo"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.locationId] }),
    index("project_locations_location_id_idx").on(table.locationId),
    index("project_locations_project_review_status_idx").on(table.projectId, table.reviewStatus),
    check(
      "project_locations_review_status_check",
      sql`${table.reviewStatus} IN ('todo', 'in_progress', 'done')`,
    ),
  ],
);

/** Project-scoped location snapshot — independent of the master locations row. */
export const projectLocationRecords = pgTable(
  "project_location_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    parentLocationId: uuid("parent_location_id"),
    locationCode: varchar("location_code", { length: 100 }),
    name: varchar("name", { length: 255 }),
    locationType: varchar("location_type", { length: 30 }),
    description: text("description"),
    department: varchar("department", { length: 150 }),
    uprn: varchar("uprn", { length: 12 }),
    address: text("address"),
    latitude: numeric("latitude", { precision: 10, scale: 7, mode: "number" }),
    longitude: numeric("longitude", { precision: 10, scale: 7, mode: "number" }),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("project_location_records_project_location_unique").on(table.projectId, table.locationId),
    index("project_location_records_location_id_idx").on(table.locationId),
    index("project_location_records_site_id_idx").on(table.siteId),
    check(
      "project_location_records_location_type_check",
      sql`${table.locationType} IS NULL OR ${table.locationType} IN ('building', 'floor', 'room', 'area')`,
    ),
    check(
      "project_location_records_status_check",
      sql`${table.status} IN ('active', 'inactive', 'demolished')`,
    ),
  ],
);
