import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  AUTH0_DOMAIN: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !value.includes("://") && !value.includes("/"), {
      message: "AUTH0_DOMAIN must be a hostname",
    }),
  AUTH0_CLIENT_ID: z.string().min(1),
  AUTH0_CLIENT_SECRET: z.string().min(1),
  AUTH0_MGMT_CLIENT_ID: z.string().min(1),
  AUTH0_MGMT_CLIENT_SECRET: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_ENDPOINT_URL_S3: z.string().url(),
  AWS_REGION: z.string().min(1),
  ASSETS_BUCKET: z.string().min(1),
  BOOTSTRAP_ADMIN_EMAIL: optionalEnv(),
  BOOTSTRAP_ADMIN_PASSWORD: optionalEnv(),
  RESEND_API_KEY: optionalEnv(),
  EMAIL_FROM: optionalEnv(),
  APS_CLIENT_ID: optionalEnv(),
  APS_CLIENT_SECRET: optionalEnv(),
  APS_BUCKET: optionalEnv(),
}).superRefine((value, ctx) => {
  const hasEmail = value.BOOTSTRAP_ADMIN_EMAIL !== undefined;
  const hasPassword = value.BOOTSTRAP_ADMIN_PASSWORD !== undefined;

  if (hasEmail !== hasPassword) {
    ctx.addIssue({
      code: "custom",
      message: "Set both BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD, or neither.",
      path: ["BOOTSTRAP_ADMIN_EMAIL"],
    });
  }

  if (value.BOOTSTRAP_ADMIN_EMAIL && !z.email().safeParse(value.BOOTSTRAP_ADMIN_EMAIL).success) {
    ctx.addIssue({
      code: "custom",
      message: "BOOTSTRAP_ADMIN_EMAIL must be an email address.",
      path: ["BOOTSTRAP_ADMIN_EMAIL"],
    });
  }

  if (value.BOOTSTRAP_ADMIN_PASSWORD && value.BOOTSTRAP_ADMIN_PASSWORD.length < 8) {
    ctx.addIssue({
      code: "custom",
      message: "BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters.",
      path: ["BOOTSTRAP_ADMIN_PASSWORD"],
    });
  }

  const apsValues = [value.APS_CLIENT_ID, value.APS_CLIENT_SECRET, value.APS_BUCKET];
  const apsSetCount = apsValues.filter((entry) => entry !== undefined).length;

  if (apsSetCount > 0 && apsSetCount < 3) {
    ctx.addIssue({
      code: "custom",
      message: "Set APS_CLIENT_ID, APS_CLIENT_SECRET, and APS_BUCKET together, or leave all unset.",
      path: ["APS_CLIENT_ID"],
    });
  }

  if (value.APS_BUCKET && !/^[a-z0-9_]{3,128}$/.test(value.APS_BUCKET)) {
    ctx.addIssue({
      code: "custom",
      message: "APS_BUCKET must be 3–128 characters of lowercase letters, numbers, or underscores.",
      path: ["APS_BUCKET"],
    });
  }
});

function optionalEnv() {
  return z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    });
}

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
