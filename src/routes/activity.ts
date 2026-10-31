import { Hono } from "hono";
import { z } from "zod";
import { CLIENTS_VIEW } from "../auth/catalog.js";
import { clientIsVisible, isAdmin } from "../auth/clientAccess.js";
import { requirePermission, requireUser } from "../auth/middleware.js";
import { listClientActivity, listEntityHistory, parseAuditCursor, resolveAuditAudience } from "../db/auditQuery.js";
import { CATALOG_ENTITY_PERMISSION } from "../db/auditedTables.js";
import type { AppEnv } from "../types.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export const activityRoutes = new Hono<AppEnv>();

activityRoutes.get("/clients/:clientId/activity", requirePermission(CLIENTS_VIEW), async (c) => {
  const clientId = parseUuid(c.req.param("clientId"));
  if (!clientId) return c.json({ error: "Client not found." }, 404);

  const limit = parseLimit(c.req.query("limit"));
  if (limit == null) return c.json({ error: "Invalid request." }, 400);

  const cursor = parseAuditCursor(c.req.query("cursor"));
  if (cursor === null) return c.json({ error: "Invalid request." }, 400);

  const db = c.get("services").db;
  if (!(await clientIsVisible(db, c.get("user"), clientId))) {
    return c.json({ error: "Client not found." }, 404);
  }

  const activity = await listClientActivity(db, clientId, { limit, cursor });
  return c.json(activity);
});

activityRoutes.get("/audit-events/:entityType/:entityId{.+}", requireUser, async (c) => {
  const entityType = c.req.param("entityType");
  const entityId = c.req.param("entityId");
  const limit = parseLimit(c.req.query("limit"));
  if (limit == null) return c.json({ error: "Invalid request." }, 400);

  const cursor = parseAuditCursor(c.req.query("cursor"));
  if (cursor === null) return c.json({ error: "Invalid request." }, 400);

  const permission = CATALOG_ENTITY_PERMISSION[entityType];
  const user = c.get("user");
  if (permission && !isAdmin(user) && !user.permissions.includes(permission)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const db = c.get("services").db;
  const audience = await resolveAuditAudience(db, entityType, entityId);
  if (audience.kind === "unknown" || audience.kind === "missing") {
    return c.json({ error: "Not found." }, 404);
  }

  if (audience.kind === "client" && !(await clientIsVisible(db, user, audience.clientId))) {
    return c.json({ error: "Not found." }, 404);
  }

  const history = await listEntityHistory(db, entityType, entityId, { limit, cursor });
  return c.json(history);
});

function parseUuid(value: string) {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseLimit(value: string | undefined) {
  if (value == null || value === "") return DEFAULT_LIMIT;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (parsed < 1 || parsed > MAX_LIMIT) return null;
  return parsed;
}
