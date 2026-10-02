import { Hono } from "hono";
import type { AppEnv } from "../types.js";

export const health = new Hono<AppEnv>();

health.get("/health", (c) => {
  return c.json({ status: "ok" });
});
