import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";
import { findUserBySession } from "./session.js";

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await findUserBySession(c);

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", user);
  await next();
};

export function requirePermission(permission: string) {
  return requireAnyPermission(permission);
}

export function requireAnyPermission(...required: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await findUserBySession(c);

    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!required.some((permission) => user.permissions.includes(permission))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    c.set("user", user);
    await next();
  };
}
