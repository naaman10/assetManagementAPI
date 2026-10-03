import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { loadUserAccess } from "../auth/access.js";
import { Auth0SignInError } from "../auth/auth0.js";
import { requireUser } from "../auth/middleware.js";
import { createSession, destroySession } from "../auth/session.js";
import { users } from "../db/schema/index.js";
import type { AppEnv } from "../types.js";
import { invalidRequest, normalizeEmail, readBody } from "./http.js";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});

export const auth = new Hono<AppEnv>();

auth.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

auth.post("/auth/login", async (c) => {
  const parsed = loginSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  try {
    const identity = await c.get("services").auth0.signIn({
      email: normalizeEmail(parsed.data.email),
      password: parsed.data.password,
    });
    const db = c.get("services").db;
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        picture: users.picture,
        disabled: users.disabled,
      })
      .from(users)
      .where(eq(users.auth0Sub, identity.sub))
      .limit(1);

    if (!user || user.disabled) {
      return c.json({ error: "Invalid email or password." }, 401);
    }

    await createSession(c, user.id);
    const access = await loadUserAccess(db, user.id);

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        roles: access.roles,
        permissions: access.permissions,
      },
    });
  } catch (error) {
    if (error instanceof Auth0SignInError) {
      return c.json({ error: error.message }, error.status);
    }

    console.error("Auth0 sign-in failed", error);
    return c.json({ error: "Sign-in is unavailable." }, 502);
  }
});

auth.get("/auth/me", requireUser, (c) => {
  return c.json({ user: c.get("user") });
});

auth.post("/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});
