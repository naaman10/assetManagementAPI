import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { clientVisibility } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import { assets, clients, locations, sites, workOrders } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv, AuthUser } from "../types.js";

const RESULT_LIMIT = 20;
const PER_TYPE_LIMIT = 20;

type SearchResult = {
  type: "site" | "location" | "asset" | "workOrder";
  id: string;
  name: string;
  rank: number;
  client: { id: string; name: string };
  siteId?: string;
  locationId?: string;
  locationCode?: string | null;
  assetId?: string;
  assetRef?: string;
};

export const searchRoutes = new Hono<AppEnv>();

searchRoutes.get("/search", requireUser, async (c) => {
  const parsed = z.string().trim().max(100).safeParse(c.req.query("q") ?? "");

  if (!parsed.success) {
    return c.json({ error: "Enter a shorter search." }, 400);
  }

  const query = parsed.data;

  if (query.length === 0) {
    return c.json({ results: [] });
  }

  const db = c.get("services").db;
  const user = c.get("user");
  const [siteRows, locationRows, assetRows, workOrderRows] = await Promise.all([
    searchSites(db, user, query),
    searchLocations(db, user, query),
    searchAssets(db, user, query),
    searchWorkOrders(db, user, query),
  ]);

  const results = [...siteRows, ...locationRows, ...assetRows, ...workOrderRows]
    .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name) || left.type.localeCompare(right.type))
    .slice(0, RESULT_LIMIT)
    .map(presentResult);

  return c.json({ results });
});

async function searchSites(db: Database, user: AuthUser, query: string): Promise<SearchResult[]> {
  const rank = bestRank([sites.name, sites.reference], query);
  const rows = await db
    .select({
      id: sites.id,
      name: sites.name,
      clientId: clients.id,
      clientName: clients.name,
      rank,
    })
    .from(sites)
    .innerJoin(clients, eq(sites.clientId, clients.id))
    .where(visible(db, user, matches([sites.name, sites.reference], query)))
    .orderBy(asc(rank), asc(sites.name))
    .limit(PER_TYPE_LIMIT);

  return rows.map((row) => ({
    type: "site",
    id: row.id,
    name: row.name,
    rank: Number(row.rank),
    client: { id: row.clientId, name: row.clientName },
  }));
}

async function searchLocations(db: Database, user: AuthUser, query: string): Promise<SearchResult[]> {
  const rank = bestRank([locations.name, locations.locationCode], query);
  const rows = await db
    .select({
      id: locations.id,
      name: locations.name,
      locationCode: locations.locationCode,
      siteId: locations.siteId,
      clientId: clients.id,
      clientName: clients.name,
      rank,
    })
    .from(locations)
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .innerJoin(clients, eq(sites.clientId, clients.id))
    .where(visible(db, user, matches([locations.name, locations.locationCode], query)))
    .orderBy(asc(rank), asc(locations.name), asc(locations.locationCode))
    .limit(PER_TYPE_LIMIT);

  return rows.map((row) => ({
    type: "location",
    id: row.id,
    name: row.name ?? row.locationCode ?? "Location",
    rank: Number(row.rank),
    siteId: row.siteId,
    locationCode: row.locationCode,
    client: { id: row.clientId, name: row.clientName },
  }));
}

async function searchAssets(db: Database, user: AuthUser, query: string): Promise<SearchResult[]> {
  const rank = bestRank([assets.assetName, assets.assetRef], query);
  const rows = await db
    .select({
      id: assets.id,
      assetName: assets.assetName,
      assetRef: assets.assetRef,
      locationId: assets.locationId,
      clientId: clients.id,
      clientName: clients.name,
      rank,
    })
    .from(assets)
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .innerJoin(clients, eq(sites.clientId, clients.id))
    .where(visible(db, user, matches([assets.assetName, assets.assetRef], query)))
    .orderBy(asc(rank), asc(assets.assetRef))
    .limit(PER_TYPE_LIMIT);

  return rows.map((row) => ({
    type: "asset",
    id: row.id,
    name: row.assetName ?? row.assetRef,
    rank: Number(row.rank),
    assetRef: row.assetRef,
    locationId: row.locationId,
    client: { id: row.clientId, name: row.clientName },
  }));
}

async function searchWorkOrders(db: Database, user: AuthUser, query: string): Promise<SearchResult[]> {
  const rank = bestRank([workOrders.title], query);
  const rows = await db
    .select({
      id: workOrders.id,
      title: workOrders.title,
      assetId: workOrders.assetId,
      clientId: clients.id,
      clientName: clients.name,
      rank,
    })
    .from(workOrders)
    .innerJoin(assets, eq(workOrders.assetId, assets.id))
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .innerJoin(clients, eq(sites.clientId, clients.id))
    .where(visible(db, user, matches([workOrders.title], query)))
    .orderBy(asc(rank), asc(workOrders.title))
    .limit(PER_TYPE_LIMIT);

  return rows.map((row) => ({
    type: "workOrder",
    id: row.id,
    name: row.title,
    rank: Number(row.rank),
    assetId: row.assetId,
    client: { id: row.clientId, name: row.clientName },
  }));
}

function visible(db: Database, user: AuthUser, match: SQL) {
  const visibility = clientVisibility(db, user);
  return visibility ? and(visibility, match) : match;
}

function matches(columns: AnyColumn[], query: string) {
  const pattern = `%${escapeLike(query)}%`;
  const checks = columns.map((column) => sql`${column}::text ILIKE ${pattern} ESCAPE '\\'`);
  return sql`(${sql.join(checks, sql` OR `)})`;
}

function bestRank(columns: AnyColumn[], query: string) {
  const ranks = columns.map((column) => fieldRank(column, query));
  return sql<number>`LEAST(${sql.join(ranks, sql`, `)})`;
}

function fieldRank(column: AnyColumn, query: string) {
  const exact = query.toLowerCase();
  const prefix = `${escapeLike(exact)}%`;

  return sql<number>`CASE
    WHEN ${column} IS NULL THEN 3
    WHEN lower(${column}::text) = ${exact} THEN 0
    WHEN lower(${column}::text) LIKE ${prefix} ESCAPE '\\' THEN 1
    ELSE 2
  END`;
}

function presentResult(result: SearchResult) {
  const base = {
    type: result.type,
    id: result.id,
    name: result.name,
    client: result.client,
  };

  if (result.type === "location") {
    return { ...base, siteId: result.siteId, locationCode: result.locationCode ?? null };
  }

  if (result.type === "asset") {
    return { ...base, assetRef: result.assetRef, locationId: result.locationId };
  }

  if (result.type === "workOrder") {
    return { ...base, assetId: result.assetId };
  }

  return base;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
