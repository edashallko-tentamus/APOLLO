-- 0.33.0 (migration 056): database accounts (security slice).
-- Until now the app connected as the account that owns every table (in the Sandbox, the superuser). Whoever holds
-- that account can switch the audit triggers off. From here a GxP server uses two accounts:
--   * the owner (runs the migrations; owns the tables, triggers and functions; used by nobody day to day)
--   * the app account (what the running app connects as): it may read, add and change rows, and nothing else.
--     It cannot change or switch off a table, a trigger or a function, cannot delete or truncate,
--     and cannot write the audit trail itself: only the audit triggers can (below).
-- The roles are created once by a database administrator (db/roles_setup.sql); the app gives the app account its
-- rights after every migration run (grant_app_role, called by server/db.js when LIMS_MIGRATE_URL is set).
-- What this does NOT protect against: the internal switches (lims.*_internal settings) can be set by anyone holding
-- the app account. They are trusted to the app account by design; the app account's password is kept by IT.
-- In the Sandbox (PGlite or one superuser account) nothing changes.
SET search_path = lims, public;

-- The audit trail is written only by these functions, which run with the owner's rights
ALTER FUNCTION gxp_audit() SECURITY DEFINER SET search_path = lims, public;
ALTER FUNCTION app_user_job_role_rules() SECURITY DEFINER SET search_path = lims, public;
ALTER FUNCTION app_user_signature_rules() SECURITY DEFINER SET search_path = lims, public;

-- Give the app account exactly its rights. Run by the owner after migrations (new tables included).
CREATE FUNCTION grant_app_role(p_role name) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
    SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls INTO r FROM pg_roles WHERE rolname = p_role;
    IF r.rolname IS NULL THEN RAISE EXCEPTION 'There is no database account named %', p_role; END IF;
    IF r.rolsuper OR r.rolbypassrls THEN RAISE EXCEPTION 'The app account % must not be a superuser', p_role; END IF;
    IF p_role = current_user THEN RAISE EXCEPTION 'The app account must not be the owner account that runs the migrations'; END IF;
    IF pg_has_role(p_role, (SELECT nspowner FROM pg_namespace WHERE nspname = 'lims'), 'USAGE') THEN
        RAISE EXCEPTION 'The app account % is (or is a member of) the owner of the lims schema', p_role;
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA lims, public TO %I', p_role);
    EXECUTE format('REVOKE CREATE ON SCHEMA lims, public FROM %I', p_role);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA lims FROM %I', p_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA lims TO %I', p_role);
    -- the audit trail: read only (written by the SECURITY DEFINER triggers above)
    EXECUTE format('REVOKE INSERT, UPDATE ON audit_log FROM %I', p_role);
    -- the migration list: read only
    EXECUTE format('REVOKE ALL ON public.schema_migrations FROM %I', p_role);
    EXECUTE format('GRANT SELECT ON public.schema_migrations TO %I', p_role);
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA lims TO %I', p_role);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA lims TO %I', p_role);
    EXECUTE format('GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA lims TO %I', p_role);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION grant_app_role(name) FROM %I', p_role);
    RETURN 'Rights given to ' || p_role;
END $$;
REVOKE EXECUTE ON FUNCTION grant_app_role(name) FROM PUBLIC;

-- What the running app should know about the account it uses (shown at start; a GxP server should show none)
CREATE FUNCTION database_account_problems() RETURNS text[] LANGUAGE sql STABLE AS $$
    SELECT array_remove(ARRAY[
        CASE WHEN (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
             THEN 'The app is connected as a superuser (' || current_user || ')' END,
        CASE WHEN pg_has_role(current_user, (SELECT nspowner FROM pg_namespace WHERE nspname = 'lims'), 'USAGE')
             THEN 'The app is connected as the owner of the tables (' || current_user || '): it could switch the audit triggers off' END,
        CASE WHEN has_table_privilege(current_user, 'audit_log', 'INSERT')
             THEN 'The app account can write the audit trail directly' END
    ], NULL)
$$;

-- The lab an audit entry belongs to, from the row it recorded (NULL = shared, or no lab: clients, the catalogue,
-- quotes before 031, users...). Used by the audit trail pages so a lab's people see their own lab's entries (0.32.0).
CREATE FUNCTION audit_row_site(n jsonb) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN n ? 'site_id' THEN (n->>'site_id')::uuid
        WHEN n->>'lab_order_id' IS NOT NULL THEN (SELECT site_id FROM lab_order WHERE id = (n->>'lab_order_id')::uuid)
        WHEN n->>'sample_id' IS NOT NULL THEN (SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = (n->>'sample_id')::uuid)
        WHEN n->>'requested_test_id' IS NOT NULL THEN (SELECT o.site_id FROM requested_test rt JOIN sample s ON s.id = rt.sample_id
                                                        JOIN lab_order o ON o.id = s.lab_order_id WHERE rt.id = (n->>'requested_test_id')::uuid)
        WHEN n->>'invoice_id' IS NOT NULL THEN (SELECT site_id FROM invoice WHERE id = (n->>'invoice_id')::uuid)
        WHEN n->>'logbook_id' IS NOT NULL THEN (SELECT site_id FROM logbook WHERE id = (n->>'logbook_id')::uuid)
        WHEN n->>'batch_id' IS NOT NULL THEN (SELECT site_id FROM test_batch WHERE id = (n->>'batch_id')::uuid)
        WHEN n->>'oos_id' IS NOT NULL THEN (SELECT site_id FROM oos_investigation WHERE id = (n->>'oos_id')::uuid)
        WHEN n->>'claim_id' IS NOT NULL THEN (SELECT site_id FROM finalization_claim WHERE id = (n->>'claim_id')::uuid)
        WHEN n->>'coa_id' IS NOT NULL THEN (SELECT site_id FROM coa WHERE id = (n->>'coa_id')::uuid)
        WHEN n->>'study_id' IS NOT NULL THEN (SELECT site_id FROM stability_study WHERE id = (n->>'study_id')::uuid)
        WHEN n->>'chamber_id' IS NOT NULL THEN (SELECT site_id FROM stability_chamber WHERE id = (n->>'chamber_id')::uuid)
        WHEN n->>'group_id' IS NOT NULL THEN (SELECT site_id FROM lab_group WHERE id = (n->>'group_id')::uuid)
        WHEN n->>'chart_id' IS NOT NULL THEN (SELECT site_id FROM trend_chart WHERE id = (n->>'chart_id')::uuid)
        WHEN n->>'test_id' IS NOT NULL THEN (SELECT site_id FROM test WHERE id = (n->>'test_id')::uuid)
        WHEN n->>'test_version_id' IS NOT NULL THEN (SELECT t.site_id FROM test_version v JOIN test t ON t.id = v.test_id WHERE v.id = (n->>'test_version_id')::uuid)
        WHEN n->>'step_id' IS NOT NULL THEN (SELECT t.site_id FROM workflow_step w JOIN test_version v ON v.id = w.test_version_id
                                              JOIN test t ON t.id = v.test_id WHERE w.id = (n->>'step_id')::uuid)
        WHEN n->>'version_id' IS NOT NULL THEN (SELECT l.site_id FROM logbook_version lv JOIN logbook l ON l.id = lv.logbook_id WHERE lv.id = (n->>'version_id')::uuid)
        WHEN n->>'project_version_id' IS NOT NULL THEN (SELECT p.site_id FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = (n->>'project_version_id')::uuid)
    END
$$;
