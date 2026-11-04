# Frontend prompt: Project type focus

Add Project Type “focus” and branch project create/view/capture on it.

## API contract (backend shipping)

- Project type has `focus`: `"assets"` | `"sites_locations"` (default `assets`).
- `GET /api/project-type-field-catalog?focus=assets|sites_locations` (or use `focus` on each field).
  - `assets` → sources `asset`, `maintenance_history`, `survey_record` (unchanged)
  - `sites_locations` → sources `site`, `location`
- Create/update project type: include `focus`; fields must match focus.
- Project create/update:
  - `assets`: `assetIds[]` (unchanged); do not send `siteIds`/`locationIds`
  - `sites_locations`: `siteIds[]` and/or `locationIds[]` (client-owned); do not send `assetIds`
    - site-only expands to all locations under those sites
    - response includes `sites[]`, `locations[]` with `reviewStatus`
- Location capture (`sites_locations` only):
  - `GET`/`PUT /api/projects/:projectId/locations/:locationId/capture`
  - `PATCH .../locations/:locationId` `{ reviewStatus }`
  - Capture writes a project-specific location record; it does **not** update the master location

## UI

1. Project Types admin: required Focus select (Assets | Sites & Locations) on create/edit.
2. Field catalog picker: filter by selected focus.
3. Project create wizard:
   - Assets focus: keep current asset picker
   - Sites & Locations focus: site multi-select + location multi-select (locations filtered by selected sites / client); allow sites-only
4. Project detail:
   - Assets focus: existing asset list + asset capture
   - Sites & Locations focus: site/location tree or list with review status; open location capture form driven by configured site/location fields
5. Types: extend `ProjectType` with `focus`; `Project` with `siteIds`/`locationIds`/`locations`; capture types as needed for location records

## Out of scope

- Location-scoped surveys/maintenance history
- Writing capture back to master locations/sites
- Changing asset capture behavior
