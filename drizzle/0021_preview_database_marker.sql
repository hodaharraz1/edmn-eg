ALTER TABLE "deployment_environment" DROP CONSTRAINT "deployment_environment_chk";--> statement-breakpoint
ALTER TABLE "deployment_environment" ADD CONSTRAINT "deployment_environment_chk" CHECK ("deployment_environment"."environment" in ('DEVELOPMENT', 'TEST', 'STAGING', 'PRODUCTION', 'PREVIEW'));--> statement-breakpoint
-- Deployment safety: an isolated PREVIEW database and the shared databases can never be turned into one another.
-- Only an EMPTY database (no users) can be marked PREVIEW, and a PREVIEW marker is permanent. A copy of staging or
-- production therefore keeps its marker and is refused by every preview (scripts/preview-db-init.ts, deploy-policy.ts).
CREATE OR REPLACE FUNCTION edmn_deployment_environment_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.environment = 'PRODUCTION' AND (TG_OP = 'DELETE' OR NEW.environment <> 'PRODUCTION') THEN
    RAISE EXCEPTION 'a PRODUCTION database cannot be re-marked as %', CASE WHEN TG_OP = 'DELETE' THEN 'unmarked' ELSE NEW.environment END USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.environment IS DISTINCT FROM OLD.environment AND (OLD.environment = 'PREVIEW' OR NEW.environment = 'PREVIEW') THEN
    RAISE EXCEPTION 'a % database cannot be re-marked as %', OLD.environment, NEW.environment USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.environment = 'PREVIEW' THEN
    RAISE EXCEPTION 'a PREVIEW database cannot be unmarked' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION edmn_preview_marker_requires_empty_database() RETURNS trigger AS $$
BEGIN
  IF NEW.environment = 'PREVIEW' AND EXISTS (SELECT 1 FROM users) THEN
    RAISE EXCEPTION 'only an empty database can be marked PREVIEW (this one holds users)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER deployment_environment_preview_insert_guard BEFORE INSERT ON deployment_environment
  FOR EACH ROW EXECUTE FUNCTION edmn_preview_marker_requires_empty_database();
