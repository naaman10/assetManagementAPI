# Asset Management API

API for the asset management web app. This service is hosted on Render. The web app is a separate Next.js project on Vercel and forwards browser requests from `/api/*` to this service.

The process boots with Neon and Google OAuth configured, and exposes `GET /health` so Render and the web app can check that it is up. Sign-in is a Google OAuth authorization-code flow. Outbound email stays off until Resend is configured.

## Stack

- Node.js and TypeScript
- Hono
- Drizzle ORM with Neon PostgreSQL
- Google OAuth 2.0 (`google-auth-library`)
- Resend

## Layout

```
src/
  server.ts           process entry and shutdown
  app.ts              HTTP app, CORS, and route mounting
  services.ts         composition root for external clients
  config/env.ts       validated environment
  db/client.ts        Neon connection pool and Drizzle
  db/schema/          table definitions
  db/migrate.ts       applies Drizzle migrations on startup
  auth/google.ts      Google OAuth client
  auth/session.ts     session cookie and database session
  auth/middleware.ts  requireUser for protected routes
  email/resend.ts     Resend client
  routes/health.ts    GET /health
  routes/auth.ts      Google sign-in, current user, and logout
```

Route handlers should read clients from `c.get("services")` rather than constructing them again.

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

The API listens on port 3001. `GET http://localhost:3001/health` returns `{ "status": "ok" }`.

Set `API_URL=http://localhost:3001` in the web app to proxy `/api/health` here.

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port. Render sets this in production. |
| `WEB_APP_ORIGIN` | Web app origin allowed by CORS. |
| `DATABASE_URL` | Neon pooled Postgres connection string. |
| `GOOGLE_CLIENT_ID` | Google OAuth web client id. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth web client secret. |
| `GOOGLE_REDIRECT_URI` | Web app callback URL. Next.js proxies it to `GET /auth/google/callback`. |
| `RESEND_API_KEY` | Optional. Resend API key. Email stays disabled until this and `EMAIL_FROM` are both set. |
| `EMAIL_FROM` | Optional. Verified From address for outbound email. |

## Sign-in

The browser must stay on the web app host. The Next.js app proxies `/api/*` to this service, and the session cookie is stored for that host.

| Action | Web app request | This API |
| --- | --- | --- |
| Start Google sign-in | Navigate to `/api/auth/google` | `GET /auth/google` |
| Google returns | `/api/auth/google/callback` | `GET /auth/google/callback` |
| Read the signed-in user | `GET /api/auth/me` | `GET /auth/me` |
| Log out | `POST /api/auth/logout` | `POST /auth/logout` |

`GET /auth/me` returns `{ "user": { "id", "email", "name", "picture" } }`. A missing or expired session returns `401`. After a successful sign-in the API redirects the browser to `WEB_APP_ORIGIN`. A failed sign-in redirects there with `auth_error` set to `access_denied`, `invalid_state`, or `auth_failed`.

Protected routes should use the `requireUser` middleware. It loads the session user onto `c.get("user")`.

Server-side calls from the Next.js app do not send the browser cookie unless the route forwards it:

```ts
import { cookies } from "next/headers";
import { apiFetch } from "@/lib/api";

const cookie = (await cookies()).toString();
const response = await apiFetch("/auth/me", { headers: { cookie } });
```

## Google OAuth client

Create a **Web application** OAuth client in Google Cloud Console. The redirect URI is the web app URL, not the Render URL.

1. Open [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **OAuth consent screen**.
2. Choose **External**, or **Internal** if this is a Google Workspace app limited to your organization.
3. Set the app name, user support email, and developer contact email.
4. Add the scopes `openid`, `email`, and `profile`.
5. If the app stays in **Testing**, add every Google account that should be able to sign in under **Test users**. Accounts that are not listed are rejected by Google.
6. Go to **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.
7. Add **Authorized JavaScript origins** with no path:
   - `http://localhost:3000`
   - `https://<your-web-app-host>`
8. Add **Authorized redirect URIs** exactly:
   - `http://localhost:3000/api/auth/google/callback`
   - `https://<your-web-app-host>/api/auth/google/callback`

Copy the client ID and client secret into the API environment.

| Variable | Local | Render |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Client ID | Same client ID |
| `GOOGLE_CLIENT_SECRET` | Client secret | Same client secret |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/api/auth/google/callback` | `https://<your-web-app-host>/api/auth/google/callback` |
| `WEB_APP_ORIGIN` | `http://localhost:3000` | `https://<your-web-app-host>` |

`GOOGLE_REDIRECT_URI` must match one Authorized redirect URI character for character, including the scheme and with no trailing slash. `WEB_APP_ORIGIN` is the site the browser returns to after sign-in, with no path.

On the web app, set `API_URL` to this service (`http://localhost:3001` locally, the Render URL in production). Start sign-in by sending the browser to `/api/auth/google` on the web app. Do not send the user directly to the Render host. The state cookie is set on the host that starts the flow, and Google sends the user back to `GOOGLE_REDIRECT_URI`.

## Database

Schema files live in `src/db/schema` and are re-exported from `src/db/schema/index.ts`. The server applies migrations in `drizzle/` before it listens. After a schema change:

```bash
npm run db:generate
```

Commit the generated SQL. The next deploy applies it.

## Deploy

Connect this repository to Render using `render.yaml`. Set the synced environment variables in the Render dashboard. The health check path is `/health`.
