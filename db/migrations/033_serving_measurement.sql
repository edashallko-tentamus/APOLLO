-- 033: serving size, Part B (Alex, 2026-10-14; Claude Code, version 0.17.1).
--  1. A Weighing step can take replicate weighings (1 to 10, e.g. 10 capsules weighed one by one); the step's weight,
--     as formulas see it, is their average.
--  2. Serving tests: a test of the catalogue can be the lab's Serving weight test (its result is the average weight of
--     one unit: one capsule, one scoop) or its Density test (g/mL).
--  3. "Results per serving" ticked on a sample orders the serving test it needs: Serving weight for a serving by weight
--     or count, Density for a serving by volume. From the client's quote when it is quoted, else at its catalogue price
--     (a named exception to quoted-only ordering, like the OOS retests).
--  4. When QC Review approves a serving test's final result, it is fed back to the sample: the measured unit weight
--     (serving weight = unit weight x the label's count) or the density; the sample keeps the link to the result.
--  5. Results per serving use the density when the serving is a volume and the result is per weight (or the reverse).
--  6. serving_problem(): what still stops a per-serving result being released (the COA release check blocks on it).
--  7. Unplanned: a request for the serving test that waits for the client's consent (the split-off requests, now also
--     without a bench step); consent orders the test.
-- Vault: Decision - Quote Pricing, Catalogue Updates and Serving Sizes (Part B).
BEGIN;
SET search_path = lims, public;

-------------------------------------------------------------------------------
-- 1. REPLICATE WEIGHINGS
-------------------------------------------------------------------------------
CREATE FUNCTION weighing_replicates(p_cfg jsonb) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
    SELECT GREATEST(1, LEAST(10, COALESCE(NULLIF(p_cfg->>'replicates', '')::integer, 1)))
$$;
-- The weight a formula uses: the latest weight, or with replicates the average of all of them (none until all are in)
CREATE FUNCTION entry_weight(p_run uuid, p_entry uuid) RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE n integer; k integer; a numeric;
BEGIN
    SELECT weighing_replicates(ws.config) INTO n FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.id = p_run;
    IF COALESCE(n, 1) <= 1 THEN
        RETURN (SELECT ev.value_num FROM entry_value ev WHERE ev.step_run_id = p_run AND ev.entry_id = p_entry AND ev.analyte_id IS NULL AND ev.status = 'Active' ORDER BY ev.run_no DESC LIMIT 1);
    END IF;
    SELECT count(*), avg(ev.value_num) INTO k, a FROM entry_value ev
     WHERE ev.step_run_id = p_run AND ev.entry_id = p_entry AND ev.analyte_id IS NULL AND ev.status = 'Active' AND ev.run_no <= n AND ev.value_num IS NOT NULL;
    RETURN CASE WHEN k >= n THEN a END;
END $$;

CREATE FUNCTION workflow_step_replicates_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.step_type = 'Weighing' AND NEW.config ? 'replicates' AND NULLIF(NEW.config->>'replicates', '') IS NOT NULL
       AND ((NEW.config->>'replicates') !~ '^[0-9]+$' OR (NEW.config->>'replicates')::integer NOT BETWEEN 1 AND 10) THEN
        RAISE EXCEPTION 'Replicate weighings: a whole number from 1 to 10';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_replicates BEFORE INSERT OR UPDATE ON workflow_step FOR EACH ROW EXECUTE FUNCTION workflow_step_replicates_rule();

CREATE FUNCTION entry_value_replicates_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer; t step_type;
BEGIN
    SELECT ws.step_type, weighing_replicates(ws.config) INTO t, n FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.id = NEW.step_run_id;
    IF t = 'Weighing' AND NEW.run_no > n THEN RAISE EXCEPTION 'This weighing takes % weight%: there is no weighing %', n, CASE WHEN n > 1 THEN 's' ELSE '' END, NEW.run_no; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_replicates BEFORE INSERT OR UPDATE ON entry_value FOR EACH ROW EXECUTE FUNCTION entry_value_replicates_rule();

-- what stops a weighing step being completed: every replicate weight (the earlier checks, then the count)
ALTER FUNCTION step_run_missing(uuid) RENAME TO step_run_missing_021;
CREATE FUNCTION step_run_missing(p_step_run uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE r step_run; ws workflow_step; n integer;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    SELECT * INTO ws FROM workflow_step WHERE id = r.step_id;
    n := CASE WHEN ws.step_type = 'Weighing' THEN weighing_replicates(ws.config) ELSE 1 END;
    RETURN QUERY SELECT m.problem FROM step_run_missing_021(p_step_run) m WHERE n = 1 OR m.problem NOT LIKE '%: no weight';
    IF n > 1 AND NOT EXISTS (SELECT 1 FROM step_run_missing_021(p_step_run) m WHERE m.problem = 'The steps before it are not completed yet') THEN
        RETURN QUERY SELECT e2.label || ': ' || (SELECT count(*) FROM entry_value ev WHERE ev.step_run_id = r.id AND ev.entry_id = e2.id AND ev.analyte_id IS NULL AND ev.value_num IS NOT NULL
                                                   AND ev.status = 'Active' AND ev.run_no <= n) || ' of ' || n || ' weights'
          FROM batch_entry e2 WHERE e2.batch_id = r.batch_id AND e2.status = 'Active' AND e2.daily_of_entry_id IS NULL AND (e2.entry_type = 'Sample' OR e2.qc_class = 'Prep')
           AND (SELECT count(*) FROM entry_value ev WHERE ev.step_run_id = r.id AND ev.entry_id = e2.id AND ev.analyte_id IS NULL AND ev.value_num IS NOT NULL AND ev.status = 'Active' AND ev.run_no <= n) < n
         ORDER BY e2.position;
    END IF;
END $$;

-- the live results: a weighing token is the average of the replicates (only that line differs from 021)
CREATE OR REPLACE FUNCTION batch_results(p_batch uuid)
RETURNS TABLE (entry_id uuid, analyte_id uuid, run_no integer, step_key text, is_final boolean, value numeric, reported text, inputs jsonb, waiting text, value_text text)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE b test_batch; e record; a record; cs record; tok text; k text; f text; ref workflow_step; rr step_run; vals jsonb; miss text;
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
                        IF ref.step_type = 'Weighing' THEN
                            v := entry_weight(rr.id, e.id);   -- 033: the average of the replicate weighings
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
-- 2. SERVING TESTS, AND WHAT THE SAMPLE KEEPS
-------------------------------------------------------------------------------
ALTER TABLE test ADD COLUMN serving_role text CHECK (serving_role IN ('Serving weight','Density'));
COMMENT ON COLUMN test.serving_role IS 'Serving weight: the result is the average weight of one unit (a capsule, a scoop); Density: g/mL. Its approved result is fed back to the sample';

ALTER TABLE sample ADD COLUMN report_per_serving boolean NOT NULL DEFAULT false;
ALTER TABLE sample ADD COLUMN unit_weight numeric(14,6);
ALTER TABLE sample ADD COLUMN unit_weight_unit text;
ALTER TABLE sample ADD COLUMN unit_weight_result_id uuid REFERENCES test_result(id);
ALTER TABLE sample ADD COLUMN density numeric(14,6);
ALTER TABLE sample ADD COLUMN density_unit text;
ALTER TABLE sample ADD COLUMN density_result_id uuid REFERENCES test_result(id);
COMMENT ON COLUMN sample.report_per_serving IS 'Results per serving: orders the serving test it needs, and nothing per serving is released before it is measured';

-- a measured unit weight sets the serving weight (x the label's count), also when the count changes later
CREATE FUNCTION sample_measured_serving() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.unit_weight IS NOT NULL AND (TG_OP = 'INSERT' OR (NEW.unit_weight, NEW.unit_weight_unit, NEW.serving_count) IS DISTINCT FROM (OLD.unit_weight, OLD.unit_weight_unit, OLD.serving_count)) THEN
        NEW.serving_size := round(NEW.unit_weight * COALESCE(NEW.serving_count, 1), 6); NEW.serving_unit := NEW.unit_weight_unit;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_sample_serving_measured BEFORE INSERT OR UPDATE OF unit_weight, unit_weight_unit, serving_count ON sample FOR EACH ROW EXECUTE FUNCTION sample_measured_serving();

-- the measured values come only from their approved results (serving_result_feed), never typed
CREATE FUNCTION sample_measured_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF (TG_OP = 'INSERT' AND (NEW.unit_weight, NEW.unit_weight_result_id, NEW.density, NEW.density_result_id) IS DISTINCT FROM (NULL::numeric, NULL::uuid, NULL::numeric, NULL::uuid))
       OR (TG_OP = 'UPDATE' AND (NEW.unit_weight, NEW.unit_weight_unit, NEW.unit_weight_result_id, NEW.density, NEW.density_unit, NEW.density_result_id)
                               IS DISTINCT FROM (OLD.unit_weight, OLD.unit_weight_unit, OLD.unit_weight_result_id, OLD.density, OLD.density_unit, OLD.density_result_id)) THEN
        RAISE EXCEPTION 'The measured unit weight and density come from their approved test results (Serving weight and Density tests)';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_sample_measured_guard BEFORE INSERT OR UPDATE ON sample FOR EACH ROW EXECUTE FUNCTION sample_measured_guard();

CREATE FUNCTION unit_dimension_of(p_unit text) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT dimension::text FROM unit_of_measure WHERE lower(unit_code) = lower(btrim(p_unit)) LIMIT 1
$$;

-- An amount per serving from the sample: per_serving with the serving as it is, else through the density
-- (a serving by volume with a result per weight, or a serving by weight with a result per volume)
CREATE FUNCTION sample_per_serving(p_value numeric, p_unit text, p_sample uuid, OUT value numeric, OUT unit text) LANGUAGE plpgsql STABLE AS $$
DECLARE s sample; ps record; d numeric; dim text; x numeric;
BEGIN
    SELECT * INTO s FROM sample WHERE id = p_sample;
    IF s.id IS NULL OR s.serving_size IS NULL OR p_value IS NULL THEN RETURN; END IF;
    SELECT * INTO ps FROM per_serving(p_value, p_unit, s.serving_size, s.serving_unit);
    IF ps.value IS NOT NULL THEN value := ps.value; unit := ps.unit; RETURN; END IF;
    IF s.density IS NULL THEN RETURN; END IF;
    d := s.density * CASE WHEN lower(COALESCE(s.density_unit, 'g/mL')) = 'g/ml' THEN 1 ELSE unit_factor(s.density_unit, 'g/mL', NULL) END;   -- g per mL
    IF d IS NULL OR d <= 0 THEN RETURN; END IF;
    dim := unit_dimension_of(s.serving_unit);
    IF dim = 'Volume' THEN
        x := s.serving_size * CASE WHEN s.serving_unit = 'mL' THEN 1 ELSE unit_factor(s.serving_unit, 'mL', NULL) END * d;          -- grams
        IF x IS NOT NULL THEN SELECT * INTO ps FROM per_serving(p_value, p_unit, x, 'g'); END IF;
    ELSIF dim = 'Mass' THEN
        x := s.serving_size * CASE WHEN s.serving_unit = 'g' THEN 1 ELSE unit_factor(s.serving_unit, 'g', NULL) END / d;            -- millilitres
        IF x IS NOT NULL THEN SELECT * INTO ps FROM per_serving(p_value, p_unit, x, 'mL'); END IF;
    END IF;
    value := ps.value; unit := ps.unit;
END $$;

-- What stops a requested test's per-serving results being released (NULL: nothing). A test needs them when its sample
-- asks for results per serving, its version reports per serving, or a limit is per serving or per package.
CREATE FUNCTION serving_problem(p_rt uuid) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE rt requested_test; s sample; t test; tv test_version; dim text; w text; dens boolean := false;
BEGIN
    SELECT * INTO rt FROM requested_test WHERE id = p_rt;
    SELECT * INTO s FROM sample WHERE id = rt.sample_id;
    SELECT * INTO t FROM test WHERE id = rt.test_id;
    SELECT * INTO tv FROM test_version WHERE id = rt.test_version_id;
    IF t.serving_role IS NOT NULL THEN RETURN NULL; END IF;
    IF NOT (s.report_per_serving OR COALESCE(tv.report_per_serving, false)
            OR EXISTS (SELECT 1 FROM specification sp WHERE sp.requested_test_id = rt.id AND sp.status = 'Active' AND sp.basis <> 'As reported')) THEN
        RETURN NULL;
    END IF;
    -- a serving test ordered on the sample and not approved yet
    SELECT string_agg(x.test_name, ', ') INTO w FROM requested_test r2 JOIN test x ON x.id = r2.test_id
     WHERE r2.sample_id = s.id AND r2.status <> 'Cancelled' AND x.serving_role IS NOT NULL AND NOT test_is_replaced(r2.id)
       AND NOT EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = r2.id AND tr.status = 'Active' AND tr.stage = 'Final' AND tr.result_key IS NULL);
    IF w IS NOT NULL THEN RETURN 'waiting for ' || w || ' (ordered, not approved yet)'; END IF;
    IF s.serving_size IS NULL THEN RETURN 'the sample has no serving (order page)'; END IF;
    dim := unit_dimension_of(s.serving_unit);
    -- a result the serving cannot be applied to directly needs the density
    dens := EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.stage = 'Final' AND tr.result_key IS NULL
                     AND tr.unit IS NOT NULL AND position('/' IN tr.unit) > 0 AND (per_serving(1, tr.unit, s.serving_size, s.serving_unit)).value IS NULL);
    IF dim <> 'Volume' AND s.unit_weight_result_id IS NULL THEN RETURN 'the serving weight is not measured (Serving weight test)'; END IF;
    IF dens AND s.density_result_id IS NULL THEN RETURN 'the density is not measured (Density test)'; END IF;
    RETURN NULL;
END $$;

-------------------------------------------------------------------------------
-- 3. ORDERING THE SERVING TEST
-------------------------------------------------------------------------------
ALTER TABLE requested_test ADD COLUMN serving_order boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN requested_test.serving_order IS 'A serving test ordered for the per-serving calculation at its catalogue price (not on the client''s quote)';
ALTER TABLE requested_test DROP CONSTRAINT requested_test_quoted_or_media;
ALTER TABLE requested_test ADD CONSTRAINT requested_test_quoted_or_media CHECK (quoted_line_id IS NOT NULL OR media_lot_id IS NOT NULL OR serving_order);

-- the price of a serving test not on the quote (only the media-qualification branch gains a sibling; as in 023 otherwise)
CREATE OR REPLACE FUNCTION requested_test_derive() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    q quoted_test_configuration; e test_catalog_entry; s sample; o lab_order; rt quote_rush_term;
    v_list numeric; v_active boolean; v_needs boolean;
BEGIN
    SELECT * INTO q FROM quoted_test_configuration WHERE id = NEW.quoted_line_id;
    SELECT * INTO e FROM test_catalog_entry WHERE test_id = NEW.test_id;
    SELECT * INTO s FROM sample WHERE id = NEW.sample_id;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.test_id <> OLD.test_id OR NEW.quoted_line_id IS DISTINCT FROM OLD.quoted_line_id OR NEW.sample_id <> OLD.sample_id
           OR NEW.test_version_id <> OLD.test_version_id OR NEW.media_lot_id IS DISTINCT FROM OLD.media_lot_id THEN
            RAISE EXCEPTION 'Test, sample, quote line and test version are fixed on a requested test';
        END IF;
        IF OLD.status = 'Cancelled' AND NEW.status <> 'Cancelled' THEN
            RAISE EXCEPTION 'A cancelled test cannot be reinstated; order it again';
        END IF;
        IF OLD.clock_start IS NOT NULL AND current_reason() IS NULL
           AND (NEW.status, NEW.rush_tier_id, NEW.special_instructions) IS DISTINCT FROM (OLD.status, OLD.rush_tier_id, OLD.special_instructions) THEN
            RAISE EXCEPTION 'A Reason for Change is required to change a test on a logged sample';
        END IF;
    END IF;
    IF NEW.tat_override IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.tat_override END) AND current_reason() IS NULL THEN
        RAISE EXCEPTION 'A Reason for Change is required to override the turnaround (TAT)';
    END IF;

    IF q.id IS NULL AND NEW.serving_order THEN
        -- 033: a serving weight or density test the per-serving calculation needs, not on the client's quote: its catalogue price
        IF NEW.rush_tier_id IS NOT NULL THEN RAISE EXCEPTION 'A serving calculation test ordered at its catalogue price is not rushed'; END IF;
        NEW.rush_status := 'None'; NEW.rush_requested_at := NULL;
        NEW.list_price := catalog_list_price(e.id); NEW.price := CASE WHEN NEW.status = 'Cancelled' THEN 0 ELSE NEW.list_price END; NEW.rush_fee := 0;
        NEW.tat_days := e.standard_tat; NEW.tat_unit := e.tat_unit;
    ELSIF q.id IS NULL THEN
        -- media qualification (no quote): the lab's own work
        IF NEW.rush_tier_id IS NOT NULL THEN RAISE EXCEPTION 'A media qualification test is not rushed'; END IF;
        NEW.rush_status := 'None'; NEW.rush_requested_at := NULL;
        NEW.list_price := 0; NEW.price := 0; NEW.rush_fee := 0;
        NEW.tat_days := e.standard_tat; NEW.tat_unit := e.tat_unit;
    ELSE
        IF TG_OP = 'INSERT' OR (NEW.rush_tier_id IS DISTINCT FROM OLD.rush_tier_id AND COALESCE(current_setting('lims.rush_explicit', true), '') <> '1') THEN
            IF NEW.rush_tier_id IS NULL THEN
                NEW.rush_status := 'None'; NEW.rush_requested_at := NULL;
            ELSE
                SELECT * INTO rt FROM quote_rush_term WHERE project_version_id = q.project_version_id AND tier_id = NEW.rush_tier_id;
                IF rt.id IS NULL OR e.rush_schedule_id IS DISTINCT FROM (SELECT schedule_id FROM rush_fee_tier WHERE id = NEW.rush_tier_id) THEN
                    RAISE EXCEPTION 'That rush tier is not available for this test on the client''s quote';
                END IF;
                v_needs := rush_requires_approval(e.id, NEW.rush_tier_id);
                NEW.rush_status := CASE WHEN v_needs THEN 'Pending Approval' ELSE 'Auto-accepted' END::rush_status;
                NEW.rush_requested_at := clock_timestamp();
            END IF;
        END IF;
        IF e.pricing_mode = 'Analyte Selection' AND TG_OP = 'UPDATE' THEN
            v_list := e.base_price + e.prep_fee
                    + COALESCE((SELECT sum(analyte_price) FROM requested_analyte WHERE requested_test_id = NEW.id AND included), 0);
        ELSE
            v_list := q.list_price;
        END IF;
        NEW.list_price := v_list;
        NEW.price := CASE WHEN q.list_price = 0 THEN q.final_price ELSE round(v_list * q.final_price / q.list_price, 2) END;
        IF NEW.status = 'Cancelled' THEN NEW.price := 0; END IF;
        v_active := NEW.rush_tier_id IS NOT NULL AND NEW.rush_status IN ('Auto-accepted','Approved') AND NEW.status <> 'Cancelled';
        IF v_active THEN
            SELECT * INTO rt FROM quote_rush_term WHERE project_version_id = q.project_version_id AND tier_id = NEW.rush_tier_id;
            NEW.rush_fee := round(CASE WHEN rt.surcharge_type = 'Flat' THEN rt.surcharge_value
                                       ELSE NEW.price * rt.surcharge_value / 100 END * (1 - rt.discount_pct / 100), 2);
            NEW.tat_days := rt.rush_tat; NEW.tat_unit := rt.tat_unit;
        ELSE
            NEW.rush_fee := 0;
            NEW.tat_days := e.standard_tat; NEW.tat_unit := e.tat_unit;
        END IF;
    END IF;
    IF NEW.tat_override IS NOT NULL THEN NEW.tat_days := NEW.tat_override; END IF;

    IF s.logged_at IS NOT NULL AND NEW.clock_start IS NULL THEN
        NEW.clock_start := GREATEST(s.logged_at, COALESCE(NEW.created_at, clock_timestamp()));
        IF NEW.status = 'Ordered' THEN NEW.status := 'In Pool'; END IF;
    END IF;
    IF NEW.clock_start IS NOT NULL AND NEW.tat_unit IS NOT NULL THEN
        NEW.day0 := tat_day0(o.site_id, NEW.clock_start, e.cutoff_time, NEW.tat_unit);
        NEW.due_date := tat_due(o.site_id, NEW.day0, NEW.tat_days, NEW.tat_unit);
    END IF;
    RETURN NEW;
END $$;

-- The lab's serving test of a role (the oldest active one with an effective version)
CREATE FUNCTION lab_serving_test(p_site uuid, p_role text) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT t.id FROM test t WHERE t.site_id = p_site AND t.serving_role = p_role AND t.status = 'Active'
       AND EXISTS (SELECT 1 FROM test_version v WHERE v.test_id = t.id AND v.status = 'Effective') ORDER BY t.created_at LIMIT 1
$$;

-- Order the serving test a sample needs (once): from the client's accepted quote when it is quoted, else at its catalogue price
CREATE FUNCTION order_serving_test(p_sample uuid, p_role text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE s sample; o lab_order; v_rt uuid; v_line uuid; v_test uuid; v_ver uuid;
BEGIN
    IF p_role NOT IN ('Serving weight','Density') THEN RAISE EXCEPTION 'Serving weight or Density'; END IF;
    SELECT * INTO s FROM sample WHERE id = p_sample;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;
    SELECT r.id INTO v_rt FROM requested_test r JOIN test t ON t.id = r.test_id WHERE r.sample_id = p_sample AND t.serving_role = p_role AND r.status <> 'Cancelled' LIMIT 1;
    IF v_rt IS NOT NULL THEN RETURN v_rt; END IF;
    SELECT ol.line_id INTO v_line FROM orderable_lines(o.client_id) ol JOIN test t ON t.id = ol.test_id
     WHERE t.serving_role = p_role AND t.site_id = o.site_id ORDER BY ol.line_id LIMIT 1;
    IF v_line IS NOT NULL THEN RETURN order_test(p_sample, v_line); END IF;
    v_test := lab_serving_test(o.site_id, p_role);
    IF v_test IS NULL THEN
        RAISE EXCEPTION 'No % test with an approved workflow at %: mark one in the Test catalogue ("Serving test")', p_role, (SELECT site_code FROM lab_site WHERE id = o.site_id);
    END IF;
    SELECT id INTO v_ver FROM test_version WHERE test_id = v_test AND status = 'Effective';
    INSERT INTO requested_test (sample_id, test_id, test_version_id, serving_order, special_instructions)
    VALUES (p_sample, v_test, v_ver, true, 'For the results per serving') RETURNING id INTO v_rt;
    RETURN v_rt;
END $$;

-- "Results per serving" ticked: order the serving test the serving needs (by volume: the density; else the unit weight)
CREATE FUNCTION sample_per_serving_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.report_per_serving AND NEW.status <> 'Cancelled'
       AND (TG_OP = 'INSERT' OR NOT OLD.report_per_serving OR NEW.serving_unit IS DISTINCT FROM OLD.serving_unit) THEN
        PERFORM order_serving_test(NEW.id, CASE WHEN unit_dimension_of(NEW.serving_unit) = 'Volume' THEN 'Density' ELSE 'Serving weight' END);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER z_sample_per_serving AFTER INSERT OR UPDATE OF report_per_serving, serving_unit ON sample FOR EACH ROW EXECUTE FUNCTION sample_per_serving_order();

-------------------------------------------------------------------------------
-- 4. THE APPROVED SERVING RESULT GOES BACK TO THE SAMPLE
-------------------------------------------------------------------------------
CREATE FUNCTION serving_result_feed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_role text; v_sample uuid; gs text := COALESCE(current_setting('lims.group_sync', true), ''); rs text := COALESCE(current_setting('lims.reason', true), '');
BEGIN
    IF NEW.status <> 'Active' OR NEW.stage <> 'Final' OR NEW.result_key IS NOT NULL OR NEW.value_num IS NULL THEN RETURN NULL; END IF;
    SELECT t.serving_role, r.sample_id INTO v_role, v_sample FROM requested_test r JOIN test t ON t.id = r.test_id WHERE r.id = NEW.requested_test_id;
    IF v_role IS NULL THEN RETURN NULL; END IF;
    IF v_role = 'Serving weight' AND unit_dimension_of(NEW.unit) IS DISTINCT FROM 'Mass' THEN RETURN NULL; END IF;     -- not a weight: left to the release check
    IF v_role = 'Density' AND unit_dimension_of(NEW.unit) IS DISTINCT FROM 'Mass/Volume' THEN RETURN NULL; END IF;
    PERFORM set_config('lims.group_sync', '1', true);
    IF btrim(rs) = '' THEN PERFORM set_config('lims.reason', v_role || ' measured: the approved result is used for the results per serving', true); END IF;
    IF v_role = 'Serving weight' THEN
        UPDATE sample SET unit_weight = NEW.value_num, unit_weight_unit = NEW.unit, unit_weight_result_id = NEW.id WHERE id = v_sample;
    ELSE
        UPDATE sample SET density = NEW.value_num, density_unit = NEW.unit, density_result_id = NEW.id WHERE id = v_sample;
    END IF;
    PERFORM set_config('lims.group_sync', gs, true); PERFORM set_config('lims.reason', rs, true);
    RETURN NULL;
END $$;
CREATE TRIGGER z_serving_feed AFTER INSERT OR UPDATE OF status, value_num ON test_result FOR EACH ROW EXECUTE FUNCTION serving_result_feed();

-------------------------------------------------------------------------------
-- 5. LIMITS PER SERVING / PACKAGE USE THE DENSITY TOO (as 031, with sample_per_serving)
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION spec_conformance(p_rt uuid, p_analyte uuid, p_value numeric, p_text text, p_reported text, p_unit text, p_found text[])
RETURNS TABLE (spec_min numeric, spec_max numeric, spec_text text, spec_unit text, conformance text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE sp specification; x numeric; below boolean := false; f numeric; u text := p_unit; smp sample; ps record;
BEGIN
    SELECT * INTO sp FROM specification s WHERE s.requested_test_id = p_rt AND s.analyte_id = p_analyte AND s.status = 'Active' LIMIT 1;
    IF sp.id IS NULL THEN spec_min := NULL; spec_max := NULL; spec_text := NULL; spec_unit := NULL; conformance := 'No specification'; RETURN NEXT; RETURN; END IF;
    spec_min := sp.min_value; spec_max := sp.max_value; spec_text := sp.text_value; spec_unit := sp.unit;
    IF sp.basis <> 'As reported' THEN spec_unit := COALESCE(sp.unit, '') || CASE sp.basis WHEN 'Per serving' THEN ' per serving' ELSE ' per package' END; END IF;
    IF sp.min_value IS NULL AND sp.max_value IS NULL THEN
        conformance := CASE WHEN p_text IS NULL THEN 'Not compared' WHEN p_text = ANY (COALESCE(p_found, '{}')) THEN 'Does not conform' ELSE 'Conforms' END;
        RETURN NEXT; RETURN;
    END IF;
    IF p_reported ~ '^\s*-?[0-9]*\.?[0-9]+\s*$' THEN x := p_reported::numeric;
    ELSIF p_reported LIKE '<%' OR p_reported = 'ND' THEN below := true; x := COALESCE(NULLIF(regexp_replace(p_reported, '[^0-9.]', '', 'g'), '')::numeric, 0);
    ELSE x := p_value; END IF;
    IF x IS NULL THEN conformance := 'Not compared'; RETURN NEXT; RETURN; END IF;
    IF sp.basis <> 'As reported' THEN
        SELECT s.* INTO smp FROM requested_test rt JOIN sample s ON s.id = rt.sample_id WHERE rt.id = p_rt;
        SELECT * INTO ps FROM sample_per_serving(x, p_unit, smp.id);
        IF ps.value IS NULL OR (sp.basis = 'Per package' AND smp.servings_per_package IS NULL) THEN conformance := 'Not compared'; RETURN NEXT; RETURN; END IF;
        x := sig3(ps.value * CASE WHEN sp.basis = 'Per package' THEN smp.servings_per_package ELSE 1 END);
        u := regexp_replace(ps.unit, ' per serving$', '');
    END IF;
    f := CASE WHEN sp.unit IS NULL OR u IS NULL OR sp.unit = u THEN 1 ELSE unit_factor(u, sp.unit, NULL) END;
    IF f IS NULL THEN conformance := 'Not compared'; RETURN NEXT; RETURN; END IF;
    x := x * f;
    conformance := CASE WHEN (sp.max_value IS NOT NULL AND x > sp.max_value AND NOT below) OR (sp.min_value IS NOT NULL AND (x < sp.min_value OR below)) THEN 'Does not conform' ELSE 'Conforms' END;
    RETURN NEXT;
END $$;

-------------------------------------------------------------------------------
-- 6. UNPLANNED: A REQUEST FOR THE SERVING TEST, WAITING FOR THE CLIENT'S CONSENT
-------------------------------------------------------------------------------
-- the split-off requests can now be raised without a bench step (no batch, step run or entry)
ALTER TABLE split_request ALTER COLUMN step_run_id DROP NOT NULL;
ALTER TABLE split_request ALTER COLUMN batch_id DROP NOT NULL;
ALTER TABLE split_request ALTER COLUMN entry_id DROP NOT NULL;
ALTER TABLE split_request ADD COLUMN serving_role text CHECK (serving_role IN ('Serving weight','Density'));
DROP VIEW split_request_view;
CREATE VIEW split_request_view AS
SELECT s.*, sm.sample_code, sm.client_sample_id, o.id AS lab_order_id, o.order_code, o.site_id, t.test_code, t.test_name, b.batch_code,
       ot.test_name AS origin_test_name, u.full_name AS decided_by_name, COALESCE(c.display_name, c.legal_name) AS client_name
  FROM split_request s JOIN sample sm ON sm.id = s.sample_id JOIN lab_order o ON o.id = sm.lab_order_id JOIN client c ON c.id = o.client_id
  JOIN test t ON t.id = s.test_id LEFT JOIN test_batch b ON b.id = s.batch_id JOIN requested_test ort ON ort.id = s.origin_requested_test_id
  JOIN test ot ON ot.id = ort.test_id LEFT JOIN app_user u ON u.id = s.decided_by;

CREATE FUNCTION request_serving_test(p_sample uuid, p_role text, p_note text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE s sample; o lab_order; v_origin uuid; v_test uuid; v_id uuid; prev text := COALESCE(current_setting('lims.testing_internal', true), '');
BEGIN
    IF p_role NOT IN ('Serving weight','Density') THEN RAISE EXCEPTION 'Serving weight or Density'; END IF;
    SELECT * INTO s FROM sample WHERE id = p_sample;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;
    IF NOT (has_permission_at('orders.edit', o.site_id) OR has_permission_at('reports.finalize', o.site_id) OR has_permission_at('testing.review', o.site_id)) THEN
        PERFORM require_permission_at('orders.edit', o.site_id);
    END IF;
    IF EXISTS (SELECT 1 FROM requested_test r JOIN test t ON t.id = r.test_id WHERE r.sample_id = p_sample AND t.serving_role = p_role AND r.status <> 'Cancelled') THEN
        RAISE EXCEPTION 'The % test is already ordered on this sample', p_role;
    END IF;
    IF EXISTS (SELECT 1 FROM split_request WHERE sample_id = p_sample AND serving_role = p_role AND status IN ('Awaiting consent','Consent given','To order')) THEN
        RAISE EXCEPTION 'A request for the % test already waits on this sample', p_role;
    END IF;
    SELECT r.id INTO v_origin FROM requested_test r JOIN test t ON t.id = r.test_id WHERE r.sample_id = p_sample AND r.status <> 'Cancelled' AND t.serving_role IS NULL
     ORDER BY (serving_problem(r.id) IS NULL), r.created_at LIMIT 1;
    IF v_origin IS NULL THEN RAISE EXCEPTION 'The sample has no test that reports per serving'; END IF;
    SELECT t.id INTO v_test FROM orderable_lines(o.client_id) ol JOIN test t ON t.id = ol.test_id WHERE t.serving_role = p_role AND t.site_id = o.site_id LIMIT 1;
    v_test := COALESCE(v_test, lab_serving_test(o.site_id, p_role));
    IF v_test IS NULL THEN RAISE EXCEPTION 'No % test with an approved workflow at %: mark one in the Test catalogue ("Serving test")', p_role, (SELECT site_code FROM lab_site WHERE id = o.site_id); END IF;
    PERFORM set_config('lims.testing_internal', '1', true);
    INSERT INTO split_request (sample_id, origin_requested_test_id, test_id, finding, status, serving_role, decision_note)
    VALUES (p_sample, v_origin, v_test, 'Results per serving need the ' || lower(p_role) || ' measured', 'Awaiting consent', p_role, NULLIF(btrim(COALESCE(p_note, '')), ''))
    RETURNING id INTO v_id;
    PERFORM set_config('lims.testing_internal', prev, true);
    RETURN v_id;
END $$;

-- the client's consent orders the serving test (ordering closes the request, as for any split-off)
CREATE FUNCTION serving_request_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.serving_role IS NOT NULL AND NEW.status = 'Consent given' AND OLD.status IS DISTINCT FROM 'Consent given' THEN
        PERFORM order_serving_test(NEW.sample_id, NEW.serving_role);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER z_serving_consent AFTER UPDATE OF status ON split_request FOR EACH ROW EXECUTE FUNCTION serving_request_consent();

COMMIT;
