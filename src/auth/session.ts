import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { loadUserAccess } from "./access.js";
import { env } from "../config/env.js";
import { sessions, users } from "../db/schema/index.js";
import type { AppEnv, AuthUser } from "../types.js";

const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax" as const,
    path: "/",
    maxAge,
  };
}

function createToken() {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(c: Context<AppEnv>, userId: string) {
  const token = createToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await c.get("services").db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  setCookie(c, SESSION_COOKIE, token, cookieOptions(SESSION_TTL_SECONDS));
}

export async function findUserBySession(c: Context<AppEnv>): Promise<AuthUser | null> {
  const token = getCookie(c, SESSION_COOKIE);

  if (!token) {
    return null;
  }

  const db = c.get("services").db;
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      picture: users.picture,
      disabled: users.disabled,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row || row.disabled) {
    if (row?.disabled) {
      await db.delete(sessions).where(eq(sessions.userId, row.id));
    }

    deleteCookie(c, SESSION_COOKIE, cookieOptions(0));
    return null;
  }

  const access = await loadUserAccess(db, row.id);

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    picture: row.picture,
    roles: access.roles,
    permissions: access.permissions,
  };
}

export async function destroySession(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE);

  if (token) {
    await c
      .get("services")
      .db.delete(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)));
  }

  deleteCookie(c, SESSION_COOKIE, cookieOptions(0));
}
