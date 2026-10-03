import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../config/env.js";

export const CONNECTION = "Username-Password-Authentication";

const PASSWORD_REALM_GRANT = "http://auth0.com/oauth/grant-type/password-realm";

type Auth0Env = Pick<Env, "AUTH0_DOMAIN" | "AUTH0_CLIENT_ID" | "AUTH0_CLIENT_SECRET">;

export type Auth0Identity = {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
};

export class Auth0SignInError extends Error {
  readonly status: 401 | 502;

  constructor(status: 401 | 502, message: string) {
    super(message);
    this.name = "Auth0SignInError";
    this.status = status;
  }
}

export function createAuth0(env: Auth0Env) {
  const issuer = `https://${env.AUTH0_DOMAIN}/`;
  const jwks = createRemoteJWKSet(new URL(".well-known/jwks.json", issuer));

  return {
    async signIn(input: { email: string; password: string }): Promise<Auth0Identity> {
      const response = await fetch(new URL("oauth/token", issuer), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: PASSWORD_REALM_GRANT,
          username: input.email,
          password: input.password,
          realm: CONNECTION,
          client_id: env.AUTH0_CLIENT_ID,
          client_secret: env.AUTH0_CLIENT_SECRET,
          scope: "openid profile email",
        }),
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const error = readString(body, "error");

        if (error === "invalid_grant" || response.status === 401) {
          throw new Auth0SignInError(401, "Invalid email or password.");
        }

        console.error("Auth0 sign-in is unavailable", response.status, error);
        throw new Auth0SignInError(502, "Sign-in is unavailable.");
      }

      const idToken = readString(body, "id_token");

      if (!idToken) {
        throw new Auth0SignInError(502, "Sign-in is unavailable.");
      }

      const verified = await jwtVerify(idToken, jwks, {
        issuer,
        audience: env.AUTH0_CLIENT_ID,
      });
      const sub = readClaim(verified.payload.sub);
      const email = readClaim(verified.payload.email);

      if (!sub || !email || verified.payload.email_verified !== true) {
        throw new Auth0SignInError(401, "Invalid email or password.");
      }

      return {
        sub,
        email,
        name: readClaim(verified.payload.name),
        picture: readClaim(verified.payload.picture),
      };
    },
  };
}

function readClaim(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readString(body: unknown, key: string) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
