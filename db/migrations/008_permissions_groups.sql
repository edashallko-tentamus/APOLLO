-- LIMS3 schema, migration 008: PERMISSIONS AND LAB GROUPS (Phase 1)
-- Vault: "Decision - Permissions Are Granted Through Lab Groups" (Alex Kiddle, 2026-10-12).
--  - A controlled, hierarchical Permission list (module > area > action), maintained by system administrators.
--  - Each lab builds its own groups from it; a group is the lab's "role". People can be in several groups;
--    their permissions are the union. Groups and memberships belong to one lab: nothing carries to another lab.
--  - Being in any active group at a lab is what gives access to that lab. The "Executive" group spans all labs,
--    view only (data and dashboard aggregation).
--  - Changes to groups, their permissions and their members are signed, dated and kept as history; nobody can add
--    themselves to a group. System administrators (app_user.is_admin) create labs, keep the permission list and
--    can do everything (keep the list short; they show up in the permission matrix).
--  - The interim job role and per-lab access ticks are converted into group memberships; writing them still works
--    for data load scripts and older rule tests (kept in step with groups), but the screens no longer use them.

BEGIN;
SET search_path = lims, public;
INSERT INTO app_user (username, full_name, is_active) VALUES ('system', 'System (data delivered by a migration)', false) ON CONFLICT (username) DO NOTHING;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);   -- reference data below is delivered by the migration itself

-------------------------------------------------------------------------------
-- 1. THE PERMISSION LIST (reference data; changed only by system administrators)
-------------------------------------------------------------------------------
CREATE TABLE permission (
    code         text PRIMARY KEY CHECK (code ~ '^[a-z_]+\.[a-z_]+$'),
    module       text NOT NULL,
    area         text NOT NULL,
    description  text NOT NULL,
    cross_lab    boolean NOT NULL DEFAULT false,  -- may be held by the all-labs (Executive) group: view-type only
    sort_order   integer NOT NULL DEFAULT 0,
    status       record_status NOT NULL DEFAULT 'Active'
);
CREATE FUNCTION permission_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE(current_setting('lims.group_sync', true), '') <> '1' AND NOT current_user_is_admin() THEN
        RAISE EXCEPTION 'Only a system administrator can change the permission list';
    END IF;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Permissions are never deleted; set them Inactive'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_rules BEFORE INSERT OR UPDATE OR DELETE ON permission FOR EACH ROW EXECUTE FUNCTION permission_rules();

INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('admin.users',        'Lab administration', 'People',            'Add people to and remove them from this lab''s groups; set temporary passwords; create users', false, 10),
 ('admin.groups',       'Lab administration', 'Groups',            'Create this lab''s groups and decide which permissions each holds (the lab''s approver of permission changes)', false, 11),
 ('admin.lab',          'Lab administration', 'Lab settings',      'Change this lab''s holiday calendar and lab details', false, 12),
 ('data.view_all',      'Lab administration', 'All labs',          'See every lab''s records, view only (Executive: data and dashboard aggregation)', true, 13),
 ('audit.view',         'Lab administration', 'Audit trail',       'Open the audit trail and the permission history', true, 14),
 ('master.clients',     'Master data', 'Clients and contacts',     'Create and change clients, contacts and their roles', false, 20),
 ('master.analytes',    'Master data', 'Analytes',                 'Create and change analytes', false, 21),
 ('master.molar_mass',  'Master data', 'Molar mass',               'Change an analyte''s molar mass (signed)', false, 22),
 ('master.units',       'Master data', 'Units',                    'Change the Units and Unit conversions tables', false, 23),
 ('master.reasons',     'Master data', 'Canned reasons',           'Change the canned Reasons for Change', false, 24),
 ('master.matrices',    'Master data', 'Matrices',                 'Change the controlled Matrix list', false, 25),
 ('catalog.edit',       'Test catalogue and quotes', 'Test catalogue', 'Change tests, pricing, turnaround and rush fee schedules', false, 30),
 ('quotes.edit',        'Test catalogue and quotes', 'Projects and quotes', 'Create, change, issue and accept projects and quotes', false, 31),
 ('orders.edit',        'Lab orders', 'Orders and samples',        'Create and change lab orders, samples and requested tests; log samples', false, 40),
 ('intake.rush',        'Lab orders', 'Rush approvals',            'Approve or decline rush requests on the intake dashboard', false, 41),
 ('inventory.edit',     'Inventory', 'Items',                      'Create and change inventory items; receive, prepare mixtures, upload Supplier COAs, transfer', false, 50),
 ('inventory.use',      'Inventory', 'Usage',                      'Record routine usage of inventory items', false, 51),
 ('inventory.adjust',   'Inventory', 'Adjustments',                'Adjust stock and dispose of items (signed)', false, 52),
 ('inventory.request',  'Inventory', 'Purchase requests',          'Request purchases and reorders', false, 53),
 ('inventory.approve',  'Inventory', 'Purchase approval',          'Approve purchase requests and reorders (until the Purchasing module exists)', false, 54),
 ('inventory.lists',    'Inventory', 'Lists',                      'Change the Supplier, Storage location and Warning rule lists', false, 55),
 ('inventory.upload',   'Inventory', 'Excel upload',               'Upload changes to the inventory list from Excel (signed)', false, 56);

-------------------------------------------------------------------------------
-- 2. GROUPS, THEIR PERMISSIONS AND THEIR MEMBERS (all audited, signed, never deleted)
-------------------------------------------------------------------------------
CREATE TABLE lab_group (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid REFERENCES lab_site(id),          -- empty = all labs (view-only Executive group)
    group_name      text NOT NULL CHECK (btrim(group_name) <> ''),
    description     text,
    is_standard     boolean NOT NULL DEFAULT false,        -- seeded basic job-role group; the lab may still change it
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX lab_group_name_uq ON lab_group (COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(group_name));
CALL make_gxp('lab_group');

CREATE TABLE group_permission (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        uuid NOT NULL REFERENCES lab_group(id),
    permission_code text NOT NULL REFERENCES permission(code),
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (group_id, permission_code)
);
CALL make_gxp('group_permission');

CREATE TABLE group_member (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        uuid NOT NULL REFERENCES lab_group(id),
    user_id         uuid NOT NULL REFERENCES app_user(id),
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (group_id, user_id)
);
CREATE INDEX group_member_user_idx ON group_member (user_id);
CALL make_gxp('group_member');

-------------------------------------------------------------------------------
-- 3. WHAT A PERSON MAY DO
-------------------------------------------------------------------------------
-- The lab the person is working in (set by the server from the lab switcher); empty = any of their labs
CREATE FUNCTION current_site() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('lims.site_id', true), '')::uuid
$$;

CREATE FUNCTION user_has_permission_at(p_user uuid, p_code text, p_site uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT is_admin AND is_active FROM app_user WHERE id = p_user), false)
        OR EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id
                     JOIN group_permission gp ON gp.group_id = g.id JOIN permission p ON p.code = gp.permission_code
                    WHERE m.user_id = p_user AND m.status = 'Active' AND g.status = 'Active' AND gp.status = 'Active' AND p.status = 'Active'
                      AND gp.permission_code = p_code
                      AND (g.site_id IS NULL OR p_site IS NULL OR g.site_id = p_site))
$$;
-- At a given lab (for records that belong to a lab)
CREATE FUNCTION has_permission_at(p_code text, p_site uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT user_has_permission_at(current_app_user(), p_code, p_site)
$$;
-- In the lab being worked in (for shared lists such as clients, analytes, units)
CREATE FUNCTION has_permission(p_code text) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT user_has_permission_at(current_app_user(), p_code, current_site())
$$;
CREATE FUNCTION require_permission_at(p_code text, p_site uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT has_permission_at(p_code, p_site) THEN
        RAISE EXCEPTION 'You do not have permission to do this: % (%). Ask your lab administrator to add you to a group that has it.',
            (SELECT lower(description) FROM permission WHERE code = p_code), p_code;
    END IF;
END $$;

-- Working access to a lab = an active membership of an active group at that lab (or system administrator)
CREATE OR REPLACE FUNCTION user_can_access_site(p_user uuid, p_site uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT is_admin AND is_active FROM app_user WHERE id = p_user), false)
        OR EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id
                    WHERE m.user_id = p_user AND m.status = 'Active' AND g.status = 'Active' AND g.site_id = p_site)
$$;
-- Viewing a lab also covers the all-labs Executive group (view only: writes still need working access)
CREATE FUNCTION user_can_view_site(p_user uuid, p_site uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT user_can_access_site(p_user, p_site) OR user_has_permission_at(p_user, 'data.view_all', NULL)
$$;

-------------------------------------------------------------------------------
-- 4. RULES ON GROUPS, PERMISSIONS AND MEMBERS
-------------------------------------------------------------------------------
CREATE FUNCTION in_group_sync() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('lims.group_sync', true), '') = '1' $$;

CREATE FUNCTION lab_group_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.group_name := btrim(NEW.group_name);
    IF TG_OP = 'UPDATE' AND NEW.site_id IS DISTINCT FROM OLD.site_id THEN RAISE EXCEPTION 'A group cannot move to another lab'; END IF;
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NEW.site_id IS NULL AND NOT current_user_is_admin() THEN RAISE EXCEPTION 'Only a system administrator can change an all-labs group'; END IF;
    IF NEW.site_id IS NOT NULL THEN PERFORM require_permission_at('admin.groups', NEW.site_id); END IF;
    PERFORM assert_signed(CASE TG_OP WHEN 'INSERT' THEN 'create a group' ELSE 'change a group' END);
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON lab_group FOR EACH ROW EXECUTE FUNCTION lab_group_rules();

CREATE FUNCTION group_permission_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g lab_group; p permission;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.group_id <> OLD.group_id OR NEW.permission_code <> OLD.permission_code) THEN
        RAISE EXCEPTION 'Switch the permission off (Inactive) instead of changing it';
    END IF;
    SELECT * INTO g FROM lab_group WHERE id = NEW.group_id;
    SELECT * INTO p FROM permission WHERE code = NEW.permission_code;
    IF g.site_id IS NULL AND NOT p.cross_lab AND NEW.status = 'Active' THEN
        RAISE EXCEPTION 'An all-labs group is view only; "%" cannot be given to it', p.description;
    END IF;
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF g.site_id IS NULL AND NOT current_user_is_admin() THEN RAISE EXCEPTION 'Only a system administrator can change an all-labs group'; END IF;
    IF g.site_id IS NOT NULL THEN PERFORM require_permission_at('admin.groups', g.site_id); END IF;
    PERFORM assert_signed('change a group''s permissions');
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON group_permission FOR EACH ROW EXECUTE FUNCTION group_permission_rules();

CREATE FUNCTION group_member_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g lab_group;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.group_id <> OLD.group_id OR NEW.user_id <> OLD.user_id) THEN
        RAISE EXCEPTION 'End the membership (Inactive) and add a new one instead';
    END IF;
    SELECT * INTO g FROM lab_group WHERE id = NEW.group_id;
    IF NEW.status = 'Active' AND g.status <> 'Active' THEN RAISE EXCEPTION 'Group "%" is Inactive', g.group_name; END IF;
    IF NEW.status = 'Active' AND NOT (SELECT is_active FROM app_user WHERE id = NEW.user_id) THEN
        RAISE EXCEPTION 'This user is deactivated and cannot be added to a group';
    END IF;
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF g.site_id IS NULL AND NOT current_user_is_admin() THEN RAISE EXCEPTION 'Only a system administrator can change who is in an all-labs group'; END IF;
    IF g.site_id IS NOT NULL THEN PERFORM require_permission_at('admin.users', g.site_id); END IF;
    IF NEW.user_id = current_app_user() AND NEW.status = 'Active' AND (TG_OP = 'INSERT' OR OLD.status <> 'Active') AND NOT current_user_is_admin() THEN
        RAISE EXCEPTION 'You cannot add yourself to a group; another administrator must do it';
    END IF;
    PERFORM assert_signed('change who is in a group');
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON group_member FOR EACH ROW EXECUTE FUNCTION group_member_rules();

-- Deactivating a user ends all their memberships (kept as history)
CREATE FUNCTION app_user_deactivated() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.is_active AND NOT NEW.is_active THEN
        PERFORM set_config('lims.group_sync', '1', true);
        IF current_reason() IS NULL THEN PERFORM set_config('lims.reason', 'User deactivated: all group memberships ended', true); END IF;
        UPDATE group_member SET status = 'Inactive' WHERE user_id = NEW.id AND status = 'Active';
        PERFORM set_config('lims.group_sync', '', true);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER z_deactivated AFTER UPDATE OF is_active ON app_user FOR EACH ROW EXECUTE FUNCTION app_user_deactivated();

-------------------------------------------------------------------------------
-- 5. STANDARD (BASIC JOB-ROLE) GROUPS: created for every lab; each lab changes or adds to them
-------------------------------------------------------------------------------
CREATE TABLE standard_group_template (
    group_name   text NOT NULL,
    description  text NOT NULL,
    permissions  text[] NOT NULL,
    sort_order   integer NOT NULL
);
INSERT INTO standard_group_template VALUES
 ('Administrator', 'Runs the lab''s access: people, groups and lab settings. In 21 CFR 211 labs keep this to IT or other staff independent of the data.',
  '{admin.users,admin.groups,admin.lab,master.matrices,audit.view}', 1),
 ('QA', 'Quality assurance: controlled lists, units, canned reasons, inventory uploads and adjustments.',
  '{master.analytes,master.molar_mass,master.units,master.reasons,master.matrices,inventory.lists,inventory.upload,inventory.adjust,audit.view}', 2),
 ('Lab Supervisor', 'Runs the bench: orders, rush approvals, inventory including approving purchases.',
  '{orders.edit,intake.rush,inventory.edit,inventory.use,inventory.adjust,inventory.request,inventory.approve,inventory.lists,master.molar_mass,audit.view}', 3),
 ('General Manager', 'Runs the lab commercially and operationally.',
  '{master.clients,catalog.edit,quotes.edit,orders.edit,intake.rush,inventory.edit,inventory.use,inventory.adjust,inventory.request,inventory.lists,audit.view}', 4),
 ('Analyst', 'Bench work: samples and inventory use.',
  '{orders.edit,inventory.edit,inventory.use,inventory.adjust,inventory.request}', 5),
 ('Intake', 'Sample receipt: clients, orders, logging and rush approvals.',
  '{master.clients,orders.edit,intake.rush}', 6),
 ('Account Manager', 'Clients and quotes.',
  '{master.clients,quotes.edit}', 7);

CREATE FUNCTION create_standard_groups(p_site uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t standard_group_template; v uuid; was text := COALESCE(current_setting('lims.group_sync', true), '');
BEGIN
    PERFORM set_config('lims.group_sync', '1', true);
    FOR t IN SELECT * FROM standard_group_template ORDER BY sort_order LOOP
        INSERT INTO lab_group (site_id, group_name, description, is_standard) VALUES (p_site, t.group_name, t.description, true)
        ON CONFLICT DO NOTHING RETURNING id INTO v;
        IF v IS NOT NULL THEN
            INSERT INTO group_permission (group_id, permission_code) SELECT v, unnest(t.permissions) ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
    PERFORM set_config('lims.group_sync', was, true);
END $$;

-- New labs get the standard groups, and whoever creates the lab joins its Administrator group
CREATE OR REPLACE FUNCTION lab_site_grant_creator() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE was text := COALESCE(current_setting('lims.group_sync', true), '');
BEGIN
    PERFORM create_standard_groups(NEW.id);
    PERFORM set_config('lims.group_sync', '1', true);
    INSERT INTO user_site_access (user_id, site_id) VALUES (current_app_user(), NEW.id) ON CONFLICT (user_id, site_id) DO NOTHING;
    INSERT INTO group_member (group_id, user_id) SELECT g.id, current_app_user() FROM lab_group g
     WHERE g.site_id = NEW.id AND g.group_name = 'Administrator' ON CONFLICT DO NOTHING;
    PERFORM set_config('lims.group_sync', was, true);
    RETURN NULL;
END $$;

-- The all-labs Executive group (view only)
INSERT INTO lab_group (site_id, group_name, description, is_standard)
VALUES (NULL, 'Executive (all labs, view only)', 'VPs, Division Directors and C-suite: see every lab''s data for dashboards and aggregation; cannot change anything.', true);
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g, unnest('{data.view_all,audit.view}'::text[]) p WHERE g.site_id IS NULL;

-------------------------------------------------------------------------------
-- 6. THE INTERIM JOB ROLE AND LAB TICKS, KEPT IN STEP WITH GROUPS (data load scripts and older rule tests)
-------------------------------------------------------------------------------
CREATE FUNCTION standard_group_id(p_site uuid, p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT id FROM lab_group WHERE site_id = p_site AND group_name = p_name AND is_standard
$$;
CREATE FUNCTION sync_member(p_group uuid, p_user uuid, p_active boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r text := current_reason();
BEGIN
    IF p_group IS NULL THEN RETURN; END IF;
    IF r IS NULL THEN PERFORM set_config('lims.reason', 'Kept in step with the job role and lab access', true); END IF;
    INSERT INTO group_member (group_id, user_id, status) VALUES (p_group, p_user, CASE WHEN p_active THEN 'Active' ELSE 'Inactive' END::record_status)
    ON CONFLICT (group_id, user_id) DO UPDATE SET status = EXCLUDED.status WHERE group_member.status <> EXCLUDED.status;
    IF r IS NULL THEN PERFORM set_config('lims.reason', '', true); END IF;
END $$;

CREATE FUNCTION user_site_access_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u app_user; was text := COALESCE(current_setting('lims.group_sync', true), '');
BEGIN
    SELECT * INTO u FROM app_user WHERE id = NEW.user_id;
    PERFORM set_config('lims.group_sync', '1', true);
    IF NEW.status = 'Active' THEN
        IF u.is_active THEN
            PERFORM sync_member(standard_group_id(NEW.site_id, u.job_role::text), u.id, true);
            IF u.is_admin THEN PERFORM sync_member(standard_group_id(NEW.site_id, 'Administrator'), u.id, true); END IF;
        END IF;
    ELSE
        IF current_reason() IS NULL THEN PERFORM set_config('lims.reason', 'Lab access ended', true); END IF;
        UPDATE group_member m SET status = 'Inactive' FROM lab_group g
         WHERE g.id = m.group_id AND g.site_id = NEW.site_id AND m.user_id = NEW.user_id AND m.status = 'Active';
    END IF;
    PERFORM set_config('lims.group_sync', was, true);
    RETURN NULL;
END $$;
CREATE TRIGGER z_group_sync AFTER INSERT OR UPDATE ON user_site_access FOR EACH ROW EXECUTE FUNCTION user_site_access_sync();

CREATE FUNCTION job_role_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s uuid; was text := COALESCE(current_setting('lims.group_sync', true), '');
BEGIN
    IF NEW.job_role IS NOT DISTINCT FROM OLD.job_role THEN RETURN NULL; END IF;
    PERFORM set_config('lims.group_sync', '1', true);
    FOR s IN SELECT DISTINCT g.site_id FROM group_member m JOIN lab_group g ON g.id = m.group_id
              WHERE m.user_id = NEW.id AND m.status = 'Active' AND g.site_id IS NOT NULL
             UNION SELECT site_id FROM user_site_access WHERE user_id = NEW.id AND status = 'Active' LOOP
        PERFORM sync_member(standard_group_id(s, OLD.job_role::text), NEW.id, false);
        PERFORM sync_member(standard_group_id(s, NEW.job_role::text), NEW.id, true);
    END LOOP;
    PERFORM set_config('lims.group_sync', was, true);
    RETURN NULL;
END $$;
CREATE TRIGGER z_group_sync AFTER UPDATE OF job_role ON app_user FOR EACH ROW EXECUTE FUNCTION job_role_sync();

-- Existing labs: standard groups, and today's job roles, lab ticks and administrators become memberships
DO $$
DECLARE s uuid;
BEGIN
    FOR s IN SELECT id FROM lab_site LOOP PERFORM create_standard_groups(s); END LOOP;
END $$;
SELECT set_config('lims.group_sync', '1', true);
SELECT sync_member(standard_group_id(a.site_id, u.job_role::text), u.id, true)
  FROM user_site_access a JOIN app_user u ON u.id = a.user_id WHERE a.status = 'Active' AND u.is_active;
SELECT sync_member(standard_group_id(a.site_id, 'Administrator'), u.id, true)
  FROM user_site_access a JOIN app_user u ON u.id = a.user_id WHERE a.status = 'Active' AND u.is_active AND u.is_admin;

-------------------------------------------------------------------------------
-- 7. PERMISSIONS ENFORCED ON EVERY MODULE BUILT SO FAR
-------------------------------------------------------------------------------
-- Shared lists (permission in the lab being worked in)
CREATE FUNCTION require_list_permission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NOT has_permission(TG_ARGV[0]) THEN
        RAISE EXCEPTION 'You do not have permission to change %: % (%). Ask your lab administrator.', replace(TG_TABLE_NAME, '_', ' '),
            (SELECT lower(description) FROM permission WHERE code = TG_ARGV[0]), TG_ARGV[0];
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON client FOR EACH ROW EXECUTE FUNCTION require_list_permission('master.clients');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON contact FOR EACH ROW EXECUTE FUNCTION require_list_permission('master.clients');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON client_contact FOR EACH ROW EXECUTE FUNCTION require_list_permission('master.clients');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON test FOR EACH ROW EXECUTE FUNCTION require_list_permission('catalog.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON test_version FOR EACH ROW EXECUTE FUNCTION require_list_permission('catalog.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON test_catalog_entry FOR EACH ROW EXECUTE FUNCTION require_list_permission('catalog.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON test_rush_approval FOR EACH ROW EXECUTE FUNCTION require_list_permission('catalog.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON test_analyte_price FOR EACH ROW EXECUTE FUNCTION require_list_permission('catalog.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON rush_fee_schedule FOR EACH ROW EXECUTE FUNCTION require_list_permission('catalog.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON rush_fee_tier FOR EACH ROW EXECUTE FUNCTION require_list_permission('catalog.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON project FOR EACH ROW EXECUTE FUNCTION require_list_permission('quotes.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON project_version FOR EACH ROW EXECUTE FUNCTION require_list_permission('quotes.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON quoted_test_configuration FOR EACH ROW EXECUTE FUNCTION require_list_permission('quotes.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON quoted_analyte_selection FOR EACH ROW EXECUTE FUNCTION require_list_permission('quotes.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON quote_rush_term FOR EACH ROW EXECUTE FUNCTION require_list_permission('quotes.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON chemical FOR EACH ROW EXECUTE FUNCTION require_list_permission('inventory.lists');

-- Analytes: the molar mass has its own permission; everything else needs master.analytes
CREATE FUNCTION analyte_permission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - '{molar_mass,molar_mass_source,record_version,modified_at,modified_by}'::text[])
                          = (to_jsonb(OLD) - '{molar_mass,molar_mass_source,record_version,modified_at,modified_by}'::text[]) THEN
        RETURN NEW;   -- only the molar mass changed: checked by its own rule
    END IF;
    IF NOT has_permission('master.analytes') THEN
        RAISE EXCEPTION 'You do not have permission to change analytes (master.analytes). Ask your lab administrator.';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON analyte FOR EACH ROW EXECUTE FUNCTION analyte_permission();

-- Records that belong to a lab: permission at that lab
CREATE FUNCTION lab_record_permission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid; v_code text := TG_ARGV[0];
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    v_site := CASE TG_TABLE_NAME
        WHEN 'lab_order' THEN (to_jsonb(NEW)->>'site_id')::uuid
        WHEN 'site_holiday' THEN (to_jsonb(NEW)->>'site_id')::uuid
        WHEN 'sample' THEN (SELECT site_id FROM lab_order WHERE id = (to_jsonb(NEW)->>'lab_order_id')::uuid)
        WHEN 'requested_test' THEN (SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = (to_jsonb(NEW)->>'sample_id')::uuid)
        WHEN 'requested_analyte' THEN (SELECT o.site_id FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id
                                        WHERE rt.id = (to_jsonb(NEW)->>'requested_test_id')::uuid)
        WHEN 'rush_decision' THEN (SELECT o.site_id FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id
                                    WHERE rt.id = (to_jsonb(NEW)->>'requested_test_id')::uuid)
    END;
    -- shelving a sample and recording its retained quantity is inventory work
    IF TG_TABLE_NAME = 'sample' AND TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - '{storage_location_id,storage_condition,retained_quantity,retained_unit,record_version,modified_at,modified_by}'::text[])
         = (to_jsonb(OLD) - '{storage_location_id,storage_condition,retained_quantity,retained_unit,record_version,modified_at,modified_by}'::text[]) THEN
        v_code := 'inventory.edit';
    END IF;
    PERFORM require_permission_at(v_code, v_site);
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON lab_order FOR EACH ROW EXECUTE FUNCTION lab_record_permission('orders.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON sample FOR EACH ROW EXECUTE FUNCTION lab_record_permission('orders.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON requested_test FOR EACH ROW EXECUTE FUNCTION lab_record_permission('orders.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON requested_analyte FOR EACH ROW EXECUTE FUNCTION lab_record_permission('orders.edit');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON rush_decision FOR EACH ROW EXECUTE FUNCTION lab_record_permission('intake.rush');

-- Lab settings: holidays by the lab's administrators; labs themselves by system administrators (unchanged)
DROP TRIGGER a_admin_only ON site_holiday;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON site_holiday FOR EACH ROW EXECUTE FUNCTION lab_record_permission('admin.lab');
DROP TRIGGER a_admin_only ON matrix;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON matrix FOR EACH ROW EXECUTE FUNCTION require_list_permission('master.matrices');

-- Inventory
CREATE FUNCTION inventory_permission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid; v_lot uuid; l inventory_lot; v_code text := 'inventory.edit';
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'inventory_lot' THEN
        IF TG_OP = 'INSERT' AND NEW.transferred_from_lot_id IS NOT NULL THEN
            v_site := (SELECT site_id FROM inventory_lot WHERE id = NEW.transferred_from_lot_id);   -- made by the sending lab
        ELSE
            v_site := NEW.site_id;
        END IF;
        IF TG_OP = 'INSERT' AND NEW.receipt_status = 'Requested' THEN v_code := 'inventory.request'; END IF;
        IF TG_OP = 'UPDATE' AND NEW.receipt_status = 'Approved' AND OLD.receipt_status = 'Requested' THEN v_code := 'inventory.approve'; END IF;
        IF TG_OP = 'UPDATE' AND NEW.status = 'Disposed' AND OLD.status <> 'Disposed' THEN v_code := 'inventory.adjust'; END IF;
    ELSE
        v_lot := (to_jsonb(NEW)->>'lot_id')::uuid;
        SELECT * INTO l FROM inventory_lot WHERE id = v_lot;
        v_site := l.site_id;
        -- the sending lab copies the Supplier COA onto the receiving lab's In Transit lot
        IF TG_TABLE_NAME IN ('supplier_coa','lot_analyte') AND l.receipt_status = 'In Transit' AND l.transferred_from_lot_id IS NOT NULL
           AND NOT has_permission_at('inventory.edit', l.site_id) THEN
            v_site := (SELECT site_id FROM inventory_lot WHERE id = l.transferred_from_lot_id);
        END IF;
        IF TG_TABLE_NAME = 'inventory_transaction' THEN
            v_code := CASE to_jsonb(NEW)->>'txn_type' WHEN 'Usage' THEN 'inventory.use' WHEN 'Adjustment' THEN 'inventory.adjust' WHEN 'Disposal' THEN 'inventory.adjust' ELSE 'inventory.edit' END;
        END IF;
    END IF;
    PERFORM require_permission_at(v_code, v_site);
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON inventory_lot FOR EACH ROW EXECUTE FUNCTION inventory_permission();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON inventory_transaction FOR EACH ROW EXECUTE FUNCTION inventory_permission();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON lot_component FOR EACH ROW EXECUTE FUNCTION inventory_permission();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON lot_analyte FOR EACH ROW EXECUTE FUNCTION inventory_permission();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON supplier_coa FOR EACH ROW EXECUTE FUNCTION inventory_permission();

-- The interim role checks now read permissions (function names kept so earlier rules keep working)
CREATE OR REPLACE FUNCTION can_maintain_inventory_lists() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT has_permission('inventory.lists') $$;
CREATE OR REPLACE FUNCTION can_approve_reorder() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT has_permission('inventory.approve') $$;
CREATE OR REPLACE FUNCTION can_maintain_units() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT has_permission('master.units') $$;
CREATE OR REPLACE FUNCTION require_inventory_maintainer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT can_maintain_inventory_lists() THEN
        RAISE EXCEPTION 'You do not have permission to change the % list (inventory.lists). Ask your lab administrator.', replace(TG_TABLE_NAME, '_', ' ');
    END IF;
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION require_units_maintainer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT can_maintain_units() THEN
        RAISE EXCEPTION 'You do not have permission to change the % list (master.units). Ask your lab administrator.', replace(replace(TG_TABLE_NAME, 'unit_of_measure', 'Units'), 'unit_conversion', 'Unit conversion');
    END IF;
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION require_qa_or_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT has_permission('master.reasons') THEN
        RAISE EXCEPTION 'You do not have permission to change the canned reasons (master.reasons). Ask your lab administrator.';
    END IF;
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION analyte_molar_mass_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.molar_mass IS NULL AND NEW.molar_mass_source IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND (NEW.molar_mass, NEW.molar_mass_source) IS NOT DISTINCT FROM (OLD.molar_mass, OLD.molar_mass_source) THEN RETURN NEW; END IF;
    IF NOT has_permission('master.molar_mass') THEN
        RAISE EXCEPTION 'You do not have permission to change a molar mass (master.molar_mass). Ask your lab administrator.';
    END IF;
    IF NEW.molar_mass IS NOT NULL AND COALESCE(btrim(NEW.molar_mass_source), '') = '' THEN
        RAISE EXCEPTION 'Give the source of the molar mass (for example "IUPAC standard atomic weights 2021")';
    END IF;
    PERFORM assert_signed('change a molar mass');
    RETURN NEW;
END $$;

-------------------------------------------------------------------------------
-- 8. VIEWS: the permission matrix (who holds what, in which lab, through which groups) and its history
-------------------------------------------------------------------------------
CREATE VIEW user_permission_view AS
SELECT u.id AS user_id, u.username, u.full_name, g.site_id, s.site_code, gp.permission_code, p.module, p.area, p.description,
       string_agg(g.group_name, ', ' ORDER BY g.group_name) AS through_groups
  FROM group_member m JOIN app_user u ON u.id = m.user_id JOIN lab_group g ON g.id = m.group_id
  JOIN group_permission gp ON gp.group_id = g.id JOIN permission p ON p.code = gp.permission_code
  LEFT JOIN lab_site s ON s.id = g.site_id
 WHERE m.status = 'Active' AND g.status = 'Active' AND gp.status = 'Active' AND p.status = 'Active' AND u.is_active
 GROUP BY u.id, u.username, u.full_name, g.site_id, s.site_code, gp.permission_code, p.module, p.area, p.description;

-- Every change to groups, their permissions and their members, with the signature behind it
CREATE VIEW permission_change_view AS
SELECT a.id AS audit_id, a.changed_at, a.table_name, a.action, a.reason, cu.full_name AS changed_by,
       se.meaning AS signature_meaning, se.full_name AS signed_by, se.signed_at, se.method AS signature_method,
       COALESCE(g.site_id, gg.site_id, gm.site_id) AS site_id,
       COALESCE(g.group_name, gg.group_name, gm.group_name) AS group_name,
       mu.full_name AS member_name, a.new_row->>'permission_code' AS permission_code, a.new_row->>'status' AS status, a.changed_fields
  FROM audit_log a JOIN app_user cu ON cu.id = a.changed_by
  LEFT JOIN signature_event se ON se.id = a.signature_id
  LEFT JOIN lab_group g ON a.table_name = 'lab_group' AND g.id = a.record_id
  LEFT JOIN lab_group gg ON a.table_name = 'group_permission' AND gg.id = (a.new_row->>'group_id')::uuid
  LEFT JOIN lab_group gm ON a.table_name = 'group_member' AND gm.id = (a.new_row->>'group_id')::uuid
  LEFT JOIN app_user mu ON a.table_name = 'group_member' AND mu.id = (a.new_row->>'user_id')::uuid
 WHERE a.table_name IN ('lab_group','group_permission','group_member');

-------------------------------------------------------------------------------
-- 9. AUDIT REFERENCES for the new records
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_slice32;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE lbl text;
BEGIN
    CASE p_table
    WHEN 'lab_group' THEN
        lbl := 'Group ' || (r->>'group_name') || COALESCE(' (' || (SELECT site_code FROM lab_site WHERE id = (r->>'site_id')::uuid) || ')', ' (all labs)');
    WHEN 'group_permission' THEN
        SELECT 'Group ' || g.group_name || COALESCE(' (' || s.site_code || ')', ' (all labs)') || ': ' || (r->>'permission_code') INTO lbl
          FROM lab_group g LEFT JOIN lab_site s ON s.id = g.site_id WHERE g.id = (r->>'group_id')::uuid;
    WHEN 'group_member' THEN
        SELECT u.full_name || ' in ' || g.group_name || COALESCE(' (' || s.site_code || ')', ' (all labs)') INTO lbl
          FROM lab_group g LEFT JOIN lab_site s ON s.id = g.site_id, app_user u WHERE g.id = (r->>'group_id')::uuid AND u.id = (r->>'user_id')::uuid;
    ELSE RETURN audit_record_ref_slice32(p_table, p_id, r);
    END CASE;
    RETURN jsonb_build_object('label', COALESCE(lbl, replace(p_table, '_', ' ')), 'link', '#/admin/groups');
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
