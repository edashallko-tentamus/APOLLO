-- Verification for migration 051 (0.29.0): the chain of custody and sample manifest (made on submission, receipts signed
-- with the receiver's handwritten signature, never changed, the signed PDF kept once in the receiving transaction, a
-- lab that requires signed receipts), receipt photos (4:3, one per report place, never changed, retired with a reason)
-- and the photo report layouts (what a sample's report needs).
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT set_config('lims.site_id', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'PASS: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (other error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN cond THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.cu_uid(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.cu_site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.cu_grp(site text, name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT g.id FROM lab_group g JOIN lab_site s ON s.id = g.site_id WHERE s.site_code = site AND g.group_name = name $$;
CREATE OR REPLACE FUNCTION pg_temp.cu_img(w int, h int) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ('p.jpg', 'image/jpeg', 0, '', decode('FFD8FFD9', 'hex')) RETURNING id $$;
CREATE OR REPLACE FUNCTION pg_temp.cu_order(po text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o uuid; c uuid; ct uuid; ln uuid; s uuid;
BEGIN
  SELECT id INTO c FROM client WHERE legal_name = 'PK Packaging Client LLC';   -- test_041's client (its accepted quote has PK Lead)
  SELECT cc.contact_id INTO ct FROM client_contact cc WHERE cc.client_id = c AND 'ORDERING' = ANY(cc.roles) AND cc.status = 'Active' LIMIT 1;
  SELECT ol.line_id INTO ln FROM orderable_lines(c) ol JOIN test t ON t.id = ol.test_id WHERE t.site_id = pg_temp.cu_site('CFL') LIMIT 1;
  INSERT INTO lab_order (client_id, site_id, ordering_contact_id, po_number) VALUES (c, pg_temp.cu_site('CFL'), ct, po) RETURNING id INTO o;
  FOR i IN 1..2 LOOP
    INSERT INTO sample (lab_order_id, client_sample_id, matrix, number_of_units) VALUES (o, po || '-' || i, 'Powder', 2) RETURNING id INTO s;
    PERFORM order_test(s, ln);
  END LOOP;
  RETURN o;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.cu_samples(o uuid) RETURNS uuid[] LANGUAGE sql AS $$ SELECT array_agg(id ORDER BY client_sample_id) FROM sample WHERE lab_order_id = o $$;

-- fixtures: an intake person with a handwritten signature and title, one without, and an Executive (view only)
INSERT INTO app_user (username, full_name) VALUES ('cu.in', 'CU Intake'), ('cu.nosig', 'CU No Signature'), ('cu.exec', 'CU Executive');
SELECT pg_temp.as_user('akiddle');
INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.cu_grp('CFL', 'Intake'), pg_temp.cu_uid('cu.in')), (pg_temp.cu_grp('CFL', 'Intake'), pg_temp.cu_uid('cu.nosig'));
INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.cu_uid('cu.exec') FROM lab_group g WHERE g.site_id IS NULL AND g.group_name LIKE 'Executive%';
DO $$ DECLARE d uuid; BEGIN
  PERFORM set_config('lims.group_sync', '1', true);
  INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ('sig.png', 'image/png', 4, '', decode('89504E47', 'hex')) RETURNING id INTO d;
  UPDATE app_user SET signature_document_id = d, title = 'Sample Receiving' WHERE username = 'cu.in';
  PERFORM set_config('lims.group_sync', '', true);
END $$;
SELECT set_config('lims.site_id', (SELECT id::text FROM lab_site WHERE site_code = 'CFL'), false);

-------------------------------------------------------------------------------
-- 1. THE CHAIN OF CUSTODY IS MADE ON SUBMISSION
-------------------------------------------------------------------------------
SELECT pg_temp.as_user('cu.in');
CREATE TEMP TABLE cu_o AS SELECT pg_temp.cu_order('CU-ONE') AS id;
SELECT pg_temp.expect_true('A Draft order has no chain of custody',
  NOT EXISTS (SELECT 1 FROM custody_document WHERE lab_order_id = (SELECT id FROM cu_o)));
UPDATE lab_order SET status = 'Submitted' WHERE id = (SELECT id FROM cu_o);
SELECT pg_temp.expect_true('Submitting makes it: COC-<order code>, with the manifest as submitted (2 samples, their tests)',
  (SELECT coc_code = 'COC-' || (SELECT order_code FROM lab_order WHERE id = (SELECT id FROM cu_o)) AND jsonb_array_length(manifest) = 2
     AND jsonb_array_length(manifest->0->'tests') = 1 AND (manifest->0->>'containers')::int = 2
   FROM custody_document WHERE lab_order_id = (SELECT id FROM cu_o)));
SELECT pg_temp.expect_error_like('Nobody makes or changes a chain of custody directly',
  $$UPDATE custody_document SET manifest = '[]' WHERE lab_order_id = (SELECT id FROM cu_o)$$, 'made when its order is submitted');
SELECT pg_temp.expect_error_like('A receipt is never typed in: samples are received with "Receive and sign"',
  $$INSERT INTO custody_event (custody_document_id, event_no, kind, event_at) SELECT id, 0, 'Received', now() FROM custody_document WHERE lab_order_id = (SELECT id FROM cu_o)$$, 'Receive and sign');

-------------------------------------------------------------------------------
-- 2. RECEIVING: SIGNED, WITH THE RECEIVER'S HANDWRITTEN SIGNATURE
-------------------------------------------------------------------------------
SELECT set_config('lims.signature_id', '', false);
SELECT pg_temp.expect_error_like('Receiving needs an electronic signature',
  $$SELECT receive_samples((SELECT id FROM cu_o), ARRAY[(pg_temp.cu_samples((SELECT id FROM cu_o)))[1]], now(), 'FedEx', NULL, 4, 'Acceptable', 'Intact', NULL)$$, 'signature');
SELECT pg_temp.as_user('cu.nosig');
SELECT pg_temp.expect_error_like('Receiving needs the receiver''s handwritten signature and title on file',
  $$SELECT receive_samples((SELECT id FROM cu_o), ARRAY[(pg_temp.cu_samples((SELECT id FROM cu_o)))[1]], now(), 'FedEx', NULL, 4, 'Acceptable', 'Intact', NULL)$$, 'handwritten signature');
SELECT pg_temp.as_user('cu.in');
SELECT pg_temp.expect_error_like('The time received cannot be in the future',
  $$SELECT receive_samples((SELECT id FROM cu_o), ARRAY[(pg_temp.cu_samples((SELECT id FROM cu_o)))[1]], now() + interval '2 hours', 'FedEx', NULL, 4, 'Acceptable', 'Intact', NULL)$$, 'future');
SELECT pg_temp.expect_error_like('Custody seals are Intact, Broken or None',
  $$SELECT receive_samples((SELECT id FROM cu_o), ARRAY[(pg_temp.cu_samples((SELECT id FROM cu_o)))[1]], now(), 'FedEx', NULL, 4, 'Acceptable', 'Taped', NULL)$$, 'Intact, Broken or None');
SELECT pg_temp.expect_error_like('Only the order''s own samples are received',
  $$SELECT receive_samples((SELECT id FROM cu_o), ARRAY(SELECT id FROM sample WHERE lab_order_id <> (SELECT id FROM cu_o) AND status = 'Expected' LIMIT 1), now(), NULL, NULL, NULL, NULL, NULL, NULL)$$, 'still expected');
CREATE TEMP TABLE cu_ev AS SELECT receive_samples((SELECT id FROM cu_o), ARRAY[(pg_temp.cu_samples((SELECT id FROM cu_o)))[1]], now() - interval '1 hour', 'FedEx', '7712', 4.2, 'Acceptable', 'Intact', 'Ice packs') AS id;
SELECT pg_temp.expect_true('The receipt logs the sample (sample ID, Logged), puts its time, temperature and condition on it',
  (SELECT status = 'Logged' AND sample_code IS NOT NULL AND receipt_temperature = 4.2 AND condition = 'Acceptable' AND received_at < now() - interval '50 minutes'
   FROM sample WHERE id = (pg_temp.cu_samples((SELECT id FROM cu_o)))[1]));
SELECT pg_temp.expect_true('The receipt is receipt 1, signed "Received by", with the receiver''s handwritten signature and title',
  (SELECT e.event_no = 1 AND e.kind = 'Received' AND e.signature_id IS NOT NULL AND e.signer_title = 'Sample Receiving'
     AND e.signature_image_id = (SELECT signature_document_id FROM app_user WHERE username = 'cu.in') AND e.created_by = pg_temp.cu_uid('cu.in')
     AND e.seals = 'Intact' AND e.delivered_by = 'FedEx'
   FROM custody_event e WHERE e.id = (SELECT id FROM cu_ev)));
SELECT pg_temp.expect_true('The other sample is still expected and the order Submitted',
  (SELECT status = 'Expected' FROM sample WHERE id = (pg_temp.cu_samples((SELECT id FROM cu_o)))[2])
  AND (SELECT status::text = 'Submitted' FROM lab_order WHERE id = (SELECT id FROM cu_o)));
SELECT pg_temp.expect_error_like('A sample already received is not received again',
  $$SELECT receive_samples((SELECT id FROM cu_o), ARRAY[(pg_temp.cu_samples((SELECT id FROM cu_o)))[1]], now(), NULL, NULL, NULL, NULL, NULL, NULL)$$, 'still expected');
-- the signed PDF is kept once, only in the receiving transaction (this test file runs in one transaction: a later
-- transaction is simulated by the event's recorded transaction)
DO $$ DECLARE d uuid; BEGIN
  INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ('coc.pdf', 'application/pdf', 4, 'abc', decode('25504446', 'hex')) RETURNING id INTO d;
  PERFORM record_custody_pdf((SELECT id FROM cu_ev), d, (SELECT sha256 FROM document_file WHERE id = d));
END $$;
SELECT pg_temp.expect_true('The chain of custody as signed (PDF) is kept with the receipt',
  (SELECT e.document_id IS NOT NULL AND e.sha256 = f.sha256 FROM custody_event e JOIN document_file f ON f.id = e.document_id WHERE e.id = (SELECT id FROM cu_ev)));
SELECT pg_temp.expect_error_like('and only once',
  $$SELECT record_custody_pdf((SELECT id FROM cu_ev), (SELECT document_id FROM custody_event WHERE id = (SELECT id FROM cu_ev)), (SELECT sha256 FROM custody_event WHERE id = (SELECT id FROM cu_ev)))$$, 'kept only when the samples are received');
SELECT pg_temp.expect_error_like('A receipt is never changed',
  $$UPDATE custody_event SET temperature = 2 WHERE id = (SELECT id FROM cu_ev)$$, 'never changed');
SELECT pg_temp.expect_error_like('nor deleted',
  $$DELETE FROM custody_event WHERE id = (SELECT id FROM cu_ev)$$, '');
SELECT pg_temp.as_user('cu.nosig');
SELECT pg_temp.expect_error_like('Its PDF is added only by the person who received',
  $$SELECT record_custody_pdf((SELECT id FROM cu_ev), (SELECT document_id FROM custody_event WHERE id = (SELECT id FROM cu_ev)), (SELECT sha256 FROM custody_event WHERE id = (SELECT id FROM cu_ev)))$$, 'kept only when');
SELECT pg_temp.as_user('cu.in');
SELECT receive_samples((SELECT id FROM cu_o), ARRAY[(pg_temp.cu_samples((SELECT id FROM cu_o)))[2]], now(), 'Client in person', NULL, NULL, NULL, 'None', NULL);
SELECT pg_temp.expect_true('A second delivery is receipt 2; once every sample is received the order is Received',
  (SELECT max(event_no) = 2 FROM custody_event e JOIN custody_document d ON d.id = e.custody_document_id WHERE d.lab_order_id = (SELECT id FROM cu_o))
  AND (SELECT status::text = 'Received' FROM lab_order WHERE id = (SELECT id FROM cu_o)));
SELECT pg_temp.expect_true('The view lists the receipts with their samples',
  (SELECT count(*) = 2 AND bool_and(sample_count = 1 AND sample_codes LIKE 'CFL%') FROM custody_event_view WHERE lab_order_id = (SELECT id FROM cu_o)));
-- the paper copy (Relinquished by), a scan
SELECT pg_temp.expect_error_like('A paper copy needs its scan',
  $$INSERT INTO custody_event (custody_document_id, event_no, kind, event_at) SELECT id, 0, 'Paper copy', now() FROM custody_document WHERE lab_order_id = (SELECT id FROM cu_o)$$, 'scan');
INSERT INTO custody_event (custody_document_id, event_no, kind, event_at, document_id)
  SELECT id, 0, 'Paper copy', now(), (SELECT document_id FROM custody_event WHERE id = (SELECT id FROM cu_ev)) FROM custody_document WHERE lab_order_id = (SELECT id FROM cu_o);
SELECT pg_temp.expect_true('The scan of the signed paper copy is event 3',
  (SELECT kind = 'Paper copy' FROM custody_event e JOIN custody_document d ON d.id = e.custody_document_id WHERE d.lab_order_id = (SELECT id FROM cu_o) AND e.event_no = 3));
SELECT pg_temp.as_user('cu.exec');
SELECT pg_temp.expect_error('The Executive (view only) cannot attach to a chain of custody',
  $$INSERT INTO custody_event (custody_document_id, event_no, kind, event_at, document_id)
    SELECT id, 0, 'Paper copy', now(), (SELECT document_id FROM custody_event WHERE id = (SELECT id FROM cu_ev)) FROM custody_document WHERE lab_order_id = (SELECT id FROM cu_o)$$);

-------------------------------------------------------------------------------
-- 3. A LAB THAT REQUIRES SIGNED RECEIPTS
-------------------------------------------------------------------------------
SELECT pg_temp.as_user('cu.in');
CREATE TEMP TABLE cu_o2 AS SELECT pg_temp.cu_order('CU-TWO') AS id;
SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', 'Rule test', false);
UPDATE lab_site SET custody_signature_required = true WHERE site_code = 'CFL';
SELECT pg_temp.as_user('cu.in');
SELECT pg_temp.expect_error_like('Where the lab requires it, samples are logged only by receiving them (signed)',
  $$SELECT log_samples(pg_temp.cu_samples((SELECT id FROM cu_o2)))$$, 'only when they are received');
SELECT receive_samples((SELECT id FROM cu_o2), pg_temp.cu_samples((SELECT id FROM cu_o2)), now(), NULL, NULL, NULL, NULL, NULL, NULL);
SELECT pg_temp.expect_true('Receiving a Draft order''s samples submits it and makes its chain of custody',
  EXISTS (SELECT 1 FROM custody_document WHERE lab_order_id = (SELECT id FROM cu_o2))
  AND (SELECT status::text = 'Received' FROM lab_order WHERE id = (SELECT id FROM cu_o2)));
SELECT pg_temp.as_user('akiddle');
UPDATE lab_site SET custody_signature_required = false WHERE site_code = 'CFL';
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.as_user('cu.in');

-------------------------------------------------------------------------------
-- 4. RECEIPT PHOTOS (4:3) AND THE PHOTO REPORT LAYOUTS
-------------------------------------------------------------------------------
CREATE TEMP TABLE cu_s AS SELECT (pg_temp.cu_samples((SELECT id FROM cu_o)))[1] AS id;
SELECT pg_temp.expect_error_like('A photo is 4:3', $$INSERT INTO sample_photo (sample_id, document_id, width_px, height_px) VALUES ((SELECT id FROM cu_s), pg_temp.cu_img(1000, 400), 1000, 400)$$, 'sample_photo_4_3');
SELECT pg_temp.expect_error_like('and at least 400 x 300', $$INSERT INTO sample_photo (sample_id, document_id, width_px, height_px) VALUES ((SELECT id FROM cu_s), pg_temp.cu_img(200, 150), 200, 150)$$, 'px_check');
SELECT pg_temp.expect_error_like('A photo is a JPEG or PNG image', $$INSERT INTO sample_photo (sample_id, document_id, width_px, height_px)
  VALUES ((SELECT id FROM cu_s), (SELECT document_id FROM custody_event WHERE id = (SELECT id FROM cu_ev)), 1200, 900)$$, 'JPEG or PNG');
INSERT INTO sample_photo (sample_id, document_id, width_px, height_px, caption, report_slot) VALUES ((SELECT id FROM cu_s), pg_temp.cu_img(1200, 900), 1200, 900, 'Tub', 1);
INSERT INTO sample_photo (sample_id, document_id, width_px, height_px, caption) VALUES ((SELECT id FROM cu_s), pg_temp.cu_img(1600, 1200), 1600, 1200, 'Label');
SELECT pg_temp.expect_true('Photos 1200 x 900 and 1600 x 1200 are 4:3', (SELECT count(*) = 2 FROM sample_photo WHERE sample_id = (SELECT id FROM cu_s)));
SELECT pg_temp.expect_error('Only one photo is Report photo 1',
  $$UPDATE sample_photo SET report_slot = 1 WHERE sample_id = (SELECT id FROM cu_s) AND caption = 'Label'$$);
UPDATE sample_photo SET report_slot = 2 WHERE sample_id = (SELECT id FROM cu_s) AND caption = 'Label';
SELECT pg_temp.expect_error_like('A photo itself is never changed', $$UPDATE sample_photo SET width_px = 800, height_px = 600 WHERE sample_id = (SELECT id FROM cu_s) AND caption = 'Label'$$, 'never changed');
UPDATE sample_photo SET status = 'Inactive' WHERE sample_id = (SELECT id FROM cu_s) AND caption = 'Label';
SELECT pg_temp.expect_true('A retired photo leaves the report',
  (SELECT report_slot IS NULL FROM sample_photo WHERE sample_id = (SELECT id FROM cu_s) AND caption = 'Label'));
SELECT pg_temp.expect_error_like('and stays retired', $$UPDATE sample_photo SET status = 'Active' WHERE sample_id = (SELECT id FROM cu_s) AND caption = 'Label'$$, 'stays retired');
SELECT pg_temp.as_user('cu.exec');
SELECT pg_temp.expect_error('The Executive (view only) cannot add photos',
  $$INSERT INTO sample_photo (sample_id, document_id, width_px, height_px) VALUES ((SELECT id FROM cu_s), pg_temp.cu_img(1200, 900), 1200, 900)$$);
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.expect_true('Every lab has the layouts "COA with 1 photo" and "COA with 2 photos"; the layouts say how many photos they print',
  (SELECT count(*) = 2 FROM report_template WHERE site_id IS NULL AND layout IN ('COA with 1 photo','COA with 2 photos') AND status = 'Active')
  AND layout_photo_count('Standard COA') = 0 AND layout_photo_count('COA with 1 photo') = 1 AND layout_photo_count('COA with 2 photos') = 2);
SELECT pg_temp.expect_true('A sample on the standard layout needs no photo', sample_report_photos_missing((SELECT id FROM cu_s)) IS NULL);
-- the lab's default made a two-photo layout (inside this test's transaction)
SELECT set_config('lims.reason', 'Rule test', false);
UPDATE report_template SET is_default = false WHERE site_id IS NULL AND is_default;
UPDATE report_template SET is_default = true WHERE site_id IS NULL AND layout = 'COA with 2 photos';
SELECT pg_temp.expect_true('On a two-photo layout the sample needs Report photo 2 as well', sample_report_photos_missing((SELECT id FROM cu_s)) LIKE '%two photos%');
UPDATE report_template SET is_default = false WHERE site_id IS NULL AND layout = 'COA with 2 photos';
UPDATE report_template SET is_default = true WHERE template_code = 'RT-001';
SELECT pg_temp.expect_error_like('A template''s layout is one the server can draw',
  $$UPDATE report_template SET layout = 'COA with 3 photos' WHERE template_code = 'RT-001'$$, 'layout_check');
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_true('The audit trail names the chain of custody, its receipts and the photos, with links to the order and sample',
  EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'custody_event' AND (audit_record_ref(table_name, record_id, new_row)->>'label') LIKE 'Chain of custody COC-%Received 1')
  AND EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'sample_photo' AND (audit_record_ref(table_name, record_id, new_row)->>'link') LIKE '#/samples/%'));
SELECT set_config('lims.site_id', '', false);
SELECT pg_temp.as_user('akiddle');

SELECT test, outcome AS result FROM results;
