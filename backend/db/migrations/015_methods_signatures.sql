-- LIMS3 schema, migration 015: WORKFLOW DESIGNER, WD-1.3: every test workflow creation and change is signed
-- Alex Kiddle, 2026-10-13 ("add sign off to test workflow creation and changes"; vault: "Decision - Test Workflow
-- Changes Are Electronically Signed"). As in Inventory (migration 007) and the build-out deck (slide 22: every record with
-- user values, formulas included, takes permission + signature + reason to create or edit): creating a test, a new
-- version, a copy or a duplicate, and every change to a Draft (the test and reporting settings, analytes, steps, their
-- equipment types and connections) and to the lab's Methods (SOPs) list need the signer's user ID and password; changes
-- to existing records also need a reason (the database already asks for one on every update of a regulated record).
-- Approval was already signed ("Approved by"). The meaning is set by the action: Created by, Changed by.
-- Enforced here so no screen, script or upload can bypass it; seeds and rule tests sign as a data load script.

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);

CREATE FUNCTION require_methods_signature() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE what text := CASE TG_TABLE_NAME
        WHEN 'test' THEN 'a test' WHEN 'test_version' THEN 'a test version' WHEN 'test_version_analyte' THEN 'a test''s analytes'
        WHEN 'workflow_step' THEN 'a workflow step' WHEN 'workflow_step_equipment' THEN 'a step''s equipment types'
        WHEN 'workflow_step_dependency' THEN 'how the workflow steps connect' WHEN 'method' THEN 'a method (SOP)' ELSE replace(TG_TABLE_NAME, '_', ' ') END;
BEGIN
    IF TG_TABLE_NAME = 'test' THEN
        -- the test record is shared with the Test catalogue: signed when a lab's test is created or its department changes
        -- (renaming or retiring from the catalogue keeps its Reason for Change; the designer signs renames too)
        IF NEW.site_id IS NULL THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND NEW.department_id IS NOT DISTINCT FROM OLD.department_id AND NEW.site_id IS NOT DISTINCT FROM OLD.site_id THEN RETURN NEW; END IF;
    END IF;
    PERFORM assert_signed(CASE TG_OP WHEN 'INSERT' THEN 'create ' ELSE 'change ' END || what);
    RETURN NEW;
END $$;

CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON test FOR EACH ROW EXECUTE FUNCTION require_methods_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON test_version FOR EACH ROW EXECUTE FUNCTION require_methods_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON test_version_analyte FOR EACH ROW EXECUTE FUNCTION require_methods_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON workflow_step FOR EACH ROW EXECUTE FUNCTION require_methods_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON workflow_step_equipment FOR EACH ROW EXECUTE FUNCTION require_methods_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON workflow_step_dependency FOR EACH ROW EXECUTE FUNCTION require_methods_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON method FOR EACH ROW EXECUTE FUNCTION require_methods_signature();

COMMIT;
