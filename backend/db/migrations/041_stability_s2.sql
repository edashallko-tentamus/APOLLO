-- S-2 Stability studies, part 2 (Alex, 2026-10-17). Vault: Decision - Stability Studies S-2. Alex's answers:
--  1. Amendments: an amended quote. A new version of the stability quote, sent and accepted like the first; on
--     acceptance the study switches to it. Pulls already done stay as they were; only future pulls change.
--  2. Cancellation: chosen per condition. Cancel is signed with a reason; future pulls are cancelled (open pull orders
--     too); for each condition's stored material the lab records Destroyed, Returned to the client or Kept as retain,
--     which frees the rack.
--  3. Excursions: QA, per study. Each study whose material was in a chamber that went out of range gets an assessment:
--     No impact / Impact (results flagged) / Client to decide, signed with a justification. The issued report lists
--     each excursion and its assessment.
--  4. The issued cumulative report: after each pull. Once a pull's results are finalized the lab can issue an interim
--     cumulative report (version 1, 2, 3...), signed like a COA and emailed to the client; the one issued when every
--     pull is done and finalized is marked Final.
-- Billing per pull was already done by I-1 (each pull's tests are invoiced once their COA is issued, priced for the
-- study year), and excursions were already listed by L-1 (stability_excursion_view).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.stability_internal', '1', true);
SELECT set_config('lims.reason', 'Migration 041: stability amendments, cancellation, excursion assessments, issued reports', true);

-------------------------------------------------------------------------------
-- 0. PERMISSIONS
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('stability.cancel', 'Stability', 'Studies', 'Cancel a stability study and record what happens to its material', false, 100),
 ('stability.assess', 'Stability', 'Excursions', 'Assess the impact of a chamber excursion on a stability study', false, 101);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('Lab Supervisor', '{stability.cancel}'), ('General Manager', '{stability.cancel}'), ('QA', '{stability.assess}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

-- canned reasons for the stability pages (the reasons themselves: seed_033)
ALTER TABLE reason_code DROP CONSTRAINT reason_code_module_check;
ALTER TABLE reason_code ADD CONSTRAINT reason_code_module_check
    CHECK (module IN ('General','Clients','Orders','Quotes','Catalog','Inventory','Equipment','Purchasing','Methods','Testing','Reports','COA comments','Logbooks','Invoicing','Stability','Admin'));

-------------------------------------------------------------------------------
-- 1. NEW COLUMNS
-------------------------------------------------------------------------------
-- an amendment's timepoint remembers the one it was copied from (so pulls follow it to the new version)
ALTER TABLE stability_timepoint ADD COLUMN carried_from_id uuid REFERENCES stability_timepoint(id);
ALTER TABLE stability_study ADD COLUMN amendment_no integer NOT NULL DEFAULT 0;
ALTER TABLE stability_study ADD COLUMN cancelled_at timestamptz;
ALTER TABLE stability_study ADD COLUMN cancelled_by uuid REFERENCES app_user(id);
ALTER TABLE stability_study ADD COLUMN cancel_reason text;
-- the date a condition's material went in (a condition added by an amendment is placed later; its pulls count from then)
ALTER TABLE stability_storage ADD COLUMN placed_on date;
UPDATE stability_storage s SET placed_on = st.placement_date FROM stability_study st WHERE st.id = s.study_id AND s.placed_on IS NULL;
-- what happened to material that was not pulled: Destroyed, Returned (to the client) or Retained (kept as a retain)
ALTER TABLE stability_storage DROP CONSTRAINT stability_storage_status_check;
ALTER TABLE stability_storage ADD CONSTRAINT stability_storage_status_check CHECK (status IN ('Stored','Used up','Returned','Destroyed','Retained'));
ALTER TABLE stability_storage ADD COLUMN disposed_at timestamptz;
ALTER TABLE stability_storage ADD COLUMN disposed_by uuid REFERENCES app_user(id);
ALTER TABLE stability_storage ADD COLUMN disposition_note text;

-------------------------------------------------------------------------------
-- 2. AMENDMENTS: a new version of the stability quote while the study runs
-------------------------------------------------------------------------------
CREATE TABLE stability_amendment (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id            uuid NOT NULL REFERENCES stability_study(id),
    amendment_no        integer NOT NULL,
    from_version_id     uuid NOT NULL REFERENCES project_version(id),
    to_version_id       uuid NOT NULL REFERENCES project_version(id),
    pulls_added         integer NOT NULL DEFAULT 0,
    pulls_cancelled     integer NOT NULL DEFAULT 0,
    pulls_changed       integer NOT NULL DEFAULT 0,
    applied_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
    applied_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX stability_amendment_uq ON stability_amendment (study_id, amendment_no);
CALL make_gxp('stability_amendment');
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON stability_amendment FOR EACH ROW EXECUTE FUNCTION stability_record_rules();

-- The study a quote version belongs to (an amendment Draft is a version of a project that already has a study)
CREATE FUNCTION stability_study_of_version(p_version uuid) RETURNS stability_study LANGUAGE sql STABLE AS $$
    SELECT s.* FROM stability_study s JOIN project_version pv ON pv.project_id = s.project_id WHERE pv.id = p_version
$$;
-- Has a pull of the study at this (accepted) timepoint been ordered or taken? (condition NULL: at any condition)
CREATE FUNCTION stability_timepoint_used(p_study uuid, p_timepoint uuid, p_condition uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM stability_pull p WHERE p.study_id = p_study AND p.timepoint_id = p_timepoint
                     AND (p_condition IS NULL OR p.condition_id = p_condition) AND p.status IN ('Ordered','Pulled'))
$$;

-- The design rules (032), plus what an amendment cannot change: T0 (ordered when the study started), the interval of
-- a timepoint already ordered or pulled, and the tests at a timepoint already ordered or pulled for that condition.
CREATE OR REPLACE FUNCTION stability_design_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_version uuid := (to_jsonb(NEW)->>'project_version_id')::uuid; v_kind text; v_site uuid; tp stability_timepoint; l quoted_test_configuration; v_test_site uuid;
        st stability_study;
BEGIN
    IF stability_internal() THEN RETURN NEW; END IF;
    SELECT p.kind INTO v_kind FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = v_version;
    IF v_kind IS DISTINCT FROM 'Stability' THEN RAISE EXCEPTION 'Only a stability quote has a study design'; END IF;
    IF TG_OP = 'UPDATE' AND v_version <> (to_jsonb(OLD)->>'project_version_id')::uuid THEN RAISE EXCEPTION 'A study design stays with its quote version'; END IF;
    IF NOT version_is_editable(v_version) THEN RAISE EXCEPTION 'The study design is locked once the quote is issued: start a new version to change it'; END IF;
    IF NOT has_permission('quotes.edit') THEN RAISE EXCEPTION 'You do not have permission to change quotes (quotes.edit). Ask your lab administrator.'; END IF;
    SELECT site_id INTO v_site FROM stability_plan WHERE project_version_id = v_version;
    st := stability_study_of_version(v_version);
    IF TG_TABLE_NAME = 'stability_plan' THEN
        SELECT p.site_id INTO v_site FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = v_version;
        IF v_site IS NULL THEN
            UPDATE project SET site_id = NEW.site_id WHERE id = (SELECT project_id FROM project_version WHERE id = v_version);
        ELSIF NEW.site_id IS DISTINCT FROM v_site THEN
            RAISE EXCEPTION 'The study is stored and tested by the lab the quote was made in';
        END IF;
    ELSIF TG_TABLE_NAME = 'stability_version_condition' THEN
        IF NOT EXISTS (SELECT 1 FROM stability_condition c WHERE c.id = NEW.condition_id AND (c.status = 'Active' OR TG_OP = 'UPDATE') AND (c.site_id IS NULL OR c.site_id = v_site)) THEN
            RAISE EXCEPTION 'Choose an active condition of the study''s lab';
        END IF;
    ELSIF TG_TABLE_NAME = 'stability_timepoint' THEN
        IF st.id IS NOT NULL AND TG_OP = 'UPDATE' AND NEW.carried_from_id IS NOT NULL
           AND (NEW.interval_value, NEW.interval_unit) IS DISTINCT FROM (OLD.interval_value, OLD.interval_unit) THEN
            IF OLD.interval_value = 0 THEN RAISE EXCEPTION 'T0 was ordered when the study started: it stays the baseline'; END IF;
            IF stability_timepoint_used(st.id, NEW.carried_from_id, NULL) THEN
                RAISE EXCEPTION '% was already ordered or pulled: its interval stays (add a new timepoint instead)', OLD.label;
            END IF;
        END IF;
        IF st.id IS NOT NULL AND NEW.interval_value = 0 AND NEW.status = 'Active' AND (TG_OP = 'INSERT' OR OLD.interval_value <> 0) THEN
            RAISE EXCEPTION 'T0 was ordered when the study started: an amendment cannot add a baseline';
        END IF;
    ELSIF TG_TABLE_NAME = 'stability_cell' THEN
        IF NEW.status = 'Active' THEN
            SELECT * INTO tp FROM stability_timepoint WHERE id = NEW.timepoint_id;
            SELECT * INTO l FROM quoted_test_configuration WHERE id = NEW.line_id;
            IF tp.project_version_id <> NEW.project_version_id OR l.project_version_id <> NEW.project_version_id OR tp.status <> 'Active' OR l.status <> 'Active' THEN
                RAISE EXCEPTION 'The test and the timepoint must belong to this version of the quote';
            END IF;
            IF tp.interval_value = 0 AND NEW.condition_id IS NOT NULL THEN RAISE EXCEPTION 'T0 is the baseline, tested at placement: it has no storage condition'; END IF;
            IF tp.interval_value > 0 AND (NEW.condition_id IS NULL OR NOT EXISTS (SELECT 1 FROM stability_version_condition vc
                    WHERE vc.project_version_id = NEW.project_version_id AND vc.condition_id = NEW.condition_id AND vc.status = 'Active')) THEN
                RAISE EXCEPTION 'Each pull is for one of the study''s conditions';
            END IF;
            SELECT site_id INTO v_test_site FROM test WHERE id = l.test_id;
            IF v_test_site IS NOT NULL AND v_test_site IS DISTINCT FROM v_site THEN
                RAISE EXCEPTION '% belongs to % and can only be tested there', (SELECT test_name FROM test WHERE id = l.test_id), (SELECT site_code FROM lab_site WHERE id = v_test_site);
            END IF;
            -- an amendment: only new work changes
            IF st.id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.status <> 'Active') THEN
                IF tp.interval_value = 0 THEN RAISE EXCEPTION 'T0 was ordered when the study started: its tests cannot change'; END IF;
                IF tp.carried_from_id IS NOT NULL AND stability_timepoint_used(st.id, tp.carried_from_id, NEW.condition_id) THEN
                    RAISE EXCEPTION '% at % was already ordered or pulled: its tests cannot change (add a new timepoint instead)',
                        tp.label, (SELECT condition_name FROM stability_condition WHERE id = NEW.condition_id);
                END IF;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END $$;

-- A new version of a stability quote. Before the study: a changed quote (032). Once the study runs: an amendment,
-- copied from the version the study runs to (not a Draft or rejected one), each timepoint remembering its original.
CREATE OR REPLACE FUNCTION new_stability_version(p_project uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_prev uuid; v_new uuid; r record; v_tp uuid; st stability_study; si text := COALESCE(current_setting('lims.stability_internal', true), '');
BEGIN
    IF (SELECT kind FROM project WHERE id = p_project) IS DISTINCT FROM 'Stability' THEN RAISE EXCEPTION 'Not a stability quote'; END IF;
    IF NOT has_permission('quotes.edit') AND NOT stability_internal() THEN RAISE EXCEPTION 'You do not have permission to change quotes (quotes.edit). Ask your lab administrator.'; END IF;
    IF EXISTS (SELECT 1 FROM project_version WHERE project_id = p_project AND status IN ('Draft','Submitted for Quote')) THEN
        RAISE EXCEPTION 'There is already a Draft of this quote: change that one';
    END IF;
    SELECT * INTO st FROM stability_study WHERE project_id = p_project;
    IF st.status = 'Cancelled' THEN RAISE EXCEPTION 'Study % was cancelled: it cannot be amended', st.study_code; END IF;
    IF st.status = 'Completed' AND NOT EXISTS (SELECT 1 FROM stability_storage s WHERE s.study_id = st.id AND s.status = 'Stored') THEN
        RAISE EXCEPTION 'Study % is completed and no material is left in the chambers: it cannot be extended', st.study_code;
    END IF;
    IF st.id IS NOT NULL AND EXISTS (SELECT 1 FROM project_version WHERE project_id = p_project AND status = 'Quoted' AND version_no > (SELECT version_no FROM project_version WHERE id = st.project_version_id)) THEN
        RAISE EXCEPTION 'An amendment is already with the client: accept or reject it first';
    END IF;
    v_prev := COALESCE(st.project_version_id, (SELECT id FROM project_version WHERE project_id = p_project ORDER BY version_no DESC LIMIT 1));
    v_new := new_project_version(p_project);
    -- new_project_version copies the latest version's lines at refreshed list prices: an amendment starts from the
    -- version the study runs to, at the prices the client accepted
    IF st.id IS NOT NULL THEN
        UPDATE quoted_test_configuration SET status = 'Removed' WHERE project_version_id = v_new AND status = 'Active';
        INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, special_instructions)
        SELECT v_new, l.test_id, l.quantity, l.special_instructions FROM quoted_test_configuration l WHERE l.project_version_id = v_prev AND l.status = 'Active';
        UPDATE quoted_test_configuration n SET final_price = o.final_price FROM quoted_test_configuration o
         WHERE n.project_version_id = v_new AND n.status = 'Active' AND o.project_version_id = v_prev AND o.status = 'Active' AND o.test_id = n.test_id;
        INSERT INTO specification (quoted_line_id, analyte_id, min_value, max_value, text_value, unit, source, basis, copied_from_spec_id)
        SELECT n.id, s.analyte_id, s.min_value, s.max_value, s.text_value, s.unit, s.source, s.basis, s.id
          FROM quoted_test_configuration n JOIN quoted_test_configuration o ON o.project_version_id = v_prev AND o.status = 'Active' AND o.test_id = n.test_id
          JOIN specification s ON s.quoted_line_id = o.id AND s.status = 'Active'
         WHERE n.project_version_id = v_new AND n.status = 'Active';
    END IF;
    PERFORM set_config('lims.stability_internal', '1', true);
    INSERT INTO stability_plan (project_version_id, site_id, product, lot, protocol_ref, unit_name, planned_placement, escalation_pct, reserve_pct, notes)
    SELECT v_new, site_id, product, lot, protocol_ref, unit_name, planned_placement, escalation_pct, reserve_pct, notes FROM stability_plan WHERE project_version_id = v_prev;
    INSERT INTO stability_version_condition (project_version_id, condition_id, sort_order)
    SELECT v_new, condition_id, sort_order FROM stability_version_condition WHERE project_version_id = v_prev AND status = 'Active';
    FOR r IN SELECT * FROM stability_timepoint WHERE project_version_id = v_prev AND status = 'Active' LOOP
        INSERT INTO stability_timepoint (project_version_id, label, interval_value, interval_unit, days_early, days_late, carried_from_id)
        VALUES (v_new, r.label, r.interval_value, r.interval_unit, r.days_early, r.days_late, CASE WHEN st.id IS NOT NULL THEN r.id END) RETURNING id INTO v_tp;
        INSERT INTO stability_cell (project_version_id, line_id, timepoint_id, condition_id, units_required)
        SELECT v_new, nl.id, v_tp, c.condition_id, c.units_required
          FROM stability_cell c JOIN quoted_test_configuration ol ON ol.id = c.line_id
          JOIN quoted_test_configuration nl ON nl.project_version_id = v_new AND nl.test_id = ol.test_id AND nl.status = 'Active'
         WHERE c.timepoint_id = r.id AND c.status = 'Active'
           AND (c.condition_id IS NULL OR EXISTS (SELECT 1 FROM stability_version_condition vc WHERE vc.project_version_id = v_new AND vc.condition_id = c.condition_id AND vc.status = 'Active'));
    END LOOP;
    PERFORM set_config('lims.stability_internal', si, true);
    RETURN v_new;
END $$;

-- What stops a stability quote being issued, plus (for an amendment) what the lab should know before it goes out
CREATE OR REPLACE FUNCTION stability_quote_problems(p_version uuid) RETURNS TABLE (severity text, problem text) LANGUAGE plpgsql STABLE AS $$
DECLARE pl stability_plan; p project; r record; st stability_study; v_today date; v_need integer; v_left integer;
BEGIN
    SELECT * INTO pl FROM stability_plan WHERE project_version_id = p_version;
    SELECT pr.* INTO p FROM project pr JOIN project_version pv ON pv.project_id = pr.id WHERE pv.id = p_version;
    IF pl.id IS NULL THEN severity := 'Error'; problem := 'Choose the lab that stores and tests the study'; RETURN NEXT; RETURN; END IF;
    IF NOT EXISTS (SELECT 1 FROM stability_version_condition WHERE project_version_id = p_version AND status = 'Active') THEN
        severity := 'Error'; problem := 'Choose at least one storage condition'; RETURN NEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM stability_timepoint WHERE project_version_id = p_version AND status = 'Active' AND interval_value = 0) THEN
        severity := 'Error'; problem := 'Add the T0 baseline timepoint (interval 0)'; RETURN NEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM stability_timepoint WHERE project_version_id = p_version AND status = 'Active' AND interval_value > 0) THEN
        severity := 'Error'; problem := 'Add at least one pull timepoint after T0'; RETURN NEXT; END IF;
    FOR r IN SELECT t.test_name FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id
              WHERE q.project_version_id = p_version AND q.status = 'Active'
                AND NOT EXISTS (SELECT 1 FROM stability_cell c WHERE c.line_id = q.id AND c.status = 'Active') LOOP
        severity := 'Error'; problem := r.test_name || ' is not at any timepoint: tick it in the matrix or remove it'; RETURN NEXT;
    END LOOP;
    FOR r IN SELECT sc.condition_name FROM stability_version_condition vc JOIN stability_condition sc ON sc.id = vc.condition_id
              WHERE vc.project_version_id = p_version AND vc.status = 'Active'
                AND NOT EXISTS (SELECT 1 FROM stability_cell c WHERE c.project_version_id = p_version AND c.condition_id = vc.condition_id AND c.status = 'Active') LOOP
        severity := 'Error'; problem := r.condition_name || ' has no pulls: tick its tests in the matrix or remove the condition'; RETURN NEXT;
    END LOOP;
    FOR r IN SELECT t.test_name FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id
              WHERE q.project_version_id = p_version AND q.status = 'Active'
                AND NOT EXISTS (SELECT 1 FROM test_version v WHERE v.test_id = q.test_id AND v.status = 'Effective') LOOP
        severity := 'Error'; problem := r.test_name || ' has no approved workflow yet, so the study could not order it'; RETURN NEXT;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id WHERE cc.client_id = p.client_id AND cc.status = 'Active'
                    AND ct.status = 'Active' AND 'ORDERING' = ANY(cc.roles)) THEN
        severity := 'Error'; problem := 'The client has no contact with the Ordering role: the study''s orders need one'; RETURN NEXT;
    END IF;
    FOR r IN SELECT sc.condition_name FROM stability_version_condition vc JOIN stability_condition sc ON sc.id = vc.condition_id
              WHERE vc.project_version_id = p_version AND vc.status = 'Active'
                AND NOT EXISTS (SELECT 1 FROM stability_chamber ch JOIN stability_rack rk ON rk.chamber_id = ch.id AND rk.status = 'Active'
                                 WHERE ch.condition_id = vc.condition_id AND ch.site_id = pl.site_id AND ch.status = 'Active') LOOP
        severity := 'Warning'; problem := r.condition_name || ': the lab has no chamber with a rack at this condition yet'; RETURN NEXT;
    END LOOP;
    st := stability_study_of_version(p_version);
    IF st.id IS NULL THEN
        IF pl.planned_placement IS NULL THEN severity := 'Warning'; problem := 'No planned placement date: the quotation shows intervals, not dates'; RETURN NEXT; END IF;
        RETURN;
    END IF;
    -- an amendment of a running study
    IF st.status = 'Cancelled' THEN severity := 'Error'; problem := 'Study ' || st.study_code || ' was cancelled: it cannot be amended'; RETURN NEXT; RETURN; END IF;
    IF p_version = st.project_version_id THEN RETURN; END IF;
    v_today := site_today(st.site_id);
    FOR r IN SELECT sc.condition_name FROM stability_version_condition vc JOIN stability_condition sc ON sc.id = vc.condition_id
              WHERE vc.project_version_id = p_version AND vc.status = 'Active' AND st.status <> 'Awaiting material'
                AND NOT EXISTS (SELECT 1 FROM stability_storage s WHERE s.study_id = st.id AND s.condition_id = vc.condition_id) LOOP
        severity := 'Warning'; problem := 'New condition ' || r.condition_name || ': its material is placed in a chamber once the amendment is accepted, and its pulls count from then'; RETURN NEXT;
    END LOOP;
    FOR r IN SELECT sc.condition_name, s.id AS storage_id FROM stability_storage s JOIN stability_condition sc ON sc.id = s.condition_id
              WHERE s.study_id = st.id AND s.status = 'Stored'
                AND NOT EXISTS (SELECT 1 FROM stability_version_condition vc WHERE vc.project_version_id = p_version AND vc.condition_id = s.condition_id AND vc.status = 'Active') LOOP
        severity := 'Warning'; problem := r.condition_name || ' is dropped: its pulls still to come are cancelled; record what happens to its material on the study'; RETURN NEXT;
    END LOOP;
    -- material: what is left against what the remaining pulls need (with the reserve)
    FOR r IN SELECT s.id, sc.condition_name, s.units_received - COALESCE((SELECT sum(units_pulled) FROM stability_pull x WHERE x.storage_id = s.id AND x.status = 'Pulled'), 0) AS left_units,
                    COALESCE((SELECT sum(c.units_required) FROM stability_cell c JOIN stability_timepoint t ON t.id = c.timepoint_id
                               WHERE c.project_version_id = p_version AND c.status = 'Active' AND c.condition_id = s.condition_id AND t.interval_value > 0
                                 AND NOT (t.carried_from_id IS NOT NULL AND stability_timepoint_used(st.id, t.carried_from_id, s.condition_id))), 0) AS need
               FROM stability_storage s JOIN stability_condition sc ON sc.id = s.condition_id WHERE s.study_id = st.id AND s.status IN ('Stored','Used up') LOOP
        v_need := ceil(r.need * (1 + COALESCE(pl.reserve_pct, st.reserve_pct) / 100))::integer;
        IF r.need > 0 AND r.left_units < v_need THEN
            severity := 'Warning'; problem := r.condition_name || ': ' || r.left_units || ' left in storage, the remaining pulls need ' || v_need || ' with the reserve'
                || CASE WHEN r.left_units = 0 THEN ' (no material left: pulls there are not scheduled)' ELSE '' END; RETURN NEXT;
        END IF;
    END LOOP;
    -- new timepoints whose date has already passed
    IF st.placement_date IS NOT NULL THEN
        FOR r IN SELECT t.label, stability_interval_date(st.placement_date, t.interval_value, t.interval_unit) AS d FROM stability_timepoint t
                  WHERE t.project_version_id = p_version AND t.status = 'Active' AND t.interval_value > 0 AND t.carried_from_id IS NULL
                    AND stability_interval_date(st.placement_date, t.interval_value, t.interval_unit) < v_today LOOP
            severity := 'Warning'; problem := r.label || ' falls on ' || to_char(r.d, 'Mon DD, YYYY') || ', already past: it is ordered as soon as the amendment is accepted'; RETURN NEXT;
        END LOOP;
    END IF;
END $$;

-- The study's status after an amendment, a placement or a pull: Completed when nothing is left to pull and every
-- condition of its version is placed; Active otherwise (an amendment can reopen a completed study)
CREATE FUNCTION stability_refresh_status(p_study uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE st stability_study; v text;
BEGIN
    SELECT * INTO st FROM stability_study WHERE id = p_study;
    IF st.status NOT IN ('Active','Completed') THEN RETURN st.status; END IF;
    v := CASE WHEN EXISTS (SELECT 1 FROM stability_pull WHERE study_id = st.id AND status IN ('Scheduled','Ordered'))
                OR EXISTS (SELECT 1 FROM stability_version_condition vc WHERE vc.project_version_id = st.project_version_id AND vc.status = 'Active'
                            AND NOT EXISTS (SELECT 1 FROM stability_storage s WHERE s.study_id = st.id AND s.condition_id = vc.condition_id))
              THEN 'Active' ELSE 'Completed' END;
    IF v <> st.status THEN UPDATE stability_study SET status = v WHERE id = st.id; END IF;
    RETURN v;
END $$;

-- Accepting an amendment: the study runs to the new version. Pulls already ordered or taken stay as they are (they
-- follow their timepoint to the new version); scheduled pulls the new design drops are cancelled, the ones it keeps
-- take its interval, window and material; new timepoints and conditions get their pulls (a new condition once it is placed).
CREATE FUNCTION apply_stability_amendment(p_study uuid, p_version uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE st stability_study; pl stability_plan; p stability_pull; ntp stability_timepoint; r record; v_units integer; v_base date; v_nom date;
        n_add integer := 0; n_cancel integer := 0; n_change integer := 0; v_reserve numeric;
        gs text := COALESCE(current_setting('lims.group_sync', true), ''); si text := COALESCE(current_setting('lims.stability_internal', true), '');
BEGIN
    SELECT * INTO st FROM stability_study WHERE id = p_study FOR UPDATE;
    IF st.project_version_id = p_version THEN RETURN 0; END IF;
    IF st.status = 'Cancelled' THEN RAISE EXCEPTION 'Study % was cancelled: an amendment cannot be accepted', st.study_code; END IF;
    SELECT * INTO pl FROM stability_plan WHERE project_version_id = p_version;
    v_reserve := COALESCE(pl.reserve_pct, (SELECT stability_reserve_pct FROM lab_site WHERE id = st.site_id));
    PERFORM set_config('lims.group_sync', '1', true); PERFORM set_config('lims.stability_internal', '1', true);
    -- 1. the pulls the study has
    FOR p IN SELECT * FROM stability_pull WHERE study_id = st.id AND status <> 'Cancelled' ORDER BY scheduled_date FOR UPDATE LOOP
        SELECT * INTO ntp FROM stability_timepoint WHERE project_version_id = p_version AND status = 'Active' AND carried_from_id = p.timepoint_id;
        IF p.status = 'Scheduled' THEN
            SELECT COALESCE(sum(c.units_required), 0) INTO v_units FROM stability_cell c WHERE c.timepoint_id = ntp.id AND c.condition_id = p.condition_id AND c.status = 'Active';
            IF ntp.id IS NULL OR v_units = 0 THEN
                UPDATE stability_pull SET status = 'Cancelled' WHERE id = p.id;
                n_cancel := n_cancel + 1;
            ELSE
                SELECT COALESCE(s.placed_on, st.placement_date) INTO v_base FROM stability_storage s WHERE s.id = p.storage_id;
                v_nom := stability_interval_date(v_base, ntp.interval_value, ntp.interval_unit);
                IF (p.nominal_date, p.units_required, p.window_start, p.window_end) IS DISTINCT FROM (v_nom, v_units, v_nom - ntp.days_early, v_nom + ntp.days_late) THEN
                    n_change := n_change + 1;
                END IF;
                UPDATE stability_pull SET timepoint_id = ntp.id, units_required = v_units, nominal_date = v_nom,
                       scheduled_date = stability_adjust_date(st.site_id, v_nom, ntp.days_early, ntp.days_late),
                       window_start = v_nom - ntp.days_early, window_end = v_nom + ntp.days_late WHERE id = p.id;
            END IF;
        ELSIF ntp.id IS NOT NULL THEN
            UPDATE stability_pull SET timepoint_id = ntp.id WHERE id = p.id;   -- ordered or taken: unchanged, but it follows its timepoint
        END IF;
    END LOOP;
    -- 2. new pulls: each placed condition still stored, at each timepoint of the new design with tests there
    FOR r IN SELECT s.id AS storage_id, s.condition_id, COALESCE(s.placed_on, st.placement_date) AS base, t.id AS tp_id, t.interval_value, t.interval_unit, t.days_early, t.days_late,
                    (SELECT sum(c.units_required) FROM stability_cell c WHERE c.timepoint_id = t.id AND c.condition_id = s.condition_id AND c.status = 'Active') AS units
               FROM stability_storage s
               JOIN stability_version_condition vc ON vc.project_version_id = p_version AND vc.condition_id = s.condition_id AND vc.status = 'Active'
               JOIN stability_timepoint t ON t.project_version_id = p_version AND t.status = 'Active' AND t.interval_value > 0
              WHERE s.study_id = st.id AND s.status = 'Stored'
                AND EXISTS (SELECT 1 FROM stability_cell c WHERE c.timepoint_id = t.id AND c.condition_id = s.condition_id AND c.status = 'Active')
                AND NOT EXISTS (SELECT 1 FROM stability_pull x WHERE x.study_id = st.id AND x.condition_id = s.condition_id AND x.timepoint_id = t.id) LOOP
        v_nom := stability_interval_date(r.base, r.interval_value, r.interval_unit);
        INSERT INTO stability_pull (study_id, storage_id, condition_id, timepoint_id, nominal_date, scheduled_date, window_start, window_end, units_required)
        VALUES (st.id, r.storage_id, r.condition_id, r.tp_id, v_nom, stability_adjust_date(st.site_id, v_nom, r.days_early, r.days_late),
                v_nom - r.days_early, v_nom + r.days_late, r.units);
        n_add := n_add + 1;
    END LOOP;
    -- 3. the material each stored condition needs under the new design
    UPDATE stability_storage s SET units_required = ceil(COALESCE((SELECT sum(c.units_required) FROM stability_cell c
             WHERE c.project_version_id = p_version AND c.condition_id = s.condition_id AND c.status = 'Active'), 0) * (1 + v_reserve / 100))::integer
     WHERE s.study_id = st.id AND s.status = 'Stored';
    -- 4. the study runs to the new version
    UPDATE stability_study SET project_version_id = p_version, product = COALESCE(pl.product, st.product), lot = COALESCE(pl.lot, st.lot),
           escalation_pct = COALESCE(pl.escalation_pct, st.escalation_pct), reserve_pct = v_reserve, amendment_no = st.amendment_no + 1 WHERE id = st.id;
    INSERT INTO stability_amendment (study_id, amendment_no, from_version_id, to_version_id, pulls_added, pulls_cancelled, pulls_changed)
    VALUES (st.id, st.amendment_no + 1, st.project_version_id, p_version, n_add, n_cancel, n_change);
    PERFORM stability_refresh_status(st.id);
    PERFORM set_config('lims.group_sync', gs, true); PERFORM set_config('lims.stability_internal', si, true);
    PERFORM create_due_stability_pulls(st.site_id);
    RETURN n_add + n_cancel + n_change;
END $$;

-- Accepting a stability quote: the first acceptance creates the study (032); a later one is an amendment
CREATE OR REPLACE FUNCTION project_version_stability_study() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_study uuid;
BEGIN
    IF NEW.status = 'Accepted' AND OLD.status <> 'Accepted' AND (SELECT kind FROM project WHERE id = NEW.project_id) = 'Stability' THEN
        SELECT id INTO v_study FROM stability_study WHERE project_id = NEW.project_id;
        IF v_study IS NULL THEN PERFORM create_stability_study(NEW.id);
        ELSE PERFORM apply_stability_amendment(v_study, NEW.id); END IF;
    END IF;
    RETURN NULL;
END $$;

-- Place the material (032). On a running study it places the conditions an amendment added (no T0; their pulls
-- count from this date).
CREATE OR REPLACE FUNCTION place_stability_study(p_study uuid, p_date date, p_rows jsonb, p_t0_units integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE st stability_study; r record; x jsonb; rk stability_rack; ch stability_chamber; v_storage uuid; v_req integer; v_n integer := 0; v_i integer;
        tp record; v_nom date; v_adding boolean; v_done integer := 0;
        gs text := COALESCE(current_setting('lims.group_sync', true), ''); si text := COALESCE(current_setting('lims.stability_internal', true), '');
BEGIN
    SELECT * INTO st FROM stability_study WHERE id = p_study FOR UPDATE;
    IF st.id IS NULL THEN RAISE EXCEPTION 'Study not found'; END IF;
    PERFORM require_permission_at('stability.manage', st.site_id);
    v_adding := st.status IN ('Active','Completed');
    IF NOT v_adding AND st.status <> 'Awaiting material' THEN RAISE EXCEPTION 'The study is %: nothing can be placed', st.status; END IF;
    IF p_date IS NULL OR p_date > site_today(st.site_id) THEN RAISE EXCEPTION 'The placement date is today or earlier'; END IF;
    IF v_adding THEN
        IF p_date < st.placement_date THEN RAISE EXCEPTION 'The placement date cannot be before the study was placed (%)', st.placement_date; END IF;
        IF NOT EXISTS (SELECT 1 FROM stability_version_condition vc WHERE vc.project_version_id = st.project_version_id AND vc.status = 'Active'
                        AND NOT EXISTS (SELECT 1 FROM stability_storage s WHERE s.study_id = st.id AND s.condition_id = vc.condition_id)) THEN
            RAISE EXCEPTION 'Every condition''s material is already placed';
        END IF;
    ELSE
        IF p_date < (st.accepted_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = st.site_id))::date THEN RAISE EXCEPTION 'The placement date cannot be before the quote was accepted (%)', (st.accepted_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = st.site_id))::date; END IF;
        IF COALESCE(p_t0_units, 0) <= 0 THEN RAISE EXCEPTION 'How many units go to the T0 baseline testing?'; END IF;
    END IF;
    v_i := (SELECT count(*) FROM stability_storage WHERE study_id = st.id);
    PERFORM set_config('lims.group_sync', '1', true); PERFORM set_config('lims.stability_internal', '1', true);
    FOR r IN SELECT vc.condition_id, sc.condition_name FROM stability_version_condition vc JOIN stability_condition sc ON sc.id = vc.condition_id
              WHERE vc.project_version_id = st.project_version_id AND vc.status = 'Active'
                AND NOT EXISTS (SELECT 1 FROM stability_storage s WHERE s.study_id = st.id AND s.condition_id = vc.condition_id)
              ORDER BY vc.sort_order, sc.sort_order, sc.condition_name LOOP
        v_i := v_i + 1;
        SELECT e INTO x FROM jsonb_array_elements(COALESCE(p_rows, '[]')) e WHERE (e->>'condition_id')::uuid = r.condition_id;
        IF x IS NULL OR COALESCE((x->>'units')::integer, 0) <= 0 THEN RAISE EXCEPTION '%: how many units are placed?', r.condition_name; END IF;
        SELECT * INTO rk FROM stability_rack WHERE id = (x->>'rack_id')::uuid;
        SELECT * INTO ch FROM stability_chamber WHERE id = rk.chamber_id;
        IF rk.id IS NULL OR rk.status <> 'Active' OR ch.status <> 'Active' THEN RAISE EXCEPTION '%: choose an active rack', r.condition_name; END IF;
        IF ch.site_id <> st.site_id THEN RAISE EXCEPTION '%: the rack is in another lab', r.condition_name; END IF;
        IF ch.condition_id <> r.condition_id THEN
            RAISE EXCEPTION '%: rack % is in a chamber set to %', r.condition_name, rk.rack_code, (SELECT condition_name FROM stability_condition WHERE id = ch.condition_id);
        END IF;
        IF EXISTS (SELECT 1 FROM equipment e WHERE e.id = ch.equipment_id AND e.admin_status <> 'In Service') THEN
            RAISE EXCEPTION '%: the chamber is not in service', r.condition_name;
        END IF;
        SELECT COALESCE(sum(c.units_required), 0) INTO v_req FROM stability_cell c WHERE c.project_version_id = st.project_version_id AND c.condition_id = r.condition_id AND c.status = 'Active';
        v_req := ceil(v_req * (1 + st.reserve_pct / 100))::integer;
        INSERT INTO stability_storage (storage_code, study_id, condition_id, rack_id, position, units_received, units_required, shortfall, placed_on)
        VALUES (st.study_code || '-' || v_i, st.id, r.condition_id, rk.id, NULLIF(btrim(x->>'position'), ''), (x->>'units')::integer, v_req, GREATEST(0, v_req - (x->>'units')::integer), p_date)
        RETURNING id INTO v_storage;
        v_done := v_done + 1;
        FOR tp IN SELECT t.*, (SELECT sum(c.units_required) FROM stability_cell c WHERE c.timepoint_id = t.id AND c.condition_id = r.condition_id AND c.status = 'Active') AS units
                    FROM stability_timepoint t WHERE t.project_version_id = st.project_version_id AND t.status = 'Active' AND t.interval_value > 0
                     AND EXISTS (SELECT 1 FROM stability_cell c WHERE c.timepoint_id = t.id AND c.condition_id = r.condition_id AND c.status = 'Active') LOOP
            v_nom := stability_interval_date(p_date, tp.interval_value, tp.interval_unit);
            INSERT INTO stability_pull (study_id, storage_id, condition_id, timepoint_id, nominal_date, scheduled_date, window_start, window_end, units_required)
            VALUES (st.id, v_storage, r.condition_id, tp.id, v_nom, stability_adjust_date(st.site_id, v_nom, tp.days_early, tp.days_late),
                    v_nom - tp.days_early, v_nom + tp.days_late, tp.units);
            v_n := v_n + 1;
        END LOOP;
    END LOOP;
    IF NOT v_adding THEN
        -- the T0 sample: received at placement; logged now unless intake already logged it
        UPDATE sample SET number_of_units = p_t0_units, received_at = COALESCE(received_at, (p_date::timestamp AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = st.site_id)))
         WHERE id = st.t0_sample_id;
        IF (SELECT status FROM sample WHERE id = st.t0_sample_id) = 'Expected' THEN PERFORM log_samples(ARRAY[st.t0_sample_id]); END IF;
        UPDATE stability_study SET status = 'Active', placement_date = p_date, placed_at = clock_timestamp(), placed_by = current_app_user() WHERE id = st.id;
    ELSE
        PERFORM stability_refresh_status(st.id);
    END IF;
    PERFORM set_config('lims.group_sync', gs, true); PERFORM set_config('lims.stability_internal', si, true);
    PERFORM create_due_stability_pulls(st.site_id);
    RETURN v_n;
END $$;

-- Recording a pull (032): the study completes only when every condition of its version is placed too
CREATE OR REPLACE FUNCTION record_stability_pull(p_pull uuid, p_at timestamptz, p_units integer, p_note text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE pl stability_pull; st stability_study; v_left integer; v_day date; v_in boolean;
        gs text := COALESCE(current_setting('lims.group_sync', true), ''); si text := COALESCE(current_setting('lims.stability_internal', true), '');
BEGIN
    SELECT * INTO pl FROM stability_pull WHERE id = p_pull FOR UPDATE;
    IF pl.id IS NULL THEN RAISE EXCEPTION 'Pull not found'; END IF;
    SELECT * INTO st FROM stability_study WHERE id = pl.study_id;
    PERFORM require_permission_at('stability.manage', st.site_id);
    IF st.status = 'Cancelled' THEN RAISE EXCEPTION 'Study % was cancelled', st.study_code; END IF;
    IF pl.status = 'Scheduled' THEN RAISE EXCEPTION 'This pull is not due until % (its order is made on that day)', pl.scheduled_date; END IF;
    IF pl.status <> 'Ordered' THEN RAISE EXCEPTION 'This pull is already %', lower(pl.status); END IF;
    IF COALESCE(p_units, 0) <= 0 THEN RAISE EXCEPTION 'How many units were taken out?'; END IF;
    p_at := COALESCE(p_at, clock_timestamp());
    IF p_at > clock_timestamp() + interval '5 minutes' THEN RAISE EXCEPTION 'The pull cannot be recorded in the future'; END IF;
    SELECT s.units_received - COALESCE((SELECT sum(units_pulled) FROM stability_pull x WHERE x.storage_id = s.id AND x.status = 'Pulled'), 0)
      INTO v_left FROM stability_storage s WHERE s.id = pl.storage_id;
    IF p_units > v_left THEN RAISE EXCEPTION 'Only % units of this condition are left in storage', v_left; END IF;
    v_day := (p_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = st.site_id))::date;
    v_in := v_day BETWEEN pl.window_start AND pl.window_end;
    IF NOT v_in AND COALESCE(btrim(p_note), '') = '' THEN
        RAISE EXCEPTION 'The pull is outside its window (% to %): say why in the note', pl.window_start, pl.window_end;
    END IF;
    PERFORM set_config('lims.group_sync', '1', true); PERFORM set_config('lims.stability_internal', '1', true);
    UPDATE stability_pull SET status = 'Pulled', pulled_at = p_at, pulled_by = current_app_user(), units_pulled = p_units, within_window = v_in,
           pull_note = NULLIF(btrim(p_note), '') WHERE id = pl.id;
    UPDATE sample SET number_of_units = p_units, received_at = p_at WHERE id = pl.sample_id;
    IF (SELECT status FROM sample WHERE id = pl.sample_id) = 'Expected' THEN PERFORM log_samples(ARRAY[pl.sample_id]); END IF;
    UPDATE stability_storage SET status = 'Used up' WHERE id = pl.storage_id AND p_units = v_left;
    PERFORM stability_refresh_status(st.id);
    PERFORM set_config('lims.group_sync', gs, true); PERFORM set_config('lims.stability_internal', si, true);
    RETURN v_left - p_units;
END $$;

-------------------------------------------------------------------------------
-- 3. CANCELLATION AND WHAT HAPPENS TO THE MATERIAL
-------------------------------------------------------------------------------
-- (internal) record the material's fate: Destroyed, Returned (to the client) or Retained (kept as a retain); frees the rack
CREATE FUNCTION stability_dispose_internal(p_storage uuid, p_disposition text, p_note text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s stability_storage;
BEGIN
    SELECT * INTO s FROM stability_storage WHERE id = p_storage FOR UPDATE;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Stored material not found'; END IF;
    IF s.status <> 'Stored' THEN RAISE EXCEPTION '% is already %', s.storage_code, lower(s.status); END IF;
    IF p_disposition IS NULL OR p_disposition NOT IN ('Destroyed','Returned','Retained') THEN
        RAISE EXCEPTION '%: choose Destroyed, Returned to the client or Kept as retain', s.storage_code;
    END IF;
    UPDATE stability_storage SET status = p_disposition, disposed_at = clock_timestamp(), disposed_by = current_app_user(),
           disposition_note = NULLIF(btrim(COALESCE(p_note, '')), '') WHERE id = s.id;
END $$;

-- Material no longer needed (the study completed, or an amendment dropped its condition): signed, with a reason
CREATE FUNCTION dispose_stability_material(p_storage uuid, p_disposition text, p_note text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s stability_storage; st stability_study; si text := COALESCE(current_setting('lims.stability_internal', true), '');
BEGIN
    SELECT * INTO s FROM stability_storage WHERE id = p_storage;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Stored material not found'; END IF;
    SELECT * INTO st FROM stability_study WHERE id = s.study_id;
    PERFORM require_permission_at('stability.manage', st.site_id);
    PERFORM assert_signed('record what happened to stability material');
    IF st.status IN ('Awaiting material','Active') AND EXISTS (SELECT 1 FROM stability_pull p WHERE p.storage_id = s.id AND p.status IN ('Scheduled','Ordered')) THEN
        RAISE EXCEPTION '% is still pulled from (% pull(s) to come): it stays in the chamber', s.storage_code,
            (SELECT count(*) FROM stability_pull p WHERE p.storage_id = s.id AND p.status IN ('Scheduled','Ordered'));
    END IF;
    PERFORM set_config('lims.stability_internal', '1', true);
    PERFORM stability_dispose_internal(p_storage, p_disposition, p_note);
    PERFORM set_config('lims.stability_internal', si, true);
END $$;

-- Cancel a study: signed (stability.cancel) with a reason. Scheduled pulls and open pull orders (not yet pulled) are
-- cancelled with their tests and samples, and the T0 order if not yet logged; pulls already taken stay in testing and
-- are reported and billed. Every condition's stored material gets its fate: p_dispositions [{storage_id, disposition, note}].
CREATE FUNCTION cancel_stability_study(p_study uuid, p_reason text, p_dispositions jsonb) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE st stability_study; s record; x jsonb; p stability_pull; n integer := 0;
        gs text := COALESCE(current_setting('lims.group_sync', true), ''); si text := COALESCE(current_setting('lims.stability_internal', true), '');
BEGIN
    SELECT * INTO st FROM stability_study WHERE id = p_study FOR UPDATE;
    IF st.id IS NULL THEN RAISE EXCEPTION 'Study not found'; END IF;
    PERFORM require_permission_at('stability.cancel', st.site_id);
    PERFORM assert_signed('cancel a stability study');
    IF st.status = 'Cancelled' THEN RAISE EXCEPTION 'Study % is already cancelled', st.study_code; END IF;
    IF st.status = 'Completed' THEN RAISE EXCEPTION 'Study % is completed: record what happens to any material left instead', st.study_code; END IF;
    IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Say why the study is cancelled'; END IF;
    FOR s IN SELECT id, storage_code FROM stability_storage WHERE study_id = st.id AND status = 'Stored' LOOP
        SELECT e INTO x FROM jsonb_array_elements(COALESCE(p_dispositions, '[]')) e WHERE (e->>'storage_id')::uuid = s.id;
        IF x IS NULL OR COALESCE(x->>'disposition', '') = '' THEN
            RAISE EXCEPTION '%: say what happens to the material (destroyed, returned to the client or kept as retain)', s.storage_code;
        END IF;
    END LOOP;
    PERFORM set_config('lims.group_sync', '1', true); PERFORM set_config('lims.stability_internal', '1', true);
    -- open pull orders not yet pulled: their tests and samples are cancelled
    FOR p IN SELECT * FROM stability_pull WHERE study_id = st.id AND status = 'Ordered' FOR UPDATE LOOP
        UPDATE requested_test SET status = 'Cancelled' WHERE stability_pull_id = p.id AND status <> 'Cancelled';
        UPDATE sample SET status = 'Cancelled' WHERE id = p.sample_id AND status = 'Expected';
        UPDATE stability_pull SET status = 'Cancelled' WHERE id = p.id;
        n := n + 1;
    END LOOP;
    WITH c AS (UPDATE stability_pull SET status = 'Cancelled' WHERE study_id = st.id AND status = 'Scheduled' RETURNING 1) SELECT n + count(*) INTO n FROM c;
    -- the T0 baseline, if the sample never arrived
    IF (SELECT status FROM sample WHERE id = st.t0_sample_id) = 'Expected' THEN
        UPDATE requested_test SET status = 'Cancelled' WHERE sample_id = st.t0_sample_id AND status <> 'Cancelled';
        UPDATE sample SET status = 'Cancelled' WHERE id = st.t0_sample_id;
    END IF;
    FOR s IN SELECT id FROM stability_storage WHERE study_id = st.id AND status = 'Stored' LOOP
        SELECT e INTO x FROM jsonb_array_elements(p_dispositions) e WHERE (e->>'storage_id')::uuid = s.id;
        PERFORM stability_dispose_internal(s.id, x->>'disposition', x->>'note');
    END LOOP;
    UPDATE stability_study SET status = 'Cancelled', cancelled_at = clock_timestamp(), cancelled_by = current_app_user(), cancel_reason = btrim(p_reason) WHERE id = st.id;
    PERFORM set_config('lims.group_sync', gs, true); PERFORM set_config('lims.stability_internal', si, true);
    RETURN n;
END $$;

-------------------------------------------------------------------------------
-- 4. EXCURSION ASSESSMENTS (QA, per study)
-------------------------------------------------------------------------------
CREATE TABLE stability_excursion_assessment (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id            uuid NOT NULL REFERENCES stability_study(id),
    logbook_entry_id    uuid NOT NULL REFERENCES logbook_entry(id),   -- the failing reading
    storage_id          uuid NOT NULL REFERENCES stability_storage(id),
    decision            text NOT NULL CHECK (decision IN ('No impact','Impact: results flagged','Client to decide')),
    justification       text NOT NULL CHECK (btrim(justification) <> ''),
    excursion_text      text,                                         -- the reading and reason, as assessed
    affected_pull_ids   uuid[] NOT NULL DEFAULT '{}',                 -- pulls of material that was in the chamber then
    status              record_status NOT NULL DEFAULT 'Active',      -- Inactive: replaced by a later assessment
    assessed_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
    assessed_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    signature_id        uuid REFERENCES signature_event(id),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX stability_excursion_assessment_uq ON stability_excursion_assessment (study_id, logbook_entry_id) WHERE status = 'Active';
CALL make_gxp('stability_excursion_assessment');
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON stability_excursion_assessment FOR EACH ROW EXECUTE FUNCTION stability_record_rules();

-- QA assesses an excursion for one study (signed, with a justification); a new assessment replaces the earlier one.
-- Affected: the pulls of the exposed material taken after the last good reading before the excursion, and those still to come.
CREATE FUNCTION assess_stability_excursion(p_study uuid, p_entry uuid, p_decision text, p_justification text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE st stability_study; x record; v uuid; si text := COALESCE(current_setting('lims.stability_internal', true), '');
BEGIN
    SELECT * INTO st FROM stability_study WHERE id = p_study;
    IF st.id IS NULL THEN RAISE EXCEPTION 'Study not found'; END IF;
    PERFORM require_permission_at('stability.assess', st.site_id);
    PERFORM assert_signed('assess a chamber excursion');
    SELECT * INTO x FROM stability_excursion_view WHERE study_id = p_study AND logbook_entry_id = p_entry LIMIT 1;
    IF x.study_id IS NULL THEN RAISE EXCEPTION 'That reading is not an excursion of study %', st.study_code; END IF;
    IF p_decision IS NULL OR p_decision NOT IN ('No impact','Impact: results flagged','Client to decide') THEN
        RAISE EXCEPTION 'Choose No impact, Impact (results flagged) or Client to decide';
    END IF;
    IF COALESCE(btrim(p_justification), '') = '' THEN RAISE EXCEPTION 'Justify the assessment'; END IF;
    PERFORM set_config('lims.stability_internal', '1', true);
    UPDATE stability_excursion_assessment SET status = 'Inactive' WHERE study_id = p_study AND logbook_entry_id = p_entry AND status = 'Active';
    INSERT INTO stability_excursion_assessment (study_id, logbook_entry_id, storage_id, decision, justification, excursion_text, affected_pull_ids, signature_id)
    VALUES (p_study, p_entry, x.storage_id, p_decision, btrim(p_justification),
            x.equipment_code || ' ' || x.equipment_name || ', ' || to_char(x.entry_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = st.site_id), 'Mon DD, YYYY HH24:MI') || ': '
              || array_to_string(x.problems, '; ') || COALESCE(' (' || x.failure_reason || ')', ''),
            COALESCE((SELECT array_agg(p.id ORDER BY p.scheduled_date) FROM stability_pull p WHERE p.storage_id = x.storage_id AND p.status <> 'Cancelled'
                       AND (p.pulled_at IS NULL OR p.pulled_at >= x.window_start)), '{}'),
            NULLIF(current_setting('lims.signature_id', true), '')::uuid)
    RETURNING id INTO v;
    PERFORM set_config('lims.stability_internal', si, true);
    RETURN v;
END $$;

-- Each excursion of a study with its current assessment
CREATE VIEW stability_excursion_status_view AS
SELECT x.*, a.id AS assessment_id, a.decision, a.justification, a.assessed_at, u.full_name AS assessed_by_name, a.affected_pull_ids,
       (SELECT string_agg(t.label || ' ' || sc.condition_name, ', ' ORDER BY p.scheduled_date) FROM stability_pull p JOIN stability_timepoint t ON t.id = p.timepoint_id
          JOIN stability_condition sc ON sc.id = p.condition_id WHERE p.id = ANY (a.affected_pull_ids)) AS affected_pulls
  FROM stability_excursion_view x
  LEFT JOIN stability_excursion_assessment a ON a.study_id = x.study_id AND a.logbook_entry_id = x.logbook_entry_id AND a.status = 'Active'
  LEFT JOIN app_user u ON u.id = a.assessed_by;

-------------------------------------------------------------------------------
-- 5. THE ISSUED CUMULATIVE REPORT (interim after a pull's results are finalized; Final at the end)
-------------------------------------------------------------------------------
-- The finalized results of the study (the ones an issued report shows)
CREATE FUNCTION stability_finalized_results(p_study uuid) RETURNS uuid[] LANGUAGE sql STABLE AS $$
    SELECT COALESCE(array_agg(x ORDER BY x), '{}') FROM (
      SELECT unnest(test_final_result_ids(rt.id)) AS x FROM requested_test rt
       WHERE rt.stability_study_id = p_study AND rt.status <> 'Cancelled' AND NOT test_is_replaced(rt.id) AND test_is_finalized(rt.id)) q
$$;
-- Final: the study is completed (or cancelled) and every test it still has is finalized
CREATE FUNCTION stability_report_is_final(p_study uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT s.status IN ('Completed','Cancelled')
       AND NOT EXISTS (SELECT 1 FROM requested_test rt JOIN sample sa ON sa.id = rt.sample_id
                        WHERE rt.stability_study_id = s.id AND rt.status <> 'Cancelled' AND sa.status <> 'Cancelled'
                          AND NOT test_is_replaced(rt.id) AND NOT test_is_finalized(rt.id))
      FROM stability_study s WHERE s.id = p_study
$$;
-- What the report would say: the finalized results, the assessments, the amendments and the study's state
CREATE FUNCTION stability_report_fingerprint(p_study uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT md5(concat_ws('|', array_to_string(stability_finalized_results(s.id), ','),
                         (SELECT string_agg(a.id::text, ',' ORDER BY a.id) FROM stability_excursion_assessment a WHERE a.study_id = s.id AND a.status = 'Active'),
                         s.amendment_no::text, s.status, stability_report_is_final(s.id)::text))
      FROM stability_study s WHERE s.id = p_study
$$;

CREATE TABLE stability_report (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_code         text NOT NULL UNIQUE,                         -- STB-00001-SR1
    study_id            uuid NOT NULL REFERENCES stability_study(id),
    version_no          integer NOT NULL,
    is_final            boolean NOT NULL DEFAULT false,
    content             jsonb NOT NULL,                               -- what the PDF shows (the record behind it)
    fingerprint         text NOT NULL,
    document_id         uuid NOT NULL REFERENCES document_file(id),   -- the PDF as sent
    sha256              text NOT NULL,
    issued_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
    issued_by           uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    signature_id        uuid NOT NULL REFERENCES signature_event(id),
    signer_title        text,
    signature_image_id  uuid REFERENCES document_file(id),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX stability_report_uq ON stability_report (study_id, version_no);
CALL make_gxp('stability_report');
CREATE FUNCTION stability_report_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'An issued stability report never changes: issue a new one'; END IF;
    IF NOT stability_internal() THEN RAISE EXCEPTION 'Stability reports are issued only through Issue report'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON stability_report FOR EACH ROW EXECUTE FUNCTION stability_report_rules();

-- Independence, as for a COA (Alex, 2026-10-15: "the same independence rules as a COA"): whoever issues the report
-- did not perform, witness, review or approve any of the study's work it reports. Returns that work, or NULL.
CREATE FUNCTION stability_report_conflict(p_study uuid, p_user uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT string_agg(DISTINCT sa.sample_code || ' (' || t.test_name || ')', ', ')
      FROM requested_test rt JOIN sample sa ON sa.id = rt.sample_id JOIN test t ON t.id = rt.test_id
     WHERE rt.stability_study_id = p_study AND rt.status <> 'Cancelled' AND test_is_finalized(rt.id)
       AND (EXISTS (SELECT 1 FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id JOIN step_run r ON r.batch_id = b.id
                     WHERE e.requested_test_id = rt.id AND b.status <> 'Cancelled'
                       AND (r.performed_by = p_user OR r.witness_id = p_user OR b.reviewed_by = p_user))
            OR EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.approved_by = p_user))
$$;
-- GMP work (a Regulated client) is issued by the quality team (reports.finalize_gmp), as its COAs are
CREATE FUNCTION stability_study_is_gmp(p_study uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(c.is_gmp_client, false) FROM stability_study s JOIN client c ON c.id = s.client_id WHERE s.id = p_study
$$;

-- What stops a report being issued now (Block), or deserves a look (Warning), and what it will be (Info)
-- p_user: who would issue it (the screens pass the viewer; inside a transaction it defaults to the person signing)
CREATE FUNCTION stability_report_problems(p_study uuid, p_user uuid DEFAULT NULL) RETURNS TABLE (severity text, problem text) LANGUAGE plpgsql STABLE AS $$
DECLARE st stability_study; r record; v_last stability_report; v_pending integer; v_conf text;
        v_me uuid := COALESCE(p_user, NULLIF(current_setting('lims.user_id', true), '')::uuid);
BEGIN
    SELECT * INTO st FROM stability_study WHERE id = p_study;
    IF st.id IS NULL THEN severity := 'Block'; problem := 'Study not found'; RETURN NEXT; RETURN; END IF;
    v_conf := CASE WHEN v_me IS NOT NULL THEN stability_report_conflict(st.id, v_me) END;
    IF v_conf IS NOT NULL THEN
        severity := 'Block'; problem := 'You performed, witnessed, reviewed or approved work this report includes (' || v_conf || '): someone else issues it'; RETURN NEXT;
    END IF;
    IF v_me IS NOT NULL AND stability_study_is_gmp(st.id) AND NOT user_has_permission_at(v_me, 'reports.finalize_gmp', st.site_id) THEN
        severity := 'Block'; problem := 'The client is Regulated (GMP): the quality team issues its reports (reports.finalize_gmp)'; RETURN NEXT;
    END IF;
    IF st.status = 'Awaiting material' THEN severity := 'Block'; problem := 'The material is not placed yet: there is nothing to report'; RETURN NEXT; RETURN; END IF;
    IF cardinality(stability_finalized_results(st.id)) = 0 THEN
        severity := 'Block'; problem := 'No results are finalized yet: issue the report once a pull''s results are finalized (Report Finalization)'; RETURN NEXT;
    END IF;
    FOR r IN SELECT x.entry_code, x.equipment_code, x.entry_at FROM stability_excursion_status_view x WHERE x.study_id = st.id AND x.assessment_id IS NULL ORDER BY x.entry_at LOOP
        severity := 'Block'; problem := 'Excursion ' || r.entry_code || ' (' || r.equipment_code || ', ' || to_char(r.entry_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = st.site_id), 'Mon DD') || ') is not assessed by QA yet'; RETURN NEXT;
    END LOOP;
    SELECT * INTO v_last FROM stability_report WHERE study_id = st.id ORDER BY version_no DESC LIMIT 1;
    IF v_last.id IS NOT NULL AND v_last.fingerprint = stability_report_fingerprint(st.id) THEN
        severity := 'Block'; problem := 'Nothing new since ' || v_last.report_code || ': no result finalized, assessment or amendment since it was issued'; RETURN NEXT;
    END IF;
    SELECT count(*) INTO v_pending FROM requested_test rt JOIN sample sa ON sa.id = rt.sample_id
     WHERE rt.stability_study_id = st.id AND rt.status <> 'Cancelled' AND sa.status <> 'Cancelled' AND NOT test_is_replaced(rt.id) AND NOT test_is_finalized(rt.id);
    IF v_pending > 0 THEN
        severity := 'Warning'; problem := v_pending || ' test' || CASE WHEN v_pending > 1 THEN 's are' ELSE ' is' END || ' not finalized yet (ordered, in testing or in review): shown as pending'; RETURN NEXT;
    END IF;
    severity := 'Info';
    problem := CASE WHEN stability_report_is_final(st.id) THEN 'This will be the Final report: every pull is done and finalized'
                    ELSE 'This will be an interim report (version ' || (COALESCE(v_last.version_no, 0) + 1) || ')' END
               || CASE WHEN v_last.is_final THEN ' (a Final report was already issued: this one replaces it)' ELSE '' END;
    RETURN NEXT;
END $$;

-- Issue the report: reports.finalize at the study's lab, signed, with the signer's handwritten signature and title on
-- file (as a COA). The PDF is made by the server from the same record; the content must match what the database sees
-- now. The client's report contacts (else the study's contact) are sent it.
CREATE FUNCTION issue_stability_report(p_study uuid, p_content jsonb, p_doc uuid, p_sha text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE st stability_study; u app_user; v_no integer; v_code text; v_final boolean; v_fp text; e text; v_id uuid; ct record; v_mail uuid;
        si text := COALESCE(current_setting('lims.stability_internal', true), '');
BEGIN
    SELECT * INTO st FROM stability_study WHERE id = p_study FOR UPDATE;
    IF st.id IS NULL THEN RAISE EXCEPTION 'Study not found'; END IF;
    PERFORM require_permission_at('reports.finalize', st.site_id);
    PERFORM assert_signed('issue a stability report');
    SELECT string_agg(problem, '; ') INTO e FROM stability_report_problems(st.id) WHERE severity = 'Block';
    IF e IS NOT NULL THEN RAISE EXCEPTION 'The report cannot be issued: %', e; END IF;
    SELECT * INTO u FROM app_user WHERE id = current_app_user();
    IF NOT u.is_automated AND (u.signature_document_id IS NULL OR btrim(COALESCE(u.title, '')) = '') THEN
        RAISE EXCEPTION '% has no handwritten signature and title on file: a lab administrator adds them (Admin > People and groups) before a report can be issued', u.full_name;
    END IF;
    v_fp := stability_report_fingerprint(st.id); v_final := stability_report_is_final(st.id);
    v_no := COALESCE((SELECT max(version_no) FROM stability_report WHERE study_id = st.id), 0) + 1;
    v_code := st.study_code || '-SR' || v_no;
    IF p_content->>'fingerprint' IS DISTINCT FROM v_fp OR (p_content->>'is_final')::boolean IS DISTINCT FROM v_final OR p_content->>'report_code' IS DISTINCT FROM v_code THEN
        RAISE EXCEPTION 'The study changed while the report was being prepared: open it again';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM document_file WHERE id = p_doc AND sha256 = p_sha) THEN RAISE EXCEPTION 'The report PDF is not the one stored'; END IF;
    PERFORM set_config('lims.stability_internal', '1', true);
    INSERT INTO stability_report (report_code, study_id, version_no, is_final, content, fingerprint, document_id, sha256, signature_id, signer_title, signature_image_id)
    VALUES (v_code, st.id, v_no, v_final, p_content, v_fp, p_doc, p_sha, NULLIF(current_setting('lims.signature_id', true), '')::uuid,
            CASE WHEN NOT u.is_automated THEN u.title END, CASE WHEN NOT u.is_automated THEN u.signature_document_id END)
    RETURNING id INTO v_id;
    PERFORM set_config('lims.stability_internal', si, true);
    FOR ct IN SELECT DISTINCT c2.email, c2.first_name, c2.last_name FROM client_contact cc JOIN contact c2 ON c2.id = cc.contact_id
               WHERE cc.client_id = st.client_id AND cc.status = 'Active' AND c2.status = 'Active' AND 'REPORT' = ANY (cc.roles) AND c2.email IS NOT NULL
              UNION SELECT c3.email, c3.first_name, c3.last_name FROM contact c3 WHERE c3.id = st.contact_id
                AND NOT EXISTS (SELECT 1 FROM client_contact cc WHERE cc.client_id = st.client_id AND cc.status = 'Active' AND 'REPORT' = ANY (cc.roles)) LOOP
        v_mail := queue_email('Stability Report Issued', ct.email, btrim(COALESCE(ct.first_name, '') || ' ' || COALESCE(ct.last_name, '')), jsonb_build_object(
            'first_name', COALESCE(ct.first_name, ''), 'study_code', st.study_code, 'report_code', v_code, 'version_no', v_no,
            'kind', CASE WHEN v_final THEN 'final' ELSE 'interim' END, 'product', COALESCE(st.product, 'your product'),
            'client_name', (SELECT COALESCE(display_name, legal_name) FROM client WHERE id = st.client_id),
            'status_line', CASE WHEN v_final THEN 'This is the final report of the study.' ELSE 'The study continues; you will receive the next report after the next pull''s results are finalized.' END,
            'staff_name', u.full_name, 'site_name', (SELECT site_name FROM lab_site WHERE id = st.site_id)), NULL, NULL, p_doc);
        IF v_mail IS NOT NULL THEN UPDATE email_outbox SET site_id = st.site_id WHERE id = v_mail; END IF;
    END LOOP;
    RETURN v_id;
END $$;

INSERT INTO email_template (template_code, template_name, subject, body, placeholders) VALUES
('Stability Report Issued', 'Stability study report issued to the client',
 'Stability report {{report_code}} for {{product}} ({{study_code}})',
 E'Dear {{first_name}},\n\nPlease find attached the {{kind}} stability report {{report_code}} (version {{version_no}}) for study {{study_code}}, {{product}}, for {{client_name}}. It gathers the results finalized so far, timepoint by timepoint, against the specification.\n\n{{status_line}}\n\nIf you have any questions, simply reply to this email.\n\nKind regards,\n{{staff_name}}\n{{site_name}}',
 '{{first_name}}, {{report_code}}, {{version_no}}, {{study_code}}, {{kind}}, {{product}}, {{client_name}}, {{status_line}}, {{staff_name}}, {{site_name}}');

-------------------------------------------------------------------------------
-- 6. VIEWS (recreated with the new columns)
-------------------------------------------------------------------------------
DROP VIEW stability_storage_view;
CREATE VIEW stability_storage_view AS
SELECT s.*, sc.condition_name, rk.rack_code, ch.id AS chamber_id, e.equipment_code, e.equipment_name, e.id AS equipment_id,
       s.units_received - COALESCE((SELECT sum(units_pulled) FROM stability_pull x WHERE x.storage_id = s.id AND x.status = 'Pulled'), 0) AS units_left,
       COALESCE((SELECT sum(units_required) FROM stability_pull x WHERE x.storage_id = s.id AND x.status IN ('Scheduled','Ordered')), 0) AS units_still_needed,
       du.full_name AS disposed_by_name
  FROM stability_storage s JOIN stability_condition sc ON sc.id = s.condition_id JOIN stability_rack rk ON rk.id = s.rack_id
  JOIN stability_chamber ch ON ch.id = rk.chamber_id JOIN equipment e ON e.id = ch.equipment_id LEFT JOIN app_user du ON du.id = s.disposed_by;

DROP VIEW stability_study_view;
CREATE VIEW stability_study_view AS
SELECT s.*, p.project_code, pv.version_no, COALESCE(cl.display_name, cl.legal_name) AS client_name, ls.site_code,
       NULLIF(btrim(COALESCE(ct.first_name, '') || ' ' || COALESCE(ct.last_name, '')), '') AS contact_name,
       o.order_code AS t0_order_code, sa.sample_code AS t0_sample_code, sa.status::text AS t0_sample_status, u.full_name AS placed_by_name,
       cu.full_name AS cancelled_by_name,
       (SELECT count(*) FROM stability_pull x WHERE x.study_id = s.id AND x.status <> 'Cancelled')::int AS pulls_total,
       (SELECT count(*) FROM stability_pull x WHERE x.study_id = s.id AND x.status = 'Pulled')::int AS pulls_done,
       (SELECT min(x.scheduled_date) FROM stability_pull x WHERE x.study_id = s.id AND x.status IN ('Scheduled','Ordered')) AS next_pull,
       (SELECT count(*) FROM stability_pull x WHERE x.study_id = s.id AND x.status = 'Ordered')::int AS pulls_to_take,
       (SELECT COALESCE(sum(x.shortfall), 0) FROM stability_storage x WHERE x.study_id = s.id)::int AS shortfall,
       (SELECT string_agg(sc.condition_name, ', ' ORDER BY vc.sort_order, sc.sort_order) FROM stability_version_condition vc JOIN stability_condition sc ON sc.id = vc.condition_id
         WHERE vc.project_version_id = s.project_version_id AND vc.status = 'Active') AS conditions,
       (SELECT count(*) FROM stability_version_condition vc WHERE vc.project_version_id = s.project_version_id AND vc.status = 'Active'
           AND NOT EXISTS (SELECT 1 FROM stability_storage x WHERE x.study_id = s.id AND x.condition_id = vc.condition_id))::int AS conditions_to_place,
       (SELECT count(*) FROM stability_excursion_status_view x WHERE x.study_id = s.id AND x.assessment_id IS NULL)::int AS excursions_open,
       (SELECT r.report_code FROM stability_report r WHERE r.study_id = s.id ORDER BY r.version_no DESC LIMIT 1) AS last_report_code,
       (SELECT r.issued_at FROM stability_report r WHERE r.study_id = s.id ORDER BY r.version_no DESC LIMIT 1) AS last_report_at,
       (SELECT pv2.version_no FROM project_version pv2 WHERE pv2.project_id = s.project_id AND pv2.version_no > pv.version_no
           AND pv2.status IN ('Draft','Submitted for Quote','Quoted') ORDER BY pv2.version_no DESC LIMIT 1) AS amendment_pending_version
  FROM stability_study s JOIN project p ON p.id = s.project_id JOIN project_version pv ON pv.id = s.project_version_id
  JOIN client cl ON cl.id = s.client_id JOIN lab_site ls ON ls.id = s.site_id JOIN contact ct ON ct.id = s.contact_id
  LEFT JOIN lab_order o ON o.id = s.t0_order_id LEFT JOIN sample sa ON sa.id = s.t0_sample_id LEFT JOIN app_user u ON u.id = s.placed_by
  LEFT JOIN app_user cu ON cu.id = s.cancelled_by;

-------------------------------------------------------------------------------
-- 7. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_041;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table IN ('stability_amendment','stability_excursion_assessment','stability_report') THEN
        RETURN jsonb_build_object('label', CASE p_table WHEN 'stability_amendment' THEN 'Amendment ' || COALESCE(r->>'amendment_no', '') || ' of ' || COALESCE((SELECT study_code FROM stability_study WHERE id = (r->>'study_id')::uuid), '')
                                                       WHEN 'stability_report' THEN 'Stability report ' || COALESCE(r->>'report_code', '')
                                                       ELSE 'Excursion assessment for ' || COALESCE((SELECT study_code FROM stability_study WHERE id = (r->>'study_id')::uuid), '') END,
                                  'href', '#/stability/studies/' || COALESCE(r->>'study_id', ''));
    END IF;
    RETURN audit_record_ref_041(p_table, p_id, r);
END $$;

SELECT set_config('lims.stability_internal', '', true);
SELECT set_config('lims.group_sync', '', true);
COMMIT;
