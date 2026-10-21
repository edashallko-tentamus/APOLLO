-- 054: audit labels without the deep chain (Claude Code, 2026-10-20; version 0.31.1).
-- audit_record_ref(table, id, row) gives every audit entry its label and link. Since 005 nearly every migration has
-- wrapped it: the new function handles its own tables and passes everything else to the previous one, renamed. By 053
-- there were 37 layers, and a common record (a sample's test, a sample, an order) went down most of them, one PL/pgSQL
-- call inside the next. On PGlite (WebAssembly, small stack) that crashed the database ("out of memory", "null
-- function or function signature mismatch") from npm test's test_004 on, found when checking 0.29.0 to 0.31.0.
-- Nothing is rewritten: every layer keeps its code. This adds a router in front:
--  - audit_ref_route: for each table, the newest layer whose code names it (built from the layers' source by
--    audit_ref_rebuild(), which follows the chain from the top down);
--  - the new audit_record_ref calls that layer directly; a table no layer names goes straight to the oldest layer
--    (every layer passes such a table down unchanged);
--  - 045's layer also added 'link' to an older layer's result that had only 'href': applied here to every result.
-- A layer naming a table is never skipped (layers match tables by name only: checked, no LIKE or pattern), and a
-- false match only means starting a little higher in the chain; so the labels are the same as before.
-- Later migrations may keep wrapping audit_record_ref as before: their layer sits on top of this router.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);

ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_054;

CREATE TABLE audit_ref_route (
    table_name  text PRIMARY KEY,
    fn          text NOT NULL,      -- the layer to call
    depth       integer NOT NULL    -- its place in the chain (0 = the newest)
);
CREATE TABLE audit_ref_chain (
    depth       integer PRIMARY KEY,
    fn          text NOT NULL
);

-- follows the chain from audit_record_ref_054 down (each layer calls exactly one older one), and routes each table to
-- the newest layer that names it in quotes
CREATE FUNCTION audit_ref_rebuild() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE f text := 'audit_record_ref_054'; src text; nxt text; d integer := 0; t text;
BEGIN
    DELETE FROM audit_ref_route; DELETE FROM audit_ref_chain;
    LOOP
        SELECT p.prosrc INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'lims' AND p.proname = f AND pg_get_function_identity_arguments(p.oid) = 'p_table text, p_id uuid, r jsonb';
        IF src IS NULL THEN RAISE EXCEPTION 'audit_ref_rebuild: layer % not found', f; END IF;
        INSERT INTO audit_ref_chain VALUES (d, f);
        FOR t IN SELECT DISTINCT m[1] FROM regexp_matches(src, '''([a-z][a-z0-9_]*)''', 'g') m
                  WHERE EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'lims' AND c.relname = m[1] AND c.relkind IN ('r', 'v', 'p')) LOOP
            INSERT INTO audit_ref_route VALUES (t, f, d) ON CONFLICT (table_name) DO NOTHING;
        END LOOP;
        nxt := (regexp_match(src, '(audit_record_ref_[a-z0-9]+)\s*\('))[1];
        EXIT WHEN nxt IS NULL;
        IF d > 200 THEN RAISE EXCEPTION 'audit_ref_rebuild: the chain does not end'; END IF;
        f := nxt; d := d + 1;
    END LOOP;
    RETURN d + 1;
END $$;
SELECT audit_ref_rebuild();

CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE f text; x jsonb;
BEGIN
    SELECT fn INTO f FROM audit_ref_route WHERE table_name = p_table;
    IF f IS NULL THEN SELECT fn INTO f FROM audit_ref_chain ORDER BY depth DESC LIMIT 1; END IF;
    EXECUTE format('SELECT %I($1, $2, $3)', f) INTO x USING p_table, p_id, r;
    IF x ? 'href' AND NOT x ? 'link' THEN x := x || jsonb_build_object('link', x->>'href'); END IF;
    RETURN x;
END $$;

COMMIT;
