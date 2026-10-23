-- 051: the chain of custody, receipt photos and the photo report layouts (0.29.0; Alex, 2026-10-20).
-- Alex's requests (vault: Decision - Chain of Custody, Receipt Photos and Photo Reports):
--  1. A chain of custody document is made when an order is submitted. When the samples are received, the person
--     receiving them signs it, and their handwritten signature is placed in its Received area. One document is both
--     the chain of custody and the sample manifest (Alex: no preference; Claude's recommendation).
--  2. Photos of the samples at receipt, and report layouts that use one photo or two, 4:3.
--  3. A QR code on the report (server only: no database change).
-- No new permission: receiving, photos and the paper copy are orders.edit (as logging was).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 051: chain of custody, receipt photos and photo report layouts', true);

-------------------------------------------------------------------------------
-- 1. THE CHAIN OF CUSTODY (ONE PER ORDER; IT IS ALSO THE SAMPLE MANIFEST)
-------------------------------------------------------------------------------
-- A lab may require every receipt to be signed: then samples are logged only by "Receive and sign" (system
-- administrators set it on the Sites page; off by default, so scripts and older tests that log samples still work)
ALTER TABLE lab_site ADD COLUMN custody_signature_required boolean NOT NULL DEFAULT false;

CREATE SEQUENCE custody_document_seq;
CREATE TABLE custody_document (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    coc_code        text NOT NULL UNIQUE,                  -- COC-<order code>
    lab_order_id    uuid NOT NULL UNIQUE REFERENCES lab_order(id),
    site_id         uuid NOT NULL REFERENCES lab_site(id),
    manifest        jsonb NOT NULL DEFAULT '[]',           -- the samples and tests as submitted (what the client sent)
    made_at_migration boolean NOT NULL DEFAULT false,      -- orders submitted before 051 got theirs when 051 ran
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('custody_document', false);

CREATE FUNCTION custody_internal() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.custody_internal', true), '') = '1'
$$;
CREATE FUNCTION custody_document_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT (custody_internal() OR in_group_sync()) THEN
        RAISE EXCEPTION 'A chain of custody is made when its order is submitted, and changes only by receiving its samples';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON custody_document FOR EACH ROW EXECUTE FUNCTION custody_document_rules();

-- The manifest: each sample with its containers, quantity, preservation and requested tests
CREATE FUNCTION custody_manifest(p_order uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('sample_id', s.id, 'client_sample_id', s.client_sample_id, 'description', s.description,
             'matrix', s.matrix, 'lot', s.lot, 'containers', s.number_of_units, 'quantity', s.quantity_received, 'quantity_unit', s.quantity_unit,
             'preservation', s.preservation,
             'tests', (SELECT COALESCE(jsonb_agg(t.test_name ORDER BY t.test_name), '[]'::jsonb) FROM requested_test rt JOIN test t ON t.id = rt.test_id
                        WHERE rt.sample_id = s.id AND rt.status <> 'Cancelled'))
           ORDER BY s.created_at, s.client_sample_id), '[]'::jsonb)
      FROM sample s WHERE s.lab_order_id = p_order AND s.status <> 'Cancelled'
$$;

CREATE FUNCTION make_custody_document(p_order uuid, p_at_migration boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o lab_order; v uuid; v_was text := COALESCE(current_setting('lims.custody_internal', true), '');
BEGIN
    SELECT id INTO v FROM custody_document WHERE lab_order_id = p_order;
    IF v IS NOT NULL THEN RETURN v; END IF;
    SELECT * INTO o FROM lab_order WHERE id = p_order;
    PERFORM set_config('lims.custody_internal', '1', true);
    INSERT INTO custody_document (coc_code, lab_order_id, site_id, manifest, made_at_migration)
    VALUES ('COC-' || o.order_code, o.id, o.site_id, custody_manifest(o.id), p_at_migration) RETURNING id INTO v;
    PERFORM set_config('lims.custody_internal', v_was, true);
    RETURN v;
END $$;

-- made when the order is submitted (by the Submit button, or by logging, which submits a Draft first)
CREATE FUNCTION lab_order_custody() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status::text <> 'Draft' AND (TG_OP = 'INSERT' OR OLD.status::text = 'Draft') THEN PERFORM make_custody_document(NEW.id); END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER z_custody AFTER INSERT OR UPDATE OF status ON lab_order FOR EACH ROW EXECUTE FUNCTION lab_order_custody();

-- Custody events: never changed. 'Received': the receiver's signed receipt of some samples (their handwritten
-- signature placed in the Received area); 'Paper copy': the scan of the copy the client signed (Relinquished by).
CREATE TABLE custody_event (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    custody_document_id uuid NOT NULL REFERENCES custody_document(id),
    event_no            integer NOT NULL,
    kind                text NOT NULL CHECK (kind IN ('Received','Paper copy')),
    event_at            timestamptz NOT NULL,              -- when the samples arrived (Received) or the copy was attached
    sample_ids          uuid[],                            -- Received: the samples received
    delivered_by        text,                              -- courier, client in person ...
    tracking_no         text,
    temperature         numeric(6,2),
    temperature_unit    text NOT NULL DEFAULT '°C',
    condition           text,
    seals               text CHECK (seals IN ('Intact','Broken','None')),
    note                text,
    signature_id        uuid REFERENCES signature_event(id),
    signer_title        text,
    signature_image_id  uuid REFERENCES document_file(id),
    document_id         uuid REFERENCES document_file(id),  -- Received: the chain of custody as signed (PDF); Paper copy: the scan
    sha256              text,
    made_txid           bigint,                             -- the transaction that made it (its PDF is added only in that one)
    record_version      integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at         timestamptz NOT NULL DEFAULT now(),
    modified_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (custody_document_id, event_no)
);
CALL make_gxp('custody_event', false);
CREATE FUNCTION custody_event_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d custody_document;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- only the signed PDF is added, once, in the transaction that made the receipt, by its signer
        IF (to_jsonb(NEW) - '{document_id,sha256,record_version,modified_at,modified_by}'::text[]) <> (to_jsonb(OLD) - '{document_id,sha256,record_version,modified_at,modified_by}'::text[])
           OR OLD.document_id IS NOT NULL OR NOT custody_internal() THEN
            RAISE EXCEPTION 'A custody event is never changed';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO d FROM custody_document WHERE id = NEW.custody_document_id;
    IF NOT in_group_sync() THEN PERFORM require_permission_at('orders.edit', d.site_id); END IF;
    IF NEW.kind = 'Received' AND NOT custody_internal() THEN RAISE EXCEPTION 'Samples are received with "Receive and sign"'; END IF;
    IF NEW.kind = 'Paper copy' AND NEW.document_id IS NULL THEN RAISE EXCEPTION 'Attach the scan of the signed paper copy'; END IF;
    SELECT COALESCE(max(event_no), 0) + 1 INTO NEW.event_no FROM custody_event WHERE custody_document_id = NEW.custody_document_id;
    NEW.made_txid := txid_current();
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON custody_event FOR EACH ROW EXECUTE FUNCTION custody_event_rules();

-- Where the lab requires a signed receipt, samples are logged only through receive_samples
CREATE FUNCTION sample_custody_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.logged_at IS NOT NULL AND OLD.logged_at IS NULL AND NOT custody_internal() AND NOT in_group_sync()
       AND EXISTS (SELECT 1 FROM lab_order o JOIN lab_site si ON si.id = o.site_id WHERE o.id = NEW.lab_order_id AND si.custody_signature_required) THEN
        RAISE EXCEPTION 'This lab logs samples only when they are received and the chain of custody is signed ("Receive and sign")';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_custody BEFORE UPDATE OF logged_at ON sample FOR EACH ROW EXECUTE FUNCTION sample_custody_rule();

-- Receive samples: the receiver signs ("Received by"), with their handwritten signature and title on file; the samples
-- are logged (sample IDs, the clock starts) and the receipt is added to the order's chain of custody
CREATE FUNCTION receive_samples(p_order uuid, p_samples uuid[], p_received_at timestamptz, p_delivered_by text, p_tracking text,
    p_temperature numeric, p_condition text, p_seals text, p_note text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o lab_order; u app_user; v_doc uuid; v_ev uuid; v_n integer; v_bad text; v_at timestamptz := COALESCE(p_received_at, clock_timestamp());
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
    -- the receipt's details go on each sample that has none of its own
    UPDATE sample SET received_at = COALESCE(received_at, v_at), receipt_temperature = COALESCE(receipt_temperature, p_temperature),
           condition = COALESCE(condition, NULLIF(btrim(p_condition), ''))
     WHERE id = ANY(p_samples);
    v_doc := make_custody_document(p_order);
    PERFORM set_config('lims.custody_internal', '1', true);
    PERFORM log_samples(p_samples);
    INSERT INTO custody_event (custody_document_id, event_no, kind, event_at, sample_ids, delivered_by, tracking_no, temperature, condition, seals, note,
                               signature_id, signer_title, signature_image_id)
    VALUES (v_doc, 0, 'Received', v_at, p_samples, NULLIF(btrim(p_delivered_by), ''), NULLIF(btrim(p_tracking), ''), p_temperature,
            NULLIF(btrim(p_condition), ''), p_seals, NULLIF(btrim(p_note), ''), NULLIF(current_setting('lims.signature_id', true), '')::uuid, u.title, u.signature_document_id)
    RETURNING id INTO v_ev;
    PERFORM set_config('lims.custody_internal', '', true);
    RETURN v_ev;
END $$;

-- The chain of custody as signed (PDF), kept with the receipt: once, in the same transaction, by the signer
CREATE FUNCTION record_custody_pdf(p_event uuid, p_doc uuid, p_sha text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e custody_event; f document_file;
BEGIN
    SELECT * INTO e FROM custody_event WHERE id = p_event;
    IF e.id IS NULL OR e.kind <> 'Received' THEN RAISE EXCEPTION 'Receipt not found'; END IF;
    IF e.created_by <> current_app_user() OR e.made_txid IS DISTINCT FROM txid_current() OR e.document_id IS NOT NULL THEN RAISE EXCEPTION 'The signed chain of custody is kept only when the samples are received'; END IF;
    SELECT * INTO f FROM document_file WHERE id = p_doc;
    IF f.id IS NULL OR f.mime_type <> 'application/pdf' OR f.sha256 <> p_sha THEN RAISE EXCEPTION 'The chain of custody PDF does not match'; END IF;
    PERFORM set_config('lims.custody_internal', '1', true);
    UPDATE custody_event SET document_id = p_doc, sha256 = p_sha WHERE id = p_event;
    PERFORM set_config('lims.custody_internal', '', true);
END $$;

CREATE VIEW custody_event_view AS
SELECT e.*, d.coc_code, d.lab_order_id, u.full_name AS by_name,
       (SELECT string_agg(COALESCE(s.sample_code, s.client_sample_id), ', ' ORDER BY s.sample_code) FROM sample s WHERE s.id = ANY(e.sample_ids)) AS sample_codes,
       COALESCE(cardinality(e.sample_ids), 0) AS sample_count
  FROM custody_event e JOIN custody_document d ON d.id = e.custody_document_id JOIN app_user u ON u.id = e.created_by;

-------------------------------------------------------------------------------
-- 2. RECEIPT PHOTOS (4:3) AND THE PHOTOS ON THE REPORT
-------------------------------------------------------------------------------
CREATE TABLE sample_photo (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sample_id       uuid NOT NULL REFERENCES sample(id),
    document_id     uuid NOT NULL REFERENCES document_file(id),
    width_px        integer NOT NULL CHECK (width_px >= 400),
    height_px       integer NOT NULL CHECK (height_px >= 300),
    caption         text,
    taken_at        timestamptz NOT NULL DEFAULT now(),
    report_slot     smallint CHECK (report_slot IN (1, 2)),   -- the photo printed first or second on a photo report
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT sample_photo_4_3 CHECK (abs(width_px * 3 - height_px * 4) <= greatest(width_px, height_px) * 3 / 100)
);
CREATE INDEX sample_photo_sample_idx ON sample_photo (sample_id);
CREATE UNIQUE INDEX sample_photo_one_per_slot ON sample_photo (sample_id, report_slot) WHERE report_slot IS NOT NULL AND status = 'Active';
CALL make_gxp('sample_photo', false);
CREATE FUNCTION sample_photo_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid; f document_file;
BEGIN
    SELECT o.site_id INTO v_site FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = NEW.sample_id;
    IF NOT in_group_sync() THEN PERFORM require_permission_at('orders.edit', v_site); END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.sample_id <> OLD.sample_id OR NEW.document_id <> OLD.document_id OR NEW.width_px <> OLD.width_px OR NEW.height_px <> OLD.height_px
           OR NEW.taken_at <> OLD.taken_at THEN
            RAISE EXCEPTION 'A photo is never changed: retire it and add another (its caption and place on the report can change)';
        END IF;
        IF OLD.status <> 'Active' AND NEW.status = 'Active' THEN RAISE EXCEPTION 'A retired photo stays retired'; END IF;
    ELSE
        SELECT * INTO f FROM document_file WHERE id = NEW.document_id;
        IF f.mime_type NOT IN ('image/jpeg','image/png') THEN RAISE EXCEPTION 'A sample photo is a JPEG or PNG image'; END IF;
        IF NEW.taken_at > clock_timestamp() + interval '5 minutes' THEN RAISE EXCEPTION 'A photo cannot be taken in the future'; END IF;
    END IF;
    IF NEW.status <> 'Active' THEN NEW.report_slot := NULL; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON sample_photo FOR EACH ROW EXECUTE FUNCTION sample_photo_rules();

-- The photo report layouts (Alex): one photo, two photos; 4:3
ALTER TABLE report_template DROP CONSTRAINT report_template_layout_check;
ALTER TABLE report_template ADD CONSTRAINT report_template_layout_check CHECK (layout IN ('Standard COA','COA with 1 photo','COA with 2 photos'));
CREATE FUNCTION layout_photo_count(p_layout text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_layout WHEN 'COA with 1 photo' THEN 1 WHEN 'COA with 2 photos' THEN 2 ELSE 0 END
$$;
INSERT INTO report_template (template_name, description, layout, site_id, is_default, options) VALUES
 ('Certificate of Analysis with 1 photo', 'The standard COA with the sample''s photo (4:3) beside its details. The photo is the one marked "Report photo 1" at receipt.',
  'COA with 1 photo', NULL, false, '{"show_method": true, "show_test_version": true, "show_tested_dates": true, "show_loq": true, "title": "CERTIFICATE OF ANALYSIS"}'),
 ('Certificate of Analysis with 2 photos', 'The standard COA with two photos of the sample (4:3) side by side under its details: "Report photo 1" and "Report photo 2".',
  'COA with 2 photos', NULL, false, '{"show_method": true, "show_test_version": true, "show_tested_dates": true, "show_loq": true, "title": "CERTIFICATE OF ANALYSIS"}');

-- What a sample's report needs and has: the photos its tests' layouts need (for the release check)
CREATE FUNCTION sample_report_photos_missing(p_sample uuid) RETURNS text LANGUAGE sql STABLE AS $$
    WITH need AS (SELECT max(layout_photo_count(r.layout)) AS n FROM requested_test rt JOIN report_template r ON r.id = test_report_template(rt.id)
                   WHERE rt.sample_id = p_sample AND rt.status <> 'Cancelled'),
         have AS (SELECT array_agg(report_slot) AS slots FROM sample_photo WHERE sample_id = p_sample AND status = 'Active' AND report_slot IS NOT NULL)
    SELECT CASE WHEN COALESCE(n, 0) = 0 THEN NULL
                WHEN n = 1 AND NOT (1 = ANY(COALESCE(slots, '{}'))) THEN 'Its report layout needs a photo: mark one "Report photo 1" on the sample'
                WHEN n = 2 AND NOT (1 = ANY(COALESCE(slots, '{}')) AND 2 = ANY(COALESCE(slots, '{}'))) THEN 'Its report layout needs two photos: mark them "Report photo 1" and "Report photo 2" on the sample'
           END
      FROM need, have
$$;

-------------------------------------------------------------------------------
-- 3. ORDERS ALREADY SUBMITTED GET THEIR CHAIN OF CUSTODY NOW (no receipts: they were logged without one)
-------------------------------------------------------------------------------
DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT id FROM lab_order WHERE status::text <> 'Draft' ORDER BY created_at LOOP PERFORM make_custody_document(r.id, true); END LOOP;
END $$;

-------------------------------------------------------------------------------
-- 4. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_051;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'custody_document' THEN
        RETURN jsonb_build_object('label', 'Chain of custody ' || COALESCE(r->>'coc_code', ''), 'link', '#/orders/' || COALESCE(r->>'lab_order_id', ''));
    ELSIF p_table = 'custody_event' THEN
        RETURN jsonb_build_object('label', 'Chain of custody ' || COALESCE((SELECT coc_code FROM custody_document WHERE id = (r->>'custody_document_id')::uuid), '')
                                  || ': ' || COALESCE(r->>'kind', '') || ' ' || COALESCE(r->>'event_no', ''),
            'link', '#/orders/' || COALESCE((SELECT lab_order_id::text FROM custody_document WHERE id = (r->>'custody_document_id')::uuid), ''));
    ELSIF p_table = 'sample_photo' THEN
        RETURN jsonb_build_object('label', 'Photo of ' || COALESCE((SELECT COALESCE(sample_code, client_sample_id) FROM sample WHERE id = (r->>'sample_id')::uuid), 'a sample')
                                  || COALESCE(': ' || (r->>'caption'), ''), 'link', '#/samples/' || COALESCE(r->>'sample_id', ''));
    END IF;
    RETURN audit_record_ref_051(p_table, p_id, r);
END $$;

COMMIT;
