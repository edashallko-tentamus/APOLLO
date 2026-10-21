-- 040: QA testing of inventory before use, for any item (Alex, 2026-10-16; Claude in the cloud, version 0.22.0).
-- Vault: Decision - QA Testing of Inventory Before Use. Generalizes media qualification (023), which only covered Media.
-- Alex's answers (2026-10-16):
--  1. The QA testing happens in the lab: a test from the designer run on a test sample carrying the lot's ID (as media).
--  2. A pass releases the lot either for every use or only for named tests, chosen per lot.
--  3. Each lab sets which item types need QA testing before use (Media on, as before); the choice can be overridden per
--     item when it is received (requiring it: anyone receiving; waiving it: QA).
--  4. A lot that fails is Rejected: blocked for every use until a retest passes; QA can order the retest, or dispose of
--     the lot (or return it to the supplier) with the existing Dispose action.
-- The table media_qualification keeps its name (it now holds every lot's QA testing); use_test_id NULL = every use.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 040: QA testing of inventory before use', true);

-------------------------------------------------------------------------------
-- 0. PERMISSIONS
-------------------------------------------------------------------------------
UPDATE permission SET area = 'QA testing', description = 'Send a lot for QA testing before use (the tests it is released for and the QA tests to run); retest a rejected lot'
 WHERE code = 'inventory.qualify';
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('inventory.qa_configure', 'Inventory', 'QA testing', 'Set which item types need QA testing before use in the lab, receive an item without it, and waive it for a lot (signed)', false, 58);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('QA', '{inventory.qa_configure}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

-------------------------------------------------------------------------------
-- 1. EACH LAB'S DEFAULTS: WHICH ITEM TYPES NEED QA TESTING BEFORE USE
-------------------------------------------------------------------------------
CREATE TABLE qa_testing_default (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid NOT NULL REFERENCES lab_site(id),
    chemical_type   chemical_type NOT NULL,
    required        boolean NOT NULL DEFAULT false,
    note            text,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (site_id, chemical_type)
);
CALL make_gxp('qa_testing_default');
CREATE FUNCTION qa_testing_default_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.site_id <> OLD.site_id OR NEW.chemical_type <> OLD.chemical_type) THEN
        RAISE EXCEPTION 'A lab''s QA testing default keeps its lab and item type';
    END IF;
    NEW.note := NULLIF(btrim(NEW.note), '');
    IF in_group_sync() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('inventory.qa_configure', NEW.site_id);
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON qa_testing_default FOR EACH ROW EXECUTE FUNCTION qa_testing_default_rules();

-- every lab starts with Media needing QA testing (as 023 did) and the other types not
INSERT INTO qa_testing_default (site_id, chemical_type, required)
SELECT s.id, t, t = 'Media' FROM lab_site s, unnest(enum_range(NULL::chemical_type)) t ON CONFLICT DO NOTHING;
CREATE FUNCTION lab_site_qa_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE was text := COALESCE(current_setting('lims.group_sync', true), '');
BEGIN
    PERFORM set_config('lims.group_sync', '1', true);
    INSERT INTO qa_testing_default (site_id, chemical_type, required)
    SELECT NEW.id, t, t = 'Media' FROM unnest(enum_range(NULL::chemical_type)) t ON CONFLICT DO NOTHING;
    PERFORM set_config('lims.group_sync', was, true);
    RETURN NULL;
END $$;
CREATE TRIGGER zz_qa_defaults AFTER INSERT ON lab_site FOR EACH ROW EXECUTE FUNCTION lab_site_qa_defaults();

-- Does the lab want QA testing for an item of these types?
CREATE FUNCTION lab_qa_default(p_site uuid, p_types chemical_type[]) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM qa_testing_default d WHERE d.site_id = p_site AND d.required AND d.chemical_type = ANY (COALESCE(p_types, '{}')))
$$;

-------------------------------------------------------------------------------
-- 2. WHETHER A LOT NEEDS QA TESTING (replaces 023's media rule)
-------------------------------------------------------------------------------
-- New lot: the lab's default for its item types, unless the person receiving it chose otherwise (lims.qa_testing '1' or
-- '0', set by the screen's tick box). Requiring it is open to anyone receiving; receiving without it when the lab's
-- default asks for it is QA's call (inventory.qa_configure). Demo data loaded with lims.media_preapproved = '1' needs none.
CREATE OR REPLACE FUNCTION inventory_lot_media_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pre boolean := COALESCE(current_setting('lims.media_preapproved', true), '') = '1';
        choice text := COALESCE(current_setting('lims.qa_testing', true), ''); dflt boolean;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF pre THEN NEW.qualification_required := false; RETURN NEW; END IF;
        dflt := lab_qa_default(NEW.site_id, NEW.chemical_types);
        IF choice = '1' THEN NEW.qualification_required := true;
        ELSIF choice = '0' THEN
            IF dflt AND NOT in_group_sync() AND NOT has_permission_at('inventory.qa_configure', NEW.site_id) THEN
                RAISE EXCEPTION 'This lab tests % before use: only QA can receive it without QA testing (inventory.qa_configure)',
                    (SELECT string_agg(d.chemical_type::text, ', ') FROM qa_testing_default d WHERE d.site_id = NEW.site_id AND d.required AND d.chemical_type = ANY (NEW.chemical_types));
            END IF;
            NEW.qualification_required := false;
        ELSE NEW.qualification_required := dflt;
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.qualification_required IS DISTINCT FROM OLD.qualification_required AND NOT media_internal() THEN
        RAISE EXCEPTION 'Whether a lot needs QA testing before use is set by the system: use Send for QA testing, or ask QA to waive it';
    END IF;
    -- a lot that becomes a type the lab tests needs QA testing too
    IF NOT OLD.qualification_required AND NOT pre AND lab_qa_default(NEW.site_id, NEW.chemical_types)
       AND NOT lab_qa_default(OLD.site_id, OLD.chemical_types) THEN NEW.qualification_required := true; END IF;
    RETURN NEW;
END $$;

-- The internal "client" for the lab's own test samples (new databases name it for every kind of lot; an existing one keeps
-- its name)
CREATE OR REPLACE FUNCTION internal_client() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_client uuid; v_contact uuid;
BEGIN
    SELECT id INTO v_client FROM client WHERE legal_name IN ('Internal: media qualification', 'Internal: QA testing of lots') ORDER BY created_at LIMIT 1;
    IF v_client IS NOT NULL THEN RETURN v_client; END IF;
    INSERT INTO client (legal_name, display_name, account_status)
    VALUES ('Internal: QA testing of lots', 'Internal: QA testing of lots', 'Active') RETURNING id INTO v_client;
    SELECT id INTO v_contact FROM contact WHERE lower(email) IN ('media.qualification@lims3.internal', 'qa.testing@lims3.internal') ORDER BY created_at LIMIT 1;
    IF v_contact IS NULL THEN
        INSERT INTO contact (first_name, last_name, email, job_title)
        VALUES ('Lab', 'QA testing', 'qa.testing@lims3.internal', 'The lab itself (internal samples)') RETURNING id INTO v_contact;
    END IF;
    INSERT INTO client_contact (client_id, contact_id, roles, portal_visible) VALUES (v_client, v_contact, '{ORDERING}', false) ON CONFLICT DO NOTHING;
    RETURN v_client;
END $$;

-------------------------------------------------------------------------------
-- 3. A LOT'S QA TESTING: FOR EVERY USE OR FOR NAMED TESTS
-------------------------------------------------------------------------------
ALTER TABLE media_qualification ALTER COLUMN use_test_id DROP NOT NULL;   -- NULL: released for every use
DROP INDEX media_qualification_one_live;
CREATE UNIQUE INDEX media_qualification_one_live ON media_qualification (lot_id, COALESCE(use_test_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE status IN ('Testing','Passed');
ALTER TABLE media_qualification ADD COLUMN retest_of_id uuid REFERENCES media_qualification(id);

-- Is the lot rejected? A failed QA test, with no QA test passed since (a retest that passes lifts it)
CREATE FUNCTION lot_qa_rejected(p_lot uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM media_qualification f WHERE f.lot_id = p_lot AND f.status = 'Failed'
                    AND NOT EXISTS (SELECT 1 FROM media_qualification p WHERE p.lot_id = p_lot AND p.status = 'Passed' AND p.created_at > f.created_at))
$$;
-- Does the lot need QA testing (by default, by choice, or because it was sent)?
CREATE FUNCTION lot_qa_required(p_lot uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(l.qualification_required, false) OR EXISTS (SELECT 1 FROM media_qualification q WHERE q.lot_id = l.id AND q.status <> 'Cancelled')
      FROM inventory_lot l WHERE l.id = p_lot
$$;
-- The lot's QA testing status, in words (NULL: no QA testing needed)
CREATE FUNCTION lot_qa_status(p_lot uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN NOT lot_qa_required(p_lot) THEN NULL
                WHEN lot_qa_rejected(p_lot) THEN
                     CASE WHEN EXISTS (SELECT 1 FROM media_qualification q WHERE q.lot_id = p_lot AND q.status = 'Testing') THEN 'Rejected, retest under way' ELSE 'Rejected' END
                WHEN EXISTS (SELECT 1 FROM media_qualification q WHERE q.lot_id = p_lot AND q.status = 'Passed' AND q.use_test_id IS NULL) THEN 'Released for every use'
                WHEN EXISTS (SELECT 1 FROM media_qualification q WHERE q.lot_id = p_lot AND q.status = 'Passed') THEN 'Released for named tests'
                WHEN EXISTS (SELECT 1 FROM media_qualification q WHERE q.lot_id = p_lot AND q.status = 'Testing') THEN 'In QA testing'
                ELSE 'Awaiting QA testing' END
$$;
-- Why the lot cannot be used for a test (NULL: it can). p_test NULL = any use outside a test (e.g. a mixture component):
-- only a release for every use allows that. In the lot's own QA batch it can always be used.
CREATE FUNCTION lot_qa_problem(p_lot uuid, p_test uuid, p_batch uuid DEFAULT NULL) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE l inventory_lot; named text;
BEGIN
    SELECT * INTO l FROM inventory_lot WHERE id = p_lot;
    IF l.id IS NULL OR NOT lot_qa_required(p_lot) THEN RETURN NULL; END IF;
    IF p_batch IS NOT NULL AND EXISTS (SELECT 1 FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id
                                        WHERE e.batch_id = p_batch AND rt.media_lot_id = p_lot) THEN RETURN NULL; END IF;
    IF lot_qa_rejected(p_lot) THEN
        RETURN 'it was rejected in QA testing; it can be used again only if a retest passes (or dispose of it)';
    END IF;
    IF EXISTS (SELECT 1 FROM media_qualification q WHERE q.lot_id = p_lot AND q.status = 'Passed' AND (q.use_test_id IS NULL OR q.use_test_id = p_test)) THEN
        RETURN NULL;
    END IF;
    SELECT string_agg(t.test_name, ', ' ORDER BY t.test_name) INTO named FROM media_qualification q JOIN test t ON t.id = q.use_test_id
     WHERE q.lot_id = p_lot AND q.status = 'Passed';
    IF named IS NOT NULL THEN
        RETURN 'it is released only for ' || named || CASE WHEN p_test IS NULL THEN ', not for every use' ELSE '' END;
    END IF;
    IF EXISTS (SELECT 1 FROM media_qualification q WHERE q.lot_id = p_lot AND q.status = 'Testing') THEN
        RETURN 'it is still in QA testing; it can be used once QA approves the test';
    END IF;
    RETURN 'it is waiting for QA testing (on the lot''s page: Send for QA testing)';
END $$;

-- Start QA testing. p_items = [{"use_test_id": uuid or null (every use), "qualification_test_id": uuid}, ...]. Makes (once)
-- the lot's test sample, with the lot's ID, on the lab's internal order, and orders each QA test on it (logged at once).
-- A rejected lot can be sent again: the retest is a new requested test on the same sample.
CREATE FUNCTION send_lot_for_qa_testing(p_lot uuid, p_items jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE l inventory_lot; it jsonb; v_use test; v_q test; v_use_id uuid; v_ver uuid; v_order uuid; v_sample uuid; v_rt uuid; v_prev uuid; v_contact uuid; v_client uuid;
        v_retest uuid; gs text := COALESCE(current_setting('lims.group_sync', true), ''); mi text := COALESCE(current_setting('lims.media_internal', true), '');
BEGIN
    SELECT * INTO l FROM inventory_lot WHERE id = p_lot;
    IF l.id IS NULL THEN RAISE EXCEPTION 'Lot not found'; END IF;
    PERFORM assert_site_access(l.site_id);
    PERFORM require_permission_at('inventory.qualify', l.site_id);
    IF l.receipt_status <> 'Received' THEN RAISE EXCEPTION 'Receive lot % before sending it for QA testing', l.lot_code; END IF;
    IF l.status <> 'Available' THEN RAISE EXCEPTION 'Lot % is % and cannot be sent for QA testing', l.lot_code, l.status; END IF;
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Choose at least one QA test, and what the lot is released for when it passes';
    END IF;
    PERFORM ensure_reason('Sent for QA testing: ' || l.lot_code);
    v_retest := (SELECT f.id FROM media_qualification f WHERE f.lot_id = l.id AND f.status = 'Failed' ORDER BY f.decided_at DESC NULLS LAST LIMIT 1);
    IF NOT lot_qa_rejected(l.id) THEN v_retest := NULL; END IF;
    PERFORM set_config('lims.group_sync', '1', true);     -- the system makes the internal order and sample (checked above)
    PERFORM set_config('lims.media_internal', '1', true);
    SELECT s.id INTO v_sample FROM sample s WHERE s.sample_code = l.lot_code;
    IF v_sample IS NULL THEN
        v_client := internal_client();   -- (made on first use)
        SELECT cc.contact_id INTO v_contact FROM client_contact cc WHERE cc.client_id = v_client AND 'ORDERING' = ANY (cc.roles) LIMIT 1;
        INSERT INTO lab_order (client_id, site_id, ordering_contact_id, notes, status)
        VALUES (v_client, l.site_id, v_contact, 'QA testing of ' || l.lot_code || ' ' || COALESCE(l.item_name, ''), 'Received') RETURNING id INTO v_order;
        INSERT INTO sample (lab_order_id, sample_code, client_sample_id, description, lot, received_at, logged_at, logged_by, status, number_of_units)
        VALUES (v_order, l.lot_code, l.manufacturer_lot, 'QA testing: ' || COALESCE(l.item_name, l.lot_code), l.manufacturer_lot, clock_timestamp(), clock_timestamp(),
                current_app_user(), 'Logged', 1)
        RETURNING id INTO v_sample;
    END IF;
    FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_use_id := NULLIF(it->>'use_test_id', '')::uuid;
        SELECT * INTO v_q FROM test WHERE id = NULLIF(it->>'qualification_test_id', '')::uuid;
        IF v_q.id IS NULL THEN RAISE EXCEPTION 'Choose the QA test to run'; END IF;
        IF v_q.site_id IS DISTINCT FROM l.site_id THEN RAISE EXCEPTION 'The QA test must be a test of the lot''s lab'; END IF;
        IF v_use_id IS NOT NULL THEN
            SELECT * INTO v_use FROM test WHERE id = v_use_id;
            IF v_use.id IS NULL THEN RAISE EXCEPTION 'The test the lot is released for was not found'; END IF;
            IF v_use.site_id IS DISTINCT FROM l.site_id THEN RAISE EXCEPTION 'Both tests must be tests of the lot''s lab'; END IF;
            IF v_use.id = v_q.id THEN RAISE EXCEPTION 'The QA test must be a different test from the one the lot is released for (for example growth promotion)'; END IF;
        END IF;
        IF EXISTS (SELECT 1 FROM media_qualification WHERE lot_id = l.id AND use_test_id IS NOT DISTINCT FROM v_use_id AND status IN ('Testing','Passed')) THEN
            RAISE EXCEPTION 'Lot % is already % for %', l.lot_code,
                (SELECT CASE status WHEN 'Passed' THEN 'released' ELSE 'in QA testing' END FROM media_qualification
                  WHERE lot_id = l.id AND use_test_id IS NOT DISTINCT FROM v_use_id AND status IN ('Testing','Passed') LIMIT 1),
                COALESCE((SELECT test_name FROM test WHERE id = v_use_id), 'every use');
        END IF;
        SELECT id INTO v_ver FROM test_version WHERE test_id = v_q.id AND status = 'Effective';
        IF v_ver IS NULL THEN RAISE EXCEPTION '% has no approved (Effective) version yet', v_q.test_name; END IF;
        -- the sample's open request for that QA test, if one is still undecided; otherwise a new one (a retest)
        SELECT rt.id INTO v_rt FROM requested_test rt WHERE rt.sample_id = v_sample AND rt.test_id = v_q.id AND rt.status <> 'Cancelled'
           AND NOT EXISTS (SELECT 1 FROM media_qualification q WHERE q.requested_test_id = rt.id AND q.status IN ('Passed','Failed'))
         ORDER BY rt.created_at DESC LIMIT 1;
        IF v_rt IS NULL THEN
            SELECT rt.id INTO v_prev FROM requested_test rt WHERE rt.sample_id = v_sample AND rt.test_id = v_q.id AND rt.status <> 'Cancelled' ORDER BY rt.created_at DESC LIMIT 1;
            INSERT INTO requested_test (sample_id, test_id, test_version_id, media_lot_id, retest_of_id) VALUES (v_sample, v_q.id, v_ver, l.id, v_prev) RETURNING id INTO v_rt;
            INSERT INTO specification (requested_test_id, analyte_id, min_value, max_value, text_value, unit, source)
            SELECT v_rt, a.analyte_id, a.default_spec_min, a.default_spec_max, a.default_spec_text, a.reporting_unit, 'Lab'
              FROM test_version_analyte a WHERE a.test_version_id = v_ver AND a.status = 'Active'
               AND (a.default_spec_min IS NOT NULL OR a.default_spec_max IS NOT NULL OR NULLIF(btrim(a.default_spec_text), '') IS NOT NULL);
        END IF;
        INSERT INTO media_qualification (lot_id, use_test_id, qualification_test_id, requested_test_id, retest_of_id) VALUES (l.id, v_use_id, v_q.id, v_rt, v_retest);
    END LOOP;
    PERFORM set_config('lims.media_internal', mi, true);
    PERFORM set_config('lims.group_sync', gs, true);
    RETURN v_sample;
END $$;
-- 023's name keeps working (screens and scripts written before 040)
CREATE OR REPLACE FUNCTION qualify_media(p_lot uuid, p_items jsonb) RETURNS uuid LANGUAGE sql AS $$ SELECT send_lot_for_qa_testing(p_lot, p_items) $$;

-- QA's approval of the batch decides: released (for every use or its test) unless a result does not conform: then the
-- lot is Rejected (blocked for every use until a retest passes)
CREATE OR REPLACE FUNCTION media_qualification_decide() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q media_qualification; bad text; mi text := COALESCE(current_setting('lims.media_internal', true), '');
BEGIN
    IF NEW.status <> 'Approved' OR OLD.status = 'Approved' THEN RETURN NULL; END IF;
    PERFORM set_config('lims.media_internal', '1', true);
    FOR q IN SELECT mq.* FROM media_qualification mq
              WHERE mq.status = 'Testing' AND mq.requested_test_id IN (SELECT e.requested_test_id FROM batch_entry e WHERE e.batch_id = NEW.id AND e.status = 'Active') LOOP
        SELECT string_agg(a.analyte_name || ' ' || COALESCE(tr.reported, tr.value_text, ''), ', ' ORDER BY a.analyte_name) INTO bad
          FROM test_result tr JOIN analyte a ON a.id = tr.analyte_id
         WHERE tr.requested_test_id = q.requested_test_id AND tr.status = 'Active' AND tr.stage = 'Final' AND tr.conformance = 'Does not conform';
        UPDATE media_qualification SET status = CASE WHEN bad IS NULL THEN 'Passed' ELSE 'Failed' END, batch_id = NEW.id,
               decided_at = clock_timestamp(), decided_by = NEW.reviewed_by,
               decision_note = CASE WHEN bad IS NULL
                                    THEN 'Released for ' || COALESCE((SELECT test_name FROM test WHERE id = q.use_test_id), 'every use') || ': QC Review of ' || NEW.batch_code || ' approved'
                                    ELSE 'Rejected: ' || bad || ' did not conform (QC Review of ' || NEW.batch_code || '). Blocked for every use until a retest passes.' END
         WHERE id = q.id;
    END LOOP;
    PERFORM set_config('lims.media_internal', mi, true);
    RETURN NULL;
END $$;

-- At the bench: a lot that needs QA testing is used only where it is released (or in its own QA batch)
CREATE OR REPLACE FUNCTION entry_material_media_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l inventory_lot; b test_batch; why text;
BEGIN
    IF NEW.status <> 'Active' OR (TG_OP = 'UPDATE' AND OLD.status = 'Active') OR testing_internal() THEN RETURN NEW; END IF;
    SELECT * INTO l FROM inventory_lot WHERE id = NEW.lot_id;
    SELECT b2.* INTO b FROM step_run r JOIN test_batch b2 ON b2.id = r.batch_id WHERE r.id = NEW.step_run_id;
    why := lot_qa_problem(l.id, b.test_id, b.id);
    IF why IS NULL THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Lot % (%) is not released by QA testing for %: %', l.lot_code, l.item_name, (SELECT test_name FROM test WHERE id = b.test_id), why;
END $$;

-- An in-house mixture is made only from lots released for every use
CREATE FUNCTION lot_component_qa_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE why text; l inventory_lot;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.component_lot_id = OLD.component_lot_id THEN RETURN NEW; END IF;
    why := lot_qa_problem(NEW.component_lot_id, NULL);
    IF why IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO l FROM inventory_lot WHERE id = NEW.component_lot_id;
    RAISE EXCEPTION 'Lot % (%) cannot go into a mixture: %', l.lot_code, l.item_name, why;
END $$;
CREATE TRIGGER a02_qa BEFORE INSERT OR UPDATE OF component_lot_id ON lot_component FOR EACH ROW EXECUTE FUNCTION lot_component_qa_rule();

-- QA waives the QA testing of a lot that the lab's default asks for (nothing sent for it yet). Signed (the route).
CREATE FUNCTION waive_lot_qa_testing(p_lot uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE l inventory_lot; gs text := COALESCE(current_setting('lims.group_sync', true), ''); mi text := COALESCE(current_setting('lims.media_internal', true), '');
BEGIN
    SELECT * INTO l FROM inventory_lot WHERE id = p_lot;
    IF l.id IS NULL THEN RAISE EXCEPTION 'Lot not found'; END IF;
    PERFORM assert_site_access(l.site_id);
    PERFORM require_permission_at('inventory.qa_configure', l.site_id);
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'A reason is required to waive QA testing'; END IF;
    IF NOT l.qualification_required THEN RAISE EXCEPTION 'Lot % does not need QA testing', l.lot_code; END IF;
    IF EXISTS (SELECT 1 FROM media_qualification q WHERE q.lot_id = l.id AND q.status <> 'Cancelled') THEN
        RAISE EXCEPTION 'Lot % has been sent for QA testing: its result decides (a rejected lot is retested or disposed of)', l.lot_code;
    END IF;
    PERFORM set_config('lims.group_sync', '1', true);
    PERFORM set_config('lims.media_internal', '1', true);
    UPDATE inventory_lot SET qualification_required = false WHERE id = l.id;
    PERFORM set_config('lims.media_internal', mi, true);
    PERFORM set_config('lims.group_sync', gs, true);
END $$;

-------------------------------------------------------------------------------
-- 4. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_040;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'qa_testing_default' THEN
        RETURN jsonb_build_object('label', 'QA testing default: ' || COALESCE(r->>'chemical_type', '') || ' (' || COALESCE((SELECT site_code FROM lab_site WHERE id = (r->>'site_id')::uuid), '') || ')',
                                  'link', '#/inventory/qa-testing');
    ELSIF p_table = 'media_qualification' THEN
        RETURN jsonb_build_object('label', 'QA testing ' || COALESCE(r->>'qualification_code', '') || ' of ' || COALESCE((SELECT lot_code FROM inventory_lot WHERE id = (r->>'lot_id')::uuid), 'a lot'),
                                  'link', '#/inventory/lots/' || COALESCE(r->>'lot_id', ''));
    END IF;
    RETURN audit_record_ref_040(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
