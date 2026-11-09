-- L-2 Logbook values feed results (Alex, 2026-10-14: "add the pertaining logbooks for USP 61 and 62 tests and USP
-- 51"). Vault: Decision - Logbook Values Feed Results Through Scanned Materials (approved 2026-10-13) and Decision -
-- Electronic Logbooks L-1 and L-2. Built on migration 034.
--  - A logbook about lots publishes values (an inoculum's CFU per mL, a culture's passage). When the lot is scanned at a
--    bench step (Add material), the step offers those values to formulas: {inoc.cfu_inoculated} is the value
--    published for the lot scanned at the step "inoc". A lot that names organisms is used only for its organisms (each
--    organism's own inoculum).
--  - At the scan the entry is chosen: the approved one inside its validity window, else the analyst picks one; a lot
--    past its validity window is refused (an inoculum past its use-by time), like an out-of-calibration balance.
--  - Only an approved entry feeds a result: until QA approves it the result waits ("Waiting for QA to approve ..."),
--    but the bench work does not.
--  - A stored result keeps the values it used and the link to the entry. Correcting the entry later flags every result
--    that used it for review; a flagged result is not released until a reviewer resolves the flag.
--  - The pre-analytical sample weights logbook: an aliquot (its entry code is its barcode) is weighed on a balance in
--    calibration; scanning it at a Weighing step fills in the weight (and the balance). It is reviewed inside the batch:
--    QC Review shows each aliquot with who weighed it, when, the balance and its calibration, and every other aliquot of
--    the same sample; the reviewer may not be the person who weighed it; approving the batch reviews the aliquots.
--  - The release check (Report Finalization) refuses a result whose logbook entries are not approved or whose flag is
--    open.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 035: logbook values feed results', true);

-------------------------------------------------------------------------------
-- 1. THE LOT SCANNED AT A STEP CARRIES ITS LOGBOOK ENTRY
-------------------------------------------------------------------------------
ALTER TABLE entry_material ADD COLUMN logbook_entry_id uuid REFERENCES logbook_entry(id);
ALTER TABLE entry_value ADD COLUMN logbook_entry_id uuid REFERENCES logbook_entry(id);   -- a weight from a weighed aliquot

-- The entries of a lot whose values a formula can use (published fields), newest first
CREATE FUNCTION lot_value_entries(p_lot uuid) RETURNS TABLE (entry_id uuid, entry_code text, status text, valid_until timestamptz, entry_at timestamptz,
    logbook_code text, logbook_name text, review_route text, usable boolean) LANGUAGE sql STABLE AS $$
    SELECT e.id, e.entry_code, e.status, e.valid_until, e.entry_at, l.logbook_code, l.logbook_name, l.review_route,
           (e.valid_until IS NULL OR e.valid_until >= clock_timestamp())
      FROM logbook_entry e JOIN logbook l ON l.id = e.logbook_id
     WHERE e.lot_id = p_lot AND e.status <> 'Voided'
       AND EXISTS (SELECT 1 FROM logbook_field f WHERE f.version_id = e.version_id AND f.publish AND f.status = 'Active')
     ORDER BY e.entry_at DESC
$$;

CREATE FUNCTION entry_material_logbook() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n_all integer; n_ok integer; n_appr integer; c record; v_lot text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.logbook_entry_id IS DISTINCT FROM OLD.logbook_entry_id AND NOT testing_internal() THEN RAISE EXCEPTION 'Remove the material and scan it again'; END IF;
        RETURN NEW;
    END IF;
    SELECT count(*), count(*) FILTER (WHERE usable), count(*) FILTER (WHERE usable AND status = 'Approved') INTO n_all, n_ok, n_appr FROM lot_value_entries(NEW.lot_id);
    IF n_all = 0 THEN NEW.logbook_entry_id := NULL; RETURN NEW; END IF;   -- the lot carries no logbook values
    v_lot := (SELECT lot_code FROM inventory_lot WHERE id = NEW.lot_id);
    IF NEW.logbook_entry_id IS NOT NULL THEN
        SELECT * INTO c FROM lot_value_entries(NEW.lot_id) x WHERE x.entry_id = NEW.logbook_entry_id;
        IF c.entry_id IS NULL THEN RAISE EXCEPTION 'That logbook entry is not about lot %', v_lot; END IF;
        IF NOT c.usable THEN RAISE EXCEPTION '% (lot %) was usable until %: it is past its validity window and cannot be used', c.entry_code, v_lot, to_char(c.valid_until, 'YYYY-MM-DD HH24:MI'); END IF;
        RETURN NEW;
    END IF;
    IF n_ok = 0 THEN
        SELECT * INTO c FROM lot_value_entries(NEW.lot_id) x ORDER BY x.valid_until DESC NULLS LAST LIMIT 1;
        RAISE EXCEPTION 'Lot % is past its validity window (logbook entry %, usable until %): it cannot be used', v_lot, c.entry_code, to_char(c.valid_until, 'YYYY-MM-DD HH24:MI');
    END IF;
    IF n_appr = 1 THEN
        SELECT x.entry_id INTO NEW.logbook_entry_id FROM lot_value_entries(NEW.lot_id) x WHERE x.usable AND x.status = 'Approved';
    ELSIF n_appr = 0 AND n_ok = 1 THEN
        SELECT x.entry_id INTO NEW.logbook_entry_id FROM lot_value_entries(NEW.lot_id) x WHERE x.usable;   -- the result waits for QA
    ELSE
        RAISE EXCEPTION 'Lot % has % usable logbook entries (%): choose which one was used', v_lot, CASE WHEN n_appr > 1 THEN n_appr ELSE n_ok END,
            (SELECT string_agg(x.entry_code || ' ' || x.status, ', ') FROM lot_value_entries(NEW.lot_id) x WHERE x.usable);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER b_logbook BEFORE INSERT OR UPDATE ON entry_material FOR EACH ROW EXECUTE FUNCTION entry_material_logbook();

-------------------------------------------------------------------------------
-- 2. FORMULAS: a material step offers the values the lab's logbooks publish
-------------------------------------------------------------------------------
ALTER FUNCTION step_token_fields(uuid) RENAME TO step_base_token_fields;
CREATE FUNCTION logbook_published_keys(p_site uuid) RETURNS text[] LANGUAGE sql STABLE AS $$
    SELECT COALESCE(array_agg(DISTINCT f.field_key ORDER BY f.field_key), '{}') FROM logbook_field f JOIN logbook_version v ON v.id = f.version_id JOIN logbook l ON l.id = v.logbook_id
     WHERE f.publish AND f.status = 'Active' AND v.status IN ('Effective','Draft') AND l.status = 'Active' AND (p_site IS NULL OR l.site_id = p_site)
$$;
CREATE FUNCTION step_token_fields(p_step uuid) RETURNS text[] LANGUAGE sql STABLE AS $$
    SELECT step_base_token_fields(s.id) || CASE WHEN s.step_type IN ('Weighing','Preparation','Dilution','Data Entry','Plating/Inoculation','Incubation')
                THEN ARRAY(SELECT k FROM unnest(logbook_published_keys(t.site_id)) k WHERE NOT (k = ANY (step_base_token_fields(s.id)))) ELSE '{}'::text[] END
      FROM workflow_step s JOIN test_version tv ON tv.id = s.test_version_id JOIN test t ON t.id = tv.test_id WHERE s.id = p_step
$$;

-- The value a formula reads from the lot scanned at a step, for an entry (the whole batch's lot, or the entry's own)
-- and an analyte (a lot that names organisms serves only them). The entry must be approved (QA) to feed a result.
CREATE FUNCTION material_value(p_step_run uuid, p_entry uuid, p_analyte uuid, p_key text, OUT value numeric, OUT logbook_entry_id uuid, OUT waiting text)
LANGUAGE plpgsql STABLE AS $$
DECLARE n integer; e logbook_entry; l logbook; v_step text; ids uuid[];
BEGIN
    v_step := (SELECT ws.step_name FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.id = p_step_run);
    SELECT array_agg(DISTINCT em.logbook_entry_id) INTO ids FROM entry_material em JOIN logbook_entry le ON le.id = em.logbook_entry_id
     WHERE em.step_run_id = p_step_run AND em.status = 'Active' AND (em.entry_id = p_entry OR em.entry_id IS NULL) AND le.entry_values ? p_key
       AND (NOT EXISTS (SELECT 1 FROM lot_analyte la WHERE la.lot_id = em.lot_id AND la.status = 'Active')
            OR EXISTS (SELECT 1 FROM lot_analyte la WHERE la.lot_id = em.lot_id AND la.status = 'Active' AND la.analyte_id = p_analyte));
    n := COALESCE(cardinality(ids), 0);
    IF n = 0 THEN
        waiting := format('Waiting for the lot that gives %s at "%s"%s', p_key, COALESCE(v_step, 'its step'),
                          CASE WHEN p_analyte IS NOT NULL THEN ' (for ' || (SELECT analyte_name FROM analyte WHERE id = p_analyte) || ')' ELSE '' END);
        RETURN;
    END IF;
    IF n > 1 THEN waiting := format('More than one lot at "%s" gives %s: remove the wrong one', v_step, p_key); RETURN; END IF;
    SELECT * INTO e FROM logbook_entry WHERE id = ids[1];
    SELECT * INTO l FROM logbook WHERE id = e.logbook_id;
    logbook_entry_id := e.id;
    IF e.status = 'Voided' THEN waiting := e.entry_code || ' was voided'; RETURN; END IF;
    IF l.review_route = 'Logbook' AND e.status <> 'Approved' THEN
        waiting := format('Waiting for QA to approve %s (%s)', e.entry_code, l.logbook_name); RETURN;
    END IF;
    value := CASE WHEN jsonb_typeof(e.entry_values->p_key) = 'number' THEN (e.entry_values->>p_key)::numeric END;
    IF value IS NULL THEN waiting := format('%s has no %s', e.entry_code, p_key); END IF;
END $$;

-------------------------------------------------------------------------------
-- 3. THE LIVE CALCULATION READS THEM (batch_results as in 033, Claude Code's replicate weighings, with the logbook values)
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION batch_results(p_batch uuid)
RETURNS TABLE (entry_id uuid, analyte_id uuid, run_no integer, step_key text, is_final boolean, value numeric, reported text, inputs jsonb, waiting text, value_text text)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE b test_batch; e record; a record; cs record; tok text; k text; f text; ref workflow_step; rr step_run; vals jsonb; miss text; lbw text;
        v numeric; formula text; runs integer; rn integer; calc jsonb := '{}'; final_key text; has_calc boolean; vt text;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    has_calc := EXISTS (SELECT 1 FROM workflow_step WHERE test_version_id = b.test_version_id AND status = 'Active' AND step_type = 'Calculation');
    SELECT ws.step_key INTO final_key FROM workflow_step ws WHERE ws.test_version_id = b.test_version_id AND ws.status = 'Active' AND ws.step_type = 'Calculation'
     ORDER BY (SELECT count(*) FROM step_ancestors(ws.id)) DESC, ws.sort_order DESC LIMIT 1;
    FOR e IN SELECT * FROM batch_entry be WHERE be.batch_id = p_batch AND be.status = 'Active' AND be.daily_of_entry_id IS NULL ORDER BY be.position LOOP
        runs := COALESCE((SELECT max(entry_runs(r.id, e.id)) FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
                           WHERE r.batch_id = p_batch AND ws.step_type = 'Data Entry'), 1);
        FOR a IN SELECT tva.* FROM test_version_analyte tva WHERE tva.test_version_id = b.test_version_id AND tva.status = 'Active' ORDER BY tva.sort_order LOOP
            FOR rn IN 1..runs LOOP
                IF NOT has_calc OR a.result_type <> 'Numeric' THEN
                    -- no calculation (or a qualitative / text result): the result is the reading
                    SELECT ev.value_num, ev.value_text, ws.step_key INTO v, vt, k FROM entry_value ev JOIN step_run r ON r.id = ev.step_run_id JOIN workflow_step ws ON ws.id = r.step_id
                     WHERE r.batch_id = p_batch AND ws.step_type = 'Data Entry' AND ev.entry_id = e.id AND ev.analyte_id = a.analyte_id AND ev.run_no = rn AND ev.status = 'Active'
                     ORDER BY ws.sort_order DESC LIMIT 1;
                    entry_id := e.id; analyte_id := a.analyte_id; run_no := rn; step_key := k; is_final := true;
                    value := CASE WHEN a.result_type = 'Numeric' THEN v END; value_text := CASE WHEN a.result_type <> 'Numeric' THEN vt END;
                    reported := CASE WHEN a.result_type = 'Numeric' THEN report_value(v, a.id) ELSE vt END; inputs := '{}';
                    waiting := CASE WHEN (a.result_type = 'Numeric' AND v IS NULL) OR (a.result_type <> 'Numeric' AND vt IS NULL) THEN 'Waiting for the reading' END;
                    RETURN NEXT; CONTINUE;
                END IF;
                calc := '{}'; value_text := NULL;
                FOR cs IN SELECT ws.* FROM workflow_step ws WHERE ws.test_version_id = b.test_version_id AND ws.status = 'Active' AND ws.step_type = 'Calculation'
                           ORDER BY (SELECT count(*) FROM step_ancestors(ws.id)), ws.sort_order LOOP
                    formula := COALESCE((SELECT o->>'formula' FROM jsonb_array_elements(COALESCE(cs.config->'overrides', '[]')) o WHERE o->>'analyte_id' = a.analyte_id::text LIMIT 1),
                                        cs.config->>'formula');
                    vals := '{}'; miss := NULL;
                    FOREACH tok IN ARRAY formula_tokens(formula) LOOP
                        k := split_part(tok, '.', 1); f := split_part(tok, '.', 2);
                        SELECT * INTO ref FROM workflow_step WHERE test_version_id = b.test_version_id AND workflow_step.step_key = k AND status = 'Active';
                        SELECT * INTO rr FROM step_run WHERE batch_id = p_batch AND step_id = ref.id;
                        v := NULL;
                        IF ref.id IS NOT NULL AND NOT (f = ANY (step_base_token_fields(ref.id))) THEN
                            -- a value published by the logbook entry of the lot scanned at that step (L-2, migration 035)
                            SELECT mv.value, mv.waiting INTO v, lbw FROM material_value(rr.id, e.id, a.analyte_id, f) mv;
                            IF v IS NULL THEN miss := COALESCE(miss || ', ', '') || COALESCE(lbw, '{' || tok || '}');
                            ELSE vals := vals || jsonb_build_object(tok, v);
                            END IF;
                            CONTINUE;
                        END IF;
                        IF ref.step_type = 'Weighing' THEN
                            v := entry_weight(rr.id, e.id);   -- 033 (Claude Code): the average of the replicate weighings
                        ELSIF ref.step_type = 'Dilution' THEN
                            SELECT CASE f WHEN 'factor' THEN dilution_factor(ev.data) ELSE dilution_final_volume(ev.data) END INTO v
                              FROM entry_value ev WHERE ev.step_run_id = rr.id AND ev.entry_id = e.id AND ev.analyte_id IS NULL AND ev.status = 'Active' ORDER BY ev.run_no DESC LIMIT 1;
                        ELSIF ref.step_type = 'Preparation' THEN
                            v := CASE WHEN (rr.fields->>f) ~ '^\s*-?[0-9]*\.?[0-9]+\s*$' THEN (rr.fields->>f)::numeric END;
                        ELSIF ref.step_type = 'Incubation' THEN
                            v := (SELECT l.duration FROM incubation_load_view l WHERE l.step_run_id = rr.id AND l.status = 'Active' AND l.duration IS NOT NULL
                                   AND (l.entry_ids IS NULL OR e.id = ANY (l.entry_ids)) ORDER BY l.time_in DESC LIMIT 1);
                        ELSIF ref.step_type = 'Data Entry' THEN
                            SELECT ev.value_num INTO v FROM entry_value ev WHERE ev.step_run_id = rr.id AND ev.entry_id = e.id AND ev.analyte_id = a.analyte_id AND ev.run_no = LEAST(rn, entry_runs(rr.id, e.id)) AND ev.status = 'Active';
                        ELSIF ref.step_type = 'Calculation' THEN
                            v := (calc->>k)::numeric;
                        ELSIF ref.step_type = 'Hold Point' THEN
                            -- the named sibling test's result on the same sample: its approved result, else its live result
                            SELECT tr.value_num INTO v FROM batch_entry e0 JOIN requested_test rt0 ON rt0.id = e0.requested_test_id
                              JOIN requested_test rt2 ON rt2.sample_id = rt0.sample_id AND rt2.test_id = (ref.config->>'test_id')::uuid AND rt2.status <> 'Cancelled'
                              JOIN test_result tr ON tr.requested_test_id = rt2.id AND tr.status = 'Active' AND tr.analyte_id = a.analyte_id AND tr.result_key IS NULL AND tr.stage = 'Final'
                             WHERE e0.id = e.id LIMIT 1;
                            IF v IS NULL THEN
                                SELECT r2.value INTO v FROM requested_test rt0 JOIN batch_entry e0 ON e0.requested_test_id = rt0.id
                                  JOIN requested_test rt2 ON rt2.sample_id = rt0.sample_id AND rt2.test_id = (ref.config->>'test_id')::uuid AND rt2.status <> 'Cancelled'
                                  JOIN batch_entry e2 ON e2.requested_test_id = rt2.id AND e2.status = 'Active'
                                  JOIN test_batch b2 ON b2.id = e2.batch_id AND b2.status <> 'Cancelled'
                                  CROSS JOIN LATERAL batch_results(e2.batch_id) r2
                                 WHERE e0.id = e.id AND r2.entry_id = e2.id AND r2.is_final AND r2.value IS NOT NULL LIMIT 1;
                            END IF;
                        END IF;
                        IF v IS NULL THEN miss := COALESCE(miss || ', ', '') || '{' || tok || '}';
                        ELSE vals := vals || jsonb_build_object(tok, v);
                        END IF;
                    END LOOP;
                    v := NULL;
                    IF miss IS NULL THEN
                        BEGIN v := formula_eval(formula, vals); EXCEPTION WHEN others THEN miss := SQLERRM; END;
                    END IF;
                    IF v IS NOT NULL THEN calc := calc || jsonb_build_object(cs.step_key, v); END IF;
                    entry_id := e.id; analyte_id := a.analyte_id; run_no := rn; step_key := cs.step_key; is_final := (cs.step_key = final_key);
                    value := v; reported := CASE WHEN cs.step_key = final_key THEN report_value(v, a.id) END; inputs := vals;
                    waiting := CASE WHEN miss IS NULL THEN NULL WHEN miss LIKE '{%' THEN 'Waiting for ' || miss ELSE miss END;
                    RETURN NEXT;
                END LOOP;
            END LOOP;
        END LOOP;
    END LOOP;
END $$;

-------------------------------------------------------------------------------
-- 4. A STORED RESULT KEEPS THE LOGBOOK VALUES IT USED; A CORRECTION FLAGS IT
-------------------------------------------------------------------------------
CREATE TABLE logbook_result_use (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_result_id      uuid NOT NULL REFERENCES test_result(id),
    logbook_entry_id    uuid NOT NULL REFERENCES logbook_entry(id),
    via                 text NOT NULL CHECK (via IN ('Material','Aliquot')),
    entry_record_version integer NOT NULL,
    entry_values        jsonb NOT NULL,                 -- the entry's values when the result was stored
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX logbook_result_use_entry_idx ON logbook_result_use (logbook_entry_id);
CREATE INDEX logbook_result_use_result_idx ON logbook_result_use (test_result_id);
CALL make_gxp('logbook_result_use', false);

CREATE TABLE logbook_result_flag (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_result_id      uuid NOT NULL REFERENCES test_result(id),
    logbook_entry_id    uuid NOT NULL REFERENCES logbook_entry(id),
    used_values         jsonb NOT NULL,                 -- what the result used
    corrected_values    jsonb NOT NULL,                 -- the entry after the correction
    status              text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Resolved')),
    resolution_note     text,
    resolved_by         uuid REFERENCES app_user(id),
    resolved_at         timestamptz,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX logbook_result_flag_result_idx ON logbook_result_flag (test_result_id);
CALL make_gxp('logbook_result_flag', false);

CREATE FUNCTION logbook_result_tables_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF logbook_internal() OR in_group_sync() THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Recorded by the system when a result is stored or an entry corrected; a flag is resolved with Resolve';
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON logbook_result_use FOR EACH ROW EXECUTE FUNCTION logbook_result_tables_rules();
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON logbook_result_flag FOR EACH ROW EXECUTE FUNCTION logbook_result_tables_rules();

-- The logbook entries behind a result of a batch entry: the lots scanned for it (or the whole batch) that serve its
-- analyte, and the aliquot weighed for it
CREATE FUNCTION result_logbook_entries(p_batch uuid, p_entry uuid, p_analyte uuid) RETURNS TABLE (logbook_entry_id uuid, via text) LANGUAGE sql STABLE AS $$
    SELECT DISTINCT em.logbook_entry_id, 'Material' FROM entry_material em JOIN step_run r ON r.id = em.step_run_id
     WHERE r.batch_id = p_batch AND em.status = 'Active' AND em.logbook_entry_id IS NOT NULL AND (em.entry_id = p_entry OR em.entry_id IS NULL)
       AND (NOT EXISTS (SELECT 1 FROM lot_analyte la WHERE la.lot_id = em.lot_id AND la.status = 'Active')
            OR EXISTS (SELECT 1 FROM lot_analyte la WHERE la.lot_id = em.lot_id AND la.status = 'Active' AND la.analyte_id = p_analyte))
    UNION
    SELECT DISTINCT ev.logbook_entry_id, 'Aliquot' FROM entry_value ev JOIN step_run r ON r.id = ev.step_run_id
     WHERE r.batch_id = p_batch AND ev.entry_id = p_entry AND ev.status = 'Active' AND ev.logbook_entry_id IS NOT NULL
$$;

-- Before a result is stored: the reviewer did not weigh its aliquot ("The reviewer did not do any of the work,
-- including the weighing")
CREATE FUNCTION test_result_logbook_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE hit record;
BEGIN
    SELECT le.entry_code, u.full_name INTO hit FROM result_logbook_entries(NEW.batch_id, NEW.entry_id, NEW.analyte_id) r
      JOIN logbook_entry le ON le.id = r.logbook_entry_id JOIN app_user u ON u.id = le.created_by
     WHERE r.via = 'Aliquot' AND EXISTS (SELECT 1 FROM logbook_entry_authors(le.id) x WHERE x.user_id = NEW.approved_by) LIMIT 1;
    IF hit.entry_code IS NOT NULL THEN
        RAISE EXCEPTION 'You weighed (or corrected) aliquot % of this batch: someone else reviews it', hit.entry_code;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER b_logbook BEFORE INSERT ON test_result FOR EACH ROW EXECUTE FUNCTION test_result_logbook_check();

-- After a result is stored: what it used is kept; an aliquot used by it is reviewed (in this batch)
CREATE FUNCTION test_result_logbook_use() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_logbook_internal(true);
    INSERT INTO logbook_result_use (test_result_id, logbook_entry_id, via, entry_record_version, entry_values)
    SELECT NEW.id, le.id, r.via, le.record_version, le.entry_values FROM result_logbook_entries(NEW.batch_id, NEW.entry_id, NEW.analyte_id) r
      JOIN logbook_entry le ON le.id = r.logbook_entry_id;
    UPDATE logbook_entry le SET status = 'Approved', approved_by = NEW.approved_by, approved_at = clock_timestamp(), approved_in_batch_id = NEW.batch_id
     WHERE le.status = 'Recorded' AND le.id IN (SELECT r.logbook_entry_id FROM result_logbook_entries(NEW.batch_id, NEW.entry_id, NEW.analyte_id) r WHERE r.via = 'Aliquot');
    PERFORM set_logbook_internal(false);
    RETURN NULL;
END $$;
CREATE TRIGGER z_logbook_use AFTER INSERT ON test_result FOR EACH ROW EXECUTE FUNCTION test_result_logbook_use();

-- A correction of an entry flags every stored (active) result that used it
CREATE FUNCTION logbook_entry_flag_results() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE was text := COALESCE(current_setting('lims.logbook_internal', true), '');
BEGIN
    IF NEW.entry_values IS NOT DISTINCT FROM OLD.entry_values THEN RETURN NULL; END IF;
    PERFORM set_config('lims.logbook_internal', '1', true);
    INSERT INTO logbook_result_flag (test_result_id, logbook_entry_id, used_values, corrected_values)
    SELECT DISTINCT ON (u.test_result_id) u.test_result_id, NEW.id, u.entry_values, NEW.entry_values
      FROM logbook_result_use u JOIN test_result tr ON tr.id = u.test_result_id
     WHERE u.logbook_entry_id = NEW.id AND tr.status = 'Active'
       AND NOT EXISTS (SELECT 1 FROM logbook_result_flag f WHERE f.test_result_id = u.test_result_id AND f.logbook_entry_id = NEW.id AND f.status = 'Open')
     ORDER BY u.test_result_id, u.created_at DESC;
    UPDATE logbook_result_flag SET corrected_values = NEW.entry_values WHERE logbook_entry_id = NEW.id AND status = 'Open';
    PERFORM set_config('lims.logbook_internal', was, true);
    RETURN NULL;
END $$;
CREATE TRIGGER z_flag_results AFTER UPDATE OF entry_values ON logbook_entry FOR EACH ROW EXECUTE FUNCTION logbook_entry_flag_results();

-- A reviewer (testing.review, not the person who corrected the entry) resolves a flag: the result stands, or it is
-- re-tested / re-reviewed through the usual routes, and the note says which
CREATE FUNCTION resolve_logbook_flag(p_flag uuid, p_note text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f logbook_result_flag; v_site uuid; le logbook_entry;
BEGIN
    SELECT * INTO f FROM logbook_result_flag WHERE id = p_flag;
    IF f.id IS NULL THEN RAISE EXCEPTION 'Flag not found'; END IF;
    IF f.status <> 'Open' THEN RAISE EXCEPTION 'The flag is already resolved'; END IF;
    SELECT b.site_id INTO v_site FROM test_result tr JOIN test_batch b ON b.id = tr.batch_id WHERE tr.id = f.test_result_id;
    PERFORM require_permission_at('testing.review', v_site);
    SELECT * INTO le FROM logbook_entry WHERE id = f.logbook_entry_id;
    IF EXISTS (SELECT 1 FROM audit_log a WHERE a.table_name = 'logbook_entry' AND a.record_id = le.id AND a.action = 'UPDATE' AND a.changed_fields ? 'entry_values'
                AND a.changed_by = current_app_user() AND a.changed_at >= f.created_at - interval '1 second') THEN
        RAISE EXCEPTION 'You corrected %: someone else reviews the results it changed', le.entry_code;
    END IF;
    IF COALESCE(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'Say what the correction means for the result (it stands, or what was done)'; END IF;
    PERFORM ensure_reason('Logbook correction reviewed for a result');
    PERFORM set_logbook_internal(true);
    UPDATE logbook_result_flag SET status = 'Resolved', resolution_note = btrim(p_note), resolved_by = current_app_user(), resolved_at = clock_timestamp() WHERE id = p_flag;
    PERFORM set_logbook_internal(false);
END $$;

-- An entry scanned at the bench or used by a result is not voided (it is corrected instead)
CREATE OR REPLACE FUNCTION logbook_entry_in_use(p_entry uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT 'it was used at ' || ws.step_name || ' in ' || b.batch_code FROM entry_material em JOIN step_run r ON r.id = em.step_run_id JOIN test_batch b ON b.id = r.batch_id
           JOIN workflow_step ws ON ws.id = r.step_id WHERE em.logbook_entry_id = p_entry AND em.status = 'Active' LIMIT 1),
        (SELECT 'its weight is in ' || b.batch_code FROM entry_value ev JOIN step_run r ON r.id = ev.step_run_id JOIN test_batch b ON b.id = r.batch_id
          WHERE ev.logbook_entry_id = p_entry AND ev.status = 'Active' LIMIT 1),
        (SELECT 'a stored result used it' FROM logbook_result_use WHERE logbook_entry_id = p_entry LIMIT 1))
$$;

-- What an entry was used for (its page): stored results and batches using it now
CREATE FUNCTION logbook_entry_uses(p_entry uuid) RETURNS TABLE (sample_id uuid, sample_code text, analyte_name text, reported text, batch_id uuid, batch_code text,
    test_result_id uuid, flag_id uuid, flag_status text, flag_note text) LANGUAGE sql STABLE AS $$
    SELECT s.id, s.sample_code, a.analyte_name, tr.reported, b.id, b.batch_code, tr.id, f.id, f.status, f.resolution_note
      FROM logbook_result_use u JOIN test_result tr ON tr.id = u.test_result_id AND tr.status = 'Active' JOIN analyte a ON a.id = tr.analyte_id
      JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN sample s ON s.id = rt.sample_id JOIN test_batch b ON b.id = tr.batch_id
      LEFT JOIN LATERAL (SELECT * FROM logbook_result_flag x WHERE x.test_result_id = tr.id AND x.logbook_entry_id = p_entry ORDER BY x.created_at DESC LIMIT 1) f ON true
     WHERE u.logbook_entry_id = p_entry
    UNION ALL
    SELECT DISTINCT NULL::uuid, NULL::text, '(not stored yet: at ' || ws.step_name || ')', NULL::text, b.id, b.batch_code, NULL::uuid, NULL::uuid, NULL::text, NULL::text
      FROM (SELECT em.step_run_id FROM entry_material em WHERE em.logbook_entry_id = p_entry AND em.status = 'Active'
            UNION SELECT ev.step_run_id FROM entry_value ev WHERE ev.logbook_entry_id = p_entry AND ev.status = 'Active') x
      JOIN step_run r ON r.id = x.step_run_id JOIN test_batch b ON b.id = r.batch_id JOIN workflow_step ws ON ws.id = r.step_id
     WHERE b.status NOT IN ('Approved','Cancelled')
$$;

-------------------------------------------------------------------------------
-- 5. THE PRE-ANALYTICAL SAMPLE WEIGHTS LOGBOOK: an aliquot scanned at a Weighing step
-------------------------------------------------------------------------------
-- A weight that came from an aliquot changes only by scanning (another aliquot, or the corrected one again)
CREATE FUNCTION entry_value_aliquot_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scanning boolean := COALESCE(current_setting('lims.aliquot_scan', true), '') = '1';
BEGIN
    IF testing_internal() OR scanning THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' AND NEW.logbook_entry_id IS NOT NULL THEN RAISE EXCEPTION 'A weight from an aliquot is recorded by scanning the aliquot'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.logbook_entry_id IS DISTINCT FROM OLD.logbook_entry_id THEN RAISE EXCEPTION 'A weight from an aliquot is recorded by scanning the aliquot'; END IF;
    IF TG_OP = 'UPDATE' AND OLD.logbook_entry_id IS NOT NULL AND NEW.value_num IS DISTINCT FROM OLD.value_num THEN
        RAISE EXCEPTION 'This weight comes from aliquot % (sample weights logbook): scan another aliquot, or correct the aliquot in its logbook and scan it again',
            (SELECT entry_code FROM logbook_entry WHERE id = OLD.logbook_entry_id);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER b_aliquot BEFORE INSERT OR UPDATE ON entry_value FOR EACH ROW EXECUTE FUNCTION entry_value_aliquot_rule();

-- The weight (the field named weight, else the first number) and the balance (the first Equipment field) of an aliquot
CREATE FUNCTION aliquot_weight(p_entry uuid, OUT weight numeric, OUT unit text, OUT balance_id uuid) LANGUAGE plpgsql STABLE AS $$
DECLARE e logbook_entry; f logbook_field;
BEGIN
    SELECT * INTO e FROM logbook_entry WHERE id = p_entry;
    SELECT * INTO f FROM logbook_field x WHERE x.version_id = e.version_id AND x.status = 'Active' AND x.field_type IN ('Number','Calculated')
     ORDER BY (x.field_key = 'weight') DESC, x.sort_order LIMIT 1;
    IF f.id IS NOT NULL AND jsonb_typeof(e.entry_values->f.field_key) = 'number' THEN weight := (e.entry_values->>f.field_key)::numeric; unit := f.unit; END IF;
    SELECT * INTO f FROM logbook_field x WHERE x.version_id = e.version_id AND x.status = 'Active' AND x.field_type = 'Equipment' ORDER BY x.sort_order LIMIT 1;
    IF f.id IS NOT NULL THEN balance_id := NULLIF(e.entry_values->>f.field_key, '')::uuid; END IF;
END $$;

CREATE FUNCTION scan_aliquot(p_step_run uuid, p_code text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r step_run; ws workflow_step; b test_batch; le logbook_entry; l logbook; be batch_entry; w record; other text; old entry_value; v_sample text;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Step not found'; END IF;
    SELECT * INTO ws FROM workflow_step WHERE id = r.step_id;
    SELECT * INTO b FROM test_batch WHERE id = r.batch_id;
    IF ws.step_type <> 'Weighing' THEN RAISE EXCEPTION 'Aliquots are scanned at a Weighing step'; END IF;
    PERFORM assert_can_perform(r.id);
    PERFORM assert_step_open(r.id);
    SELECT e.* INTO le FROM logbook_entry e JOIN logbook lb ON lb.id = e.logbook_id WHERE lower(e.entry_code) = lower(btrim(p_code)) AND lb.subject = 'Sample';
    IF le.id IS NULL THEN RAISE EXCEPTION 'No weighed aliquot "%" (a sample weights logbook entry)', btrim(p_code); END IF;
    SELECT * INTO l FROM logbook WHERE id = le.logbook_id;
    IF le.site_id <> b.site_id THEN RAISE EXCEPTION 'Aliquot % belongs to another lab', le.entry_code; END IF;
    IF le.status = 'Voided' THEN RAISE EXCEPTION 'Aliquot % was voided', le.entry_code; END IF;
    v_sample := (SELECT sample_code FROM sample WHERE id = le.sample_id);
    SELECT x.* INTO be FROM batch_entry x JOIN requested_test rt ON rt.id = x.requested_test_id
     WHERE x.batch_id = r.batch_id AND x.status = 'Active' AND x.daily_of_entry_id IS NULL AND x.removed_at IS NULL AND rt.sample_id = le.sample_id ORDER BY x.position LIMIT 1;
    IF be.id IS NULL THEN RAISE EXCEPTION 'Aliquot % is of sample %, which is not in %', le.entry_code, v_sample, b.batch_code; END IF;
    SELECT b2.batch_code INTO other FROM entry_value ev JOIN step_run r2 ON r2.id = ev.step_run_id JOIN test_batch b2 ON b2.id = r2.batch_id
     WHERE ev.logbook_entry_id = le.id AND ev.status = 'Active' AND NOT (ev.step_run_id = r.id AND ev.entry_id = be.id) LIMIT 1;
    IF other IS NOT NULL THEN RAISE EXCEPTION 'Aliquot % was already used in % (an aliquot is used once)', le.entry_code, other; END IF;
    SELECT * INTO w FROM aliquot_weight(le.id);
    IF w.weight IS NULL THEN RAISE EXCEPTION 'Aliquot % has no weight', le.entry_code; END IF;
    PERFORM ensure_reason('Weight from aliquot ' || le.entry_code);
    PERFORM set_config('lims.aliquot_scan', '1', true);
    SELECT * INTO old FROM entry_value WHERE step_run_id = r.id AND entry_id = be.id AND analyte_id IS NULL AND run_no = 1 AND status = 'Active';
    IF old.id IS NOT NULL THEN
        UPDATE entry_value SET value_num = w.weight, logbook_entry_id = le.id, data = data || jsonb_build_object('aliquot', le.entry_code) WHERE id = old.id;
    ELSE
        INSERT INTO entry_value (step_run_id, entry_id, value_num, data, logbook_entry_id) VALUES (r.id, be.id, w.weight, jsonb_build_object('aliquot', le.entry_code), le.id);
    END IF;
    IF w.balance_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM entry_equipment q WHERE q.step_run_id = r.id AND q.entry_id = be.id AND q.equipment_id = w.balance_id AND q.status = 'Active') THEN
        UPDATE entry_equipment SET status = 'Inactive' WHERE step_run_id = r.id AND entry_id = be.id AND status = 'Active'
           AND equipment_id IN (SELECT id FROM equipment WHERE equipment_type_id = (SELECT equipment_type_id FROM equipment WHERE id = w.balance_id));
        INSERT INTO entry_equipment (step_run_id, entry_id, equipment_id) VALUES (r.id, be.id, w.balance_id);
    END IF;
    PERFORM set_config('lims.aliquot_scan', '', true);
    RETURN be.label;
END $$;

-- Every aliquot of the batch's samples, used here or not (QC Review shows them all: repeat weighings and discarded
-- aliquots are never hidden), with who weighed it, when, the balance and its calibration at the time
CREATE FUNCTION batch_aliquots(p_batch uuid)
RETURNS TABLE (logbook_entry_id uuid, entry_code text, sample_id uuid, sample_code text, weight numeric, unit text, balance_id uuid, balance_code text, balance_name text,
               calibration text, weighed_by uuid, weighed_by_name text, weighed_at timestamptz, entry_status text, used boolean, used_weight numeric, entry_label text, corrected boolean)
LANGUAGE sql STABLE AS $$
    WITH smp AS (SELECT DISTINCT rt.sample_id FROM batch_entry x JOIN requested_test rt ON rt.id = x.requested_test_id
                  WHERE x.batch_id = p_batch AND x.removed_at IS NULL AND x.daily_of_entry_id IS NULL)
    SELECT le.id, le.entry_code, le.sample_id, s.sample_code, w.weight, w.unit, w.balance_id, eq.equipment_code, eq.equipment_name,
           CASE WHEN w.balance_id IS NULL THEN 'No balance recorded'
                WHEN NOT eq.calibration_required THEN 'Calibration not required'
                ELSE COALESCE((SELECT CASE WHEN c.result::text = 'Fail' THEN 'Last calibration before it failed'
                                           WHEN c.expiration_date >= (le.entry_at AT TIME ZONE st.time_zone)::date THEN 'In calibration (' || c.calibration_code || ', to ' || c.expiration_date || ')'
                                           ELSE 'Out of calibration (expired ' || c.expiration_date || ')' END
                                 FROM calibration c WHERE c.equipment_id = w.balance_id AND c.status = 'Active' AND c.performed_date <= (le.entry_at AT TIME ZONE st.time_zone)::date
                                 ORDER BY c.performed_date DESC, c.created_at DESC LIMIT 1), 'No calibration on record at the time') END,
           le.created_by, u.full_name, le.entry_at, le.status, ev.id IS NOT NULL, ev.value_num, be.label, (ev.id IS NOT NULL AND ev.value_num IS DISTINCT FROM w.weight)
      FROM logbook_entry le JOIN logbook l ON l.id = le.logbook_id AND l.subject = 'Sample' JOIN smp ON smp.sample_id = le.sample_id
      JOIN sample s ON s.id = le.sample_id JOIN lab_site st ON st.id = le.site_id JOIN app_user u ON u.id = le.created_by
      CROSS JOIN LATERAL aliquot_weight(le.id) w LEFT JOIN equipment eq ON eq.id = w.balance_id
      LEFT JOIN LATERAL (SELECT ev2.* FROM entry_value ev2 JOIN step_run r ON r.id = ev2.step_run_id WHERE r.batch_id = p_batch AND ev2.logbook_entry_id = le.id AND ev2.status = 'Active' LIMIT 1) ev ON true
      LEFT JOIN batch_entry be ON be.id = ev.entry_id
     WHERE le.status <> 'Voided' OR ev.id IS NOT NULL
     ORDER BY s.sample_code, le.entry_at
$$;

-- The review problems gain the aliquots: a weight scanned before its aliquot was corrected, a voided aliquot in use
ALTER FUNCTION batch_review_problems(uuid) RENAME TO batch_review_problems_l2;
CREATE FUNCTION batch_review_problems(p_batch uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY SELECT x.problem FROM batch_review_problems_l2(p_batch) x;
    IF (SELECT status FROM test_batch WHERE id = p_batch) = 'Awaiting Review' THEN
        RETURN QUERY SELECT 'Aliquot ' || a.entry_code || ' (' || a.entry_label || ') was corrected after it was scanned (now ' || lb_num(a.weight) || COALESCE(' ' || a.unit, '') || '): return the batch to scan it again'
          FROM batch_aliquots(p_batch) a WHERE a.used AND a.corrected;
        RETURN QUERY SELECT 'Aliquot ' || a.entry_code || ' (' || a.entry_label || ') was voided: return the batch to weigh the sample again'
          FROM batch_aliquots(p_batch) a WHERE a.used AND a.entry_status = 'Voided';
    END IF;
END $$;

-------------------------------------------------------------------------------
-- 6. THE RELEASE CHECK: a result's logbook entries are approved and no correction flag is open
-------------------------------------------------------------------------------
CREATE FUNCTION logbook_release_problem(p_rt uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT le.entry_code || ' (' || l.logbook_name || ') was corrected after ' || a.analyte_name || ' used it: a reviewer resolves the flag (on the entry''s page) before it is released'
           FROM test_result tr JOIN logbook_result_flag f ON f.test_result_id = tr.id AND f.status = 'Open' JOIN logbook_entry le ON le.id = f.logbook_entry_id
           JOIN logbook l ON l.id = le.logbook_id JOIN analyte a ON a.id = tr.analyte_id
          WHERE tr.requested_test_id = p_rt AND tr.status = 'Active' LIMIT 1),
        (SELECT le.entry_code || ' (' || l.logbook_name || '), used by ' || a.analyte_name || ', is ' || CASE WHEN le.status = 'Voided' THEN 'voided' ELSE 'not approved by QA' END
           FROM test_result tr JOIN logbook_result_use u ON u.test_result_id = tr.id JOIN logbook_entry le ON le.id = u.logbook_entry_id
           JOIN logbook l ON l.id = le.logbook_id JOIN analyte a ON a.id = tr.analyte_id
          WHERE tr.requested_test_id = p_rt AND tr.status = 'Active' AND (le.status = 'Voided' OR (l.review_route = 'Logbook' AND le.status <> 'Approved')) LIMIT 1))
$$;
CREATE FUNCTION result_finalization_logbook_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p text := logbook_release_problem(NEW.requested_test_id);
BEGIN
    IF p IS NOT NULL THEN RAISE EXCEPTION 'Not released: %', p; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER b_logbook BEFORE INSERT ON result_finalization FOR EACH ROW EXECUTE FUNCTION result_finalization_logbook_check();

-------------------------------------------------------------------------------
-- 7. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_l2;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table IN ('logbook_result_use', 'logbook_result_flag') THEN
        RETURN jsonb_build_object('label', CASE p_table WHEN 'logbook_result_use' THEN 'Logbook value used by a result: ' ELSE 'Result flagged by a logbook correction: ' END
                                           || COALESCE((SELECT entry_code FROM logbook_entry WHERE id = (r->>'logbook_entry_id')::uuid), ''),
                                  'link', '#/logbooks/entries/' || (r->>'logbook_entry_id'));
    END IF;
    RETURN audit_record_ref_l2(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
