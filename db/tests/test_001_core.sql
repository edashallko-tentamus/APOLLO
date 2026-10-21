-- Verification script for migration 001. Each block prints PASS/FAIL.
SET search_path = lims, public;

INSERT INTO app_user (username, full_name, is_admin) VALUES ('akiddle','Alex Kiddle', true);  -- system administrator (migration 008: permissions)
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);

CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'PASS: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN cond THEN 'PASS' ELSE 'FAIL' END); END $$;

-- Analytes
INSERT INTO analyte (analyte_name, report_name, analyte_class, cas_number, synonyms)
  VALUES ('Lead','Lead (Pb)','Chemical','7439-92-1','{Pb}');
INSERT INTO analyte (analyte_name, analyte_class) VALUES ('pH','Physical/General');
INSERT INTO analyte (analyte_name, analyte_class) VALUES ('Total Aerobic Plate Count','Microbiological');
SELECT pg_temp.expect_true('Analyte codes generated', (SELECT string_agg(analyte_code, ',' ORDER BY analyte_code) FROM analyte) = 'ANL-00001,ANL-00002,ANL-00003');
SELECT pg_temp.expect_true('Report Name defaults to Analyte Name', (SELECT report_name FROM analyte WHERE analyte_name='pH') = 'pH');
SELECT pg_temp.expect_error('Bad CAS check digit rejected', $$INSERT INTO analyte (analyte_name, analyte_class, cas_number) VALUES ('Fake','Chemical','7439-92-2')$$);
SELECT pg_temp.expect_error('CAS on microbiological analyte rejected', $$INSERT INTO analyte (analyte_name, analyte_class, cas_number) VALUES ('E. coli','Microbiological','7439-92-1')$$);
SELECT pg_temp.expect_error('Duplicate analyte name (case-insensitive) rejected', $$INSERT INTO analyte (analyte_name, analyte_class) VALUES ('LEAD','Chemical')$$);

-- Clients and hierarchy
INSERT INTO client (legal_name, display_name, account_status, is_gmp_client) VALUES ('Acme Holdings Inc','Acme','Active',true);
INSERT INTO client (legal_name, parent_client_id, account_status)
  SELECT 'Acme Irvine Site', id, 'Active' FROM client WHERE legal_name='Acme Holdings Inc';
INSERT INTO client (legal_name, account_status) VALUES ('Beta Foods LLC','Active');
SELECT pg_temp.expect_error('Client hierarchy loop rejected',
  $$SET LOCAL lims.reason='test'; UPDATE client SET parent_client_id=(SELECT id FROM client WHERE legal_name='Acme Irvine Site') WHERE legal_name='Acme Holdings Inc'$$);

-- Contacts linked to several clients
INSERT INTO contact (first_name,last_name,email,portal_access) VALUES ('Maria','Lopez','maria@consult.com',true);
INSERT INTO contact (first_name,last_name,email) VALUES ('Sam','Ng','sam@acme.com');
INSERT INTO client_contact (client_id, contact_id, roles)
  SELECT c.id, ct.id, '{ORDERING,REPORT}' FROM client c, contact ct WHERE c.legal_name IN ('Acme Irvine Site','Beta Foods LLC') AND ct.email='maria@consult.com';
INSERT INTO client_contact (client_id, contact_id, roles)
  SELECT c.id, ct.id, '{PRIMARY,BILLING}' FROM client c, contact ct WHERE c.legal_name='Acme Irvine Site' AND ct.email='sam@acme.com';
SELECT pg_temp.expect_true('One contact sees two clients in portal', (SELECT count(*) FROM contact_portal_clients v JOIN contact ct ON ct.id=v.contact_id WHERE ct.email='maria@consult.com') = 2);
SELECT pg_temp.expect_error('Second PRIMARY contact on same client rejected',
  $$INSERT INTO client_contact (client_id, contact_id, roles) SELECT c.id, ct.id, '{PRIMARY}' FROM client c, contact ct WHERE c.legal_name='Acme Irvine Site' AND ct.email='maria@consult.com'$$);
INSERT INTO contact (first_name,last_name,email) VALUES ('Lee','Park','lee@acme.com'), ('Kim','Diaz','kim@acme.com');
INSERT INTO client_contact (client_id, contact_id, roles)
  SELECT c.id, ct.id, '{SECONDARY,REPORT}' FROM client c, contact ct WHERE c.legal_name='Acme Irvine Site' AND ct.email IN ('lee@acme.com','kim@acme.com');
SELECT pg_temp.expect_true('Multiple Secondary contacts allowed', (SELECT count(*) FROM client_contact cc JOIN client c ON c.id=cc.client_id WHERE c.legal_name='Acme Irvine Site' AND 'SECONDARY'=ANY(cc.roles)) = 2);
SELECT pg_temp.expect_error('Primary and Secondary on same link rejected',
  $$INSERT INTO client_contact (client_id, contact_id, roles) SELECT c.id, ct.id, '{PRIMARY,SECONDARY}' FROM client c, contact ct WHERE c.legal_name='Beta Foods LLC' AND ct.email='lee@acme.com'$$);
SELECT pg_temp.expect_error('Unknown contact role rejected',
  $$INSERT INTO client_contact (client_id, contact_id, roles) SELECT c.id, ct.id, '{CEO}' FROM client c, contact ct WHERE c.legal_name='Acme Holdings Inc' AND ct.email='sam@acme.com'$$);
SELECT pg_temp.expect_error('Duplicate contact email rejected', $$INSERT INTO contact (first_name,last_name,email) VALUES ('M','L','MARIA@consult.com')$$);

-- Ordering rules
SELECT pg_temp.expect_true('Ordering contact on Active client can order',
  contact_can_order((SELECT id FROM contact WHERE email='maria@consult.com'), (SELECT id FROM client WHERE legal_name='Beta Foods LLC')));
SELECT pg_temp.expect_true('Billing-only contact cannot order',
  NOT contact_can_order((SELECT id FROM contact WHERE email='sam@acme.com'), (SELECT id FROM client WHERE legal_name='Acme Irvine Site')));
SELECT set_config('lims.reason','Credit hold per accounting', false);
UPDATE client SET account_status='On Hold' WHERE legal_name='Beta Foods LLC';
SELECT pg_temp.expect_true('On Hold client can still order and test',
  contact_can_order((SELECT id FROM contact WHERE email='maria@consult.com'), (SELECT id FROM client WHERE legal_name='Beta Foods LLC')));
SELECT pg_temp.expect_true('On Hold client cannot have reports released',
  NOT client_can_release_report((SELECT id FROM client WHERE legal_name='Beta Foods LLC')));
UPDATE client SET account_status='On Hold' WHERE legal_name='Acme Holdings Inc';
SELECT pg_temp.expect_true('Hold does not cascade to child client',
  (SELECT client_can_release_report(id) FROM client WHERE legal_name='Acme Irvine Site'));
UPDATE client SET account_status='Inactive' WHERE legal_name='Acme Holdings Inc';
SELECT pg_temp.expect_true('Inactive client cannot order', NOT client_can_order((SELECT id FROM client WHERE legal_name='Acme Holdings Inc')));
SELECT pg_temp.expect_true('Inactive client can still receive reports', client_can_release_report((SELECT id FROM client WHERE legal_name='Acme Holdings Inc')));
SELECT set_config('lims.reason','', false);

-- GxP controls
SELECT pg_temp.expect_error('Update without Reason for Change rejected', $$UPDATE client SET site_address='1 Main St' WHERE legal_name='Acme Holdings Inc'$$);
SELECT pg_temp.expect_error('Hard delete rejected', $$DELETE FROM contact WHERE email='sam@acme.com'$$);
SELECT pg_temp.expect_error('Audit log cannot be edited', $$UPDATE audit_log SET reason='x'$$);
SELECT pg_temp.expect_error('Audit log cannot be deleted', $$DELETE FROM audit_log$$);
SELECT pg_temp.expect_true('Hold change audited with old/new values and reason',
  EXISTS (SELECT 1 FROM audit_log WHERE table_name='client' AND action='UPDATE'
           AND changed_fields->'account_status'->>'old'='Active' AND changed_fields->'account_status'->>'new'='On Hold'
           AND reason='Credit hold per accounting' AND record_version=2));
SELECT pg_temp.expect_true('Record version incremented', (SELECT record_version FROM client WHERE legal_name='Beta Foods LLC') = 2);
SELECT set_config('lims.user_id','', false);
SELECT pg_temp.expect_error('Change without a user identity rejected', $$INSERT INTO analyte (analyte_name, analyte_class) VALUES ('Moisture','Physical/General')$$);

SELECT rpad(left(test, 74), 76) || outcome AS result FROM results;
SELECT 1 AS done;