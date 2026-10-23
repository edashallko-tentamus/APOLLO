-- 057: cancelling tests and samples, the thermometer at receipt, license dates on the lab's date (Claude Code, 2026-10-20; version 0.34.0).
-- Alex, 2026-10-20:
--  - "I think i just realized that you can't remove tests or samples once they have been added." Nothing is ever
--    deleted; tests and samples are cancelled (kept, greyed). His choice: a clear Cancel… on tests and samples, and a
--    logged sample can be cancelled too, while none of its tests has results; a test in a batch that has started must
--    be taken out of the batch first (or the batch cancelled). Before 057 the database let a test in a batch, or with
--    results, be cancelled; now it refuses, saying why. Cancelling a sample cancels its tests.
--  - COC information: "Reporting units for potency testing ... (selected by client)": on hold (Alex: the specifications
--    and serving size units may already cover it; he is checking with the lab). Not in this migration.
--  - "Serving size (shared by client)": already on the sample (031); now printed on the chain of custody (no change here).
--  - "Thermometer equipment ID (recorded by lab at receipt)". His choice: picked from the equipment register, available
--    and in calibration, whenever a temperature is recorded at receipt; printed on the chain of custody.
-- Permissions: none new (orders.edit for cancelling and receipt).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.reason', 'Migration 057: cancelling, thermometer at receipt', true);

-------------------------------------------------------------------------------
-- 1. CANCELLING TESTS AND SAMPLES
-------------------------------------------------------------------------------
-- What stops a requested test being cancelled (NULL: nothing): its results, or a batch it is in
CREATE FUNCTION requested_test_cancel_problem(p_rt uuid) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE rt requested_test; nm text; b text;
BEGIN
    SELECT * INTO rt FROM requested_test WHERE id = p_rt;
    IF rt.id IS NULL OR rt.status = 'Cancelled' THEN RETURN NULL; END IF;
    SELECT t.test_name || ' on ' || COALESCE(s.sample_code, s.client_sample_id, 'the sample') INTO nm
      FROM test t, sample s WHERE t.id = rt.test_id AND s.id = rt.sample_id;
    SELECT string_agg(DISTINCT tb.batch_code, ', ') INTO b FROM test_result tr JOIN test_batch tb ON tb.id = tr.batch_id
     WHERE tr.requested_test_id = p_rt AND tr.status = 'Active';
    IF b IS NOT NULL THEN RETURN format('%s has results (%s): it cannot be cancelled', nm, b); END IF;
    SELECT tb.batch_code INTO b FROM batch_entry e JOIN test_batch tb ON tb.id = e.batch_id
     WHERE e.requested_test_id = p_rt AND e.status = 'Active' AND tb.status::text <> 'Cancelled' ORDER BY tb.created_at DESC LIMIT 1;
    IF b IS NOT NULL THEN
        RETURN format('%s is in batch %s: take it out of the batch first (possible until bench work starts), or cancel the batch', nm, b);
    END IF;
    RETURN NULL;
END $$;

CREATE FUNCTION requested_test_cancel_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p text;
BEGIN
    -- a stability study and a competency attempt cancel their own tests (their functions handle their batches)
    IF NEW.status = 'Cancelled' AND OLD.status <> 'Cancelled' AND NOT (stability_internal() OR training_internal()) THEN
        p := requested_test_cancel_problem(NEW.id);
        IF p IS NOT NULL THEN RAISE EXCEPTION '%', p; END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER c_requested_test_cancel BEFORE UPDATE OF status ON requested_test FOR EACH ROW EXECUTE FUNCTION requested_test_cancel_rule();

-- A sample can be cancelled (logged or not) while none of its tests has results or is in a batch; its tests go with it
CREATE FUNCTION sample_cancel_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; p text;
BEGIN
    IF NEW.status = 'Cancelled' AND OLD.status <> 'Cancelled' AND NOT (stability_internal() OR training_internal()) THEN
        FOR r IN SELECT id FROM requested_test WHERE sample_id = NEW.id AND status <> 'Cancelled' LOOP
            p := requested_test_cancel_problem(r.id);
            IF p IS NOT NULL THEN
                RAISE EXCEPTION 'Sample % cannot be cancelled: %', COALESCE(NEW.sample_code, NEW.client_sample_id, ''), p;
            END IF;
        END LOOP;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER c_sample_cancel BEFORE UPDATE OF status ON sample FOR EACH ROW EXECUTE FUNCTION sample_cancel_rule();

CREATE FUNCTION sample_cancel_tests() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'Cancelled' AND OLD.status <> 'Cancelled' THEN
        UPDATE requested_test SET status = 'Cancelled' WHERE sample_id = NEW.id AND status <> 'Cancelled';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER z_sample_cancel_tests AFTER UPDATE OF status ON sample FOR EACH ROW EXECUTE FUNCTION sample_cancel_tests();

-------------------------------------------------------------------------------
-- 1b. A LICENSE'S STATE ON THE LAB'S DATE (055 used the server's date, a day ahead in the evening in California)
-------------------------------------------------------------------------------
CREATE FUNCTION license_state_on(p_expires date, p_status text, p_today date) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p_status = 'Retired' THEN 'Retired'
                WHEN p_expires IS NULL THEN 'Current'
                WHEN p_expires < p_today THEN 'Expired'
                WHEN p_expires <= p_today + 30 THEN 'Expiring soon'
                ELSE 'Current' END
$$;

-------------------------------------------------------------------------------
-- 2. THE THERMOMETER AT RECEIPT
-------------------------------------------------------------------------------
ALTER TABLE custody_event ADD COLUMN thermometer_id uuid REFERENCES equipment(id);

-- as in 051, plus the thermometer: required with a temperature; the lab's own, available and in calibration
DROP FUNCTION receive_samples(uuid, uuid[], timestamptz, text, text, numeric, text, text, text);
CREATE FUNCTION receive_samples(p_order uuid, p_samples uuid[], p_received_at timestamptz, p_delivered_by text, p_tracking text,
    p_temperature numeric, p_condition text, p_seals text, p_note text, p_thermometer uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o lab_order; u app_user; v_doc uuid; v_ev uuid; v_n integer; v_bad text; v_at timestamptz := COALESCE(p_received_at, clock_timestamp()); ev record;
BEGIN
    SELECT * INTO o FROM lab_order WHERE id = p_order;
    IF o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
    PERFORM require_permission_at('orders.edit', o.site_id);
    PERFORM assert_signed('receive samples and sign the chain of custody');
    SELECT * INTO u FROM app_user WHERE id = current_app_user();
    IF u.signature_document_id IS NULL OR NULLIF(btrim(u.title), '') IS NULL THEN
        RAISE EXCEPTION 'Your handwritten signature and title are not on file, so they cannot be placed on the chain of custody. A lab administrator records them in Admin > People and groups (COA signature).';
    END IF;
    IF p_samples IS NULL OR cardinality(p_samples) = 0 THEN RAISE EXCEPTION 'Tick the samples being received'; END IF;
    SELECT string_agg(COALESCE(s.client_sample_id, s.description, s.id::text), ', ') INTO v_bad FROM sample s
     WHERE s.id = ANY(p_samples) AND (s.lab_order_id <> p_order OR s.status::text <> 'Expected');
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Only this order''s samples that are still expected can be received (not: %)', v_bad; END IF;
    SELECT count(*) INTO v_n FROM sample WHERE id = ANY(p_samples);
    IF v_n <> cardinality(p_samples) THEN RAISE EXCEPTION 'Sample not found'; END IF;
    IF v_at > clock_timestamp() + interval '5 minutes' THEN RAISE EXCEPTION 'The time received cannot be in the future'; END IF;
    IF v_at < o.created_at - interval '30 days' THEN RAISE EXCEPTION 'The time received is long before the order was made'; END IF;
    IF p_seals IS NOT NULL AND p_seals NOT IN ('Intact','Broken','None') THEN RAISE EXCEPTION 'Custody seals are Intact, Broken or None'; END IF;
    -- the thermometer (Alex, 2026-10-20): from the register, this lab's, available and in calibration
    IF p_temperature IS NOT NULL AND p_thermometer IS NULL THEN
        RAISE EXCEPTION 'Say which thermometer took the temperature (from the equipment register)';
    END IF;
    IF p_thermometer IS NOT NULL THEN
        SELECT * INTO ev FROM equipment_view WHERE id = p_thermometer;
        IF ev.id IS NULL THEN RAISE EXCEPTION 'Thermometer not found'; END IF;
        IF ev.site_id <> o.site_id THEN RAISE EXCEPTION '% belongs to another lab', ev.equipment_code; END IF;
        IF ev.availability <> 'Available' THEN RAISE EXCEPTION '% is % and cannot be used%', ev.equipment_code, lower(ev.availability), COALESCE(' (' || ev.tagged_for || ')', ''); END IF;
        IF ev.calibration_status = 'Deficient' THEN RAISE EXCEPTION '% is out of calibration and cannot be used', ev.equipment_code; END IF;
    END IF;
    -- the receipt's details go on each sample that has none of its own
    UPDATE sample SET received_at = COALESCE(received_at, v_at), receipt_temperature = COALESCE(receipt_temperature, p_temperature),
           condition = COALESCE(condition, NULLIF(btrim(p_condition), ''))
     WHERE id = ANY(p_samples);
    v_doc := make_custody_document(p_order);
    PERFORM set_config('lims.custody_internal', '1', true);
    PERFORM log_samples(p_samples);
    INSERT INTO custody_event (custody_document_id, event_no, kind, event_at, sample_ids, delivered_by, tracking_no, temperature, condition, seals, note,
                               signature_id, signer_title, signature_image_id, thermometer_id)
    VALUES (v_doc, 0, 'Received', v_at, p_samples, NULLIF(btrim(p_delivered_by), ''), NULLIF(btrim(p_tracking), ''), p_temperature,
            NULLIF(btrim(p_condition), ''), p_seals, NULLIF(btrim(p_note), ''), NULLIF(current_setting('lims.signature_id', true), '')::uuid, u.title, u.signature_document_id,
            p_thermometer)
    RETURNING id INTO v_ev;
    PERFORM set_config('lims.custody_internal', '', true);
    RETURN v_ev;
END $$;

DROP VIEW custody_event_view;
CREATE VIEW custody_event_view AS
SELECT e.*, d.coc_code, d.lab_order_id, u.full_name AS by_name,
       (SELECT string_agg(COALESCE(s.sample_code, s.client_sample_id), ', ' ORDER BY s.sample_code) FROM sample s WHERE s.id = ANY(e.sample_ids)) AS sample_codes,
       COALESCE(cardinality(e.sample_ids), 0) AS sample_count,
       th.equipment_code AS thermometer_code, th.equipment_name AS thermometer_name
  FROM custody_event e JOIN custody_document d ON d.id = e.custody_document_id JOIN app_user u ON u.id = e.created_by
  LEFT JOIN equipment th ON th.id = e.thermometer_id;

COMMIT;
