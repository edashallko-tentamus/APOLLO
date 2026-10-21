-- Demo data for slice 2: lab sites, holidays, effective test versions, and example lab orders.
-- Fictional. Holiday lists are placeholders for each lab to confirm.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');   -- test definitions are signed (migration 015)

INSERT INTO lab_site (site_code, site_name, time_zone, address, default_oos_procedure) VALUES
 ('CFL', 'CFL', 'America/Los_Angeles', 'Location to confirm', 'Check and Acknowledge'),
 ('TPS', 'Tentamus Pharmaceutical Services', 'America/New_York', 'St. Petersburg, FL', 'Full Phase I (21 CFR 211)')
ON CONFLICT (site_code) DO NOTHING;

INSERT INTO site_holiday (site_id, holiday_date, description)
SELECT s.id, h.d::date, h.n FROM lab_site s, (VALUES
  ('2026-01-01', 'New Year''s Day'), ('2026-05-25', 'Memorial Day'), ('2026-07-03', 'Independence Day (observed)'),
  ('2026-09-07', 'Labor Day'), ('2026-11-26', 'Thanksgiving'), ('2026-11-27', 'Day after Thanksgiving'), ('2026-12-25', 'Christmas Day'),
  ('2027-01-01', 'New Year''s Day'), ('2027-05-31', 'Memorial Day'), ('2027-07-05', 'Independence Day (observed)'),
  ('2027-09-06', 'Labor Day'), ('2027-11-25', 'Thanksgiving'), ('2027-11-26', 'Day after Thanksgiving'), ('2027-12-24', 'Christmas Day (observed)')
) AS h(d, n)
WHERE s.site_code IN ('CFL', 'TPS')
  AND NOT EXISTS (SELECT 1 FROM site_holiday x WHERE x.site_id = s.id AND x.holiday_date = h.d::date);

-- Every catalogue test without a version gets an Effective version 1 (Sandbox only)
SELECT set_config('lims.methods_internal', '1', true);  -- tests made before the Workflow Designer: version 1 Effective without approval (migration 012)
INSERT INTO test_version (test_id, version_no, status, effective_from)
SELECT t.id, 1, 'Effective', now() FROM test t WHERE NOT EXISTS (SELECT 1 FROM test_version v WHERE v.test_id = t.id);
SELECT set_config('lims.methods_internal', '', true);

-- Example order: Acme Irvine at CFL, three samples, two logged, one rush auto-accepted and one waiting for approval
DO $$
DECLARE v_order uuid; v_s1 uuid; v_s2 uuid; v_s3 uuid; v_proj uuid; v_rt uuid;
BEGIN
    SELECT id INTO v_proj FROM project WHERE project_name = 'Protein Powder Release Panel';
    IF v_proj IS NULL OR NOT EXISTS (SELECT 1 FROM orderable_lines((SELECT id FROM client WHERE legal_name = 'Acme Nutrition Irvine Site'))) THEN
        RETURN;  -- demo project changed; skip the example order
    END IF;
    INSERT INTO lab_order (client_id, site_id, ordering_contact_id, submission_channel, po_number, status)
    SELECT c.id, s.id, ct.id, 'Online', 'PO-44871', 'Submitted' FROM client c, lab_site s, contact ct
     WHERE c.legal_name = 'Acme Nutrition Irvine Site' AND s.site_code = 'CFL' AND ct.email = 'sam.nguyen@example-acme.com'
    RETURNING id INTO v_order;
    INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, product, lot, quantity_received, quantity_unit, number_of_units, condition, receipt_temperature)
    VALUES (v_order, 'VAN-0912', 'Vanilla protein powder', 'Powder', 'Whey Isolate Vanilla', 'L2609A', 450, 'g', 2, 'Acceptable', 21.5) RETURNING id INTO v_s1;
    INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, product, lot, quantity_received, quantity_unit, number_of_units, condition, receipt_temperature)
    VALUES (v_order, 'CHO-0913', 'Chocolate protein powder', 'Powder', 'Whey Isolate Chocolate', 'L2609B', 450, 'g', 2, 'Acceptable', 21.5) RETURNING id INTO v_s2;
    INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, product, lot, quantity_received, quantity_unit, number_of_units)
    VALUES (v_order, 'STR-0914', 'Strawberry protein powder', 'Powder', 'Whey Isolate Strawberry', 'L2609C', 450, 'g', 2) RETURNING id INTO v_s3;
    PERFORM apply_project(v_s1, v_proj); PERFORM apply_project(v_s2, v_proj); PERFORM apply_project(v_s3, v_proj);
    -- rush: 48 Hour (auto-accepted) on sample 1 metals, Same Day (needs approval) on sample 2 metals
    UPDATE requested_test SET rush_tier_id = (SELECT rt.id FROM rush_fee_tier rt JOIN rush_fee_schedule s ON s.id = rt.schedule_id WHERE s.schedule_name = 'Chemistry Rush' AND rt.tier_name = '48 Hour')
     WHERE sample_id = v_s1 AND test_id = (SELECT id FROM test WHERE test_name = 'Heavy Metals Panel (ICP-MS)');
    UPDATE requested_test SET rush_tier_id = (SELECT rt.id FROM rush_fee_tier rt JOIN rush_fee_schedule s ON s.id = rt.schedule_id WHERE s.schedule_name = 'Chemistry Rush' AND rt.tier_name = 'Same Day')
     WHERE sample_id = v_s2 AND test_id = (SELECT id FROM test WHERE test_name = 'Heavy Metals Panel (ICP-MS)');
    PERFORM log_samples(ARRAY[v_s1, v_s2]);
END $$;

-- Beta Foods: accept its list-price project so it can order, plus a draft walk-in order at TPS
DO $$
DECLARE v_ver uuid;
BEGIN
    SELECT pv.id INTO v_ver FROM project_version pv JOIN project p ON p.id = pv.project_id
     WHERE p.project_name = 'Catalogue pricing' AND pv.status = 'Draft' ORDER BY pv.version_no DESC LIMIT 1;
    IF v_ver IS NOT NULL THEN
        UPDATE project_version SET status = 'Quoted', valid_until = current_date + 365 WHERE id = v_ver;
        UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'jordan.reyes@example-beta.com') WHERE id = v_ver;
    END IF;
    IF EXISTS (SELECT 1 FROM contact WHERE email = 'jordan.reyes@example-beta.com') THEN
        INSERT INTO lab_order (client_id, site_id, ordering_contact_id, submission_channel)
        SELECT c.id, s.id, ct.id, 'Walk-in' FROM client c, lab_site s, contact ct
         WHERE c.legal_name = 'Beta Foods LLC' AND s.site_code = 'TPS' AND ct.email = 'jordan.reyes@example-beta.com';
    END IF;
END $$;

COMMIT;
