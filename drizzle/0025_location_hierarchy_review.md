# Location hierarchy migration review

Migration `0025_location_hierarchy` adds hierarchical columns to `locations` without classifying existing rows.

## Preserved

- All existing location UUIDs
- All `site_id` relationships
- All asset → location foreign keys
- Existing `location_code` / `name` values
- No inferred parent/child links from names
- No automatic `location_type` assignment

## New defaults for existing rows

| Column | Existing rows |
| --- | --- |
| `parent_location_id` | `NULL` (site roots) |
| `location_type` | `NULL` — **requires review** |
| `description`, `department`, `uprn`, `address`, `latitude`, `longitude` | `NULL` |
| `status` | `active` |

## Records requiring review

Any location with a null type is a legacy flat location. Until a type is set, it may only remain a site root (no parent).

```sql
SELECT
  l.id,
  l.site_id,
  s.name AS site_name,
  l.location_code,
  l.name,
  l.status,
  l.created_at
FROM locations l
JOIN sites s ON s.id = l.site_id
WHERE l.location_type IS NULL
ORDER BY s.name, l.name NULLS LAST, l.location_code NULLS LAST;
```

Count:

```sql
SELECT count(*) AS untyped_locations
FROM locations
WHERE location_type IS NULL;
```

The migration also emits a `NOTICE` with that count when it runs.

## Suggested follow-up

1. Review untyped rows per site.
2. Set `location_type` (`building`, `floor`, `room`, or `area`) where known.
3. Set `parent_location_id` only after types are correct (DB enforces allowed parent/child pairs).
4. Leave type null only for rows that should stay unclassified site-level locations.
