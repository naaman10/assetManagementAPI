DELETE FROM "project_type_field_definitions" WHERE "source" = 'survey_record' AND "field_key" = 'photos';
DROP TABLE IF EXISTS "survey_record_photos";
