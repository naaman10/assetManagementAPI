CREATE TABLE "audit_control" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "audit_control_id_check" CHECK ("audit_control"."id" = true)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid,
	"actor_user_id" uuid,
	"actor_email" text,
	"actor_name" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_label" text,
	"client_id" uuid,
	"subject_type" text,
	"subject_id" text,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"changes" jsonb,
	CONSTRAINT "audit_events_action_check" CHECK ("audit_events"."action" IN ('created', 'updated', 'deleted'))
);
--> statement-breakpoint
CREATE INDEX "audit_events_client_occurred_idx" ON "audit_events" USING btree ("client_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "audit_events_entity_occurred_idx" ON "audit_events" USING btree ("entity_type","entity_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "audit_events_actor_occurred_idx" ON "audit_events" USING btree ("actor_user_id","occurred_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "audit_events_subject_occurred_idx" ON "audit_events" USING btree ("subject_type","subject_id","occurred_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "audit_events_request_idx" ON "audit_events" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX "audit_events_scope_gin" ON "audit_events" USING gin ("scope");
--> statement-breakpoint
INSERT INTO "audit_control" ("id", "enabled") VALUES (true, true);
--> statement-breakpoint
CREATE FUNCTION audit_label(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(BTRIM(value), '');
$$;
--> statement-breakpoint
CREATE FUNCTION audit_uuid(row_data jsonb, key text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF row_data ->> key IS NULL OR BTRIM(row_data ->> key) = '' THEN
    RETURN NULL;
  END IF;

  RETURN (row_data ->> key)::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION audit_scope(input jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_object_agg(key, value)
      FROM jsonb_each(input)
      WHERE jsonb_typeof(value) <> 'null'
    ),
    '{}'::jsonb
  );
$$;
--> statement-breakpoint
CREATE FUNCTION audit_changes(old_row jsonb, new_row jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_object_agg(
        field_name,
        jsonb_build_object('from', old_row -> field_name, 'to', new_row -> field_name)
      )
      FROM (
        SELECT jsonb_object_keys(old_row) AS field_name
        UNION
        SELECT jsonb_object_keys(new_row)
      ) fields
      WHERE field_name NOT IN ('created_at', 'updated_at')
        AND (old_row -> field_name) IS DISTINCT FROM (new_row -> field_name)
    ),
    '{}'::jsonb
  );
$$;
--> statement-breakpoint
CREATE FUNCTION audit_entity_id(table_name text, row_data jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  CASE table_name
    WHEN 'nrm3_classifications' THEN
      RETURN row_data ->> 'code';
    WHEN 'client_settings' THEN
      RETURN row_data ->> 'client_id';
    WHEN 'client_members' THEN
      RETURN (row_data ->> 'client_id') || ':' || (row_data ->> 'user_id');
    WHEN 'project_assets' THEN
      RETURN (row_data ->> 'project_id') || ':' || (row_data ->> 'asset_id');
    WHEN 'project_members' THEN
      RETURN (row_data ->> 'project_id') || ':' || (row_data ->> 'user_id');
    WHEN 'survey_record_users' THEN
      RETURN (row_data ->> 'survey_record_id') || ':' || (row_data ->> 'user_id');
    WHEN 'asset_comment_mentions' THEN
      RETURN (row_data ->> 'comment_id') || ':' || (row_data ->> 'user_id');
    WHEN 'user_roles' THEN
      RETURN (row_data ->> 'user_id') || ':' || (row_data ->> 'role_id');
    WHEN 'role_permissions' THEN
      RETURN (row_data ->> 'role_id') || ':' || (row_data ->> 'permission_id');
    WHEN 'project_type_field_definitions' THEN
      RETURN (row_data ->> 'source') || ':' || (row_data ->> 'field_key');
    ELSE
      RETURN row_data ->> 'id';
  END CASE;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION audit_asset_place(target_asset_id uuid)
RETURNS TABLE(client_id uuid, site_id uuid, location_id uuid, asset_label text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT s.client_id, l.site_id, a.location_id, COALESCE(audit_label(a.asset_name), audit_label(a.tag))
  FROM assets a
  JOIN locations l ON l.id = a.location_id
  JOIN sites s ON s.id = l.site_id
  WHERE a.id = target_asset_id;
$$;
--> statement-breakpoint
CREATE FUNCTION audit_describe(
  table_name text,
  row_data jsonb,
  OUT entity_id text,
  OUT entity_label text,
  OUT client_id uuid,
  OUT subject_type text,
  OUT subject_id text,
  OUT scope jsonb
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_site_id uuid;
  v_location_id uuid;
  v_asset_id uuid;
  v_project_id uuid;
BEGIN
  entity_id := audit_entity_id(table_name, row_data);

  CASE table_name
    WHEN 'clients' THEN
      client_id := audit_uuid(row_data, 'id');
      entity_label := audit_label(row_data ->> 'name');
      subject_type := 'clients';
      subject_id := entity_id;
    WHEN 'client_contacts' THEN
      client_id := audit_uuid(row_data, 'client_id');
      entity_label := audit_label(row_data ->> 'name');
      subject_type := 'clients';
      subject_id := row_data ->> 'client_id';
    WHEN 'client_members' THEN
      client_id := audit_uuid(row_data, 'client_id');
      subject_type := 'clients';
      subject_id := row_data ->> 'client_id';
      SELECT COALESCE(audit_label(u.name), audit_label(u.email))
      INTO entity_label
      FROM users u
      WHERE u.id = audit_uuid(row_data, 'user_id');
    WHEN 'client_settings' THEN
      client_id := audit_uuid(row_data, 'client_id');
      entity_label := 'Settings';
      subject_type := 'clients';
      subject_id := row_data ->> 'client_id';
    WHEN 'sites' THEN
      client_id := audit_uuid(row_data, 'client_id');
      v_site_id := audit_uuid(row_data, 'id');
      entity_label := audit_label(row_data ->> 'name');
      subject_type := 'sites';
      subject_id := entity_id;
    WHEN 'locations' THEN
      v_site_id := audit_uuid(row_data, 'site_id');
      v_location_id := audit_uuid(row_data, 'id');
      SELECT s.client_id INTO client_id FROM sites s WHERE s.id = v_site_id;
      entity_label := COALESCE(audit_label(row_data ->> 'name'), audit_label(row_data ->> 'location_code'));
      subject_type := 'locations';
      subject_id := entity_id;
    WHEN 'location_plans' THEN
      v_location_id := audit_uuid(row_data, 'location_id');
      SELECT s.client_id, l.site_id
      INTO client_id, v_site_id
      FROM locations l
      JOIN sites s ON s.id = l.site_id
      WHERE l.id = v_location_id;
      entity_label := audit_label(row_data ->> 'name');
      subject_type := 'locations';
      subject_id := row_data ->> 'location_id';
    WHEN 'location_plan_features' THEN
      v_location_id := audit_uuid(row_data, 'location_id');
      SELECT s.client_id, l.site_id
      INTO client_id, v_site_id
      FROM locations l
      JOIN sites s ON s.id = l.site_id
      WHERE l.id = v_location_id;
      entity_label := COALESCE(audit_label(row_data ->> 'label_override'), 'Plan feature');
      subject_type := 'locations';
      subject_id := row_data ->> 'location_id';
    WHEN 'assets' THEN
      v_location_id := audit_uuid(row_data, 'location_id');
      v_asset_id := audit_uuid(row_data, 'id');
      SELECT s.client_id, l.site_id
      INTO client_id, v_site_id
      FROM locations l
      JOIN sites s ON s.id = l.site_id
      WHERE l.id = v_location_id;
      entity_label := COALESCE(audit_label(row_data ->> 'asset_name'), audit_label(row_data ->> 'tag'));
      subject_type := 'assets';
      subject_id := entity_id;
    WHEN 'asset_comments' THEN
      v_asset_id := audit_uuid(row_data, 'asset_id');
      SELECT p.client_id, p.site_id, p.location_id
      INTO client_id, v_site_id, v_location_id
      FROM audit_asset_place(v_asset_id) p;
      entity_label := audit_label(left(row_data ->> 'body', 120));
      subject_type := 'assets';
      subject_id := row_data ->> 'asset_id';
    WHEN 'asset_comment_mentions' THEN
      SELECT p.client_id, p.site_id, p.location_id, c.asset_id
      INTO client_id, v_site_id, v_location_id, v_asset_id
      FROM asset_comments c
      JOIN audit_asset_place(c.asset_id) p ON true
      WHERE c.id = audit_uuid(row_data, 'comment_id');
      SELECT COALESCE(audit_label(u.name), audit_label(u.email))
      INTO entity_label
      FROM users u
      WHERE u.id = audit_uuid(row_data, 'user_id');
      subject_type := 'assets';
      subject_id := v_asset_id::text;
    WHEN 'maintenance_schedules' THEN
      v_asset_id := audit_uuid(row_data, 'asset_id');
      SELECT p.client_id, p.site_id, p.location_id
      INTO client_id, v_site_id, v_location_id
      FROM audit_asset_place(v_asset_id) p;
      entity_label := COALESCE(audit_label(row_data ->> 'name'), audit_label(row_data ->> 'reference'));
      subject_type := 'assets';
      subject_id := row_data ->> 'asset_id';
    WHEN 'work_orders' THEN
      v_asset_id := audit_uuid(row_data, 'asset_id');
      SELECT p.client_id, p.site_id, p.location_id
      INTO client_id, v_site_id, v_location_id
      FROM audit_asset_place(v_asset_id) p;
      entity_label := COALESCE(audit_label(row_data ->> 'title'), audit_label(row_data ->> 'reference'));
      subject_type := 'assets';
      subject_id := row_data ->> 'asset_id';
    WHEN 'maintenance_history' THEN
      v_asset_id := audit_uuid(row_data, 'asset_id');
      SELECT p.client_id, p.site_id, p.location_id
      INTO client_id, v_site_id, v_location_id
      FROM audit_asset_place(v_asset_id) p;
      entity_label := audit_label(row_data ->> 'reference_number');
      subject_type := 'assets';
      subject_id := row_data ->> 'asset_id';
    WHEN 'maintenance_history_photos' THEN
      SELECT h.asset_id
      INTO v_asset_id
      FROM maintenance_history h
      WHERE h.id = audit_uuid(row_data, 'maintenance_history_id');
      SELECT p.client_id, p.site_id, p.location_id
      INTO client_id, v_site_id, v_location_id
      FROM audit_asset_place(v_asset_id) p;
      entity_label := COALESCE(audit_label(row_data ->> 'caption'), 'Photo');
      subject_type := 'assets';
      subject_id := v_asset_id::text;
    WHEN 'projects' THEN
      client_id := audit_uuid(row_data, 'client_id');
      v_project_id := audit_uuid(row_data, 'id');
      entity_label := audit_label(row_data ->> 'title');
      subject_type := 'projects';
      subject_id := entity_id;
    WHEN 'project_assets' THEN
      v_project_id := audit_uuid(row_data, 'project_id');
      v_asset_id := audit_uuid(row_data, 'asset_id');
      SELECT pr.client_id, l.site_id, a.location_id
      INTO client_id, v_site_id, v_location_id
      FROM projects pr
      LEFT JOIN assets a ON a.id = v_asset_id
      LEFT JOIN locations l ON l.id = a.location_id
      WHERE pr.id = v_project_id;
      SELECT COALESCE(audit_label(a.asset_name), audit_label(a.tag))
      INTO entity_label
      FROM assets a
      WHERE a.id = v_asset_id;
      subject_type := 'projects';
      subject_id := row_data ->> 'project_id';
    WHEN 'project_members' THEN
      v_project_id := audit_uuid(row_data, 'project_id');
      SELECT pr.client_id INTO client_id FROM projects pr WHERE pr.id = v_project_id;
      SELECT COALESCE(audit_label(u.name), audit_label(u.email))
      INTO entity_label
      FROM users u
      WHERE u.id = audit_uuid(row_data, 'user_id');
      subject_type := 'projects';
      subject_id := row_data ->> 'project_id';
    WHEN 'survey_records' THEN
      v_project_id := audit_uuid(row_data, 'project_id');
      v_asset_id := audit_uuid(row_data, 'asset_id');
      SELECT pr.client_id INTO client_id FROM projects pr WHERE pr.id = v_project_id;
      SELECT l.site_id, a.location_id, COALESCE(audit_label(a.asset_name), audit_label(a.tag))
      INTO v_site_id, v_location_id, entity_label
      FROM assets a
      JOIN locations l ON l.id = a.location_id
      WHERE a.id = v_asset_id;
      subject_type := 'projects';
      subject_id := row_data ->> 'project_id';
    WHEN 'survey_record_users' THEN
      v_project_id := audit_uuid(row_data, 'project_id');
      SELECT pr.client_id INTO client_id FROM projects pr WHERE pr.id = v_project_id;
      SELECT sr.asset_id INTO v_asset_id
      FROM survey_records sr
      WHERE sr.id = audit_uuid(row_data, 'survey_record_id');
      SELECT l.site_id, a.location_id
      INTO v_site_id, v_location_id
      FROM assets a
      JOIN locations l ON l.id = a.location_id
      WHERE a.id = v_asset_id;
      SELECT COALESCE(audit_label(u.name), audit_label(u.email))
      INTO entity_label
      FROM users u
      WHERE u.id = audit_uuid(row_data, 'user_id');
      subject_type := 'projects';
      subject_id := row_data ->> 'project_id';
    WHEN 'survey_record_photos' THEN
      SELECT sr.project_id, sr.asset_id
      INTO v_project_id, v_asset_id
      FROM survey_records sr
      WHERE sr.id = audit_uuid(row_data, 'survey_record_id');
      SELECT pr.client_id INTO client_id FROM projects pr WHERE pr.id = v_project_id;
      SELECT l.site_id, a.location_id
      INTO v_site_id, v_location_id
      FROM assets a
      JOIN locations l ON l.id = a.location_id
      WHERE a.id = v_asset_id;
      entity_label := 'Photo';
      subject_type := 'projects';
      subject_id := v_project_id::text;
    WHEN 'users' THEN
      entity_label := COALESCE(audit_label(row_data ->> 'name'), audit_label(row_data ->> 'email'));
      subject_type := 'users';
      subject_id := entity_id;
    WHEN 'user_roles' THEN
      subject_type := 'users';
      subject_id := row_data ->> 'user_id';
      SELECT audit_label(r.name) INTO entity_label FROM roles r WHERE r.id = audit_uuid(row_data, 'role_id');
    WHEN 'role_permissions' THEN
      subject_type := 'roles';
      subject_id := row_data ->> 'role_id';
      SELECT audit_label(p.name) INTO entity_label FROM permissions p WHERE p.id = audit_uuid(row_data, 'permission_id');
    WHEN 'project_type_field_definitions' THEN
      entity_label := audit_label(row_data ->> 'label');
      subject_type := 'project_type_field_definitions';
      subject_id := entity_id;
    WHEN 'project_type_fields' THEN
      entity_label := audit_label(row_data ->> 'field_key');
      subject_type := 'project_types';
      subject_id := row_data ->> 'project_type_id';
    WHEN 'asset_types', 'groups', 'elements', 'sub_elements', 'maintenance_types', 'project_types', 'roles', 'permissions' THEN
      entity_label := audit_label(row_data ->> 'name');
      subject_type := table_name;
      subject_id := entity_id;
    WHEN 'nrm3_classifications' THEN
      entity_label := audit_label(row_data ->> 'name');
      subject_type := 'nrm3_classifications';
      subject_id := entity_id;
    ELSE
      entity_label := entity_id;
      subject_type := table_name;
      subject_id := entity_id;
  END CASE;

  scope := audit_scope(jsonb_build_object(
    'clientId', client_id,
    'siteId', v_site_id,
    'locationId', v_location_id,
    'assetId', v_asset_id,
    'projectId', v_project_id,
    'subjectId', subject_id
  ));
END;
$$;
--> statement-breakpoint
CREATE FUNCTION audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  enabled boolean;
  row_data jsonb;
  change_set jsonb;
  described record;
  actor_id uuid;
  actor_email text;
  actor_name text;
  request_id uuid;
  action_name text;
BEGIN
  SELECT audit_control.enabled INTO enabled FROM audit_control WHERE audit_control.id IS TRUE;

  IF COALESCE(enabled, false) IS NOT TRUE THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    row_data := to_jsonb(OLD);
    action_name := 'deleted';
  ELSIF TG_OP = 'UPDATE' THEN
    change_set := audit_changes(to_jsonb(OLD), to_jsonb(NEW));
    IF change_set = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
    row_data := to_jsonb(NEW);
    action_name := 'updated';
  ELSE
    row_data := to_jsonb(NEW);
    action_name := 'created';
  END IF;

  SELECT *
  INTO described
  FROM audit_describe(TG_TABLE_NAME, row_data) AS audit_describe;

  BEGIN
    actor_id := NULLIF(current_setting('app.actor_user_id', true), '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      actor_id := NULL;
  END;

  BEGIN
    request_id := NULLIF(current_setting('app.request_id', true), '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      request_id := NULL;
  END;

  actor_email := NULLIF(BTRIM(COALESCE(current_setting('app.actor_email', true), '')), '');
  actor_name := NULLIF(BTRIM(COALESCE(current_setting('app.actor_name', true), '')), '');

  INSERT INTO audit_events (
    request_id,
    actor_user_id,
    actor_email,
    actor_name,
    action,
    entity_type,
    entity_id,
    entity_label,
    client_id,
    subject_type,
    subject_id,
    scope,
    before,
    after,
    changes
  ) VALUES (
    request_id,
    actor_id,
    actor_email,
    actor_name,
    action_name,
    TG_TABLE_NAME,
    described.entity_id,
    described.entity_label,
    described.client_id,
    described.subject_type,
    described.subject_id,
    COALESCE(described.scope, '{}'::jsonb),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    CASE WHEN TG_OP = 'UPDATE' THEN change_set ELSE NULL END
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION reject_audit_event_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND pg_trigger_depth() >= 2 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION reject_audit_event_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
BEFORE INSERT OR UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION reject_audit_event_write();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT
EXECUTE FUNCTION reject_audit_event_truncate();
--> statement-breakpoint
DO $$
DECLARE
  audited text;
BEGIN
  -- Keep this list in sync with AUDITED_TABLES in src/db/auditedTables.ts.
  FOREACH audited IN ARRAY ARRAY[
    'clients',
    'client_contacts',
    'client_members',
    'client_settings',
    'sites',
    'locations',
    'location_plans',
    'location_plan_features',
    'assets',
    'asset_comments',
    'asset_comment_mentions',
    'projects',
    'project_assets',
    'project_members',
    'survey_records',
    'survey_record_users',
    'survey_record_photos',
    'maintenance_schedules',
    'maintenance_history',
    'maintenance_history_photos',
    'work_orders',
    'asset_types',
    'groups',
    'elements',
    'sub_elements',
    'nrm3_classifications',
    'maintenance_types',
    'project_types',
    'project_type_field_definitions',
    'project_type_fields',
    'users',
    'user_roles',
    'roles',
    'role_permissions',
    'permissions'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()',
      'audit_' || audited || '_row',
      audited
    );
  END LOOP;
END $$;
