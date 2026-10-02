import { Resend } from "resend";
import type { Env } from "../config/env.js";

export function createEmailClient(
  env: Pick<Env, "RESEND_API_KEY" | "EMAIL_FROM">,
) {
  return {
    resend: new Resend(env.RESEND_API_KEY),
    from: env.EMAIL_FROM,
  };
}
