-- Sandbox demo data for migration 014 (WD-1.2): version 2 of the demo Heavy Metals by ICP-MS test with QC acceptance
-- criteria per analyte (mercury has its own limits; the matrix spike duplicate does not judge mercury), the weighing
-- tolerance in % (0.5 g ± 10 %) and the LOD hidden on the report. Built by the demo Analyst and left as a Draft, so a
-- Lab Supervisor, QA or Alex (who did not work on it) can review and approve it.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); t uuid; v uuid; qc jsonb;
BEGIN
    SELECT id INTO t FROM test WHERE site_id = cfl AND test_name = 'Heavy Metals (Pb, Cd, As, Hg) by ICP-MS';
    IF t IS NULL OR EXISTS (SELECT 1 FROM test_version WHERE test_id = t AND version_no > 1) THEN RETURN; END IF;
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'analyst'), true);
    PERFORM script_signature('Sandbox demo data');
    v := new_test_version(t);
    UPDATE test_version SET change_summary = 'QC limits per analyte (mercury has its own); weighing tolerance 10 %; LOD not printed on the report' WHERE id = v;
    UPDATE test_version_analyte SET hide_lod = true WHERE test_version_id = v;

    -- one row per analyte for each criterion: name => [applies, min, max, limit_ref]; analytes not named use the default
    CREATE TEMP TABLE IF NOT EXISTS demo_lim (qc text, lt text, dmin numeric, dmax numeric, dref text, an text, applies boolean, mn numeric, mx numeric, ref text) ON COMMIT DROP;
    DELETE FROM demo_lim;
    INSERT INTO demo_lim VALUES
      ('Method Blank', 'Blank threshold', NULL, NULL, '½ LOQ', NULL, NULL, NULL, NULL, NULL),
      ('Laboratory Control Sample', 'Recovery %', 80, 120, NULL, 'Mercury', true, 75, 125, NULL),
      ('Matrix Spike', 'Recovery %', 75, 125, NULL, 'Mercury', true, 70, 130, NULL),
      ('Matrix Spike Duplicate', 'RPD', NULL, 20, NULL, 'Mercury', false, NULL, NULL, NULL),
      ('ICV', 'Recovery %', 90, 110, NULL, NULL, NULL, NULL, NULL, NULL),
      ('CCV', 'Recovery %', 90, 110, NULL, 'Mercury', true, 85, 115, NULL);
    SELECT jsonb_agg(q.qc || jsonb_build_object('criteria', (
             SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('limit_type', d.lt, 'min', d.dmin, 'max', d.dmax, 'limit_ref', d.dref)) || jsonb_build_object('analytes', (
                      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('analyte_id', a.analyte_id,
                               'applies', COALESCE(x.applies, true),
                               'min', CASE WHEN x.an IS NOT NULL THEN x.mn ELSE d.dmin END,
                               'max', CASE WHEN x.an IS NOT NULL THEN x.mx ELSE d.dmax END,
                               'limit_ref', CASE WHEN x.an IS NOT NULL THEN x.ref ELSE d.dref END)) ORDER BY a.sort_order)
                        FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id
                        LEFT JOIN demo_lim x ON x.qc = d.qc AND x.an = an.analyte_name
                       WHERE a.test_version_id = v AND a.status = 'Active')))
               FROM (SELECT DISTINCT ON (qc) * FROM demo_lim ORDER BY qc) d WHERE d.qc = q.qc->>'qc_type')) ORDER BY q.n)
      INTO qc
      FROM workflow_step s, jsonb_array_elements(s.config->'qc') WITH ORDINALITY q(qc, n)
     WHERE s.test_version_id = v AND s.step_type = 'Batching';
    UPDATE workflow_step SET config = jsonb_set(config, '{qc}', qc) WHERE test_version_id = v AND step_type = 'Batching';
    UPDATE workflow_step SET config = config || '{"target_mode": "Single", "target": 0.5, "tolerance": 10, "tolerance_unit": "%"}'::jsonb
     WHERE test_version_id = v AND step_type = 'Weighing';
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
END $$;

COMMIT;
