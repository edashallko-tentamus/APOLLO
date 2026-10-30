-- Verification for migration 008: the permission list, lab groups, additive membership, per-lab separation,
-- the view-only all-labs Executive group, signatures and no self-promotion, permissions enforced on each module,
-- the permission matrix and its history, and the interim job role / lab ticks kept in step
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
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN cond THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$   -- switch user and sign (as a data load script)
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END
$$;
CREATE OR REPLACE FUNCTION pg_temp.user_only(u text) RETURNS text LANGUAGE sql AS $$          -- switch user WITHOUT signing
  SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false) || set_config('lims.signature_id', '', false)
$$;
CREATE OR REPLACE FUNCTION pg_temp.site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.grp(site text, name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT g.id FROM lab_group g LEFT JOIN lab_site s ON s.id = g.site_id WHERE COALESCE(s.site_code, '*') = site AND g.group_name = name $$;
CREATE OR REPLACE FUNCTION pg_temp.uid(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.can(u text, code text, site text) RETURNS boolean LANGUAGE sql AS $$
  SELECT user_has_permission_at(pg_temp.uid(u), code, pg_temp.site(site)) $$;

INSERT INTO app_user (username, full_name) VALUES ('p.admin', 'Perm Lab Admin'), ('p.qa', 'Perm QA'), ('p.multi', 'Perm Multi Role'), ('p.exec', 'Perm Executive'), ('p.new', 'Perm New Starter');

-- The permission list and the standard groups
SELECT pg_temp.expect_true('The permission list is delivered (module > area > description)', (SELECT count(*) FROM permission WHERE status = 'Active') >= 20);
SELECT pg_temp.expect_true('Every lab has the standard groups (one per template entry)',
  (SELECT bool_and(n = (SELECT count(*) FROM standard_group_template)) FROM (SELECT count(*) AS n FROM lab_group WHERE site_id IS NOT NULL AND is_standard GROUP BY site_id) x));
SELECT pg_temp.expect_true('A new lab gets the standard groups and its creator joins its Administrator group', (SELECT count(*) FROM lab_group WHERE site_id IS NULL AND group_name NOT IN ('Finance (all labs)', 'Corporate QA (all labs)')) = 1); -- 037 adds the all-labs Finance group, 050 Corporate QA
INSERT INTO lab_site (site_code, site_name, time_zone) VALUES ('PRM', 'Permission Test Lab', 'America/Denver');
SELECT pg_temp.expect_true('New lab PRM: standard groups created, creator is its administrator',
  (SELECT count(*) FROM lab_group WHERE site_id = pg_temp.site('PRM')) = (SELECT count(*) FROM standard_group_template)
  AND EXISTS (SELECT 1 FROM group_member WHERE group_id = pg_temp.grp('PRM', 'Administrator') AND user_id = pg_temp.uid('akiddle') AND status = 'Active'));
SELECT pg_temp.expect_error('Only a system administrator changes the permission list', $$SELECT pg_temp.user_only('p.qa'); UPDATE permission SET description = 'x' WHERE code = 'orders.edit'$$);
SELECT pg_temp.user_only('akiddle');

-- Membership: signed, by someone with admin.users at that lab, never yourself
SELECT pg_temp.expect_error('Adding someone to a group needs a signature',
  $$INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.grp('CFL', 'Administrator'), pg_temp.uid('p.admin'))$$);
SELECT pg_temp.as_user('akiddle');
INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.grp('CFL', 'Administrator'), pg_temp.uid('p.admin'));
SELECT pg_temp.expect_true('Signed membership is audited with its signature',
  EXISTS (SELECT 1 FROM audit_log a WHERE a.table_name = 'group_member' AND a.new_row->>'user_id' = pg_temp.uid('p.admin')::text AND a.signature_id IS NOT NULL));
SELECT pg_temp.expect_true('Being in a CFL group gives access to CFL only', user_can_access_site(pg_temp.uid('p.admin'), pg_temp.site('CFL')) AND NOT user_can_access_site(pg_temp.uid('p.admin'), pg_temp.site('TPS')));
SELECT pg_temp.as_user('p.admin');
INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.grp('CFL', 'QA'), pg_temp.uid('p.qa'));
SELECT pg_temp.expect_true('A lab administrator adds people to the lab''s groups', pg_temp.can('p.qa', 'master.units', 'CFL'));
SELECT pg_temp.expect_error('A lab administrator cannot add people to another lab''s groups',
  $$INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.grp('TPS', 'QA'), pg_temp.uid('p.qa'))$$);
SELECT pg_temp.expect_error('Nobody can add themselves to a group',
  $$INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.grp('CFL', 'Lab Supervisor'), pg_temp.uid('p.admin'))$$);
SELECT pg_temp.as_user('p.qa');
SELECT pg_temp.expect_error('QA (no admin.users) cannot change memberships',
  $$INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.grp('CFL', 'Analyst'), pg_temp.uid('p.multi'))$$);

-- Additive: several groups, permissions add up; a lab-defined group (HPTLC)
SELECT pg_temp.as_user('p.admin');
INSERT INTO lab_group (site_id, group_name, description) VALUES (pg_temp.site('CFL'), 'HPTLC test group', 'HPTLC bench');
INSERT INTO group_permission (group_id, permission_code) VALUES (pg_temp.grp('CFL', 'HPTLC test group'), 'purchasing.approve');
INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.grp('CFL', 'Analyst'), pg_temp.uid('p.multi')), (pg_temp.grp('CFL', 'HPTLC test group'), pg_temp.uid('p.multi'));
SELECT pg_temp.expect_true('Analyst + HPTLC: permissions add up (orders from Analyst, approve from HPTLC)',
  pg_temp.can('p.multi', 'orders.edit', 'CFL') AND pg_temp.can('p.multi', 'purchasing.approve', 'CFL') AND NOT pg_temp.can('p.multi', 'admin.users', 'CFL'));
SELECT pg_temp.expect_true('The matrix shows the permission and the groups it comes through',
  (SELECT through_groups FROM user_permission_view WHERE user_id = pg_temp.uid('p.multi') AND permission_code = 'purchasing.approve' AND site_code = 'CFL') = 'HPTLC test group');
SELECT pg_temp.expect_error('Duplicate group name in the same lab (any capitals) refused',
  $$INSERT INTO lab_group (site_id, group_name) VALUES (pg_temp.site('CFL'), 'hptlc TEST group')$$);
SELECT pg_temp.as_user('p.qa');
SELECT pg_temp.expect_error('Only someone with admin.groups changes what a group may do',
  $$INSERT INTO group_permission (group_id, permission_code) VALUES (pg_temp.grp('CFL', 'Analyst'), 'admin.users')$$);

-- Per lab: the same person in another lab has only what that lab gives them
SELECT pg_temp.as_user('akiddle');
INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.grp('TPS', 'Intake'), pg_temp.uid('p.multi'));
SELECT pg_temp.expect_true('p.multi at TPS (Intake) cannot approve purchases there, but can at CFL',
  NOT pg_temp.can('p.multi', 'purchasing.approve', 'TPS') AND pg_temp.can('p.multi', 'purchasing.approve', 'CFL') AND pg_temp.can('p.multi', 'intake.rush', 'TPS'));

-- Permissions are enforced on the modules
SELECT pg_temp.user_only('p.qa');
SELECT set_config('lims.site_id', pg_temp.site('CFL')::text, false);
SELECT pg_temp.expect_error('QA cannot create a lab order (no orders.edit)',
  $$INSERT INTO lab_order (client_id, site_id, ordering_contact_id) SELECT c.id, pg_temp.site('CFL'), ct.id FROM client c, contact ct
    WHERE c.legal_name = 'Acme Irvine Site' AND ct.email = 'maria@consult.com'$$);
-- Moved to the Java backend in migration 072 (JUnit: PermissionChecksTest): QA cannot change a client without master.clients (ClientService)
SELECT pg_temp.expect_error('QA cannot change the test catalogue (no catalog.edit)', $$UPDATE test SET test_name = 'Moisture X' WHERE test_name = 'Moisture'$$);
SELECT pg_temp.user_only('p.multi');
SELECT set_config('lims.reason', 'Permission test', false);
SELECT pg_temp.expect_error('An analyst cannot change an analyte (no master.analytes)', $$UPDATE analyte SET synonyms = '{x}' WHERE analyte_name = 'Lead'$$);
INSERT INTO lab_order (client_id, site_id, ordering_contact_id, po_number) SELECT c.id, pg_temp.site('CFL'), ct.id, 'PO-PERM' FROM client c, contact ct
 WHERE c.legal_name = 'Acme Irvine Site' AND ct.email = 'maria@consult.com';
SELECT pg_temp.expect_true('An analyst can create a lab order (orders.edit)', EXISTS (SELECT 1 FROM lab_order WHERE po_number = 'PO-PERM'));
SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.reason', '', false);

-- The all-labs Executive group: sees every lab, changes nothing
SELECT pg_temp.as_user('akiddle');
INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.grp('*', 'Executive (all labs, view only)'), pg_temp.uid('p.exec'));
SELECT pg_temp.expect_true('Executive can view every lab', user_can_view_site(pg_temp.uid('p.exec'), pg_temp.site('CFL')) AND user_can_view_site(pg_temp.uid('p.exec'), pg_temp.site('TPS')));
SELECT pg_temp.expect_true('...but has working access to none', NOT user_can_access_site(pg_temp.uid('p.exec'), pg_temp.site('CFL')));
SELECT pg_temp.expect_error('An all-labs group cannot be given a change permission',
  $$INSERT INTO group_permission (group_id, permission_code) VALUES (pg_temp.grp('*', 'Executive (all labs, view only)'), 'orders.edit')$$);
SELECT pg_temp.user_only('p.exec');
SELECT pg_temp.expect_error('Executive cannot create an order', $$INSERT INTO lab_order (client_id, site_id, ordering_contact_id) SELECT c.id, pg_temp.site('TPS'), ct.id FROM client c, contact ct
    WHERE c.legal_name = 'Beta Foods LLC' AND ct.email = 'maria@consult.com'$$);
SELECT pg_temp.as_user('p.admin');
SELECT pg_temp.expect_error('A lab administrator cannot change the all-labs group',
  $$INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.grp('*', 'Executive (all labs, view only)'), pg_temp.uid('p.qa'))$$);

-- Ending a membership is a change (signed, with a reason) and keeps the history
SELECT pg_temp.as_user('p.admin');
SELECT pg_temp.expect_error('Ending a membership needs a reason',
  $$UPDATE group_member SET status = 'Inactive' WHERE group_id = pg_temp.grp('CFL', 'HPTLC test group') AND user_id = pg_temp.uid('p.multi')$$);
SELECT set_config('lims.reason', 'Moved off the HPTLC bench', false);
UPDATE group_member SET status = 'Inactive' WHERE group_id = pg_temp.grp('CFL', 'HPTLC test group') AND user_id = pg_temp.uid('p.multi');
SELECT pg_temp.expect_true('Leaving HPTLC removes only what HPTLC gave', NOT pg_temp.can('p.multi', 'purchasing.approve', 'CFL') AND pg_temp.can('p.multi', 'orders.edit', 'CFL'));
SELECT pg_temp.expect_true('The permission history shows who, when, the reason and the signature',
  EXISTS (SELECT 1 FROM permission_change_view WHERE member_name = 'Perm Multi Role' AND group_name = 'HPTLC test group' AND status = 'Inactive'
           AND reason = 'Moved off the HPTLC bench' AND signed_by = 'Perm Lab Admin'));
SELECT pg_temp.expect_error('Memberships are never deleted', $$DELETE FROM group_member WHERE user_id = pg_temp.uid('p.multi')$$);

-- Deactivating a user ends every membership
SELECT pg_temp.as_user('akiddle');
INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.grp('CFL', 'Analyst'), pg_temp.uid('p.new')), (pg_temp.grp('TPS', 'Analyst'), pg_temp.uid('p.new'));
UPDATE app_user SET is_active = false WHERE username = 'p.new';
SELECT pg_temp.expect_true('A deactivated user loses every group and every lab', NOT EXISTS (SELECT 1 FROM group_member WHERE user_id = pg_temp.uid('p.new') AND status = 'Active')
  AND NOT user_can_access_site(pg_temp.uid('p.new'), pg_temp.site('CFL')));

-- The interim job role and lab ticks are kept in step with the standard groups (data load scripts, older tests)
SELECT set_config('lims.reason', 'Promoted', false);
INSERT INTO user_site_access (user_id, site_id) VALUES (pg_temp.uid('p.qa'), pg_temp.site('TPS'));
SELECT pg_temp.expect_true('A lab tick puts the person in their job role''s group there (Analyst by default)',
  EXISTS (SELECT 1 FROM group_member WHERE group_id = pg_temp.grp('TPS', 'Analyst') AND user_id = pg_temp.uid('p.qa') AND status = 'Active'));
UPDATE app_user SET job_role = 'Lab Supervisor' WHERE username = 'p.qa';
SELECT pg_temp.expect_true('Changing the job role moves them to that standard group',
  EXISTS (SELECT 1 FROM group_member WHERE group_id = pg_temp.grp('TPS', 'Lab Supervisor') AND user_id = pg_temp.uid('p.qa') AND status = 'Active')
  AND NOT EXISTS (SELECT 1 FROM group_member WHERE group_id = pg_temp.grp('TPS', 'Analyst') AND user_id = pg_temp.uid('p.qa') AND status = 'Active'));
SELECT set_config('lims.reason', '', false);

-- Audit references
SELECT pg_temp.expect_true('Audit entry for a membership names the person, group and lab',
  (SELECT r->>'label' FROM group_member m, audit_record_ref('group_member', m.id, to_jsonb(m)) r
    WHERE m.group_id = pg_temp.grp('CFL', 'QA') AND m.user_id = pg_temp.uid('p.qa')) = 'Perm QA in QA (CFL)');

SELECT set_config('lims.signature_id', '', false);
SELECT rpad(left(test, 74), 76) || outcome AS result FROM results;
SELECT 1 AS done;
