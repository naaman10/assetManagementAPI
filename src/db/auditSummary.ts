import type { AuditChanges } from "./schema/auditEvents.js";

const HEADLINE_RANK: Record<string, number> = {
  clients: 0,
  sites: 1,
  locations: 2,
  assets: 3,
  projects: 4,
  work_orders: 5,
  survey_records: 6,
  maintenance_history: 7,
};

const ENTITY_NOUNS: Record<string, [string, string]> = {
  clients: ["client", "clients"],
  client_contacts: ["contact", "contacts"],
  client_members: ["client member", "client members"],
  client_settings: ["client settings", "client settings"],
  sites: ["site", "sites"],
  locations: ["location", "locations"],
  location_plans: ["location plan", "location plans"],
  location_plan_features: ["plan feature", "plan features"],
  assets: ["asset", "assets"],
  asset_comments: ["comment", "comments"],
  asset_comment_mentions: ["comment mention", "comment mentions"],
  projects: ["project", "projects"],
  project_assets: ["project asset", "project assets"],
  project_members: ["project member", "project members"],
  survey_records: ["survey", "surveys"],
  survey_record_users: ["survey assignee", "survey assignees"],
  survey_record_photos: ["survey photo", "survey photos"],
  maintenance_schedules: ["maintenance schedule", "maintenance schedules"],
  maintenance_history: ["maintenance record", "maintenance records"],
  maintenance_history_photos: ["maintenance photo", "maintenance photos"],
  work_orders: ["work order", "work orders"],
  asset_types: ["asset type", "asset types"],
  groups: ["group", "groups"],
  elements: ["element", "elements"],
  sub_elements: ["sub element", "sub elements"],
  nrm3_classifications: ["NRM3 classification", "NRM3 classifications"],
  maintenance_types: ["maintenance type", "maintenance types"],
  project_types: ["project type", "project types"],
  project_type_fields: ["project type field", "project type fields"],
  project_type_field_definitions: ["project type field definition", "project type field definitions"],
  users: ["user", "users"],
  user_roles: ["user role", "user roles"],
  roles: ["role", "roles"],
  role_permissions: ["role permission", "role permissions"],
  permissions: ["permission", "permissions"],
};

export type SummaryEvent = {
  id: string;
  occurredAt: Date;
  action: string;
  entityType: string;
  entityLabel: string | null;
  changes: AuditChanges | null;
};

export function actorDisplayName(actor: { name: string | null; email: string | null }) {
  const name = actor.name?.trim();
  if (name) return name;
  const email = actor.email?.trim();
  if (email) return email;
  return "Someone";
}

export function activitySummary(actorName: string, events: SummaryEvent[]) {
  const headline = pickHeadline(events);
  if (headline) return formatOne(actorName, headline);
  return formatGroup(actorName, events);
}

function pickHeadline(events: SummaryEvent[]) {
  let best: SummaryEvent | undefined;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const event of events) {
    const rank = HEADLINE_RANK[event.entityType];
    if (rank === undefined) continue;
    if (!best || rank < bestRank || (rank === bestRank && isNewer(event, best))) {
      best = event;
      bestRank = rank;
    }
  }

  return best;
}

function isNewer(event: SummaryEvent, other: SummaryEvent) {
  const difference = event.occurredAt.getTime() - other.occurredAt.getTime();
  if (difference !== 0) return difference > 0;
  return event.id > other.id;
}

function formatGroup(actorName: string, events: SummaryEvent[]) {
  const [first] = events;
  if (!first) return `${actorName} changed records`;
  if (events.length === 1) return formatOne(actorName, first);

  const sameKind = events.every((event) => event.action === first.action && event.entityType === first.entityType);
  if (!sameKind) return `${actorName} changed ${events.length} records`;

  const plural = noun(first.entityType)[1];
  const labels = events.flatMap((event) => (event.entityLabel ? [event.entityLabel] : []));
  const labelSuffix = labels.length > 0 && labels.length <= 3 ? ` · ${labels.join(", ")}` : "";
  return `${actorName} ${first.action} ${events.length} ${plural}${labelSuffix}`;
}

function formatOne(actorName: string, event: SummaryEvent) {
  const label = event.entityLabel ? ` ${event.entityLabel}` : "";
  let text = `${actorName} ${event.action} ${noun(event.entityType)[0]}${label}`;
  if (event.action !== "updated" || !event.changes) return text;

  const fields = Object.keys(event.changes);
  if (fields.length === 0) return text;

  const shown = fields.slice(0, 8);
  const extra = fields.length - shown.length;
  text += ` · ${shown.join(", ")}`;
  if (extra > 0) text += ` +${extra}`;
  return text;
}

function noun(entityType: string): [string, string] {
  return ENTITY_NOUNS[entityType] ?? [entityType, entityType];
}
