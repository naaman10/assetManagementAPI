import type { Context } from "hono";
import type { ZodError } from "zod";
import { AccessError } from "../auth/access.js";
import { Auth0RequestError } from "../auth/management.js";
import type { AppEnv } from "../types.js";

export async function readBody(c: Context) {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export function invalidRequest(c: Context, error: ZodError) {
  return c.json({ error: "Invalid request", details: error.flatten().fieldErrors }, 400);
}

export function routeError(c: Context<AppEnv>, error: unknown) {
  if (error instanceof AccessError) {
    return c.json({ error: error.message }, 409);
  }

  if (error instanceof Auth0RequestError) {
    if (error.status === 409) {
      return c.json({ error: "A user with that email already exists." }, 409);
    }

    if (error.status === 400) {
      return c.json({ error: error.message }, 400);
    }

    console.error("Auth0 management request failed", error);
    return c.json({ error: "Auth0 request failed." }, 502);
  }

  if (isUniqueViolation(error)) {
    return c.json({ error: "That value is already in use." }, 409);
  }

  throw error;
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  if ("code" in error && error.code === "23505") {
    return true;
  }

  if ("cause" in error) {
    return isUniqueViolation(error.cause);
  }

  return false;
}
