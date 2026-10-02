import { CodeChallengeMethod } from "google-auth-library";
import { Hono } from "hono";
import { createGoogleAuth } from "../auth/google.js";
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

auth.get("/auth/google", async (c) => {
  const client = createGoogleAuth(env);
  const state = createToken();
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();

  if (!codeChallenge) {
    throw new Error("Google code challenge was not created.");
  }

  saveOAuthTransaction(c, { state, verifier: codeVerifier });

  const url = client.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  return c.redirect(url);
});

auth.get("/auth/google/callback", async (c) => {
  const googleError = c.req.query("error");

  if (googleError) {
    clearOAuthTransaction(c);
    const code = googleError === "access_denied" ? "access_denied" : "auth_failed";
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
    const client = createGoogleAuth(env);
    const { tokens } = await client.getToken({
      code,
      codeVerifier: transaction.verifier,
    });

    if (!tokens.id_token) {
      return c.redirect(appHome("auth_failed"));
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      return c.redirect(appHome("auth_failed"));
    }

    const [user] = await c
      .get("services")
      .db.insert(users)
      .values({
        googleSub: payload.sub,
        email: payload.email,
        name: payload.name ?? null,
        picture: payload.picture ?? null,
      })
      .onConflictDoUpdate({
        target: users.googleSub,
        set: {
          email: payload.email,
          name: payload.name ?? null,
          picture: payload.picture ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: users.id });

    if (!user) {
      return c.redirect(appHome("auth_failed"));
    }

    await createSession(c, user.id);
    return c.redirect(appHome());
  } catch (error) {
    console.error("Google sign-in failed", error);
    return c.redirect(appHome("auth_failed"));
  }
});

auth.get("/auth/me", requireUser, (c) => {
  return c.json({ user: c.get("user") });
});

auth.post("/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

function appHome(authError?: string) {
  const url = new URL(env.WEB_APP_ORIGIN);

  if (authError) {
    url.searchParams.set("auth_error", authError);
  }

  return url.toString();
}
