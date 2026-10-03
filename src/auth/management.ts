import type { Env } from "../config/env.js";
import { CONNECTION } from "./auth0.js";

type ManagementEnv = Pick<Env, "AUTH0_DOMAIN" | "AUTH0_MGMT_CLIENT_ID" | "AUTH0_MGMT_CLIENT_SECRET">;

export class Auth0RequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "Auth0RequestError";
    this.status = status;
  }
}

export type Auth0Account = {
  userId: string;
};

export function createAuth0Management(env: ManagementEnv) {
  const issuer = `https://${env.AUTH0_DOMAIN}/`;
  let cached: { value: string; expiresAt: number } | null = null;

  async function accessToken() {
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.value;
    }

    const response = await fetch(new URL("oauth/token", issuer), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: env.AUTH0_MGMT_CLIENT_ID,
        client_secret: env.AUTH0_MGMT_CLIENT_SECRET,
        audience: `https://${env.AUTH0_DOMAIN}/api/v2/`,
      }),
    });
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Auth0RequestError(response.status, "Auth0 management token request failed.");
    }

    const token = readString(body, "access_token");
    const expiresIn =
      body && typeof body === "object" && "expires_in" in body && typeof body.expires_in === "number"
        ? body.expires_in
        : 3600;

    if (!token) {
      throw new Auth0RequestError(response.status, "Auth0 management token response was empty.");
    }

    cached = { value: token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  }

  async function request(path: string, init: { method: string; body?: unknown }) {
    const token = await accessToken();
    const response = await fetch(new URL(`api/v2/${path}`, issuer), {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    if (response.status === 204) {
      return null;
    }

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Auth0RequestError(response.status, readErrorMessage(body, response.status));
    }

    return body;
  }

  return {
    async createUser(input: { email: string; password: string; name: string | null }): Promise<Auth0Account> {
      const body = await request("users", {
        method: "POST",
        body: {
          connection: CONNECTION,
          email: input.email,
          password: input.password,
          email_verified: true,
          verify_email: false,
          name: input.name ?? undefined,
        },
      });
      const userId = readString(body, "user_id");

      if (!userId) {
        throw new Auth0RequestError(502, "Auth0 did not return a user id.");
      }

      return { userId };
    },

    async findByEmail(email: string): Promise<Auth0Account | null> {
      const body = await request(`users-by-email?email=${encodeURIComponent(email)}`, {
        method: "GET",
      });

      if (!Array.isArray(body)) {
        return null;
      }

      const match = body.find(isDatabaseUser);
      return match ? { userId: match.user_id } : null;
    },

    async updateUser(
      userId: string,
      input: { email?: string; name?: string | null; password?: string; blocked?: boolean },
    ) {
      const body: Record<string, unknown> = {};

      if (input.email) {
        body.email = input.email;
        body.email_verified = true;
        body.verify_email = false;
      }

      if (input.name !== undefined) {
        body.name = input.name;
      }

      if (input.password) {
        body.password = input.password;
        body.connection = CONNECTION;
      }

      if (input.blocked !== undefined) {
        body.blocked = input.blocked;
      }

      await request(`users/${encodeURIComponent(userId)}`, { method: "PATCH", body });
    },

    async deleteUser(userId: string) {
      await request(`users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    },
  };
}

function isDatabaseUser(value: unknown): value is { user_id: string } {
  if (!value || typeof value !== "object" || !("user_id" in value) || typeof value.user_id !== "string") {
    return false;
  }

  if (!("identities" in value) || !Array.isArray(value.identities)) {
    return value.user_id.startsWith("auth0|");
  }

  return value.identities.some(
    (identity) =>
      !!identity &&
      typeof identity === "object" &&
      "connection" in identity &&
      identity.connection === CONNECTION,
  );
}

function readString(body: unknown, key: string) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readErrorMessage(body: unknown, status: number) {
  const message = readString(body, "message");

  if (message && (status === 400 || status === 409)) {
    return message;
  }

  return `Auth0 request failed with status ${status}.`;
}
