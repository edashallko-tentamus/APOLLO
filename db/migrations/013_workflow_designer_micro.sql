-- LIMS3 schema, migration 013: WORKFLOW DESIGNER, WD-1.1: micro definitions from Irvine practice
-- Vault: "Decision - Workflow Designer Micro Definitions" (Alex Kiddle, 2026-10-13), "Context - AAL Irvine Micro SOP Review".
--  - Product categories (Cosmetic, Dietary Supplement, Food, Raw Material...): a controlled list; each matrix may belong
--    to one. A Weighing step can have no target (the analyst decides), one target, or a weight range per product
--    category; a Dilution step can set its amounts per category (e.g. 10 g into 90 mL for supplements, 1 g into 9 mL
--    for cosmetics). Optional: easy to drop if labs do not use it.
--  - Each qualitative analyte has its own result values (default Absent / Present; Irvine micro: ND, ND*, D*, D) and the
--    values that mean "found" (what a split-off on a finding reacts to).
--  - A batch QC can run daily (one set per method per day, shared by that day's batches) and can be made from strains
--    of the test's organisms (the bench will refuse any other material, WD-4).

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);

-------------------------------------------------------------------------------
-- 1. PRODUCT CATEGORIES (controlled list, shared by all labs; kept with the Matrix list)
-------------------------------------------------------------------------------
CREATE TABLE product_category (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category_name   text NOT NULL CHECK (btrim(category_name) <> ''),
    description     text,
    sort_order      integer NOT NULL DEFAULT 0,
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX product_category_uq ON product_category (lower(category_name));
CALL make_gxp('product_category');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON product_category FOR EACH ROW EXECUTE FUNCTION require_list_permission('master.matrices');
INSERT INTO product_category (category_name, description, sort_order) VALUES
 ('Cosmetic', 'Cosmetics and personal care', 1), ('Dietary Supplement', 'Dietary supplements', 2),
 ('Food', 'Foods and beverages', 3), ('Raw Material', 'Ingredients and raw materials', 4);
ALTER TABLE matrix ADD COLUMN product_category_id uuid REFERENCES product_category(id);

-------------------------------------------------------------------------------
-- 2. QUALITATIVE RESULT VALUES PER ANALYTE
-------------------------------------------------------------------------------
ALTER TABLE test_version_analyte
    ADD COLUMN result_values text[] NOT NULL DEFAULT '{Absent,Present}',
    ADD COLUMN found_values  text[] NOT NULL DEFAULT '{Present}';
CREATE OR REPLACE FUNCTION tva_values() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.result_values := array(SELECT v FROM (SELECT btrim(x) AS v, min(n) AS n FROM unnest(NEW.result_values) WITH ORDINALITY u(x, n) WHERE btrim(x) <> '' GROUP BY btrim(x)) q ORDER BY n);   -- order kept
    NEW.found_values := array(SELECT v FROM (SELECT btrim(x) AS v, min(n) AS n FROM unnest(NEW.found_values) WITH ORDINALITY u(x, n) WHERE btrim(x) <> '' GROUP BY btrim(x)) q ORDER BY n);
    RETURN NEW;
END $$;
CREATE TRIGGER a02_values BEFORE INSERT OR UPDATE ON test_version_analyte FOR EACH ROW EXECUTE FUNCTION tva_values();

-------------------------------------------------------------------------------
-- 3. VALIDATION AND COPYING KNOW THE NEW SETTINGS
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION test_version_problems(p_version uuid) RETURNS TABLE (severity text, step_key text, problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE v test_version; t test; s record; q jsonb; c jsonb; o jsonb; f jsonb; tok text; ref workflow_step; n integer; m integer;
        anc uuid[]; tv_analytes uuid[]; lt text; tgt test; dep uuid;
BEGIN
    SELECT * INTO v FROM test_version WHERE id = p_version;
    SELECT * INTO t FROM test WHERE id = v.test_id;
    SELECT array_agg(analyte_id) INTO tv_analytes FROM test_version_analyte WHERE test_version_id = p_version AND status = 'Active';
    -- the test and version
    IF t.department_id IS NULL THEN RETURN QUERY SELECT 'Error', NULL::text, 'Choose the department that does this test (tab 1)'; END IF;
    IF v.method_id IS NULL THEN RETURN QUERY SELECT 'Error', NULL::text, 'Choose the method (SOP) this version follows (tab 1)';
    ELSIF EXISTS (SELECT 1 FROM method WHERE id = v.method_id AND status <> 'Active') THEN RETURN QUERY SELECT 'Error', NULL::text, 'The method is Inactive; choose an active one (tab 1)';
    END IF;
    IF t.department_id IS NOT NULL AND NOT department_has_people(t.department_id) THEN
        RETURN QUERY SELECT 'Warning', NULL::text, format('Nobody is in a group for the %s department yet, so nobody could do its steps (Admin > Groups: mark a group as that department)',
            (SELECT department_name FROM department WHERE id = t.department_id));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM test_catalog_entry WHERE test_id = t.id) THEN
        RETURN QUERY SELECT 'Warning', NULL::text, 'Not priced yet: it can be approved, but cannot be quoted or ordered until the catalogue has its price';
    END IF;
    -- analytes
    IF tv_analytes IS NULL THEN RETURN QUERY SELECT 'Error', NULL::text, 'Add at least one analyte (tab 2)'; END IF;
    RETURN QUERY SELECT 'Error', NULL::text, format('%s: a %s result needs a reporting unit (tab 2)', an.analyte_name, lower(a.result_type::text))
      FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id
     WHERE a.test_version_id = p_version AND a.status = 'Active' AND a.result_type IN ('Numeric','Count') AND a.reporting_unit IS NULL;
    RETURN QUERY SELECT 'Error', NULL::text, format('%s: a qualitative result needs at least two result values (tab 2)', an.analyte_name)
      FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id
     WHERE a.test_version_id = p_version AND a.status = 'Active' AND a.result_type = 'Qualitative' AND cardinality(a.result_values) < 2;
    RETURN QUERY SELECT 'Error', NULL::text, format('%s: the values that mean "found" must be among its result values (tab 2)', an.analyte_name)
      FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id
     WHERE a.test_version_id = p_version AND a.status = 'Active' AND a.result_type = 'Qualitative' AND NOT (a.found_values <@ a.result_values);
    -- steps
    SELECT count(*) INTO n FROM workflow_step WHERE test_version_id = p_version AND status = 'Active';
    IF n = 0 THEN RETURN QUERY SELECT 'Error', NULL::text, 'Add the workflow steps (tab 3)'; RETURN; END IF;
    SELECT count(*) INTO m FROM workflow_step s0 WHERE s0.test_version_id = p_version AND s0.status = 'Active'
       AND NOT EXISTS (SELECT 1 FROM workflow_step_dependency d WHERE d.step_id = s0.id AND d.status = 'Active');
    IF m <> 1 THEN
        RETURN QUERY SELECT 'Error', NULL::text, format('The workflow must have exactly one first step; %s steps come after nothing. Connect each step to the one before it.', m);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM workflow_step WHERE test_version_id = p_version AND status = 'Active' AND step_type = 'QC Review') THEN
        RETURN QUERY SELECT 'Error', NULL::text, 'The workflow needs a QC Review step (where the results are reviewed and approved)';
    END IF;
    IF (SELECT count(*) FROM workflow_step WHERE test_version_id = p_version AND status = 'Active' AND step_type = 'Batching') > 1 THEN
        RETURN QUERY SELECT 'Error', NULL::text, 'Only one Batching step is allowed';
    END IF;

    FOR s IN SELECT ws.* FROM workflow_step ws WHERE ws.test_version_id = p_version AND ws.status = 'Active' ORDER BY ws.sort_order, ws.step_key LOOP
        c := s.config;
        SELECT array_agg(a.step_id) INTO anc FROM step_ancestors(s.id) a;
        -- shape of the graph
        IF s.step_type = 'Batching' AND anc IS NOT NULL THEN RETURN QUERY SELECT 'Error', s.step_key, 'Batching must be the first step'; END IF;
        IF s.step_type <> 'QC Review' AND NOT EXISTS (SELECT 1 FROM workflow_step_dependency d JOIN workflow_step x ON x.id = d.step_id
                                                       WHERE d.depends_on_step_id = s.id AND d.status = 'Active' AND x.status = 'Active') THEN
            RETURN QUERY SELECT 'Error', s.step_key, 'Nothing comes after this step: every branch must end in a QC Review';
        END IF;
        dep := COALESCE(s.department_id, t.department_id);
        IF s.department_id IS NOT NULL AND s.department_id IS DISTINCT FROM t.department_id AND NOT department_has_people(s.department_id) THEN
            RETURN QUERY SELECT 'Warning', s.step_key, format('Nobody is in a group for the %s department, so nobody could do this step', (SELECT department_name FROM department WHERE id = s.department_id));
        END IF;
        -- equipment
        -- (a Data Entry step that is a manual observation, with no instrument export to attach, needs no instrument)
        IF s.step_type IN ('Weighing','Incubation') OR (s.step_type = 'Data Entry' AND COALESCE(c->>'require_attachment', 'true') <> 'false')
           OR EXISTS (SELECT 1 FROM workflow_step_equipment WHERE step_id = s.id AND status = 'Active') THEN
            SELECT count(*), count(*) FILTER (WHERE is_main) INTO n, m FROM workflow_step_equipment WHERE step_id = s.id AND status = 'Active';
            IF n = 0 THEN RETURN QUERY SELECT 'Error', s.step_key, format('Choose the equipment type for this %s step', lower(s.step_type::text));
            ELSIF m <> 1 THEN RETURN QUERY SELECT 'Error', s.step_key, 'Mark exactly one equipment type as the main instrument (the others are alternatives)';
            END IF;
        END IF;
        -- settings per step type
        CASE s.step_type
        WHEN 'Batching' THEN
            IF NOT jnum_ok(c, 'max_samples', 1) THEN RETURN QUERY SELECT 'Error', s.step_key, 'Enter the maximum number of samples per batch (1 or more)'; END IF;
            FOR q IN SELECT * FROM jsonb_array_elements(COALESCE(c->'qc', '[]')) LOOP
                IF NOT EXISTS (SELECT 1 FROM qc_type WHERE qc_type = q->>'qc_type') THEN RETURN QUERY SELECT 'Error', s.step_key, format('"%s" is not a QC type', q->>'qc_type'); CONTINUE; END IF;
                IF COALESCE(q->>'qc_class', '') NOT IN ('Prep','Analytical') THEN RETURN QUERY SELECT 'Error', s.step_key, format('%s: choose Prep or Analytical QC', q->>'qc_type'); END IF;
                IF COALESCE(q->>'frequency', '') = 'Every N' THEN
                    IF NOT jnum_ok(q, 'every_n', 1) THEN RETURN QUERY SELECT 'Error', s.step_key, format('%s: every how many samples?', q->>'qc_type'); END IF;
                ELSIF COALESCE(q->>'frequency', '') = 'Once' THEN
                    IF NOT jnum_ok(q, 'count', 1, false) THEN RETURN QUERY SELECT 'Error', s.step_key, format('%s: how many per batch?', q->>'qc_type'); END IF;
                ELSIF COALESCE(q->>'frequency', '') = 'Daily' THEN NULL;   -- one set per method per day, shared by that day's batches
                ELSE RETURN QUERY SELECT 'Error', s.step_key, format('%s: choose how often (once per batch, every N samples, or daily)', q->>'qc_type');
                END IF;
                IF COALESCE(q->>'material', '') = 'Strains' AND NOT EXISTS (SELECT 1 FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id
                        WHERE a.test_version_id = p_version AND a.status = 'Active' AND an.analyte_class = 'Microbiological') THEN
                    RETURN QUERY SELECT 'Error', s.step_key, format('%s is made from strains of the test''s organisms, but the test has no microbiological analytes', q->>'qc_type');
                ELSIF COALESCE(q->>'material', '') NOT IN ('', 'Strains') THEN
                    RETURN QUERY SELECT 'Error', s.step_key, format('%s: "%s" is not a material requirement', q->>'qc_type', q->>'material');
                END IF;
                FOR o IN SELECT * FROM jsonb_array_elements(COALESCE(q->'criteria', '[]')) LOOP
                    SELECT shape INTO lt FROM qc_limit_type WHERE limit_type = o->>'limit_type';
                    IF lt IS NULL THEN RETURN QUERY SELECT 'Error', s.step_key, format('%s: "%s" is not a limit type', q->>'qc_type', o->>'limit_type'); CONTINUE; END IF;
                    IF lt = 'Range' AND (NOT jnum_ok(o, 'min') OR NOT jnum_ok(o, 'max') OR (o->>'min')::numeric > (o->>'max')::numeric) THEN
                        RETURN QUERY SELECT 'Error', s.step_key, format('%s %s: enter a minimum and a maximum (min not above max)', q->>'qc_type', o->>'limit_type');
                    ELSIF lt = 'Max' AND NOT jnum_ok(o, 'max') AND COALESCE(o->>'limit_ref', '') NOT IN ('LOQ','½ LOQ','LOD') THEN
                        RETURN QUERY SELECT 'Error', s.step_key, format('%s %s: enter a maximum, or LOQ, ½ LOQ or LOD', q->>'qc_type', o->>'limit_type');
                    END IF;
                    FOR f IN SELECT * FROM jsonb_array_elements(COALESCE(o->'overrides', '[]')) LOOP
                        IF tv_analytes IS NULL OR NOT ((f->>'analyte_id')::uuid = ANY(tv_analytes)) THEN
                            RETURN QUERY SELECT 'Error', s.step_key, format('%s %s: an analyte exception names an analyte that is not on this test', q->>'qc_type', o->>'limit_type');
                        ELSIF lt = 'Range' AND (NOT jnum_ok(f, 'min') OR NOT jnum_ok(f, 'max') OR (f->>'min')::numeric > (f->>'max')::numeric) THEN
                            RETURN QUERY SELECT 'Error', s.step_key, format('%s %s exception for %s: enter a minimum and a maximum', q->>'qc_type', o->>'limit_type', (SELECT analyte_name FROM analyte WHERE id = (f->>'analyte_id')::uuid));
                        END IF;
                    END LOOP;
                END LOOP;
            END LOOP;
        WHEN 'Weighing' THEN
            IF COALESCE(c->>'target_mode', CASE WHEN c ? 'target' THEN 'Single' ELSE 'None' END) = 'Single' THEN
                IF NOT jnum_ok(c, 'target', 0) OR NOT jnum_ok(c, 'tolerance', 0, false) THEN RETURN QUERY SELECT 'Error', s.step_key, 'Enter the target weight (and tolerance)'; END IF;
            ELSIF c->>'target_mode' = 'By product category' THEN
                IF jsonb_array_length(COALESCE(c->'by_category', '[]')) = 0 THEN RETURN QUERY SELECT 'Error', s.step_key, 'Enter a weight range for at least one product category'; END IF;
                FOR o IN SELECT * FROM jsonb_array_elements(COALESCE(c->'by_category', '[]')) LOOP
                    IF NOT EXISTS (SELECT 1 FROM product_category WHERE id::text = o->>'category_id' AND status = 'Active') THEN
                        RETURN QUERY SELECT 'Error', s.step_key, 'A weight range names a product category that is not on the list';
                    ELSIF NOT jnum_ok(o, 'min', 0) OR NOT jnum_ok(o, 'max', 0) OR (o->>'min')::numeric > (o->>'max')::numeric THEN
                        RETURN QUERY SELECT 'Error', s.step_key, format('%s: enter the lowest and highest weight', (SELECT category_name FROM product_category WHERE id::text = o->>'category_id'));
                    END IF;
                END LOOP;
                IF (SELECT count(*) <> count(DISTINCT x->>'category_id') FROM jsonb_array_elements(COALESCE(c->'by_category', '[]')) x) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'A product category appears twice';
                END IF;
            ELSIF c->>'target_mode' IS DISTINCT FROM 'None' THEN
                RETURN QUERY SELECT 'Error', s.step_key, 'Choose no target, one target, or a range per product category';
            END IF;
        WHEN 'Preparation' THEN
            FOR f IN SELECT * FROM jsonb_array_elements(COALESCE(c->'fields', '[]')) LOOP
                IF field_key(f->>'label') = '' THEN RETURN QUERY SELECT 'Error', s.step_key, 'Every field needs a label';
                ELSIF COALESCE(f->>'type', '') NOT IN ('Number','Text','Time','Date') THEN RETURN QUERY SELECT 'Error', s.step_key, format('Field "%s": choose Number, Text, Time or Date', f->>'label');
                END IF;
            END LOOP;
            IF (SELECT count(*) <> count(DISTINCT field_key(f2->>'label')) FROM jsonb_array_elements(COALESCE(c->'fields', '[]')) f2) THEN
                RETURN QUERY SELECT 'Error', s.step_key, 'Two fields have the same label';
            END IF;
        WHEN 'Plating/Inoculation' THEN
            IF NOT jnum_ok(c, 'plates_per_entry', 1) THEN RETURN QUERY SELECT 'Error', s.step_key, 'Enter the plates per entry (1 or more)'; END IF;
        WHEN 'Incubation' THEN
            IF NOT jnum_ok(c, 'temp_c') THEN RETURN QUERY SELECT 'Error', s.step_key, 'Enter the target temperature (°C)'; END IF;
            IF NOT jnum_ok(c, 'temp_tolerance', 0, false) THEN RETURN QUERY SELECT 'Error', s.step_key, 'The temperature tolerance must be a number'; END IF;
            IF NOT jnum_ok(c, 'duration', 0) OR COALESCE(c->>'duration_unit', '') NOT IN ('hours','days') THEN
                RETURN QUERY SELECT 'Error', s.step_key, 'Enter the target duration in hours or days';
            ELSIF NOT jnum_ok(c, 'window_min', 0) OR NOT jnum_ok(c, 'window_max', 0)
                  OR (c->>'window_min')::numeric > (c->>'duration')::numeric OR (c->>'window_max')::numeric < (c->>'duration')::numeric THEN
                RETURN QUERY SELECT 'Error', s.step_key, 'Enter the acceptable window (shortest and longest), around the target duration';
            END IF;
        WHEN 'Dilution' THEN
            FOR o IN SELECT * FROM jsonb_array_elements(COALESCE(c->'by_category', '[]')) LOOP
                IF NOT EXISTS (SELECT 1 FROM product_category WHERE id::text = o->>'category_id' AND status = 'Active') THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'An amount names a product category that is not on the list';
                ELSIF NOT jnum_ok(o, 'aliquot', 0) OR (o->>'aliquot')::numeric = 0 OR NOT jnum_ok(o, 'diluent', 0) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, format('%s: enter the amounts added', (SELECT category_name FROM product_category WHERE id::text = o->>'category_id'));
                END IF;
            END LOOP;
            IF COALESCE(c->>'mode', '') = 'Single' THEN
                IF jsonb_array_length(COALESCE(c->'by_category', '[]')) = 0 AND (NOT jnum_ok(c, 'aliquot', 0) OR (c->>'aliquot')::numeric = 0 OR NOT jnum_ok(c, 'diluent', 0)) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'Enter the default aliquot and diluent amounts (what is added, not a factor)';
                END IF;
            ELSIF COALESCE(c->>'mode', '') = 'Serial' THEN
                IF NOT jnum_ok(c, 'initial_amount', 0) OR (c->>'initial_amount')::numeric = 0 OR NOT jnum_ok(c, 'initial_diluent', 0)
                   OR NOT jnum_ok(c, 'transfer_aliquot', 0) OR (c->>'transfer_aliquot')::numeric = 0 OR NOT jnum_ok(c, 'transfer_diluent', 0) OR NOT jnum_ok(c, 'depth', 1) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'Enter the initial amounts, the transfer amounts and the standard depth';
                END IF;
            ELSE RETURN QUERY SELECT 'Error', s.step_key, 'Choose Single or Serial dilution';
            END IF;
            IF NOT jnum_ok(c, 'fields_per_entry', 1, false) THEN RETURN QUERY SELECT 'Error', s.step_key, 'Dilution fields per entry must be 1 or more'; END IF;
        WHEN 'Split off Test', 'Hold Point' THEN
            SELECT * INTO tgt FROM test WHERE id = CASE WHEN (c->>'test_id') ~ '^[0-9a-f-]{36}$' THEN (c->>'test_id')::uuid END;
            IF tgt.id IS NULL THEN RETURN QUERY SELECT 'Error', s.step_key, CASE s.step_type WHEN 'Hold Point' THEN 'Choose the test this step waits for' ELSE 'Choose the test to split off' END;
            ELSIF tgt.id = t.id THEN RETURN QUERY SELECT 'Error', s.step_key, 'A test cannot split off or wait for itself';
            ELSIF tgt.status <> 'Active' THEN RETURN QUERY SELECT 'Error', s.step_key, format('%s is retired', tgt.test_name);
            ELSIF tgt.site_id IS NOT NULL AND tgt.site_id IS DISTINCT FROM t.site_id THEN RETURN QUERY SELECT 'Error', s.step_key, format('%s belongs to another lab; copy it to this lab first', tgt.test_name);
            END IF;
            IF s.step_type = 'Split off Test' AND COALESCE(c->>'trigger', '') NOT IN ('On finding','Manual only') THEN
                RETURN QUERY SELECT 'Error', s.step_key, 'Choose when it is split off (on a finding, or by the analyst only)';
            END IF;
            IF s.step_type = 'Split off Test' AND c->>'trigger' = 'On finding' THEN
                IF jsonb_typeof(c->'finding_steps') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'finding_steps') = 0 THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'Choose the Data Entry step(s), before this one, whose finding splits off the test';
                ELSE
                    FOR o IN SELECT * FROM jsonb_array_elements(c->'finding_steps') LOOP
                        SELECT * INTO ref FROM workflow_step WHERE test_version_id = p_version AND workflow_step.step_key = (o #>> '{}') AND status = 'Active';
                        IF ref.id IS NULL OR NOT (ref.id = ANY(COALESCE(anc, '{}'))) OR ref.step_type <> 'Data Entry' THEN
                            RETURN QUERY SELECT 'Error', s.step_key, format('"%s" is not a Data Entry step that comes before this one', o #>> '{}');
                        END IF;
                    END LOOP;
                END IF;
                IF COALESCE(c->>'finding', '') NOT IN ('Present','Count above') OR (c->>'finding' = 'Count above' AND NOT jnum_ok(c, 'count_above', 0)) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'Choose the finding: something found (a value that means found), or a count above a number';
                END IF;
            END IF;
        WHEN 'Calculation' THEN
            IF formula_check(c->>'formula') IS NOT NULL THEN RETURN QUERY SELECT 'Error', s.step_key, 'Formula: ' || formula_check(c->>'formula'); END IF;
            FOR o IN SELECT * FROM jsonb_array_elements(COALESCE(c->'overrides', '[]')) LOOP
                IF tv_analytes IS NULL OR NOT ((o->>'analyte_id')::uuid = ANY(tv_analytes)) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'A formula exception names an analyte that is not on this test';
                ELSIF formula_check(o->>'formula') IS NOT NULL THEN
                    RETURN QUERY SELECT 'Error', s.step_key, format('Formula for %s: %s', (SELECT analyte_name FROM analyte WHERE id = (o->>'analyte_id')::uuid), formula_check(o->>'formula'));
                END IF;
            END LOOP;
            -- every token must name a step that comes before this one, and a field that step offers
            FOREACH tok IN ARRAY formula_tokens(COALESCE(c->>'formula', '') || ' ' || COALESCE((SELECT string_agg(o2->>'formula', ' ') FROM jsonb_array_elements(COALESCE(c->'overrides', '[]')) o2), '')) LOOP
                SELECT * INTO ref FROM workflow_step WHERE test_version_id = p_version AND workflow_step.step_key = split_part(tok, '.', 1) AND status = 'Active';
                IF ref.id IS NULL THEN RETURN QUERY SELECT 'Error', s.step_key, format('{%s}: there is no step "%s"', tok, split_part(tok, '.', 1));
                ELSIF NOT (ref.id = ANY(COALESCE(anc, '{}'))) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, format('{%s}: "%s" does not come before this step, so its value would not exist yet', tok, ref.step_name);
                ELSIF NOT (split_part(tok, '.', 2) = ANY(step_token_fields(ref.id))) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, format('{%s}: "%s" offers %s', tok, ref.step_name,
                        COALESCE(NULLIF(array_to_string(array(SELECT '{' || ref.step_key || '.' || x || '}' FROM unnest(step_token_fields(ref.id)) x), ', '), ''), 'no values to formulas'));
                END IF;
            END LOOP;
        WHEN 'Data Entry' THEN
            IF COALESCE(btrim(c->>'value_label'), '') = '' THEN RETURN QUERY SELECT 'Error', s.step_key, 'Name the value that is entered (e.g. Concentration in solution)'; END IF;
            FOR o IN SELECT * FROM jsonb_array_elements(COALESCE(c->'analyte_ids', '[]')) LOOP
                IF tv_analytes IS NULL OR NOT ((o #>> '{}')::uuid = ANY(tv_analytes)) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'This step lists an analyte that is not on the test';
                END IF;
            END LOOP;
        ELSE NULL;
        END CASE;
    END LOOP;
    RETURN;
END $$;

CREATE OR REPLACE FUNCTION copy_version_content(p_src uuid, p_dst uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE src_site uuid; dst_site uuid; s workflow_step; v_new uuid; map jsonb := '{}';
BEGIN
    SELECT t.site_id INTO src_site FROM test t JOIN test_version v ON v.test_id = t.id WHERE v.id = p_src;
    SELECT t.site_id INTO dst_site FROM test t JOIN test_version v ON v.test_id = t.id WHERE v.id = p_dst;
    INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, reporting_unit, loq, lod, rounding_mode, rounding_digits,
                                      hide_on_report, default_spec_min, default_spec_max, default_spec_text, result_values, found_values)
    SELECT p_dst, analyte_id, sort_order, result_type, reporting_unit, loq, lod, rounding_mode, rounding_digits, hide_on_report, default_spec_min, default_spec_max, default_spec_text, result_values, found_values
      FROM test_version_analyte WHERE test_version_id = p_src AND status = 'Active';
    FOR s IN SELECT * FROM workflow_step WHERE test_version_id = p_src AND status = 'Active' ORDER BY sort_order LOOP
        INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, department_id, instructions, config)
        VALUES (p_dst, s.step_key, s.step_name, s.step_type, s.sort_order,
                CASE WHEN src_site IS NOT DISTINCT FROM dst_site THEN s.department_id
                     ELSE (SELECT d2.id FROM department d1 JOIN department d2 ON upper(d2.department_code) = upper(d1.department_code) AND d2.site_id = dst_site
                            WHERE d1.id = s.department_id AND d2.status = 'Active') END,
                s.instructions, s.config)
        RETURNING id INTO v_new;
        map := map || jsonb_build_object(s.id::text, v_new);
        INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main)
        SELECT v_new, CASE WHEN src_site IS NOT DISTINCT FROM dst_site THEN e.equipment_type_id ELSE e2.id END, e.is_main
          FROM workflow_step_equipment e JOIN equipment_type e1 ON e1.id = e.equipment_type_id
          LEFT JOIN equipment_type e2 ON lower(e2.type_name) = lower(e1.type_name) AND e2.site_id = dst_site AND e2.status = 'Active'
         WHERE e.step_id = s.id AND e.status = 'Active' AND (src_site IS NOT DISTINCT FROM dst_site OR e2.id IS NOT NULL);
    END LOOP;
    INSERT INTO workflow_step_dependency (step_id, depends_on_step_id, dependency_type)
    SELECT (map->>d.step_id::text)::uuid, (map->>d.depends_on_step_id::text)::uuid, d.dependency_type
      FROM workflow_step_dependency d JOIN workflow_step s1 ON s1.id = d.step_id
     WHERE s1.test_version_id = p_src AND d.status = 'Active' AND map ? d.step_id::text AND map ? d.depends_on_step_id::text;
END $$;

ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_slice11;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'product_category' THEN RETURN jsonb_build_object('label', 'Product category ' || (r->>'category_name'), 'link', '#/admin/matrices'); END IF;
    RETURN audit_record_ref_slice11(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
