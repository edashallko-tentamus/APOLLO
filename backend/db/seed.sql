-- Demo data for the Sandbox. Fictional clients and people; not real records.
BEGIN;
SET search_path = lims, public;

INSERT INTO app_user (username, full_name) VALUES
 ('akiddle', 'Alex Kiddle'), ('qa.reviewer', 'QA Reviewer (demo)'), ('intake', 'Intake Tech (demo)'), ('acctmgr', 'Account Manager (demo)');
UPDATE app_user SET is_admin = true WHERE username = 'akiddle';  -- system administrator from the start (migration 008: permissions)
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT script_signature('Sandbox demo data');   -- test definitions are signed (migration 015)

-- Analytes
INSERT INTO analyte (analyte_name, report_name, analyte_class, cas_number, synonyms) VALUES
 ('Lead', 'Lead (Pb)', 'Chemical', '7439-92-1', '{Pb}'),
 ('Arsenic', 'Arsenic (As)', 'Chemical', '7440-38-2', '{As}'),
 ('Cadmium', 'Cadmium (Cd)', 'Chemical', '7440-43-9', '{Cd}'),
 ('Mercury', 'Mercury (Hg)', 'Chemical', '7439-97-6', '{Hg}'),
 ('Chromium', 'Chromium (Cr)', 'Chemical', '7440-47-3', '{Cr}'),
 ('Nickel', 'Nickel (Ni)', 'Chemical', '7440-02-0', '{Ni}'),
 ('Copper', 'Copper (Cu)', 'Chemical', '7440-50-8', '{Cu}'),
 ('Zinc', 'Zinc (Zn)', 'Chemical', '7440-66-6', '{Zn}'),
 ('Antimony', 'Antimony (Sb)', 'Chemical', '7440-36-0', '{Sb}'),
 ('Selenium', 'Selenium (Se)', 'Chemical', '7782-49-2', '{Se}');
INSERT INTO analyte (analyte_name, report_name, analyte_class) VALUES
 ('Total Aerobic Plate Count', 'Total Aerobic Plate Count', 'Microbiological'),
 ('Yeast and Mold', 'Yeast and Mold', 'Microbiological'),
 ('E. coli', 'E. coli', 'Microbiological'),
 ('Salmonella', 'Salmonella spp.', 'Microbiological'),
 ('pH', 'pH', 'Physical/General'),
 ('Moisture', 'Moisture', 'Physical/General'),
 ('Water Activity', 'Water Activity (aw)', 'Physical/General');

-- Clients (fictional)
INSERT INTO client (legal_name, display_name, account_status, is_gmp_client, billing_address, default_report_delivery) VALUES
 ('Acme Nutrition Holdings Inc', 'Acme Holdings', 'Active', false, '100 Corporate Way, Irvine CA', 'Email'),
 ('Beta Foods LLC', 'Beta Foods', 'Active', false, '22 Harbor Rd, Long Beach CA', 'Portal'),
 ('Coastal Botanicals Co', 'Coastal Botanicals', 'On Hold', false, '9 Ocean Ave, Ventura CA', 'Email'),
 ('Delta Pharmaceuticals Inc', 'Delta Pharma', 'Active', true, '450 Research Pkwy, San Diego CA', 'Email');
INSERT INTO client (legal_name, display_name, parent_client_id, account_status, site_address, default_report_delivery)
 SELECT 'Acme Nutrition Irvine Site', 'Acme Irvine', id, 'Active', '5 Lab Ln, Irvine CA', 'Email' FROM client WHERE legal_name = 'Acme Nutrition Holdings Inc';

-- Contacts
INSERT INTO contact (first_name, last_name, email, phone, job_title, portal_access) VALUES
 ('Maria', 'Lopez', 'maria.lopez@example-consulting.com', '555-0101', 'Regulatory Consultant', true),
 ('Sam', 'Nguyen', 'sam.nguyen@example-acme.com', '555-0102', 'QA Manager', true),
 ('Lee', 'Park', 'lee.park@example-acme.com', '555-0103', 'Purchasing', false),
 ('Kim', 'Diaz', 'kim.diaz@example-acme.com', '555-0104', 'Director of Quality', true),
 ('Jordan', 'Reyes', 'jordan.reyes@example-beta.com', '555-0105', 'Owner', true),
 ('Priya', 'Shah', 'priya.shah@example-delta.com', '555-0106', 'QC Lead', true);

INSERT INTO client_contact (client_id, contact_id, roles)
 SELECT c.id, ct.id, r.roles::text[] FROM (VALUES
   ('Acme Nutrition Irvine Site', 'sam.nguyen@example-acme.com', '{PRIMARY,ORDERING,REPORT,QUALITY}'),
   ('Acme Nutrition Irvine Site', 'lee.park@example-acme.com', '{SECONDARY,BILLING}'),
   ('Acme Nutrition Irvine Site', 'maria.lopez@example-consulting.com', '{SECONDARY,ORDERING,REPORT}'),
   ('Acme Nutrition Holdings Inc', 'kim.diaz@example-acme.com', '{PRIMARY,REPORT,QUALITY}'),
   ('Acme Nutrition Holdings Inc', 'lee.park@example-acme.com', '{BILLING}'),
   ('Beta Foods LLC', 'jordan.reyes@example-beta.com', '{PRIMARY,ORDERING,REPORT,BILLING}'),
   ('Beta Foods LLC', 'maria.lopez@example-consulting.com', '{ORDERING,REPORT}'),
   ('Delta Pharmaceuticals Inc', 'priya.shah@example-delta.com', '{PRIMARY,ORDERING,REPORT,QUALITY}')
 ) AS r(client, email, roles)
 JOIN client c ON c.legal_name = r.client JOIN contact ct ON ct.email = r.email;

-- Rush fee schedules
INSERT INTO rush_fee_schedule (schedule_name, description) VALUES
 ('Chemistry Rush', 'Rush options for chemistry testing'),
 ('Micro Rush', 'Rush options for microbiology (limited by incubation times)');
INSERT INTO rush_fee_tier (schedule_id, tier_name, rush_tat, tat_unit, surcharge_type, surcharge_value, requires_approval, escalation_hours, sort_order)
 SELECT s.id, t.tier, t.tat, 'Business Days', t.stype::surcharge_type, t.val, t.appr, 2, t.ord
   FROM rush_fee_schedule s JOIN (VALUES
   ('Chemistry Rush', 'Same Day', 0, 'Percent', 150, true, 1),
   ('Chemistry Rush', 'Next Day', 1, 'Percent', 100, false, 2),
   ('Chemistry Rush', '48 Hour', 2, 'Percent', 50, false, 3),
   ('Chemistry Rush', '5 Day', 5, 'Flat', 25, false, 4),
   ('Micro Rush', '48 Hour Preliminary', 2, 'Percent', 75, true, 1),
   ('Micro Rush', '72 Hour', 3, 'Percent', 40, false, 2)
 ) AS t(sched, tier, tat, stype, val, appr, ord) ON t.sched = s.schedule_name;

-- Tests and catalogue terms
INSERT INTO test (test_name) VALUES
 ('Heavy Metals Panel (ICP-MS)'), ('Moisture'), ('Water Activity'), ('Total Aerobic Plate Count'),
 ('Yeast and Mold'), ('Salmonella (Presence/Absence)'), ('pH');
SELECT set_config('lims.methods_internal', '1', true);  -- tests made before the Workflow Designer: version 1 Effective without approval (migration 012)
INSERT INTO test_version (test_id, version_no, status, effective_from) SELECT id, 1, 'Effective', now() FROM test;
SELECT set_config('lims.methods_internal', '', true);

INSERT INTO test_catalog_entry (test_id, description, pricing_mode, base_price, prep_fee, standard_tat, tat_unit, cutoff_time, rush_schedule_id, show_in_public_catalogue)
 SELECT t.id, x.descr, x.mode::pricing_mode, x.base, x.prep, x.tat, x.unit::tat_unit, x.cutoff::time,
        (SELECT id FROM rush_fee_schedule WHERE schedule_name = x.sched), x.pub
   FROM test t JOIN (VALUES
   ('Heavy Metals Panel (ICP-MS)', 'Elemental impurities by ICP-MS; price by element', 'Analyte Selection', 50, 25, 7, 'Business Days', '14:00', 'Chemistry Rush', true),
   ('Moisture', 'Loss on drying', 'Base + Preparation Fee', 30, 10, 5, 'Business Days', '15:00', 'Chemistry Rush', true),
   ('Water Activity', 'Water activity by dew point', 'Base Price Only', 45, 0, 5, 'Business Days', '15:00', 'Chemistry Rush', true),
   ('Total Aerobic Plate Count', 'Aerobic plate count', 'Base Price Only', 60, 0, 5, 'Calendar Days', '12:00', 'Micro Rush', true),
   ('Yeast and Mold', 'Yeast and mold count', 'Base Price Only', 65, 0, 7, 'Calendar Days', '12:00', 'Micro Rush', true),
   ('Salmonella (Presence/Absence)', 'Salmonella detection in 25 g', 'Base Price Only', 90, 0, 5, 'Calendar Days', '11:00', 'Micro Rush', false),
   ('pH', 'pH by electrode', 'Base Price Only', 25, 0, 3, 'Business Days', '15:00', 'Chemistry Rush', true)
 ) AS x(name, descr, mode, base, prep, tat, unit, cutoff, sched, pub) ON x.name = t.test_name;

INSERT INTO test_analyte_price (catalog_entry_id, analyte_id, price)
 SELECT e.id, a.id, 20 FROM test_catalog_entry e JOIN test t ON t.id = e.test_id, analyte a
  WHERE t.test_name = 'Heavy Metals Panel (ICP-MS)' AND a.analyte_class = 'Chemical';

-- A quoted, accepted project for Acme Irvine
INSERT INTO project (client_id, project_name, purpose)
 SELECT id, 'Protein Powder Release Panel', 'Finished product release testing' FROM client WHERE legal_name = 'Acme Nutrition Irvine Site';
SELECT new_project_version((SELECT id FROM project WHERE project_name = 'Protein Powder Release Panel'));
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity)
 SELECT pv.id, t.id, 12 FROM project_version pv JOIN project p ON p.id = pv.project_id, test t
  WHERE p.project_name = 'Protein Powder Release Panel' AND t.test_name IN ('Heavy Metals Panel (ICP-MS)', 'Moisture', 'Total Aerobic Plate Count');
UPDATE quoted_test_configuration SET final_price = round(list_price * 0.85, 2);
UPDATE quoted_analyte_selection SET included = false
 WHERE analyte_id IN (SELECT id FROM analyte WHERE analyte_name IN ('Antimony', 'Selenium', 'Zinc'));
UPDATE quote_rush_term SET discount_pct = 100 WHERE tier_name = '5 Day';
UPDATE quote_rush_term SET discount_pct = 25 WHERE tier_name = '48 Hour';
UPDATE project_version SET status = 'Quoted', valid_until = current_date + 60;
UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'sam.nguyen@example-acme.com');

-- A draft list-price acceptance for Beta Foods
INSERT INTO project (client_id, project_name, purpose, is_list_price_acceptance)
 SELECT id, 'Catalogue pricing', 'Client accepted list pricing for catalogue tests', true FROM client WHERE legal_name = 'Beta Foods LLC';
SELECT new_project_version((SELECT id FROM project WHERE project_name = 'Catalogue pricing'));
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity)
 SELECT pv.id, t.id, 1 FROM project_version pv JOIN project p ON p.id = pv.project_id, test t
  WHERE p.project_name = 'Catalogue pricing' AND t.test_name IN ('Yeast and Mold', 'Water Activity');

COMMIT;
