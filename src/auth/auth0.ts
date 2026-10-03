import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../config/env.js";

export const CONNECTION = "Username-Password-Authentication";

type Auth0Env = Pick<
  Env,
  "AUTH0_DOMAIN" | "AUTH0_CLIENT_ID" | "AUTH0_CLIENT_SECRET" | "AUTH0_REDIRECT_URI"
>;

export type Auth0Identity = {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
};

export function createAuth0(env: Auth0Env) {
  const issuer = `https://${env.AUTH0_DOMAIN}/`;
  const jwks = createRemoteJWKSet(new URL(".well-known/jwks.json", issuer));

  return {
    codeChallenge(verifier: string) {
      return createHash("sha256").update(verifier).digest("base64url");
    },

    authorizationUrl(input: { state: string; codeChallenge: string }) {
      const url = new URL("authorize", issuer);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", env.AUTH0_CLIENT_ID);
      url.searchParams.set("redirect_uri", env.AUTH0_REDIRECT_URI);
      url.searchParams.set("scope", "openid profile email");
      url.searchParams.set("state", input.state);
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("connection", CONNECTION);
      return url.toString();
    },

    logoutUrl(returnTo: string) {
      const url = new URL("v2/logout", issuer);
      url.searchParams.set("client_id", env.AUTH0_CLIENT_ID);
      url.searchParams.set("returnTo", returnTo);
      return url.toString();
    },

    async exchangeCode(input: { code: string; codeVerifier: string }): Promise<Auth0Identity> {
      const response = await fetch(new URL("oauth/token", issuer), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: env.AUTH0_CLIENT_ID,
          client_secret: env.AUTH0_CLIENT_SECRET,
          code: input.code,
          code_verifier: input.codeVerifier,
          redirect_uri: env.AUTH0_REDIRECT_URI,
        }),
      });

      if (!response.ok) {
        throw new Error(`Auth0 token exchange failed with status ${response.status}.`);
      }

      const idToken = readIdToken(await response.json());
      const verified = await jwtVerify(idToken, jwks, {
        issuer,
        audience: env.AUTH0_CLIENT_ID,
      });
      const sub = readClaim(verified.payload.sub);
      const email = readClaim(verified.payload.email);

      if (!sub || !email || verified.payload.email_verified !== true) {
        throw new Error("Auth0 identity is missing a verified email.");
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

function readIdToken(body: unknown) {
  if (!body || typeof body !== "object" || !("id_token" in body) || typeof body.id_token !== "string") {
    throw new Error("Auth0 token response did not include an ID token.");
  }

  return body.id_token;
}
