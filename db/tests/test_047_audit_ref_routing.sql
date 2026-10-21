-- Verification for migration 054: audit labels are routed to the layer that names the table, so a label no longer
-- goes down the whole chain of audit_record_ref layers (which crashed PGlite from 053 on). Runs after every other test.
SET search_path = lims, public;
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
-- a call from inside nested PL/pgSQL, as the earlier tests and the screens make it
CREATE OR REPLACE FUNCTION pg_temp.ar_nested(t text, depth integer) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  IF depth > 0 THEN RETURN pg_temp.ar_nested(t, depth - 1); END IF;
  RETURN (SELECT audit_record_ref(a.table_name, a.record_id, a.new_row) FROM audit_log a WHERE a.table_name = t ORDER BY a.id DESC LIMIT 1);
END $$;

SELECT pg_temp.expect_true('The chain of layers is known (more than 30) and ends at the oldest one, which calls no other',
  (SELECT count(*) > 30 FROM audit_ref_chain)
  AND (SELECT prosrc !~ 'audit_record_ref_[a-z0-9]+\s*\(' FROM pg_proc WHERE proname = (SELECT fn FROM audit_ref_chain ORDER BY depth DESC LIMIT 1)));
SELECT pg_temp.expect_true('Each table goes to the newest layer that names it: a requested test to an old layer, a competency attempt to the newest',
  (SELECT depth > 10 FROM audit_ref_route WHERE table_name = 'requested_test')
  AND (SELECT depth = 0 FROM audit_ref_route WHERE table_name = 'competency_attempt'));
SELECT pg_temp.expect_true('A requested test''s label from five calls deep: its test, its sample, a link to the sample',
  (SELECT x->>'label' LIKE '% on %' AND x->>'link' LIKE '#/samples/%' FROM (SELECT pg_temp.ar_nested('requested_test', 5) AS x) q));
SELECT pg_temp.expect_true('A sample, an order and a lot are labelled with their links',
  (SELECT x->>'link' LIKE '#/samples/%' FROM (SELECT pg_temp.ar_nested('sample', 5) AS x) q)
  AND (SELECT x->>'link' LIKE '#/orders/%' FROM (SELECT pg_temp.ar_nested('lab_order', 5) AS x) q)
  AND (SELECT x->>'link' LIKE '#/inventory/lots/%' FROM (SELECT pg_temp.ar_nested('inventory_lot', 5) AS x) q));
SELECT pg_temp.expect_true('A table no layer names still gets the oldest layer''s plain label',
  (SELECT audit_record_ref('no_such_table', gen_random_uuid(), '{}'::jsonb) ->> 'label') IS NOT NULL);
SELECT pg_temp.expect_true('Every audited table gets a label (no error, never empty)',
  NOT EXISTS (SELECT 1 FROM (SELECT DISTINCT ON (a.table_name) a.table_name, a.record_id, a.new_row FROM audit_log a ORDER BY a.table_name, a.id DESC) z
               WHERE COALESCE(audit_record_ref(z.table_name, z.record_id, z.new_row) ->> 'label', '') = ''));
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
