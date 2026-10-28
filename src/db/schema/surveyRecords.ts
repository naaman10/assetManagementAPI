import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { assets } from "./assets.js";
import { projects } from "./projects.js";
import { users } from "./users.js";

export const SURVEY_RECORD_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
  "requires_review",
  "approved",
] as const;

export const SURVEY_CONDITION_CODES = ["A", "B", "C", "D"] as const;

export const surveyRecords = pgTable(
  "survey_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 30 }).notNull().default("not_started"),
    surveyedAt: timestamp("surveyed_at", { withTimezone: true, mode: "date" }),
    conditionCode: varchar("condition_code", { length: 10 }),
    componentDescription: text("component_description"),
    estimatedAssetAgeYears: integer("estimated_asset_age_years"),
    estimatedRemainingLifeYears: integer("estimated_remaining_life_years"),
    quantityObserved: numeric("quantity_observed", { precision: 12, scale: 3, mode: "number" }),
    unitOfMeasure: varchar("unit_of_measure", { length: 30 }),
    observations: text("observations"),
    defectDetails: text("defect_details"),
    riskConsequence: integer("risk_consequence"),
    riskLikelihood: integer("risk_likelihood"),
    riskScore: integer("risk_score"),
    furtherInvestigationRequired: boolean("further_investigation_required").notNull().default(false),
    resurveyRequired: boolean("resurvey_required").notNull().default(false),
    comments: text("comments"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_survey_records_project").on(table.projectId),
    index("idx_survey_records_asset").on(table.assetId),
    index("idx_survey_records_status").on(table.status),
    unique("survey_records_project_asset_unique").on(table.projectId, table.assetId),
    unique("survey_records_id_project_unique").on(table.id, table.projectId),
    check(
      "survey_records_status_check",
      sql`${table.status} IN ('not_started', 'in_progress', 'completed', 'requires_review', 'approved')`,
    ),
    check(
      "survey_records_condition_check",
      sql`${table.conditionCode} IS NULL OR ${table.conditionCode} IN ('A', 'B', 'C', 'D')`,
    ),
    check(
      "survey_records_age_check",
      sql`${table.estimatedAssetAgeYears} IS NULL OR ${table.estimatedAssetAgeYears} >= 0`,
    ),
    check(
      "survey_records_life_check",
      sql`${table.estimatedRemainingLifeYears} IS NULL OR ${table.estimatedRemainingLifeYears} >= 0`,
    ),
    check(
      "survey_records_quantity_check",
      sql`${table.quantityObserved} IS NULL OR ${table.quantityObserved} >= 0`,
    ),
    check(
      "survey_records_risk_check",
      sql`(${table.riskConsequence} IS NULL OR ${table.riskConsequence} >= 0)
        AND (${table.riskLikelihood} IS NULL OR ${table.riskLikelihood} >= 0)
        AND (${table.riskScore} IS NULL OR ${table.riskScore} >= 0)`,
    ),
  ],
);

export const surveyRecordUsers = pgTable(
  "survey_record_users",
  {
    surveyRecordId: uuid("survey_record_id").notNull(),
    projectId: uuid("project_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.surveyRecordId, table.userId] }),
    index("survey_record_users_user_id_idx").on(table.userId),
    foreignKey({
      columns: [table.surveyRecordId, table.projectId],
      foreignColumns: [surveyRecords.id, surveyRecords.projectId],
      name: "survey_record_users_record_project_fk",
    }).onDelete("cascade"),
  ],
);
