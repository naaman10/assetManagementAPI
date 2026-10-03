import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Auth0Identity } from "../auth/auth0.js";
import { requireUser } from "../auth/middleware.js";
import {
  clearOAuthTransaction,
  createSession,
  createToken,
  destroySession,
  readOAuthTransaction,
  saveOAuthTransaction,
} from "../auth/session.js";
import { env } from "../config/env.js";
import { users } from "../db/schema/index.js";
import type { AppEnv } from "../types.js";

export const auth = new Hono<AppEnv>();

auth.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

auth.get("/auth/login", (c) => {
  const client = c.get("services").auth0;
  const state = createToken();
  const verifier = createToken();

  saveOAuthTransaction(c, { state, verifier });

  return c.redirect(
    client.authorizationUrl({
      state,
      codeChallenge: client.codeChallenge(verifier),
    }),
  );
});

auth.get("/auth/callback", async (c) => {
  const providerError = c.req.query("error");

  if (providerError) {
    clearOAuthTransaction(c);
    const code = providerError === "access_denied" ? "access_denied" : "auth_failed";
    return c.redirect(appHome(code));
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  const transaction = code && state ? readOAuthTransaction(c, state) : null;
  clearOAuthTransaction(c);

  if (!code || !transaction) {
    return c.redirect(appHome("invalid_state"));
  }

  try {
    const identity = await c.get("services").auth0.exchangeCode({
      code,
      codeVerifier: transaction.verifier,
    });
    const userId = await findEnabledUser(c, identity);

    if (!userId) {
      return c.redirect(appHome("auth_failed"));
    }

    await createSession(c, userId);
    return c.redirect(appHome());
  } catch (error) {
    console.error("Auth0 sign-in failed", error);
    return c.redirect(appHome("auth_failed"));
  }
});

auth.get("/auth/me", requireUser, (c) => {
  return c.json({ user: c.get("user") });
});

auth.post("/auth/logout", async (c) => {
  await destroySession(c);

  return c.json({
    ok: true,
    logoutUrl: c.get("services").auth0.logoutUrl(env.WEB_APP_ORIGIN),
  });
});

async function findEnabledUser(c: Context<AppEnv>, identity: Auth0Identity) {
  const [user] = await c
    .get("services")
    .db.select({ id: users.id, disabled: users.disabled })
    .from(users)
    .where(eq(users.auth0Sub, identity.sub))
    .limit(1);

  if (!user || user.disabled) {
    return null;
  }

  return user.id;
}

function appHome(authError?: string) {
  const url = new URL(env.WEB_APP_ORIGIN);

  if (authError) {
    url.searchParams.set("auth_error", authError);
  }

  return url.toString();
}
