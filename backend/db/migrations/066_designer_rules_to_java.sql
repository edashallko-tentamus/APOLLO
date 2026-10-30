-- 066: the Workflow Designer rules move to the Java backend (Edashall Konah, 2026-10-29; the database keeps structures only).
-- Java checks them before every write (methods/domain: TestDefinition, SopMethod, TestVersion, VersionAnalyte, WorkflowStep,
-- WorkflowGraph, Specification, Formula, QcCriteria, VersionDesign with its review; saved by methods/service through
-- repo/DesignStore), with JUnit tests in DesignerRulesTest. Java also creates, versions, duplicates, copies and approves
-- tests with its own code, checks formulas and works out the review and the QC limits per analyte itself.
--
-- Dropped here (Java is now their only checker):
--   * the rule parts of test_rules (a test never moves lab, its department is its lab's), method_rules (no move, trims),
--     test_version_rules (Draft on insert, never renumbered, frozen unless Draft, Effective only by approval),
--     specification_rules (no swapped owner or analyte, text and unit tidied, locked once quoted, a cancelled test, an
--     analyte of the test); their permission checks stay, as every permission trigger does until the permissions wave;
--   * assert_version_editable, tva_rules, tva_values, workflow_step_rules, workflow_step_cascade (z_cascade),
--     workflow_step_equipment_rules, workflow_step_dependency_rules (no loops), workflow_step_replicates_rule,
--     test_version_template_rule (a02_report_template);
--   * the "Report ±" rule of tva_uncertainty_rules and the tidy of tva_invalid_values_rules;
--   * the checks on method name, version rounding, analyte LOQ/LOD/rounding/suggested limits/uncertainty, step key, name
--     and settings, a step depending on itself, and a specification's limit and its order.
--
-- Kept, with Java's own copy for Java's writes:
--   * create_test, new_test_version, copy_test, copy_version_content, approve_test_version, test_version_authors:
--     called by the demo data loads (seed_010 to seed_032), Admin's quick test (AdminService) and trending's
--     "use these limits" (new_test_version); approve_test_version still calls version_verification (the gate);
--   * test_version_problems (and _014), qc_criteria, formula_check, formula_tokens, formula_lex, jnum_ok, field_key,
--     step_token_fields, step_ancestors: called by the workflow verification (024), the bench, QC Review, logbooks and
--     the Node verification; formula_eval stays the calculation engine's. The tests list still counts Errors with
--     test_version_problems (one query for all tests);
--   * the copy-forward triggers test_version_carry_028/030 and the carry parts of tva_uncertainty_rules and
--     tva_invalid_values_rules: the kept new_test_version and copy_test rely on them (Java copies explicitly);
--   * the trim in test_rules and test_test_name_check: the Java Test catalogue (pricing) renames tests without checking;
--   * specification_one_owner and the value lists (uncertainty_kind, basis): shapes, not rules;
--   * methods_internal, set_methods_internal, require_methods_permission and every signature trigger
--     (require_methods_signature).
-- Sandbox only: other writers of these tables (data load scripts, other features' database functions) are no longer
-- checked by the database.

-- test: the name trim and who may change it
CREATE OR REPLACE FUNCTION test_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.test_name := btrim(NEW.test_name);
    IF methods_internal() THEN RETURN NEW; END IF;
    IF NEW.site_id IS NOT NULL THEN
        IF NOT (has_permission_at('methods.design', NEW.site_id) OR has_permission_at('catalog.edit', NEW.site_id)) THEN
            PERFORM require_permission_at('methods.design', NEW.site_id);
        END IF;
    ELSIF NOT (has_permission('methods.design') OR has_permission('catalog.edit')) THEN
        RAISE EXCEPTION 'You do not have permission to change tests (methods.design or catalog.edit). Ask your lab administrator.';
    END IF;
    RETURN NEW;
END $$;

-- method: who may change it
CREATE OR REPLACE FUNCTION method_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('methods.design', NEW.site_id);
    RETURN NEW;
END $$;
ALTER TABLE method DROP CONSTRAINT IF EXISTS method_method_name_check;

-- test_version: who may change it
CREATE OR REPLACE FUNCTION test_version_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t test;
BEGIN
    IF methods_internal() THEN RETURN NEW; END IF;
    SELECT * INTO t FROM test WHERE id = NEW.test_id;
    IF NOT (has_permission_at('methods.design', t.site_id) OR has_permission_at('catalog.edit', t.site_id)) THEN
        PERFORM require_methods_permission('methods.design', t.site_id);
    END IF;
    RETURN NEW;
END $$;
ALTER TABLE test_version DROP CONSTRAINT IF EXISTS test_version_rounding_digits_check;
ALTER TABLE test_version DROP CONSTRAINT IF EXISTS test_version_sig_figs;
DROP TRIGGER IF EXISTS a02_report_template ON test_version;
DROP FUNCTION IF EXISTS test_version_template_rule();

-- analytes of a version: the rules and checks (the copy-forward of uncertainty and of the values that are not results stays)
DROP TRIGGER IF EXISTS a01_rules ON test_version_analyte;
DROP FUNCTION IF EXISTS tva_rules();
DROP TRIGGER IF EXISTS a02_values ON test_version_analyte;
DROP FUNCTION IF EXISTS tva_values();
CREATE OR REPLACE FUNCTION tva_uncertainty_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src uuid;
BEGIN
    IF TG_OP = 'INSERT' AND NEW.uncertainty IS NULL THEN
        SELECT copied_from_version_id INTO src FROM test_version WHERE id = NEW.test_version_id;
        IF src IS NOT NULL THEN
            SELECT a.uncertainty, a.uncertainty_kind, a.report_uncertainty INTO NEW.uncertainty, NEW.uncertainty_kind, NEW.report_uncertainty
              FROM test_version_analyte a WHERE a.test_version_id = src AND a.analyte_id = NEW.analyte_id AND a.status = 'Active' LIMIT 1;
            NEW.report_uncertainty := COALESCE(NEW.report_uncertainty, false);
        END IF;
    END IF;
    IF NEW.uncertainty IS NOT NULL AND NEW.uncertainty_kind IS NULL THEN NEW.uncertainty_kind := 'Unit'; END IF;
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tva_invalid_values_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src uuid;
BEGIN
    IF TG_OP = 'INSERT' AND cardinality(COALESCE(NEW.invalid_values, '{}')) = 0 THEN
        SELECT copied_from_version_id INTO src FROM test_version WHERE id = NEW.test_version_id;
        IF src IS NOT NULL THEN
            SELECT COALESCE(a.invalid_values, '{}') INTO NEW.invalid_values FROM test_version_analyte a
             WHERE a.test_version_id = src AND a.analyte_id = NEW.analyte_id AND a.status = 'Active' LIMIT 1;
        END IF;
        NEW.invalid_values := COALESCE(NEW.invalid_values, '{}');
    END IF;
    RETURN NEW;
END $$;
ALTER TABLE test_version_analyte DROP CONSTRAINT IF EXISTS test_version_analyte_loq_check;
ALTER TABLE test_version_analyte DROP CONSTRAINT IF EXISTS test_version_analyte_lod_check;
ALTER TABLE test_version_analyte DROP CONSTRAINT IF EXISTS test_version_analyte_rounding_digits_check;
ALTER TABLE test_version_analyte DROP CONSTRAINT IF EXISTS test_version_analyte_uncertainty_check;
ALTER TABLE test_version_analyte DROP CONSTRAINT IF EXISTS tva_lod_le_loq;
ALTER TABLE test_version_analyte DROP CONSTRAINT IF EXISTS tva_rounding_pair;
ALTER TABLE test_version_analyte DROP CONSTRAINT IF EXISTS tva_sig_figs;
ALTER TABLE test_version_analyte DROP CONSTRAINT IF EXISTS tva_spec_order;

-- workflow steps, their equipment types and connections
DROP TRIGGER IF EXISTS a01_rules ON workflow_step;
DROP FUNCTION IF EXISTS workflow_step_rules();
DROP TRIGGER IF EXISTS z_cascade ON workflow_step;
DROP FUNCTION IF EXISTS workflow_step_cascade();
DROP TRIGGER IF EXISTS a02_replicates ON workflow_step;
DROP FUNCTION IF EXISTS workflow_step_replicates_rule();
DROP TRIGGER IF EXISTS a01_rules ON workflow_step_equipment;
DROP FUNCTION IF EXISTS workflow_step_equipment_rules();
DROP TRIGGER IF EXISTS a01_rules ON workflow_step_dependency;
DROP FUNCTION IF EXISTS workflow_step_dependency_rules();
DROP FUNCTION IF EXISTS assert_version_editable(uuid);
ALTER TABLE workflow_step DROP CONSTRAINT IF EXISTS workflow_step_step_key_check;
ALTER TABLE workflow_step DROP CONSTRAINT IF EXISTS workflow_step_step_name_check;
ALTER TABLE workflow_step DROP CONSTRAINT IF EXISTS workflow_step_config_check;
ALTER TABLE workflow_step_dependency DROP CONSTRAINT IF EXISTS step_not_own_dependency;

-- specifications: who may change them only (the one-owner shape stays)
CREATE OR REPLACE FUNCTION specification_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid; rt requested_test;
BEGIN
    IF NEW.quoted_line_id IS NOT NULL THEN
        IF NOT has_permission('quotes.edit') THEN RAISE EXCEPTION 'You do not have permission to change quotes (quotes.edit). Ask your lab administrator.'; END IF;
    ELSE
        SELECT * INTO rt FROM requested_test WHERE id = NEW.requested_test_id;
        SELECT o.site_id INTO v_site FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = rt.sample_id;
        IF NOT (rt.media_lot_id IS NOT NULL AND media_internal()) THEN
            PERFORM require_permission_at('orders.edit', v_site);
        END IF;
    END IF;
    RETURN NEW;
END $$;
ALTER TABLE specification DROP CONSTRAINT IF EXISTS specification_has_limit;
ALTER TABLE specification DROP CONSTRAINT IF EXISTS specification_order;
