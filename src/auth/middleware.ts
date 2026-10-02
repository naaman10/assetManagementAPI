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
