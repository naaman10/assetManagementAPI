# Asset Management API

API for the asset management web app. This service is hosted on Render. The web app is a separate Next.js project on Vercel and forwards browser requests from `/api/*` to this service.

The process boots with Neon and Auth0 configured, and exposes `GET /health` so Render and the web app can check that it is up. Sign-in is an email and password form on the web app. This API checks the password with Auth0 and sets the session cookie. The browser does not visit Auth0's login page. Auth0 stores passwords only. This API stores users, roles, and permissions, and it is where accounts are created. Public registration is disabled. Outbound email stays off until Resend is configured.

## Stack

- Node.js and TypeScript
- Hono
- Drizzle ORM with Neon PostgreSQL
- Auth0 (`jose` for token verification)
- Resend

## Layout

```
src/
  server.ts              process entry, migrations, and first-admin bootstrap
  app.ts                 HTTP app, CORS, and route mounting
  services.ts            composition root for external clients
  config/env.ts          validated environment
  db/client.ts           Neon connection pool and Drizzle
  db/schema/             table definitions
  db/migrate.ts          applies Drizzle migrations on startup
  db/bootstrap.ts        seeds permissions and the first admin
  auth/auth0.ts          Auth0 password check and token verification
  auth/management.ts     Auth0 Management API client
  auth/access.ts         role and permission checks
  auth/session.ts        session cookie and database session
  auth/middleware.ts     requireUser and requirePermission
  email/resend.ts        Resend client
  routes/health.ts       GET /health
  routes/auth.ts         Auth0 sign-in, current user, and logout
  routes/users.ts        user management
  routes/roles.ts        role management
  routes/permissions.ts  permission catalog
  routes/clients.ts      clients, contacts, logos, and settings
  routes/sites.ts        client sites
  routes/search.ts       site, location, asset, and work order search
  routes/locations.ts    site locations
  routes/assets.ts       location assets
  routes/audits.ts       client audits
  routes/assetTypes.ts   asset type catalog
  routes/classifications.ts  groups, elements, sub elements, and BCIS references
  routes/maintenanceTypes.ts maintenance type catalog
  routes/maintenanceSchedules.ts asset maintenance schedules
  routes/workOrders.ts   asset work orders
  storage/assets.ts      Neon assets bucket
```

Route handlers should read services from `c.get("services")` rather than constructing them again.

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
| `AUTH0_DOMAIN` | Auth0 tenant hostname, with no scheme or path. |
| `AUTH0_CLIENT_ID` | Auth0 Regular Web Application client id. Used for sign-in. |
| `AUTH0_CLIENT_SECRET` | Auth0 Regular Web Application client secret. |
| `AUTH0_MGMT_CLIENT_ID` | Auth0 Machine-to-Machine application client id. Used to create and update logins. |
| `AUTH0_MGMT_CLIENT_SECRET` | Auth0 Machine-to-Machine application client secret. |
| `BOOTSTRAP_ADMIN_EMAIL` | Optional. Email of the first admin. Set with the password until that admin exists. |
| `BOOTSTRAP_ADMIN_PASSWORD` | Optional. Password of the first admin. Remove it after the first successful boot. |
| `RESEND_API_KEY` | Optional. Resend API key. Email stays disabled until this and `EMAIL_FROM` are both set. |
| `EMAIL_FROM` | Optional. Verified From address for outbound email. |

Set both bootstrap variables, or neither. The password must be at least 8 characters and must also satisfy the Auth0 password policy.

## Sign-in

The browser must stay on the web app host. The Next.js app proxies `/api/*` to this service, and the session cookie is stored for that host.

| Action | Web app request | This API |
| --- | --- | --- |
| Sign in | `POST /api/auth/login` with `{ "email", "password" }` | `POST /auth/login` |
| Read the signed-in user | `GET /api/auth/me` | `GET /auth/me` |
| Log out | `POST /api/auth/logout` | `POST /auth/logout` |

`POST /auth/login` checks the password with Auth0, then sets the session cookie. A successful response is `{ "user": { "id", "email", "name", "picture", "roles", "permissions" } }`. An unknown user, a wrong password, or a disabled account returns `401` with `{ "error": "Invalid email or password." }`. A malformed body returns `400`.

`GET /auth/me` returns the same user object. `picture` may be null. `roles` is `{ "id", "name" }[]`. `permissions` is the string list granted by those roles, loaded from the database on each request. A missing or expired session returns `401`.

Only a user already created in this API can sign in. An Auth0 account with no local user is rejected. A disabled user is rejected, and an existing session for that user stops working on the next request.

`POST /auth/logout` deletes the local session and returns `{ "ok": true }`. There is no Auth0 browser session to end.

Protected routes should use the `requireUser` middleware. It loads the session user onto `c.get("user")`. Routes that need a permission should use `requirePermission("users:view")`, which returns `401` when the session is missing and `403` when the permission is absent. A role change applies on the next request.

Server-side calls from the Next.js app do not send the browser cookie unless the route forwards it:

```ts
import { cookies } from "next/headers";
import { apiFetch } from "@/lib/api";

const cookie = (await cookies()).toString();
const response = await apiFetch("/auth/me", { headers: { cookie } });
```

## User management

These routes require the session cookie. Permissions are a fixed catalog seeded on startup. The app can list them and assign them to roles. It cannot create, rename, or delete a permission. The seeded `admin` role has every permission. That role cannot be renamed or deleted. The API refuses a change that would leave no enabled user able to edit users and edit roles. You cannot disable or delete your own account.

Passwords are sent only to create or update a user. Responses never include them. Auth0's password policy can reject a password with `400` and Auth0's message.

| Action | Request | Permission |
| --- | --- | --- |
| List users | `GET /users` | `users:view` |
| Create user | `POST /users` | `users:create` |
| Read user | `GET /users/:id` | `users:view` |
| Update user | `PATCH /users/:id` | `users:edit` |
| Delete user | `DELETE /users/:id` | `users:delete` |
| List roles | `GET /roles` | `roles:view`, `users:create`, or `users:edit` |
| Create role | `POST /roles` | `roles:create` |
| Read role | `GET /roles/:id` | `roles:view`, `users:create`, or `users:edit` |
| Update role | `PATCH /roles/:id` | `roles:edit` |
| Delete role | `DELETE /roles/:id` | `roles:delete` |
| List permissions | `GET /permissions` | `permissions:view`, `roles:create`, or `roles:edit` |

Create a user with `{ "email", "password", "name", "roleIds" }`. `name` and `roleIds` are optional. `roleIds` may contain one role or several. Update a user with any of `{ "email", "password", "name", "disabled", "roleIds" }`. `roleIds` replaces the user's roles. Create a role with `{ "name", "description", "permissionIds" }`. `permissionIds` must be ids returned by `GET /permissions`.

A user response is `{ "id", "email", "name", "picture", "disabled", "roles", "permissions", "createdAt", "updatedAt" }`. A role response includes its permissions. Invalid JSON or fields return `400`. A duplicate email or role name returns `409`.

## Asset types

These routes require the session cookie. Asset types are shared catalog data, so access is the permission below and does not depend on client membership. The `admin` role receives `assetType:view`, `assetType:create`, `assetType:edit`, and `assetType:delete` on the next boot. The migration seeds the asset type hierarchy. Each record is `{ "id", "parentId", "code", "name", "description", "classificationType", "isActive", "createdAt", "updatedAt" }`. `parentId` and `description` may be null. `classificationType` is `group`, `system`, `element`, `asset`, or `component`. `code` is unique. `GET /asset-types` returns the full list ordered by code.

| Action | Request | Permission |
| --- | --- | --- |
| List asset types | `GET /asset-types` | `assetType:view` |
| Create asset type | `POST /asset-types` | `assetType:create` |
| Read asset type | `GET /asset-types/:id` | `assetType:view` |
| Update asset type | `PATCH /asset-types/:id` | `assetType:edit` |
| Delete asset type | `DELETE /asset-types/:id` | `assetType:delete` |

Create an asset type with `{ "code", "name", "description", "classificationType", "parentId", "isActive" }`. `code` and `name` are required. The others are optional. `classificationType` defaults to `asset` and `isActive` defaults to true. Update an asset type with any of those fields. A duplicate code returns `409`. An unknown asset type or parent returns `404`. A parent that would nest an asset type under itself returns `400`. Delete returns `{ "ok": true }`. Deleting an asset type that still has children, or that is still used by an asset, returns `409`.

## Classification

These routes require the session cookie. Groups, elements, sub elements, BCIS references, and BCIS sub references are shared catalogs, so access is the permission below and does not depend on client membership. The `admin` role receives each permission on the next boot. Each record is `{ "id", "code", "name", "description", "isActive", "createdAt", "updatedAt" }`. An element also has `groupId`. A sub element also has `elementId`. A BCIS sub reference also has `bcisRefId`. `description` may be null. `code` is unique within its catalog. Lists are ordered by code.

An element belongs to one group. A sub element belongs to one element. A BCIS sub reference belongs to one BCIS reference. The migration seeds one example of each chain: group `EBF` External Building Fabric, element `ROOF-STR` Roof Structure, sub element `TPR` Timber Purlin and Rafters, BCIS reference `2` Superstructure, and BCIS sub reference `2.3` Roof.

| Action | Request | Permission |
| --- | --- | --- |
| List groups | `GET /groups` | `group:view` |
| Create group | `POST /groups` | `group:create` |
| Read group | `GET /groups/:id` | `group:view` |
| Update group | `PATCH /groups/:id` | `group:edit` |
| Delete group | `DELETE /groups/:id` | `group:delete` |
| List elements | `GET /elements` | `element:view` |
| Create element | `POST /elements` | `element:create` |
| Read element | `GET /elements/:id` | `element:view` |
| Update element | `PATCH /elements/:id` | `element:edit` |
| Delete element | `DELETE /elements/:id` | `element:delete` |
| List sub elements | `GET /sub-elements` | `subElement:view` |
| Create sub element | `POST /sub-elements` | `subElement:create` |
| Read sub element | `GET /sub-elements/:id` | `subElement:view` |
| Update sub element | `PATCH /sub-elements/:id` | `subElement:edit` |
| Delete sub element | `DELETE /sub-elements/:id` | `subElement:delete` |
| List BCIS references | `GET /bcis-refs` | `bcisRef:view` |
| Create BCIS reference | `POST /bcis-refs` | `bcisRef:create` |
| Read BCIS reference | `GET /bcis-refs/:id` | `bcisRef:view` |
| Update BCIS reference | `PATCH /bcis-refs/:id` | `bcisRef:edit` |
| Delete BCIS reference | `DELETE /bcis-refs/:id` | `bcisRef:delete` |
| List BCIS sub references | `GET /bcis-sub-refs` | `bcisSubRef:view` |
| Create BCIS sub reference | `POST /bcis-sub-refs` | `bcisSubRef:create` |
| Read BCIS sub reference | `GET /bcis-sub-refs/:id` | `bcisSubRef:view` |
| Update BCIS sub reference | `PATCH /bcis-sub-refs/:id` | `bcisSubRef:edit` |
| Delete BCIS sub reference | `DELETE /bcis-sub-refs/:id` | `bcisSubRef:delete` |

Create a group or BCIS reference with `{ "code", "name", "description", "isActive" }`. `code` and `name` are required. Create an element with `{ "groupId", "code", "name", "description", "isActive" }`. Create a sub element with `{ "elementId", "code", "name", "description", "isActive" }`. Create a BCIS sub reference with `{ "bcisRefId", "code", "name", "description", "isActive" }`. `isActive` defaults to true. Update with any of the fields for that catalog. A duplicate code returns `409`. An unknown record or parent returns `404`. Delete returns `{ "ok": true }`. Deleting a record that still has children, or that is still used by an asset, returns `409`. Moving an element, sub element, or BCIS sub reference to a different parent while an asset uses it returns `409`.

## Maintenance types

These routes require the session cookie. Maintenance types are shared catalog data, so access is the permission below and does not depend on client membership. The `admin` role receives `maintenanceTypes:view`, `maintenanceTypes:create`, `maintenanceTypes:edit`, and `maintenanceTypes:delete` on the next boot. Each record is `{ "id", "code", "name", "description", "sortOrder", "isActive", "createdAt", "updatedAt" }`. `description` may be null. `code` is unique. `sortOrder` is an integer and defaults to `0`. Lists are ordered by `sortOrder`, then code.

| Action | Request | Permission |
| --- | --- | --- |
| List maintenance types | `GET /maintenance-types` | `maintenanceTypes:view` |
| Create maintenance type | `POST /maintenance-types` | `maintenanceTypes:create` |
| Read maintenance type | `GET /maintenance-types/:id` | `maintenanceTypes:view` |
| Update maintenance type | `PATCH /maintenance-types/:id` | `maintenanceTypes:edit` |
| Delete maintenance type | `DELETE /maintenance-types/:id` | `maintenanceTypes:delete` |

Create a maintenance type with `{ "code", "name", "description", "sortOrder", "isActive" }`. `code` and `name` are required. `sortOrder` defaults to `0` and `isActive` defaults to true. Update a maintenance type with any of those fields. A duplicate code returns `409`. An unknown maintenance type returns `404`. Delete returns `{ "ok": true }`. Deleting a maintenance type that is still used by a maintenance schedule or a work order returns `409`.

## Clients

These routes require the session cookie. Contacts, sites, and settings use the parent client's permission. There is no separate contact, site, or settings permission. The `admin` role receives `clients:view`, `clients:create`, `clients:edit`, and `clients:delete` on the next boot.

A user with the `admin` role can see every client. Any other user can see a client only as its sponsor or as one of its members. The client lead is a contact, so that link does not grant access. The same rule covers the client's contacts, sites, logo, and settings. A sponsor, a member, or an admin can view, add, edit, and delete that client's locations, assets, maintenance schedules, work orders, and audits without a `clients` permission. Anyone else receives `404`. A hidden client returns `404`, including its contacts, sites, locations, assets, maintenance schedules, work orders, and audits. `GET /clients` lists only the clients that user can see. Creating a client adds the creator as a member, unless the creator is an admin.

| Action | Request | Permission |
| --- | --- | --- |
| List clients | `GET /clients` | `clients:view` |
| Create client | `POST /clients` | `clients:create` |
| Read client | `GET /clients/:id` | `clients:view` |
| Update client | `PATCH /clients/:id` | `clients:edit` |
| Upload logo | `PUT /clients/:id/logo` | `clients:edit` |
| Delete client | `DELETE /clients/:id` | `clients:delete` |
| Add contact | `POST /clients/:id/contacts` | `clients:edit` |
| Update contact | `PATCH /clients/:id/contacts/:contactId` | `clients:edit` |
| Delete contact | `DELETE /clients/:id/contacts/:contactId` | `clients:edit` |
| Create site | `POST /clients/:id/sites` | `clients:create` |
| Read site | `GET /sites/:id` | `clients:view` |
| Update site | `PATCH /sites/:id` | `clients:edit` |
| List locations | `GET /sites/:id/locations` | Client member |
| Create location | `POST /sites/:id/locations` | Client member |
| Read location | `GET /locations/:id` | Client member |
| Update location | `PATCH /locations/:id` | Client member |
| Delete location | `DELETE /locations/:id` | Client member |
| List site assets | `GET /sites/:id/assets` | Client member |
| List location assets | `GET /locations/:id/assets` | Client member |
| Create asset | `POST /locations/:id/assets` | Client member |
| Read asset | `GET /assets/:id` | Client member |
| Update asset | `PATCH /assets/:id` | Client member |
| Delete asset | `DELETE /assets/:id` | Client member |
| List asset maintenance schedules | `GET /assets/:id/maintenance-schedules` | Client member |
| Create maintenance schedule | `POST /assets/:id/maintenance-schedules` | Client member |
| Read maintenance schedule | `GET /maintenance-schedules/:id` | Client member |
| Update maintenance schedule | `PATCH /maintenance-schedules/:id` | Client member |
| Delete maintenance schedule | `DELETE /maintenance-schedules/:id` | Client member |
| List work orders | `GET /work-orders` | Client member |
| List asset work orders | `GET /assets/:id/work-orders` | Client member |
| Create work order | `POST /assets/:id/work-orders` | Client member |
| Read work order | `GET /work-orders/:id` | Client member |
| Update work order | `PATCH /work-orders/:id` | Client member |
| Delete work order | `DELETE /work-orders/:id` | Client member |
| Search | `GET /search?q=` | Client member |
| List audits | `GET /audits` | Client member |
| List client audits | `GET /clients/:id/audits` | Client member |
| Create audit | `POST /clients/:id/audits` | Client member |
| Read audit | `GET /audits/:id` | Client member |
| Update audit | `PATCH /audits/:id` | Client member |
| Delete audit | `DELETE /audits/:id` | Client member |
| Update settings | `PATCH /clients/:id/settings` | `clients:edit` |
| List users for settings | `GET /clients/users` | `clients:edit` |

Create a client with `{ "name", "reference", "address", "contacts" }`. `reference` is required, trimmed, at most 200 characters, and unique. It cannot be cleared. A duplicate reference returns `409`. `contacts` is optional. `address` is `{ "line1", "line2", "city", "county", "postcode", "country" }`. `line1`, `city`, `postcode`, and `country` are required. A contact is `{ "name", "role", "email", "telephone" }`. `role` is a job title. `role`, `email`, and `telephone` are optional. Update a client with any of `{ "name", "reference", "address" }`. An address update may send only the fields that changed. Contacts are added, updated, and deleted on their own routes.

A client response is `{ "id", "name", "reference", "logoUrl", "address", "contacts", "createdAt", "updatedAt" }`. `reference` is a string. `GET /clients` omits `sites` and `settings`. A single client, including create, update, logo, contact, and settings responses, also includes `sites` and `settings`. `settings` is `{ "leadContact", "sponsor", "members" }`. `leadContact` is a contact `{ "id", "name", "role", "email", "telephone" }`, or `null`. `sponsor` is a user `{ "id", "email", "name" }`, or `null`. `members` is that same user shape, ordered by name. Update settings with any of `{ "leadContactId", "sponsorUserId", "memberIds" }`. Send `null` to clear the lead or sponsor. `memberIds` replaces the member list. The lead must be a contact on that client. The sponsor and members must be users. An unknown contact or user returns `404`. `GET /clients/users` returns `{ "users" }` as `{ "id", "email", "name" }`, ordered by name, for choosing a sponsor and members. It does not require `users:view` and does not include roles or permissions. `logoUrl` is a presigned read URL that lasts one hour, or `null`. The stored object key is not returned. Each contact includes `id`, `name`, `role`, `email`, `telephone`, `createdAt`, and `updatedAt`. Create client and add contact return `201`. Delete client and delete contact return `{ "ok": true }`. An unknown client or contact returns `404`. Deleting a contact that is assigned to a site returns `409`. Deleting a contact who is the client lead clears that lead.

Create a site with `{ "name", "reference", "address", "contactId" }`. `reference` is optional and may be null. An empty reference is stored as null. `contactId` must be a contact on that client. Update a site with any of `{ "name", "reference", "address", "contactId" }`. A site response is `{ "id", "name", "reference", "address", "contact", "locationCount", "locations", "createdAt", "updatedAt" }`. The contact is `{ "id", "name", "role", "email", "telephone" }`. `GET /sites/:id` and `PATCH /sites/:id` also include `client` as `{ "id", "name", "reference", "logoUrl" }`. Each site on a client omits `client`, `locationCount`, and `locations`. Sites are ordered by name. Create site returns `201`. An unknown site, or a contact that is missing or belongs to another client, returns `404`.

`GET /sites/:id/locations` returns `{ "locationCount", "locations" }` for a sponsor, a member, or an admin. `locations` is ordered by name. Each location on that list is `{ "id", "siteId", "locationCode", "name", "createdAt", "updatedAt" }`. `GET /locations/:id`, create, and `PATCH /locations/:id` also include `client` as `{ "id", "name" }`. `locationCode` and `name` are optional and may be null. `locationCode` is at most 100 characters and `name` is at most 255. Create a location with `{ "locationCode", "name" }`. Update a location with any of those fields. Send null or an empty string to clear one. Create location returns `201`. Delete location returns `{ "ok": true }`. An unknown location returns `404`. Deleting a location deletes its assets. Deleting a client deletes its sites, its locations, its assets, and its audits.

`GET /locations/:id/assets` returns `{ "assetCount", "assets" }` for a sponsor, a member, or an admin of that location's client. Those assets are ordered by reference. `GET /sites/:id/assets` returns the same shape for every asset on that site's locations, ordered by location name, then location code, then reference. Each asset is `{ "id", "client", "locationId", "location", "assetTypeId", "assetType", "groupId", "group", "elementId", "element", "subElementId", "subElement", "bcisRefId", "bcisRef", "bcisSubRefId", "bcisSubRef", "assetRef", "assetName", "description", "quantity", "unitOfMeasure", "installationDate", "estimatedAgeYears", "expectedLifeYears", "status", "createdAt", "updatedAt" }`. `client` is `{ "id", "name" }`. `location` is `{ "id", "siteId", "locationCode", "name" }`. `assetType`, `group`, `element`, `subElement`, `bcisRef`, and `bcisSubRef` are `{ "id", "code", "name" }`, or `null`. `assetName`, `description`, `quantity`, `unitOfMeasure`, `installationDate`, `estimatedAgeYears`, and `expectedLifeYears` may be null. `assetRef` is required and is at most 100 characters. `unitOfMeasure` is at most 30 characters. `quantity` has up to 2 decimal places. `installationDate` is `YYYY-MM-DD`. `estimatedAgeYears` and `expectedLifeYears` are zero or greater. `status` is `active`, `inactive`, `out_of_service`, `decommissioned`, `disposed`, `proposed`, `under_installation`, `awaiting_commissioning`, or `deleted`, and defaults to `active`. Create an asset with `{ "assetTypeId", "assetRef", "assetName", "description", "quantity", "unitOfMeasure", "installationDate", "estimatedAgeYears", "expectedLifeYears", "status", "groupId", "elementId", "subElementId", "bcisRefId", "bcisSubRefId" }`. `assetTypeId` and `assetRef` are required. The classification ids are optional. An element must belong to the selected group, a sub element must belong to the selected element, and a BCIS sub reference must belong to the selected BCIS reference. Sending a child without its parent returns `400`. The location comes from the URL and cannot be changed. Update an asset with any of those fields. Send null or an empty string to clear an optional text or date field. Send null to clear quantity, a year count, or a classification id. Create asset returns `201`. Delete asset returns `{ "ok": true }` and removes the row. Setting `status` to `deleted` keeps the row. An unknown site, location, asset, or asset type returns `404`. Deleting an asset deletes its maintenance schedules and its work orders, and removes it from any audits.

`GET /assets/:id/maintenance-schedules` returns `{ "maintenanceScheduleCount", "maintenanceSchedules" }` for a sponsor, a member, or an admin of that asset's client. Schedules are ordered by next due date, then name. Each schedule is `{ "id", "assetId", "asset", "location", "client", "maintenanceTypeId", "maintenanceType", "reference", "name", "description", "frequencyValue", "frequencyUnit", "autoWorkorder", "startDate", "lastCompletedDate", "nextDueDate", "estimatedDurationMinutes", "estimatedCost", "isActive", "createdAt", "updatedAt" }`. `asset` is `{ "id", "assetRef", "assetName", "locationId" }`. `location` is `{ "id", "siteId", "locationCode", "name" }`. `client` is `{ "id", "name" }`. `maintenanceType` is `{ "id", "code", "name" }`. `name` is required and is at most 255 characters. `description`, `startDate`, `lastCompletedDate`, `nextDueDate`, `estimatedDurationMinutes`, and `estimatedCost` may be null. Dates are `YYYY-MM-DD`. `frequencyValue` is an integer greater than zero. `frequencyUnit` is `days`, `weeks`, `months`, or `years`. `estimatedDurationMinutes` is zero or greater. `estimatedCost` has up to 2 decimal places. `autoWorkorder` defaults to false. `isActive` defaults to true. Create a schedule with `{ "name", "maintenanceTypeId", "frequencyValue", "frequencyUnit", "description", "autoWorkorder", "startDate", "lastCompletedDate", "nextDueDate", "estimatedDurationMinutes", "estimatedCost", "isActive" }`. `name`, `maintenanceTypeId`, `frequencyValue`, and `frequencyUnit` are required. `reference` is assigned when the schedule is created and cannot be changed. It is `{client reference}-MS-{number}`, starting at 1 for each client, such as `ACME-MS-1`. Maintenance schedule and work order numbers are counted separately. Changing the client reference does not change numbers already assigned. The asset comes from the URL and cannot be changed. Update a schedule with any of the create fields. Send null or an empty string to clear a date or the description. Send null to clear the duration or cost. Create schedule returns `201`. Delete schedule returns `{ "ok": true }` and removes the row. Setting `isActive` to false keeps the row. An unknown asset, schedule, or maintenance type returns `404`. Deleting a maintenance type that a schedule still uses returns `409`. Deleting a schedule clears it from any work orders.

`GET /work-orders` returns `{ "workOrderCount", "workOrders" }` for every work order on a client the user can access: a sponsor, a member, or an admin. `GET /assets/:id/work-orders` returns the same shape for one asset. Work orders are ordered by due date, then title. Each work order is `{ "id", "assetId", "asset", "location", "client", "scheduleId", "schedule", "maintenanceTypeId", "maintenanceType", "assignedTo", "assignee", "reference", "title", "description", "priority", "status", "dueDate", "scheduledDate", "completedAt", "createdAt", "updatedAt" }`. `asset` is `{ "id", "assetRef", "assetName", "locationId" }`. `location` is `{ "id", "siteId", "locationCode", "name" }`. `client` is `{ "id", "name" }`. `schedule` is `{ "id", "name" }`, or `null`. `maintenanceType` is `{ "id", "code", "name" }`. `assignee` is a user `{ "id", "email", "name" }`, or `null`. `title` is required and is at most 255 characters. `description`, `scheduleId`, `assignedTo`, `dueDate`, `scheduledDate`, and `completedAt` may be null. `dueDate` and `scheduledDate` are `YYYY-MM-DD`. `completedAt` is a timestamp. `priority` is `low`, `medium`, `high`, or `critical`, and defaults to `medium`. `status` is `open`, `scheduled`, `in_progress`, `on_hold`, `completed`, or `cancelled`, and defaults to `open`. Create a work order with `{ "title", "maintenanceTypeId", "scheduleId", "description", "priority", "status", "dueDate", "scheduledDate", "assignedTo", "completedAt" }`. `title` and `maintenanceTypeId` are required. `reference` is assigned when the work order is created and cannot be changed. It is `{client reference}-WO-{number}`, starting at 1 for each client, such as `ACME-WO-1`. Maintenance schedule and work order numbers are counted separately. Changing the client reference does not change numbers already assigned. The asset comes from the URL and cannot be changed. A schedule must belong to that asset. A visible schedule on another asset returns `400`. Update a work order with any of the create fields. Send null or an empty string to clear the description or a date. Send null to clear `scheduleId`, `assignedTo`, or `completedAt`. Setting `status` to `completed` does not fill `completedAt`. Create work order returns `201`. Delete work order returns `{ "ok": true }` and removes the row. An unknown asset, work order, maintenance type, schedule, or assignee returns `404`. Deleting a maintenance type that a work order still uses returns `409`. Deleting an asset deletes its work orders. Deleting a schedule clears `scheduleId`. Deleting an assigned user clears `assignedTo`.

`GET /search?q=` returns `{ "results" }` for a sponsor, a member, or an admin. An empty `q` returns no results. `q` is at most 100 characters. The list contains at most 20 matches, ordered by relevance: an exact match, then a value that starts with the query, then a value that contains it. A site matches its name or reference. A location matches its name or location code. An asset matches its name or reference. A maintenance schedule matches its name or reference. A work order matches its title or reference. Each result is `{ "type", "id", "name", "client" }`. `type` is `site`, `location`, `asset`, `maintenanceSchedule`, or `workOrder`. `client` is `{ "id", "name" }`. A location also has `siteId` and `locationCode`. An asset also has `assetRef` and `locationId`. A maintenance schedule and a work order also have `assetId`. A location name falls back to its location code. An asset name falls back to its reference. Records on a hidden client are omitted.

`GET /audits` returns `{ "auditCount", "audits" }` for every audit on a client the user can access: a sponsor, a member, or an admin. `GET /clients/:id/audits` returns the same shape for one client. Audits are ordered by due date, then title. Each audit is `{ "id", "title", "projectReference", "status", "description", "startDate", "dueDate", "lead", "client", "assets", "createdAt", "updatedAt" }`. `title` is required and is at most 200 characters. `projectReference` is required and is at most 100 characters. `description`, `startDate`, and `dueDate` may be null. `startDate` and `dueDate` are `YYYY-MM-DD`. When both are set, the due date must be on or after the start date. `status` is `scheduled`, `in_progress`, or `completed`, and defaults to `scheduled`. `lead` is a user `{ "id", "email", "name" }`, or `null`. `client` is `{ "id", "name" }`. `assets` is `{ "id", "assetRef", "assetName", "locationId" }[]`, ordered by reference. Each asset must belong to that client. Create an audit with `{ "title", "projectReference", "status", "description", "startDate", "dueDate", "leadUserId", "assetIds" }`. `title` and `projectReference` are required. The client comes from the URL and cannot be changed. `assetIds` replaces the linked assets. Send an empty array to clear them. Send null to clear the lead, description, or a date. Create audit returns `201`. Delete audit returns `{ "ok": true }`. An unknown client, audit, lead, or asset returns `404`. Deleting a client deletes its audits. Deleting a user who is a lead clears that lead.

Upload a logo as multipart form data with one field named `logo`. The file must be a JPEG, PNG, or WebP image of 2 MB or less. The API stores it in the private Neon `assets` bucket and replaces any previous logo. Deleting a client deletes its logo, its contacts, its sites, its locations, its assets, its audits, and its settings.

## Auth0 setup

Auth0 checks the password. This API creates the account, stores the profile, and decides which roles that person has. Do not create users, roles, or permissions in the Auth0 dashboard. Do not create an Auth0 API for this product.

If you already have a tenant, open [manage.auth0.com](https://manage.auth0.com) and start at step 2.

### 1. Create the account and tenant

1. Go to [auth0.com/signup](https://auth0.com/signup) and create an account.
2. When Auth0 asks for a tenant, pick a name and the **UK** region. The tenant address will look like `your-tenant.uk.auth0.com`.
3. That address is `AUTH0_DOMAIN`. Copy the host only. Leave off `https://` and any path.

### 2. Turn off public sign-up and social login

1. Open **Authentication → Database**.
2. Open **Username-Password-Authentication**. Leave this name as it is. The API asks Auth0 for this connection by that exact name.
3. Turn **Disable Sign Ups** on and save.
4. Open **Authentication → Social** and disable every connection, including Google.
5. Under the database connection's **Authentication Methods** or password policy, note the password rules. New tenants usually require at least 8 characters and a mix of uppercase, lowercase, numbers, and symbols. The first admin password and every password created in the app must satisfy that policy.

### 3. Create the sign-in application

This application holds the secret used when a person signs in. Do not create a Single Page Application.

1. Open **Applications → Applications → Create Application**.
2. Name it `Asset Management`.
3. Choose **Regular Web Application** and create it.
4. Open **Advanced Settings → Grant Types**. Turn **Password** on. Turn **Implicit** off. Save.
5. Copy **Client ID** and **Client Secret**. Those are `AUTH0_CLIENT_ID` and `AUTH0_CLIENT_SECRET`.

No callback URL is required. The password form stays on the web app, and this API sends the credentials to Auth0.

### 4. Create the management application

This application lets the API create and update passwords. It is separate from the sign-in application.

1. Open **Applications → Applications → Create Application**.
2. Name it `Asset Management Management`.
3. Choose **Machine to Machine Applications**.
4. When Auth0 asks which API it should call, choose **Auth0 Management API**.
5. Grant only these permissions:
   - `read:users`
   - `create:users`
   - `update:users`
   - `delete:users`
6. Create and authorize the application.
7. Open the application's **Settings** and copy **Client ID** and **Client Secret**. Those are `AUTH0_MGMT_CLIENT_ID` and `AUTH0_MGMT_CLIENT_SECRET`.

If the application already exists, open **Applications → APIs → Auth0 Management API → Machine to Machine Applications**, authorize it, and select those four permissions.

### 5. Put the values in the environment

Use the same Auth0 applications locally and on Render.

| Variable | Local | Render |
| --- | --- | --- |
| `AUTH0_DOMAIN` | `your-tenant.uk.auth0.com` | Same host |
| `AUTH0_CLIENT_ID` | Sign-in client ID | Same client ID |
| `AUTH0_CLIENT_SECRET` | Sign-in client secret | Same client secret |
| `AUTH0_MGMT_CLIENT_ID` | Management client ID | Same client ID |
| `AUTH0_MGMT_CLIENT_SECRET` | Management client secret | Same client secret |
| `WEB_APP_ORIGIN` | `http://localhost:3000` | `https://<your-web-app-host>` |
| `BOOTSTRAP_ADMIN_EMAIL` | Your email | Same email |
| `BOOTSTRAP_ADMIN_PASSWORD` | A password that meets the Auth0 policy | Same password, until the first boot succeeds |
| `AWS_ACCESS_KEY_ID` | Neon storage access key | Same access key |
| `AWS_SECRET_ACCESS_KEY` | Neon storage secret | Same secret |
| `AWS_ENDPOINT_URL_S3` | Branch storage endpoint | Same endpoint |
| `AWS_REGION` | Storage region, such as `us-east-2` | Same region |
| `ASSETS_BUCKET` | `assets` | `assets` |

`AUTH0_DOMAIN` is the hostname only. `WEB_APP_ORIGIN` is the web app origin allowed by CORS, with no path.

Remove `AUTH0_REDIRECT_URI` and `AUTH0_AUDIENCE` if they are still set. Sign-in no longer redirects to Auth0.

Create Neon storage credentials for the same branch as `DATABASE_URL`, with `storage:read` and `storage:write`. The `assets` bucket stays private. Render does not inject these values.

### 6. Start the API and sign in

1. Start the API. On boot it seeds the permission catalog, gives every permission to the `admin` role, creates an Auth0 login for `BOOTSTRAP_ADMIN_EMAIL`, and creates a local admin user when nobody can edit users and roles.
2. If that email already has an Auth0 login, the API links it and does not change the password. Sign in with the existing password.
3. Sign in from the web app form. That posts to `/api/auth/login`. Do not send the browser to Auth0.
4. Create every later user and role from the app. Assign permissions from the catalog. Do not add users or roles in the Auth0 dashboard.
5. After `GET /api/auth/me` shows the admin user, remove `BOOTSTRAP_ADMIN_PASSWORD` from the environment and restart. Leave the email unset as well, or leave both. The admin already exists, so later boots will not reset the password.

A role change is saved in the database and applies on the next request. The person does not have to sign in again.

## Render

`render.yaml` lists the Auth0, storage, and bootstrap variables with `sync: false`. Set them in the Render dashboard for `asset-management-api` before deploying. Remove `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `AUTH0_REDIRECT_URI`, and `AUTH0_AUDIENCE` if they are still present. The process validates the environment at boot, so a deploy without the Auth0 sign-in, management, and Neon storage values fails and the service stays down.

Set the bootstrap email and password for the first deploy. After the admin can sign in, delete `BOOTSTRAP_ADMIN_PASSWORD` and redeploy.

## Database

Schema files live in `src/db/schema` and are re-exported from `src/db/schema/index.ts`. The server applies migrations in `drizzle/` before it listens. After a schema change:

```bash
npm run db:generate
```

Commit the generated SQL. The next deploy applies it.

## Deploy

Connect this repository to Render using `render.yaml`. Set the synced environment variables in the Render dashboard. The health check path is `/health`.
