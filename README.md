# Asset Management API

API for the asset management web app. This service is hosted on Render. The web app is a separate Next.js project on Vercel and forwards browser requests from `/api/*` to this service.

Authenticated feature endpoints are not implemented yet. The process boots with Neon and Google OAuth configured, and exposes `GET /health` so Render and the web app can check that it is up. Outbound email stays off until Resend is configured.

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
  auth/google.ts      Google OAuth client
  email/resend.ts     Resend client
  routes/health.ts    GET /health
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
| `GOOGLE_REDIRECT_URI` | OAuth callback on this API. |
| `RESEND_API_KEY` | Optional. Resend API key. Email stays disabled until this and `EMAIL_FROM` are both set. |
| `EMAIL_FROM` | Optional. Verified From address for outbound email. |

## Database

Schema files live in `src/db/schema` and are re-exported from `src/db/schema/index.ts`. After a schema change:

```bash
npm run db:generate
npm run db:migrate
```

## Deploy

Connect this repository to Render using `render.yaml`. Set the synced environment variables in the Render dashboard. The health check path is `/health`.
