-- 067: the testing bench rules move to the Java backend (Edashall Konah, 2026-10-29; the database keeps structures only).
-- Java checks them before every write (testing/domain: Batch, BatchEntry, BatchPlan, RunOrder, BenchStep, StepDepartment,
-- Witness, BenchValue, MaterialUse, EquipmentUse, IncubationLoad, AnalyticalRun, SplitRequest, AnalystPick; run by
-- testing/service BatchMakingService and BenchService through repo/BenchRepository), with JUnit tests in BenchRulesTest.
--
-- Dropped here (Java is now their only checker):
--   * the rule parts of test_batch_rules, batch_entry_rules, step_run_rules, entry_value_rules, entry_material_rules,
--     entry_equipment_rules, step_attachment_rules and incubation_load_rules (who may work on a step: its department,
--     a verification batch, a closed batch; a completed step's data; when a step may start; superseded entries and
--     shared daily controls; weights, plate counts, readings that exist, analytes on the test; lots usable, strains,
--     the amount used and its unit; equipment usable, in calibration, of the step's type; load times and corrections);
--   * entry_value_replicates_rule, entry_value_dilution_run, analytical_run_no_rules, reprep_request_rules (on
--     reprep_request, reanalysis_request and analytical_run) and split_request_rules;
--   * assign_batch, add_batch_items, remove_batch_entry, assert_batch_editable, batch_samples_changed, request_reprep,
--     request_reanalysis, reopen_step, decide_split_request, set_analyst_pick, clear_analyst_pick and
--     add_analytical_run_diluted: only the testing routes called them, now Java's (BatchMakingService, BenchService).
--
-- Kept, with Java's own copy for Java's writes:
--   * create_batch, batch_order, complete_step, sign_witness, add_analytical_run: the demo data load (seeds 014 to 032)
--     and Node's automated verification run call them; step_run_missing: the batch page's read model, and it reads the
--     results (QC Review's batch_results); Java asks it what is missing and decides itself;
--   * can_perform_step, user_in_department, step_department, assert_can_perform, assert_step_open, entry_runs,
--     testing_internal: called by the kept functions above, QC Review, logbooks and Node's OOS checks;
--   * batch_started, batch_client_sample_count: read models (the batch page, open batches);
--   * the cascades on these tables: step_started, step_run_fields_started, incubation_load_started (first data starts
--     the step), entry_material_stock (the lot's Usage and return), make_split_requests and send_split_alerts (Split off
--     step completed), test_batch_orders and test_batch_status_orders (order status), review_marks_on_reopen: the kept
--     functions and Node's verification run rely on them, and Java's writes fire them so nothing is done twice;
--   * other features' rules on these tables: entry_material_media_rule (QA testing of lots), entry_material_logbook and
--     entry_value_aliquot_rule (logbooks), step_run_training_gate (training), media_qualification_decide.
-- Every permission check of these triggers stays (a later wave moves the permission triggers), and assigning a batch,
-- picking a reading and deciding a split-off request get their permission check here, as their functions had it.
-- Sandbox only: other writers of these tables (data load scripts, Node's verification run) are no longer checked by the
-- dropped rules.

-- test_batch: who may change a batch (assigning needs testing.assign)
CREATE OR REPLACE FUNCTION test_batch_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF testing_internal() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('testing.perform', NEW.site_id);
    IF TG_OP = 'UPDATE' AND NEW.assigned_to <> OLD.assigned_to THEN PERFORM require_permission_at('testing.assign', NEW.site_id); END IF;
    RETURN NEW;
END $$;

-- the bench tables: bench rights in the batch's lab
CREATE OR REPLACE FUNCTION bench_permission_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid;
BEGIN
    IF testing_internal() THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'batch_entry' THEN
        SELECT site_id INTO v_site FROM test_batch WHERE id = NEW.batch_id;
    ELSE
        SELECT b.site_id INTO v_site FROM step_run r JOIN test_batch b ON b.id = r.batch_id
         WHERE r.id = CASE WHEN TG_TABLE_NAME = 'step_run' THEN (to_jsonb(NEW)->>'id')::uuid ELSE (to_jsonb(NEW)->>'step_run_id')::uuid END;
        IF TG_TABLE_NAME = 'step_run' AND v_site IS NULL THEN SELECT site_id INTO v_site FROM test_batch WHERE id = (to_jsonb(NEW)->>'batch_id')::uuid; END IF;
    END IF;
    PERFORM require_permission_at('testing.perform', v_site);
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a01_rules ON batch_entry;
DROP FUNCTION IF EXISTS batch_entry_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON batch_entry FOR EACH ROW EXECUTE FUNCTION bench_permission_rule();
DROP TRIGGER IF EXISTS a01_rules ON step_run;
DROP FUNCTION IF EXISTS step_run_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON step_run FOR EACH ROW EXECUTE FUNCTION bench_permission_rule();
DROP TRIGGER IF EXISTS a01_rules ON entry_value;
DROP FUNCTION IF EXISTS entry_value_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON entry_value FOR EACH ROW EXECUTE FUNCTION bench_permission_rule();
DROP TRIGGER IF EXISTS a02_replicates ON entry_value;
DROP FUNCTION IF EXISTS entry_value_replicates_rule();
DROP TRIGGER IF EXISTS a03_dilution_run ON entry_value;
DROP FUNCTION IF EXISTS entry_value_dilution_run();
DROP TRIGGER IF EXISTS a01_rules ON entry_material;
DROP FUNCTION IF EXISTS entry_material_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON entry_material FOR EACH ROW EXECUTE FUNCTION bench_permission_rule();
DROP TRIGGER IF EXISTS a01_rules ON entry_equipment;
DROP FUNCTION IF EXISTS entry_equipment_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON entry_equipment FOR EACH ROW EXECUTE FUNCTION bench_permission_rule();
DROP TRIGGER IF EXISTS a01_rules ON step_attachment;
DROP FUNCTION IF EXISTS step_attachment_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON step_attachment FOR EACH ROW EXECUTE FUNCTION bench_permission_rule();
DROP TRIGGER IF EXISTS a02_run ON entry_equipment;
DROP TRIGGER IF EXISTS a02_run ON step_attachment;
DROP FUNCTION IF EXISTS analytical_run_no_rules();
DROP TRIGGER IF EXISTS a01_rules ON incubation_load;
DROP FUNCTION IF EXISTS incubation_load_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON incubation_load FOR EACH ROW EXECUTE FUNCTION bench_permission_rule();

-- re-preps, re-analyses and analytical runs: written by Java (and by add_analytical_run) only
DROP TRIGGER IF EXISTS a01_rules ON reprep_request;
DROP TRIGGER IF EXISTS a01_rules ON reanalysis_request;
DROP TRIGGER IF EXISTS a01_rules ON analytical_run;
DROP FUNCTION IF EXISTS reprep_request_rules();

-- split-off requests: deciding needs orders.edit (they are raised by make_split_requests, internally)
CREATE OR REPLACE FUNCTION split_request_permission_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF testing_internal() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('orders.edit', (SELECT o.site_id FROM sample sm JOIN lab_order o ON o.id = sm.lab_order_id WHERE sm.id = NEW.sample_id));
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a01_rules ON split_request;
DROP FUNCTION IF EXISTS split_request_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON split_request FOR EACH ROW EXECUTE FUNCTION split_request_permission_rule();

-- the analyst's pick: testing.pick_run (it used QC Review's review_tables_rules)
CREATE OR REPLACE FUNCTION analyst_pick_permission_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF testing_internal() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('testing.pick_run', (SELECT site_id FROM test_batch WHERE id = NEW.batch_id));
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a01_rules ON analyst_pick;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON analyst_pick FOR EACH ROW EXECUTE FUNCTION analyst_pick_permission_rule();

-- the actions now Java's
DROP FUNCTION IF EXISTS assign_batch(uuid, uuid);
DROP FUNCTION IF EXISTS add_batch_items(uuid, jsonb);
DROP FUNCTION IF EXISTS remove_batch_entry(uuid);
DROP FUNCTION IF EXISTS batch_samples_changed(uuid);
DROP FUNCTION IF EXISTS assert_batch_editable(uuid);
DROP FUNCTION IF EXISTS request_reprep(uuid[], integer);
DROP FUNCTION IF EXISTS request_reanalysis(uuid, uuid[], integer);
DROP FUNCTION IF EXISTS reopen_step(uuid);
DROP FUNCTION IF EXISTS decide_split_request(uuid, text, text);
DROP FUNCTION IF EXISTS set_analyst_pick(uuid, integer, uuid, text);
DROP FUNCTION IF EXISTS clear_analyst_pick(uuid);
DROP FUNCTION IF EXISTS add_analytical_run_diluted(uuid, uuid[], integer, numeric, numeric);
