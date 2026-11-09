-- Verification for migration 050 (V-1): vendor approvals, local and corporate. Corporate QA (an all-labs group) approves
-- for every lab; a lab's QA for its own lab; a lab can be stricter, never looser; supply scopes on approvals and on
-- requests; proposing a local approval for corporate approval (documents, a shared class, never decided by its
-- proposer); notices to the labs; the shared risk classes and scopes kept by Corporate QA; QA approves vendors only.
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
CREATE OR REPLACE FUNCTION pg_temp.va_site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.va_grp(site text, name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT g.id FROM lab_group g JOIN lab_site s ON s.id = g.site_id WHERE s.site_code = site AND g.group_name = name $$;
CREATE OR REPLACE FUNCTION pg_temp.va_uid(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.va_sup(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM supplier WHERE supplier_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.va_cls(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM supplier_risk_class WHERE class_name = n ORDER BY site_id NULLS FIRST LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.va_sc(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM supply_scope WHERE scope_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.va_can(u text, code text, site text) RETURNS boolean LANGUAGE sql AS $$ SELECT user_has_permission_at(pg_temp.va_uid(u), code, pg_temp.va_site(site)) $$;
CREATE OR REPLACE FUNCTION pg_temp.va_st(sup text, site text) RETURNS text LANGUAGE sql AS $$ SELECT supplier_status_at(pg_temp.va_sup(sup), pg_temp.va_site(site)) $$;
CREATE OR REPLACE FUNCTION pg_temp.va_doc() RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ('evidence.pdf', 'application/pdf', 0, '', decode('JVBERi0xLjQK', 'base64')) RETURNING id $$;
CREATE OR REPLACE FUNCTION pg_temp.va_vq(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM vendor_qualification WHERE qualification_code = code $$;

INSERT INTO app_user (username, full_name) VALUES ('va.qa', 'VA CFL QA'), ('va.tpsqa', 'VA TPS QA'), ('va.corp1', 'VA Corporate One'), ('va.corp2', 'VA Corporate Two'),
 ('va.ana', 'VA Analyst'), ('va.sup', 'VA Supervisor'), ('va.acc', 'VA Accounting');
SELECT pg_temp.as_user('akiddle');
INSERT INTO group_member (group_id, user_id) VALUES
 (pg_temp.va_grp('CFL', 'QA'), pg_temp.va_uid('va.qa')), (pg_temp.va_grp('TPS', 'QA'), pg_temp.va_uid('va.tpsqa')),
 (pg_temp.va_grp('CFL', 'Analyst'), pg_temp.va_uid('va.ana')), (pg_temp.va_grp('TPS', 'Analyst'), pg_temp.va_uid('va.ana')),
 (pg_temp.va_grp('CFL', 'Lab Supervisor'), pg_temp.va_uid('va.sup')), (pg_temp.va_grp('CFL', 'Accounting'), pg_temp.va_uid('va.acc')),
 (pg_temp.va_grp('CFL', 'QA'), pg_temp.va_uid('va.corp2'));   -- va.corp2 is also in CFL's QA group (to test that a proposer never decides)
INSERT INTO group_member (group_id, user_id) SELECT g.id, u.id FROM lab_group g, app_user u
 WHERE g.site_id IS NULL AND g.group_name = 'Corporate QA (all labs)' AND u.username IN ('va.corp1', 'va.corp2');
INSERT INTO supplier (supplier_name, supplier_type) VALUES ('VA Standards Co', 'Supplier'), ('VA Calibration Svc', 'Supplier'), ('VA Media Labs', 'Supplier'), ('VA Glassware', 'Supplier');

-------------------------------------------------------------------------------
-- 1. WHO MAY DO WHAT
-------------------------------------------------------------------------------
SELECT pg_temp.expect_true('Corporate QA holds corporate approval at every lab; it approves no purchase requests and no lab''s QA is corporate',
  pg_temp.va_can('va.corp1', 'purchasing.qualify_corporate', 'CFL') AND pg_temp.va_can('va.corp1', 'purchasing.qualify_corporate', 'TPS')
  AND NOT pg_temp.va_can('va.corp1', 'purchasing.approve', 'CFL') AND NOT pg_temp.va_can('va.qa', 'purchasing.qualify_corporate', 'CFL'));
SELECT pg_temp.expect_true('QA approves vendors, not purchase requests (Lab Supervisors approve requests, not vendors)',
  pg_temp.va_can('va.qa', 'purchasing.qualify', 'CFL') AND NOT pg_temp.va_can('va.qa', 'purchasing.approve', 'CFL')
  AND pg_temp.va_can('va.sup', 'purchasing.approve', 'CFL') AND NOT pg_temp.va_can('va.sup', 'purchasing.qualify', 'CFL'));
SELECT pg_temp.expect_error_like('Corporate approval cannot be given to one lab''s group',
  $$INSERT INTO group_permission (group_id, permission_code) VALUES (pg_temp.va_grp('CFL', 'QA'), 'purchasing.qualify_corporate')$$, 'all-labs Corporate QA');

-------------------------------------------------------------------------------
-- 2. SUPPLY SCOPES AND RISK CLASSES (Corporate QA keeps the shared ones)
-------------------------------------------------------------------------------
SELECT pg_temp.expect_true('Eleven supply scopes; equipment, services and other purchases each have a default',
  (SELECT count(*) FROM supply_scope WHERE status = 'Active') = 11
  AND (SELECT count(*) FROM supply_scope WHERE default_for IS NOT NULL) = 3);
SELECT pg_temp.as_user('va.qa');
SELECT pg_temp.expect_error_like('A lab''s QA does not change the supply scopes', $$INSERT INTO supply_scope (scope_name, line_types) VALUES ('Water', '{Other}')$$, 'Corporate QA');
SELECT pg_temp.expect_error_like('A lab''s QA does not change the shared risk classes', $$INSERT INTO supplier_risk_class (class_name, requal_months) VALUES ('Class Z', 6)$$, 'Corporate QA');
SELECT pg_temp.as_user('va.corp1');
INSERT INTO supply_scope (scope_name, description, line_types, sort_order) VALUES ('Waste disposal', 'Hazardous waste collection', '{Service}', 12);
INSERT INTO supplier_risk_class (class_name, requal_months, description, sort_order) VALUES ('Class 0 (critical)', 6, 'Critical single-source vendors', 0);
SELECT pg_temp.expect_true('Corporate QA adds a supply scope and a shared risk class of its own (6 months)',
  pg_temp.va_sc('Waste disposal') IS NOT NULL AND (SELECT site_id IS NULL AND requal_months = 6 FROM supplier_risk_class WHERE class_name = 'Class 0 (critical)'));
-- Moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.supplyScopes): an item type belongs to one scope

-------------------------------------------------------------------------------
-- 3. LOCAL APPROVALS WITH SCOPES, AND REQUESTS CHECKED AGAINST THEM
-------------------------------------------------------------------------------
SELECT pg_temp.as_user('va.qa');
SELECT set_config('lims.site_id', pg_temp.va_site('CFL')::text, false);
SELECT pg_temp.expect_error_like('A lab''s QA approves for its own lab only', $$INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, approval_date, scope_ids)
  VALUES (pg_temp.va_sup('VA Calibration Svc'), NULL, pg_temp.va_cls('Class II'), 'Approved', current_date, ARRAY[pg_temp.va_sc('Calibration services')])$$, 'Corporate QA');
INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, approval_date, scope_ids, accreditations)
VALUES (pg_temp.va_sup('VA Calibration Svc'), pg_temp.va_site('CFL'), pg_temp.va_cls('Class II'), 'Approved', current_date, ARRAY[pg_temp.va_sc('Calibration services')], 'ISO 17025'),
       (pg_temp.va_sup('VA Standards Co'), pg_temp.va_site('CFL'), pg_temp.va_cls('Class III'), 'Approved', current_date, ARRAY[pg_temp.va_sc('Reference standards'), pg_temp.va_sc('Reagents and solvents')], 'ISO 17034');
SELECT pg_temp.expect_true('Approved at CFL only (not at TPS); the record keeps its scopes',
  pg_temp.va_st('VA Calibration Svc', 'CFL') = 'Approved' AND pg_temp.va_st('VA Calibration Svc', 'TPS') = 'Not qualified'
  AND scope_names((SELECT scope_ids FROM vendor_qualification WHERE supplier_id = pg_temp.va_sup('VA Calibration Svc'))) = 'Calibration services');
-- Moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.vendorApprovals): an approval names active scopes

SELECT pg_temp.as_user('va.ana');
INSERT INTO purchase_line (site_id, line_type, description, supplier_id, quantity, unit_price, scope_ids)
VALUES (pg_temp.va_site('CFL'), 'Service', 'VA balance calibration', pg_temp.va_sup('VA Calibration Svc'), 1, 300, ARRAY[pg_temp.va_sc('Calibration services')]);
SELECT pg_temp.expect_true('A calibration request to a vendor approved for calibration is accepted, with its scope',
  (SELECT scope_names(scope_ids) FROM purchase_line WHERE description = 'VA balance calibration') = 'Calibration services');
SELECT pg_temp.expect_error_like('A service request with no scope chosen is "Other services", which the vendor is not approved for',
  $$INSERT INTO purchase_line (site_id, line_type, description, supplier_id, quantity) VALUES (pg_temp.va_site('CFL'), 'Service', 'VA consulting', pg_temp.va_sup('VA Calibration Svc'), 1)$$, 'not approved for other services');
SELECT pg_temp.expect_error_like('A request cannot name a scope that does not fit its kind',
  $$INSERT INTO purchase_line (site_id, line_type, description, supplier_id, quantity, scope_ids) VALUES (pg_temp.va_site('CFL'), 'Service', 'VA odd', pg_temp.va_sup('VA Calibration Svc'), 1, ARRAY[pg_temp.va_sc('Reference standards')])$$, 'cannot be for Reference standards');
SELECT pg_temp.expect_error_like('A reagent from a vendor approved only for calibration is refused, naming the scope',
  $$INSERT INTO inventory_lot (site_id, item_name, physical_form, chemical_types, supplier_id, receipt_status, requested_quantity, unit) VALUES (pg_temp.va_site('CFL'), 'VA Nitric acid', 'Liquid', '{Reagent}', pg_temp.va_sup('VA Calibration Svc'), 'Requested', 1, 'L')$$, 'not approved for reagents and solvents');
INSERT INTO inventory_lot (site_id, item_name, physical_form, chemical_types, supplier_id, receipt_status, requested_quantity, unit)
VALUES (pg_temp.va_site('CFL'), 'VA Nitric acid', 'Liquid', '{Reagent}', pg_temp.va_sup('VA Standards Co'), 'Requested', 1, 'L');
SELECT pg_temp.expect_true('A reagent request takes its scope from the item type',
  (SELECT scope_names(l.scope_ids) FROM purchase_line l JOIN inventory_lot i ON i.purchase_line_id = l.id WHERE i.item_name = 'VA Nitric acid') = 'Reagents and solvents');

-------------------------------------------------------------------------------
-- 4. CORPORATE APPROVALS, AND A LAB STRICTER BUT NEVER LOOSER
-------------------------------------------------------------------------------
SELECT pg_temp.as_user('va.corp1');
INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, approval_date, scope_ids, justification)
VALUES (pg_temp.va_sup('VA Glassware'), NULL, pg_temp.va_cls('Class I'), 'Approved', current_date, ARRAY[pg_temp.va_sc('Consumables'), pg_temp.va_sc('Other purchases')], 'Corporate supplier agreement');
SELECT pg_temp.expect_true('Corporate approval: every lab may use the vendor, decided at corporate level',
  pg_temp.va_st('VA Glassware', 'CFL') = 'Approved' AND pg_temp.va_st('VA Glassware', 'TPS') = 'Approved'
  AND (SELECT decided_at FROM vendor_decision(pg_temp.va_sup('VA Glassware'), pg_temp.va_site('TPS'))) = 'Corporate');
-- Moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.vendorApprovals): a corporate approval uses a shared risk class, not a lab's
SELECT pg_temp.as_user('va.tpsqa');
SELECT set_config('lims.site_id', pg_temp.va_site('TPS')::text, false);
INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, approval_date, justification)
VALUES (pg_temp.va_sup('VA Glassware'), pg_temp.va_site('TPS'), pg_temp.va_cls('Class I'), 'Suspended', current_date, 'Broken deliveries at TPS');
SELECT pg_temp.expect_true('A lab can be stricter: TPS suspends locally; CFL keeps the corporate approval',
  pg_temp.va_st('VA Glassware', 'TPS') = 'Suspended' AND pg_temp.va_st('VA Glassware', 'CFL') = 'Approved');
SELECT pg_temp.as_user('va.ana');
INSERT INTO purchase_line (site_id, line_type, description, supplier_id, quantity) VALUES (pg_temp.va_site('CFL'), 'Other', 'VA beakers', pg_temp.va_sup('VA Glassware'), 10);
INSERT INTO purchase_line (site_id, line_type, description, supplier_id, quantity) VALUES (pg_temp.va_site('CFL'), 'Other', 'VA flasks', pg_temp.va_sup('VA Glassware'), 10);
SELECT pg_temp.as_user('va.corp2');
INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, approval_date, justification)
VALUES (pg_temp.va_sup('VA Glassware'), NULL, pg_temp.va_cls('Class I'), 'Suspended', current_date, 'Recall of a glassware lot');
SELECT pg_temp.expect_true('Corporate suspension blocks every lab (whatever the labs decided)',
  pg_temp.va_st('VA Glassware', 'CFL') = 'Suspended' AND (SELECT decided_at FROM vendor_decision(pg_temp.va_sup('VA Glassware'), pg_temp.va_site('CFL'))) = 'Corporate');
-- Moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.noticesAndDocuments): every lab gets a notice; CFL's says its 2 open requests are stopped
SELECT pg_temp.as_user('va.sup');
SELECT pg_temp.expect_error_like('A stopped request cannot be approved, and says Corporate QA stopped it',
  $$SELECT approve_purchase_lines(ARRAY[(SELECT id FROM purchase_line WHERE description = 'VA beakers')])$$, 'by Corporate QA for every lab');
SELECT pg_temp.as_user('va.qa');
SELECT set_config('lims.site_id', pg_temp.va_site('CFL')::text, false);
-- Moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.vendorApprovals): never looser, a lab cannot approve a vendor Corporate QA suspended
-- Moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.noticesAndDocuments): notices are acknowledged once, by the lab's QA (who and when recorded)

-------------------------------------------------------------------------------
-- 5. PROPOSING A LOCAL APPROVAL FOR CORPORATE APPROVAL
-------------------------------------------------------------------------------
INSERT INTO vendor_document (qualification_id, document_id, doc_kind, title, certificate_expires)
VALUES ((SELECT id FROM vendor_qualification WHERE supplier_id = pg_temp.va_sup('VA Standards Co')), pg_temp.va_doc(), 'Certificate', 'ISO 17034 certificate', current_date + 300);
-- Moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.proposals): a proposal needs a document, a shared risk class, no more than the lab approved, one open per vendor;
-- it is changed only through its steps; Corporate QA (never the proposer) decides, a rejection says why, an approval covers at most what the lab
-- approved and carries the documents; withdrawing needs a reason; the lab is told. The corporate approval it makes is recorded directly here.
SELECT pg_temp.as_user('va.corp1');
INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, approval_date, scope_ids, justification)
VALUES (pg_temp.va_sup('VA Standards Co'), NULL, pg_temp.va_cls('Class III'), 'Approved', current_date, ARRAY[pg_temp.va_sc('Reference standards')], 'Corporate approval (rule test)');
SELECT pg_temp.expect_true('TPS may now order reference standards from it, but not reagents (CFL''s alone)',
  (SELECT status FROM vendor_decision(pg_temp.va_sup('VA Standards Co'), pg_temp.va_site('TPS'), ARRAY[pg_temp.va_sc('Reference standards')])) = 'Approved'
  AND (SELECT status FROM vendor_decision(pg_temp.va_sup('VA Standards Co'), pg_temp.va_site('TPS'), ARRAY[pg_temp.va_sc('Reagents and solvents')])) = 'Not approved for this'
  AND (SELECT status FROM vendor_decision(pg_temp.va_sup('VA Standards Co'), pg_temp.va_site('CFL'), ARRAY[pg_temp.va_sc('Reagents and solvents')])) = 'Approved');
SELECT pg_temp.as_user('va.qa');
SELECT set_config('lims.site_id', pg_temp.va_site('CFL')::text, false);
INSERT INTO vendor_document (qualification_id, document_id, doc_kind, title)
VALUES ((SELECT id FROM vendor_qualification WHERE supplier_id = pg_temp.va_sup('VA Calibration Svc')), pg_temp.va_doc(), 'Questionnaire', 'Supplier questionnaire 2026');

-------------------------------------------------------------------------------
-- 6. DOCUMENTS, VIEWS, AUDIT
-------------------------------------------------------------------------------
SELECT pg_temp.as_user('va.qa');
-- Moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.noticesAndDocuments): a vendor document is never edited (Java only withdraws it)
SELECT pg_temp.expect_error_like('A lab''s QA cannot add documents to a corporate approval',
  $$INSERT INTO vendor_document (qualification_id, document_id, doc_kind) VALUES ((vendor_corporate(pg_temp.va_sup('VA Standards Co'))).id, pg_temp.va_doc(), 'Other')$$, 'Corporate QA');
SELECT pg_temp.expect_true('The vendor approvals page row: CFL decides locally, the corporate record beside it, its next certificate expiry',
  (SELECT approval_status = 'Approved' AND decided_at = 'This lab' AND local_code IS NOT NULL AND corporate_code IS NOT NULL
     AND corporate_scopes = 'Reference standards' AND next_certificate_expiry = current_date + 300
     FROM vendor_approval_view WHERE supplier_name = 'VA Standards Co' AND site_id = pg_temp.va_site('CFL')));
SELECT pg_temp.expect_true('The stopped requests are counted on the page',
  (SELECT stopped_requests = 2 FROM vendor_approval_view WHERE supplier_name = 'VA Glassware' AND site_id = pg_temp.va_site('CFL')));
-- Moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.proposals): audit entries name the proposal (no proposal is made here any more)
SELECT pg_temp.expect_true('Audit entries name the documents and link to the vendor',
  EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'vendor_document' AND (audit_record_ref(table_name, record_id, new_row)->>'link') LIKE '#/purchasing/suppliers/%'));
SELECT set_config('lims.site_id', '', false);
SELECT pg_temp.as_user('akiddle');

SELECT test, outcome AS result FROM results;
