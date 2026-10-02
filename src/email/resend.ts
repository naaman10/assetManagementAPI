import { Resend } from "resend";
import type { Env } from "../config/env.js";

export type EmailClient = {
  resend: Resend;
  from: string;
};

export function createEmailClient(
  env: Pick<Env, "RESEND_API_KEY" | "EMAIL_FROM">,
): EmailClient | null {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    console.log("Resend is not configured. Outbound email is disabled.");
    return null;
  }

  return {
    resend: new Resend(env.RESEND_API_KEY),
    from: env.EMAIL_FROM,
  };
}
