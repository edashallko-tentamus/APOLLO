-- LIMS3 schema, migration 009: EQUIPMENT (Phase 1)
-- Vault: "Decision - Equipment Slice Scope and Rules" (Alex Kiddle, 2026-10-12) and the earlier equipment decisions
-- (status is derived from tags, one tag with four reasons, calibration history kept as events, at least one owner,
-- calibration expiry and maintenance due dates tag equipment out automatically, QA release by a different person).
--  - One register for every instrument and small item (HPLC to pipette), each belonging to one lab.
--  - Equipment types and departments: static lists each lab keeps.
--  - Owners: groups of that lab and/or named people; at least one, checked when the save completes.
--  - Tag-out (Maintenance, Repair, Calibration, Qualification) makes equipment unavailable. Tag-in needs a record of
--    the work. After Repair, Calibration or Qualification it needs a release by someone holding equipment.release who
--    did not tag it out and did not do or record the work (every lab).
--  - Calibrations and qualifications are kept as events; the current calibration gives the calibration status
--    (Conforms, Alert within the instrument's alert window, Deficient when missing, failed or expired).
--  - Changing a calibration's expiry, date or result needs equipment.release, a signature and a different person.
--  - Maintenance schedules: next due date, warning days, tag out when due; recording the work moves the next due date.
--  - Transfer to another lab keeps the history; it arrives tagged out for Qualification.
--  - Every create and change is signed, audited and never deleted; the automatic tag-outs are made by "System".

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);

-------------------------------------------------------------------------------
-- 1. PERMISSIONS (added to the list and to the standard groups of every lab)
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('equipment.edit',      'Equipment', 'Equipment records',  'Add and change equipment, owners, maintenance schedules and documents; take it out of service; transfer it to another lab', false, 60),
 ('equipment.tag',       'Equipment', 'Tag-out and maintenance', 'Tag equipment out; record maintenance and repairs; tag it back in after maintenance', false, 61),
 ('equipment.calibrate', 'Equipment', 'Calibration and qualification', 'Record calibrations and qualifications (IQ/OQ/PQ) with their certificates', false, 62),
 ('equipment.release',   'Equipment', 'Release to service', 'Release equipment to service after repair, calibration or qualification; change a calibration''s expiry, date or result (never your own work)', false, 63),
 ('equipment.lists',     'Equipment', 'Lists',              'Change this lab''s Equipment types and Departments lists', false, 64);

CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES
 ('Administrator',   '{equipment.lists}'),
 ('QA',              '{equipment.release,equipment.lists}'),
 ('Lab Supervisor',  '{equipment.edit,equipment.tag,equipment.calibrate,equipment.lists}'),
 ('General Manager', '{equipment.edit,equipment.tag,equipment.calibrate,equipment.lists}'),
 ('Analyst',         '{equipment.tag,equipment.calibrate}');
UPDATE standard_group_template t SET permissions = t.permissions || n.perms FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL
ON CONFLICT DO NOTHING;

-------------------------------------------------------------------------------
-- 2. EACH LAB'S STATIC LISTS: DEPARTMENTS AND EQUIPMENT TYPES
-------------------------------------------------------------------------------
CREATE TABLE department (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id          uuid NOT NULL REFERENCES lab_site(id),
    department_code  text NOT NULL CHECK (btrim(department_code) <> ''),
    department_name  text NOT NULL CHECK (btrim(department_name) <> ''),
    status           record_status NOT NULL DEFAULT 'Active',
    record_version   integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at      timestamptz NOT NULL DEFAULT now(),
    modified_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX department_code_uq ON department (site_id, upper(department_code));
CREATE UNIQUE INDEX department_name_uq ON department (site_id, lower(department_name));
CALL make_gxp('department');

CREATE TABLE equipment_type (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id          uuid NOT NULL REFERENCES lab_site(id),
    type_name        text NOT NULL CHECK (btrim(type_name) <> ''),
    description      text,
    status           record_status NOT NULL DEFAULT 'Active',
    record_version   integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at      timestamptz NOT NULL DEFAULT now(),
    modified_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX equipment_type_name_uq ON equipment_type (site_id, lower(type_name));
CALL make_gxp('equipment_type');

-- Internal steps (transfer, schedule moving on, automatic tag-out) skip the person's permission checks
CREATE FUNCTION equipment_internal() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.equipment_internal', true), '') = '1' OR in_group_sync()
$$;

CREATE FUNCTION equipment_list_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.site_id <> OLD.site_id THEN RAISE EXCEPTION 'A list entry cannot move to another lab'; END IF;
    IF TG_TABLE_NAME = 'department' THEN NEW.department_code := upper(btrim(NEW.department_code)); NEW.department_name := btrim(NEW.department_name);
    ELSE NEW.type_name := btrim(to_jsonb(NEW)->>'type_name'); END IF;
    IF equipment_internal() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('equipment.lists', NEW.site_id);
    PERFORM assert_signed('change the ' || replace(TG_TABLE_NAME, '_', ' ') || ' list');
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON department FOR EACH ROW EXECUTE FUNCTION equipment_list_rules();
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON equipment_type FOR EACH ROW EXECUTE FUNCTION equipment_list_rules();

-------------------------------------------------------------------------------
-- 3. EQUIPMENT
-------------------------------------------------------------------------------
CREATE TYPE equipment_admin_status AS ENUM ('In Service','Out of Service','Retired');
CREATE SEQUENCE equipment_code_seq;
CREATE TABLE equipment (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_code              text NOT NULL UNIQUE DEFAULT 'EQ-' || lpad(nextval('equipment_code_seq')::text, 5, '0'),
    site_id                     uuid NOT NULL REFERENCES lab_site(id),
    equipment_name              text NOT NULL CHECK (btrim(equipment_name) <> ''),
    equipment_type_id           uuid NOT NULL REFERENCES equipment_type(id),
    department_id               uuid REFERENCES department(id),
    manufacturer                text,
    model                       text,
    serial_number               text,
    asset_tag                   text,
    location_id                 uuid REFERENCES storage_location(id),
    location_note               text,
    calibration_required        boolean NOT NULL DEFAULT false,
    calibration_interval_months integer CHECK (calibration_interval_months > 0),
    calibration_alert_days      integer NOT NULL DEFAULT 30 CHECK (calibration_alert_days >= 0),
    qualification_required      boolean NOT NULL DEFAULT false,
    in_service_date             date,
    admin_status                equipment_admin_status NOT NULL DEFAULT 'In Service',
    notes                       text,
    record_version              integer NOT NULL DEFAULT 1,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    created_by                  uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at                 timestamptz NOT NULL DEFAULT now(),
    modified_by                 uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX equipment_serial_uq ON equipment (lower(COALESCE(manufacturer, '')), lower(serial_number)) WHERE serial_number IS NOT NULL;
CREATE INDEX equipment_site_idx ON equipment (site_id);
CALL make_gxp('equipment');

CREATE FUNCTION equipment_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
    NEW.equipment_name := btrim(NEW.equipment_name);
    NEW.serial_number := NULLIF(btrim(NEW.serial_number), '');
    NEW.manufacturer := NULLIF(btrim(NEW.manufacturer), '');
    IF TG_OP = 'UPDATE' AND NEW.equipment_code <> OLD.equipment_code THEN RAISE EXCEPTION 'The equipment ID is given by the system and cannot be changed'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.site_id <> OLD.site_id AND NOT equipment_internal() THEN
        RAISE EXCEPTION 'Use Transfer to move equipment to another lab (its history goes with it)';
    END IF;
    IF (TG_OP = 'INSERT' OR NEW.equipment_type_id IS DISTINCT FROM OLD.equipment_type_id OR NEW.site_id <> OLD.site_id) THEN
        SELECT CASE WHEN t.site_id <> NEW.site_id THEN 'belongs to another lab' WHEN t.status <> 'Active' THEN 'is Inactive' END INTO v
          FROM equipment_type t WHERE t.id = NEW.equipment_type_id;
        IF v IS NOT NULL THEN RAISE EXCEPTION 'That equipment type %; pick one from this lab''s Equipment types list', v; END IF;
    END IF;
    IF NEW.department_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.department_id IS DISTINCT FROM OLD.department_id) THEN
        SELECT CASE WHEN d.site_id <> NEW.site_id THEN 'belongs to another lab' WHEN d.status <> 'Active' THEN 'is Inactive' END INTO v
          FROM department d WHERE d.id = NEW.department_id;
        IF v IS NOT NULL THEN RAISE EXCEPTION 'That department %; pick one from this lab''s Departments list', v; END IF;
    END IF;
    IF NEW.location_id IS NOT NULL AND (SELECT site_id FROM storage_location WHERE id = NEW.location_id) <> NEW.site_id THEN
        RAISE EXCEPTION 'That location belongs to another lab';
    END IF;
    IF NEW.calibration_required AND NEW.admin_status = 'In Service' AND NEW.calibration_interval_months IS NULL
       AND (TG_OP = 'INSERT' OR NOT OLD.calibration_required) THEN
        NULL; -- the interval is optional: each calibration can carry its own expiry date
    END IF;
    IF equipment_internal() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('equipment.edit', CASE WHEN TG_OP = 'UPDATE' THEN OLD.site_id ELSE NEW.site_id END);
    PERFORM assert_signed(CASE TG_OP WHEN 'INSERT' THEN 'add equipment' ELSE 'change equipment' END);
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION equipment_rules();

-------------------------------------------------------------------------------
-- 4. OWNERS: groups of the equipment's lab and/or named people (at least one)
-------------------------------------------------------------------------------
CREATE TABLE equipment_owner (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id    uuid NOT NULL REFERENCES equipment(id),
    group_id        uuid REFERENCES lab_group(id),
    user_id         uuid REFERENCES app_user(id),
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT equipment_owner_one_kind CHECK ((group_id IS NULL) <> (user_id IS NULL))
);
CREATE UNIQUE INDEX equipment_owner_group_uq ON equipment_owner (equipment_id, group_id) WHERE group_id IS NOT NULL;
CREATE UNIQUE INDEX equipment_owner_user_uq ON equipment_owner (equipment_id, user_id) WHERE user_id IS NOT NULL;
CALL make_gxp('equipment_owner');

CREATE FUNCTION equipment_owner_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e equipment; g lab_group;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.equipment_id <> OLD.equipment_id OR NEW.group_id IS DISTINCT FROM OLD.group_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
        RAISE EXCEPTION 'Remove the owner (Inactive) and add the new one instead';
    END IF;
    SELECT * INTO e FROM equipment WHERE id = NEW.equipment_id;
    IF NEW.status = 'Active' THEN
        IF NEW.group_id IS NOT NULL THEN
            SELECT * INTO g FROM lab_group WHERE id = NEW.group_id;
            IF g.site_id IS DISTINCT FROM e.site_id THEN RAISE EXCEPTION 'Owner group "%" is not a group of this equipment''s lab', g.group_name; END IF;
            IF g.status <> 'Active' THEN RAISE EXCEPTION 'Group "%" is Inactive', g.group_name; END IF;
        ELSIF NOT user_can_access_site(NEW.user_id, e.site_id) OR NOT (SELECT is_active FROM app_user WHERE id = NEW.user_id) THEN
            RAISE EXCEPTION '% is not in a group at this lab, so cannot own its equipment', (SELECT full_name FROM app_user WHERE id = NEW.user_id);
        END IF;
    END IF;
    IF equipment_internal() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('equipment.edit', e.site_id);
    PERFORM assert_signed('change who is responsible for equipment');
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON equipment_owner FOR EACH ROW EXECUTE FUNCTION equipment_owner_rules();

-- Checked when the save completes, so equipment and its owners can be saved together
CREATE FUNCTION equipment_owner_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid := CASE TG_TABLE_NAME WHEN 'equipment' THEN NEW.id ELSE (to_jsonb(NEW)->>'equipment_id')::uuid END; e equipment;
BEGIN
    SELECT * INTO e FROM equipment WHERE id = v_id;
    IF e.admin_status <> 'Retired' AND NOT EXISTS (SELECT 1 FROM equipment_owner WHERE equipment_id = v_id AND status = 'Active') THEN
        RAISE EXCEPTION '% % needs at least one responsible group or person (owners get its calibration and maintenance warnings)', e.equipment_code, e.equipment_name;
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER z_owner_required AFTER INSERT OR UPDATE ON equipment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION equipment_owner_required();
CREATE CONSTRAINT TRIGGER z_owner_required AFTER INSERT OR UPDATE ON equipment_owner DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION equipment_owner_required();

-- Is this person responsible for this equipment (named, or through a group they are in)?
CREATE FUNCTION is_equipment_owner(p_user uuid, p_equipment uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM equipment_owner o WHERE o.equipment_id = p_equipment AND o.status = 'Active' AND o.user_id = p_user)
        OR EXISTS (SELECT 1 FROM equipment_owner o JOIN group_member m ON m.group_id = o.group_id AND m.status = 'Active' AND m.user_id = p_user
                     JOIN lab_group g ON g.id = o.group_id AND g.status = 'Active'
                    WHERE o.equipment_id = p_equipment AND o.status = 'Active')
$$;

-------------------------------------------------------------------------------
-- 5. MAINTENANCE SCHEDULES
-------------------------------------------------------------------------------
CREATE TABLE maintenance_schedule (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id     uuid NOT NULL REFERENCES equipment(id),
    task_name        text NOT NULL CHECK (btrim(task_name) <> ''),
    interval_count   integer NOT NULL CHECK (interval_count > 0),
    interval_unit    text NOT NULL CHECK (interval_unit IN ('days','weeks','months','years')),
    next_due_date    date NOT NULL,
    alert_days       integer NOT NULL DEFAULT 7 CHECK (alert_days >= 0),
    tag_out_when_due boolean NOT NULL DEFAULT true,
    instructions     text,
    status           record_status NOT NULL DEFAULT 'Active',
    record_version   integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at      timestamptz NOT NULL DEFAULT now(),
    modified_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('maintenance_schedule');

CREATE FUNCTION interval_of(p_count integer, p_unit text) RETURNS interval LANGUAGE sql IMMUTABLE AS $$
    SELECT make_interval(days => CASE p_unit WHEN 'days' THEN p_count WHEN 'weeks' THEN p_count * 7 ELSE 0 END,
                         months => CASE p_unit WHEN 'months' THEN p_count WHEN 'years' THEN p_count * 12 ELSE 0 END)
$$;

-------------------------------------------------------------------------------
-- 6. TAGS: the single thing that makes equipment unavailable
-------------------------------------------------------------------------------
CREATE TYPE tag_reason AS ENUM ('Maintenance','Repair','Calibration','Qualification');
CREATE TYPE tag_source AS ENUM ('Manual','Calibration due','Maintenance due','Transfer');
CREATE SEQUENCE equipment_tag_seq;
CREATE TABLE equipment_tag (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_code              text NOT NULL UNIQUE DEFAULT 'TAG-' || lpad(nextval('equipment_tag_seq')::text, 6, '0'),
    equipment_id          uuid NOT NULL REFERENCES equipment(id),
    reason                tag_reason NOT NULL,
    source                tag_source NOT NULL DEFAULT 'Manual',
    schedule_id           uuid REFERENCES maintenance_schedule(id),
    description           text,
    tagged_out_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
    tagged_out_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    tag_out_signature_id  uuid REFERENCES signature_event(id),
    tagged_in_at          timestamptz,
    tagged_in_by          uuid REFERENCES app_user(id),
    tag_in_signature_id   uuid REFERENCES signature_event(id),
    tag_in_meaning        text,
    record_version        integer NOT NULL DEFAULT 1,
    created_at            timestamptz NOT NULL DEFAULT now(),
    created_by            uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at           timestamptz NOT NULL DEFAULT now(),
    modified_by           uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX equipment_tag_active_idx ON equipment_tag (equipment_id) WHERE tagged_in_at IS NULL;
CALL make_gxp('equipment_tag', false);   -- tag-out and tag-in are signed events; no separate Reason for Change

-------------------------------------------------------------------------------
-- 7. WORK RECORDS: maintenance log entries, calibrations, qualifications, documents
-------------------------------------------------------------------------------
CREATE TYPE equipment_event_type AS ENUM ('Maintenance','Repair','Service visit','Check','Note');
CREATE SEQUENCE equipment_event_seq;
CREATE TABLE equipment_event (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_code           text NOT NULL UNIQUE DEFAULT 'EV-' || lpad(nextval('equipment_event_seq')::text, 6, '0'),
    equipment_id         uuid NOT NULL REFERENCES equipment(id),
    tag_id               uuid REFERENCES equipment_tag(id),
    schedule_id          uuid REFERENCES maintenance_schedule(id),
    event_type           equipment_event_type NOT NULL,
    performed_date       date NOT NULL,
    performed_by_user_id uuid REFERENCES app_user(id),
    performed_by_vendor  text,
    summary              text NOT NULL CHECK (btrim(summary) <> ''),
    status               record_status NOT NULL DEFAULT 'Active',
    record_version       integer NOT NULL DEFAULT 1,
    created_at           timestamptz NOT NULL DEFAULT now(),
    created_by           uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at          timestamptz NOT NULL DEFAULT now(),
    modified_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT equipment_event_who CHECK (performed_by_user_id IS NOT NULL OR btrim(COALESCE(performed_by_vendor, '')) <> '')
);
CREATE INDEX equipment_event_eq_idx ON equipment_event (equipment_id);
CALL make_gxp('equipment_event');

CREATE TYPE cal_result AS ENUM ('Pass','Fail');
CREATE SEQUENCE calibration_seq;
CREATE TABLE calibration (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    calibration_code     text NOT NULL UNIQUE DEFAULT 'CAL-' || lpad(nextval('calibration_seq')::text, 6, '0'),
    equipment_id         uuid NOT NULL REFERENCES equipment(id),
    tag_id               uuid REFERENCES equipment_tag(id),
    performed_date       date NOT NULL,
    expiration_date      date NOT NULL,
    result               cal_result NOT NULL,
    performed_by_user_id uuid REFERENCES app_user(id),
    performed_by_vendor  text,
    certificate_number   text,
    notes                text,
    status               record_status NOT NULL DEFAULT 'Active',
    record_version       integer NOT NULL DEFAULT 1,
    created_at           timestamptz NOT NULL DEFAULT now(),
    created_by           uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at          timestamptz NOT NULL DEFAULT now(),
    modified_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT calibration_who CHECK (performed_by_user_id IS NOT NULL OR btrim(COALESCE(performed_by_vendor, '')) <> ''),
    CONSTRAINT calibration_dates CHECK (expiration_date >= performed_date)
);
CREATE INDEX calibration_eq_idx ON calibration (equipment_id, performed_date DESC);
CALL make_gxp('calibration');

CREATE TYPE qualification_type AS ENUM ('IQ','OQ','PQ','IQ/OQ','IQ/OQ/PQ','Requalification');
CREATE SEQUENCE qualification_seq;
CREATE TABLE qualification (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    qualification_code   text NOT NULL UNIQUE DEFAULT 'QL-' || lpad(nextval('qualification_seq')::text, 6, '0'),
    equipment_id         uuid NOT NULL REFERENCES equipment(id),
    tag_id               uuid REFERENCES equipment_tag(id),
    qualification_type   qualification_type NOT NULL,
    performed_date       date NOT NULL,
    result               cal_result NOT NULL,
    performed_by_user_id uuid REFERENCES app_user(id),
    performed_by_vendor  text,
    protocol_reference   text,
    notes                text,
    status               record_status NOT NULL DEFAULT 'Active',
    record_version       integer NOT NULL DEFAULT 1,
    created_at           timestamptz NOT NULL DEFAULT now(),
    created_by           uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at          timestamptz NOT NULL DEFAULT now(),
    modified_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT qualification_who CHECK (performed_by_user_id IS NOT NULL OR btrim(COALESCE(performed_by_vendor, '')) <> '')
);
CALL make_gxp('qualification');

CREATE TYPE equipment_doc_type AS ENUM ('Calibration certificate','Service report','Qualification report','Manual','Photo','Error log','Invoice','Checklist','Other');
CREATE TABLE equipment_document (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id     uuid NOT NULL REFERENCES equipment(id),
    document_id      uuid NOT NULL REFERENCES document_file(id),
    doc_type         equipment_doc_type NOT NULL,
    title            text,
    calibration_id   uuid REFERENCES calibration(id),
    qualification_id uuid REFERENCES qualification(id),
    event_id         uuid REFERENCES equipment_event(id),
    tag_id           uuid REFERENCES equipment_tag(id),
    status           record_status NOT NULL DEFAULT 'Active',
    record_version   integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at      timestamptz NOT NULL DEFAULT now(),
    modified_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('equipment_document');

CREATE TABLE equipment_transfer (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id     uuid NOT NULL REFERENCES equipment(id),
    from_site_id     uuid NOT NULL REFERENCES lab_site(id),
    to_site_id       uuid NOT NULL REFERENCES lab_site(id),
    tag_id           uuid REFERENCES equipment_tag(id),
    notes            text,
    record_version   integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at      timestamptz NOT NULL DEFAULT now(),
    modified_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT equipment_transfer_other_lab CHECK (from_site_id <> to_site_id)
);
CALL make_gxp('equipment_transfer', false);

-------------------------------------------------------------------------------
-- 8. CALIBRATION STATUS AND AVAILABILITY (derived, never typed)
-------------------------------------------------------------------------------
CREATE FUNCTION current_calibration(p_equipment uuid) RETURNS calibration LANGUAGE sql STABLE AS $$
    SELECT * FROM calibration WHERE equipment_id = p_equipment AND status = 'Active'
     ORDER BY performed_date DESC, created_at DESC LIMIT 1
$$;
CREATE FUNCTION calibration_status(p_equipment uuid) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE e equipment; c calibration; today date;
BEGIN
    SELECT * INTO e FROM equipment WHERE id = p_equipment;
    IF NOT e.calibration_required THEN RETURN 'Not required'; END IF;
    c := current_calibration(p_equipment);
    today := site_today(e.site_id);
    IF c.id IS NULL OR c.result = 'Fail' OR c.expiration_date < today THEN RETURN 'Deficient'; END IF;
    IF c.expiration_date - today <= e.calibration_alert_days THEN RETURN 'Alert'; END IF;
    RETURN 'Conforms';
END $$;

-------------------------------------------------------------------------------
-- 9. RULES ON TAGS AND WORK RECORDS
-------------------------------------------------------------------------------
-- The person who tagged it out, or did or recorded the work under this tag
CREATE FUNCTION tag_workers(p_tag uuid) RETURNS uuid[] LANGUAGE sql STABLE AS $$
    SELECT array_agg(DISTINCT u) FROM (
        SELECT tagged_out_by AS u FROM equipment_tag WHERE id = p_tag
        UNION ALL SELECT unnest(ARRAY[performed_by_user_id, created_by]) FROM equipment_event WHERE tag_id = p_tag AND status = 'Active'
        UNION ALL SELECT unnest(ARRAY[performed_by_user_id, created_by]) FROM calibration WHERE tag_id = p_tag AND status = 'Active'
        UNION ALL SELECT unnest(ARRAY[performed_by_user_id, created_by]) FROM qualification WHERE tag_id = p_tag AND status = 'Active'
    ) x WHERE u IS NOT NULL
$$;

CREATE FUNCTION equipment_tag_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e equipment; v_sig uuid := NULLIF(current_setting('lims.signature_id', true), '')::uuid;
BEGIN
    SELECT * INTO e FROM equipment WHERE id = NEW.equipment_id;
    IF TG_OP = 'INSERT' THEN
        IF e.admin_status = 'Retired' THEN RAISE EXCEPTION '% is retired', e.equipment_code; END IF;
        IF NEW.schedule_id IS NOT NULL AND (SELECT equipment_id FROM maintenance_schedule WHERE id = NEW.schedule_id) <> NEW.equipment_id THEN
            RAISE EXCEPTION 'That maintenance schedule belongs to other equipment';
        END IF;
        IF EXISTS (SELECT 1 FROM equipment_tag WHERE equipment_id = NEW.equipment_id AND tagged_in_at IS NULL AND reason = NEW.reason
                     AND schedule_id IS NOT DISTINCT FROM NEW.schedule_id) THEN
            RAISE EXCEPTION '% is already tagged out for %', e.equipment_code, lower(NEW.reason::text);
        END IF;
        NEW.tagged_in_at := NULL; NEW.tagged_in_by := NULL; NEW.tag_in_signature_id := NULL; NEW.tag_in_meaning := NULL;
        NEW.tagged_out_at := clock_timestamp();
        NEW.tagged_out_by := current_app_user();
        IF NEW.source = 'Manual' OR NOT equipment_internal() THEN
            IF NEW.source <> 'Manual' THEN RAISE EXCEPTION 'Only the system makes automatic tag-outs'; END IF;
            PERFORM require_permission_at('equipment.tag', e.site_id);
            PERFORM assert_signed('tag equipment out');
        END IF;
        NEW.tag_out_signature_id := v_sig;
        RETURN NEW;
    END IF;
    -- After creation only the tag-in can be recorded, once
    IF OLD.tagged_in_at IS NOT NULL THEN RAISE EXCEPTION 'Tag % is closed and cannot be changed', OLD.tag_code; END IF;
    IF (to_jsonb(NEW) - '{tagged_in_at,tagged_in_by,tag_in_signature_id,tag_in_meaning,record_version,modified_at,modified_by}'::text[])
       <> (to_jsonb(OLD) - '{tagged_in_at,tagged_in_by,tag_in_signature_id,tag_in_meaning,record_version,modified_at,modified_by}'::text[]) THEN
        RAISE EXCEPTION 'A tag cannot be changed; tag the equipment back in and tag it out again if needed';
    END IF;
    IF NEW.tagged_in_at IS NULL THEN RETURN NEW; END IF;
    -- Tag-in: a record of the work, and for repair, calibration or qualification a release by someone else
    IF NOT EXISTS (SELECT 1 FROM equipment_event WHERE tag_id = NEW.id AND status = 'Active')
       AND NOT EXISTS (SELECT 1 FROM calibration WHERE tag_id = NEW.id AND status = 'Active')
       AND NOT EXISTS (SELECT 1 FROM qualification WHERE tag_id = NEW.id AND status = 'Active') THEN
        RAISE EXCEPTION 'Record the work done (what was done, by whom, when) before tagging % back in', e.equipment_code;
    END IF;
    IF NEW.reason = 'Calibration' AND e.calibration_required AND calibration_status(e.id) = 'Deficient' THEN
        RAISE EXCEPTION '% has no passing, in-date calibration: record the calibration first', e.equipment_code;
    END IF;
    IF NEW.reason = 'Calibration' AND NOT EXISTS (SELECT 1 FROM calibration WHERE tag_id = NEW.id AND status = 'Active' AND result = 'Pass') THEN
        RAISE EXCEPTION 'Record the passing calibration done under this tag before releasing %', e.equipment_code;
    END IF;
    IF NEW.reason = 'Qualification' AND NOT EXISTS (SELECT 1 FROM qualification WHERE tag_id = NEW.id AND status = 'Active' AND result = 'Pass') THEN
        RAISE EXCEPTION 'Record the passing qualification (IQ/OQ/PQ) done under this tag before releasing %', e.equipment_code;
    END IF;
    IF NEW.reason = 'Maintenance' THEN
        PERFORM require_permission_at('equipment.tag', e.site_id);
        NEW.tag_in_meaning := 'Returned to service by';
    ELSE
        IF NOT has_permission_at('equipment.release', e.site_id) THEN
            RAISE EXCEPTION 'Releasing equipment after % needs the release permission (equipment.release), usually QA', lower(NEW.reason::text);
        END IF;
        IF current_app_user() = ANY (COALESCE(tag_workers(NEW.id), '{}')) THEN
            RAISE EXCEPTION 'You tagged % out or did or recorded the work, so someone else must release it to service', e.equipment_code;
        END IF;
        NEW.tag_in_meaning := 'Released by';
    END IF;
    PERFORM assert_signed('tag equipment back in');
    NEW.tagged_in_at := clock_timestamp();
    NEW.tagged_in_by := current_app_user();
    NEW.tag_in_signature_id := v_sig;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON equipment_tag FOR EACH ROW EXECUTE FUNCTION equipment_tag_rules();

-- Shared checks for the work records: same equipment for the tag and schedule; who did it; not in the future
CREATE FUNCTION equipment_work_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e equipment; j jsonb := to_jsonb(NEW); o jsonb; v_tag uuid := (j->>'tag_id')::uuid; t equipment_tag; v_code text;
        v_core text[] := '{expiration_date,performed_date,result,status}';
BEGIN
    SELECT * INTO e FROM equipment WHERE id = NEW.equipment_id;
    IF TG_OP = 'UPDATE' AND NEW.equipment_id <> OLD.equipment_id THEN RAISE EXCEPTION 'A record cannot move to other equipment'; END IF;
    IF TG_OP = 'INSERT' AND e.admin_status = 'Retired' THEN RAISE EXCEPTION '% is retired', e.equipment_code; END IF;
    IF v_tag IS NOT NULL THEN
        SELECT * INTO t FROM equipment_tag WHERE id = v_tag;
        IF t.equipment_id <> NEW.equipment_id THEN RAISE EXCEPTION 'That tag belongs to other equipment'; END IF;
        IF TG_OP = 'INSERT' AND t.tagged_in_at IS NOT NULL THEN RAISE EXCEPTION 'Tag % is already closed', t.tag_code; END IF;
    END IF;
    IF j ? 'schedule_id' AND j->>'schedule_id' IS NOT NULL
       AND (SELECT equipment_id FROM maintenance_schedule WHERE id = (j->>'schedule_id')::uuid) <> NEW.equipment_id THEN
        RAISE EXCEPTION 'That maintenance schedule belongs to other equipment';
    END IF;
    IF j ? 'performed_date' AND (j->>'performed_date')::date > site_today(e.site_id) THEN
        RAISE EXCEPTION 'The date it was done cannot be in the future';
    END IF;
    IF j ? 'performed_by_user_id' AND TG_OP = 'INSERT' AND j->>'performed_by_user_id' IS NULL AND btrim(COALESCE(j->>'performed_by_vendor', '')) = '' THEN
        NEW := jsonb_populate_record(NEW, jsonb_build_object('performed_by_user_id', current_app_user()));
    END IF;
    IF TG_TABLE_NAME = 'calibration' AND TG_OP = 'INSERT' THEN
        -- default expiry: the instrument's calibration interval
        IF NEW.expiration_date IS NULL AND e.calibration_interval_months IS NOT NULL THEN
            NEW.expiration_date := (NEW.performed_date + make_interval(months => e.calibration_interval_months) - interval '1 day')::date;
        END IF;
        IF NEW.expiration_date IS NULL THEN RAISE EXCEPTION 'Give the calibration expiry date (this equipment has no calibration interval set)'; END IF;
    END IF;
    IF equipment_internal() THEN RETURN NEW; END IF;
    v_code := CASE TG_TABLE_NAME WHEN 'equipment_event' THEN 'equipment.tag' WHEN 'maintenance_schedule' THEN 'equipment.edit' ELSE 'equipment.calibrate' END;
    -- correcting a calibration or qualification (expiry, date, result, or withdrawing it) is QA's, never the performer's
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('calibration','qualification') THEN
        o := to_jsonb(OLD);
        IF EXISTS (SELECT 1 FROM unnest(v_core) k WHERE j->k IS DISTINCT FROM o->k) THEN
            IF NOT has_permission_at('equipment.release', e.site_id) THEN
                RAISE EXCEPTION 'Changing a % record''s expiry, date, result or status needs the release permission (equipment.release), usually QA', replace(TG_TABLE_NAME, '_', ' ');
            END IF;
            IF current_app_user() IN ((o->>'performed_by_user_id')::uuid, (o->>'created_by')::uuid) THEN
                RAISE EXCEPTION 'You did or recorded this %, so someone else must change it', TG_TABLE_NAME;
            END IF;
            v_code := 'equipment.release';
        END IF;
    END IF;
    PERFORM require_permission_at(v_code, e.site_id);
    PERFORM assert_signed(CASE TG_OP WHEN 'INSERT' THEN 'record ' ELSE 'change ' END || replace(replace(TG_TABLE_NAME, 'equipment_event', 'maintenance log entry'), '_', ' '));
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON equipment_event FOR EACH ROW EXECUTE FUNCTION equipment_work_rules();
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON calibration FOR EACH ROW EXECUTE FUNCTION equipment_work_rules();
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON qualification FOR EACH ROW EXECUTE FUNCTION equipment_work_rules();
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON maintenance_schedule FOR EACH ROW EXECUTE FUNCTION equipment_work_rules();

-- Recording scheduled work moves the schedule's next due date on (from the date it was done)
CREATE FUNCTION equipment_event_advance_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s maintenance_schedule; was text := COALESCE(current_setting('lims.equipment_internal', true), ''); r text := current_reason();
BEGIN
    IF NEW.schedule_id IS NULL OR NEW.status <> 'Active' THEN RETURN NULL; END IF;
    SELECT * INTO s FROM maintenance_schedule WHERE id = NEW.schedule_id;
    PERFORM set_config('lims.equipment_internal', '1', true);
    IF r IS NULL THEN PERFORM set_config('lims.reason', 'Scheduled maintenance done: next due date moved on', true); END IF;
    UPDATE maintenance_schedule SET next_due_date = (NEW.performed_date + interval_of(s.interval_count, s.interval_unit))::date
     WHERE id = s.id AND next_due_date <> (NEW.performed_date + interval_of(s.interval_count, s.interval_unit))::date;
    IF r IS NULL THEN PERFORM set_config('lims.reason', '', true); END IF;
    PERFORM set_config('lims.equipment_internal', was, true);
    RETURN NULL;
END $$;
CREATE TRIGGER z_advance AFTER INSERT ON equipment_event FOR EACH ROW EXECUTE FUNCTION equipment_event_advance_schedule();

CREATE FUNCTION equipment_document_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e equipment;
BEGIN
    SELECT * INTO e FROM equipment WHERE id = NEW.equipment_id;
    IF TG_OP = 'UPDATE' AND (NEW.document_id <> OLD.document_id OR NEW.equipment_id <> OLD.equipment_id) THEN
        RAISE EXCEPTION 'An uploaded document cannot be swapped; upload the new one and set this one Inactive';
    END IF;
    IF (NEW.calibration_id IS NOT NULL AND (SELECT equipment_id FROM calibration WHERE id = NEW.calibration_id) <> NEW.equipment_id)
       OR (NEW.qualification_id IS NOT NULL AND (SELECT equipment_id FROM qualification WHERE id = NEW.qualification_id) <> NEW.equipment_id)
       OR (NEW.event_id IS NOT NULL AND (SELECT equipment_id FROM equipment_event WHERE id = NEW.event_id) <> NEW.equipment_id)
       OR (NEW.tag_id IS NOT NULL AND (SELECT equipment_id FROM equipment_tag WHERE id = NEW.tag_id) <> NEW.equipment_id) THEN
        RAISE EXCEPTION 'The document is linked to a record of other equipment';
    END IF;
    IF equipment_internal() THEN RETURN NEW; END IF;
    IF NOT (has_permission_at('equipment.edit', e.site_id) OR has_permission_at('equipment.tag', e.site_id) OR has_permission_at('equipment.calibrate', e.site_id)) THEN
        RAISE EXCEPTION 'You do not have permission to add documents to this lab''s equipment (equipment.edit, equipment.tag or equipment.calibrate)';
    END IF;
    PERFORM assert_signed('add or change an equipment document');
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON equipment_document FOR EACH ROW EXECUTE FUNCTION equipment_document_rules();

CREATE FUNCTION equipment_transfer_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'A transfer record cannot be changed'; END IF;
    IF NOT equipment_internal() THEN RAISE EXCEPTION 'Use Transfer on the equipment page'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON equipment_transfer FOR EACH ROW EXECUTE FUNCTION equipment_transfer_rules();

-------------------------------------------------------------------------------
-- 10. ACTIONS: transfer to another lab, automatic tag-outs
-------------------------------------------------------------------------------
-- Move equipment to another lab with its history. The sender needs equipment.edit and signs; the receiving lab
-- gets it tagged out for Qualification, owned by the group named here, until its own release.
CREATE FUNCTION transfer_equipment(p_equipment uuid, p_to_site uuid, p_owner_group uuid, p_notes text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE e equipment; v_type uuid; v_tag uuid; v_id uuid; tname text; was text := COALESCE(current_setting('lims.equipment_internal', true), '');
BEGIN
    SELECT * INTO e FROM equipment WHERE id = p_equipment FOR UPDATE;
    IF e.id IS NULL THEN RAISE EXCEPTION 'Equipment not found'; END IF;
    IF e.admin_status = 'Retired' THEN RAISE EXCEPTION '% is retired', e.equipment_code; END IF;
    IF p_to_site = e.site_id THEN RAISE EXCEPTION 'Pick another lab'; END IF;
    PERFORM require_permission_at('equipment.edit', e.site_id);
    PERFORM assert_signed('transfer equipment to another lab');
    IF (SELECT site_id FROM lab_group WHERE id = p_owner_group AND status = 'Active') IS DISTINCT FROM p_to_site THEN
        RAISE EXCEPTION 'Name a group of the receiving lab to be responsible for it';
    END IF;
    tname := (SELECT type_name FROM equipment_type WHERE id = e.equipment_type_id);
    PERFORM set_config('lims.equipment_internal', '1', true);
    IF current_reason() IS NULL THEN
        PERFORM set_config('lims.reason', 'Transferred to ' || (SELECT site_code FROM lab_site WHERE id = p_to_site) || COALESCE(': ' || NULLIF(btrim(p_notes), ''), ''), true);
    END IF;
    -- the receiving lab's type of the same name (added to its list if it has none)
    SELECT id INTO v_type FROM equipment_type WHERE site_id = p_to_site AND lower(type_name) = lower(tname);
    IF v_type IS NULL THEN
        INSERT INTO equipment_type (site_id, type_name, description) VALUES (p_to_site, tname, 'Added when ' || e.equipment_code || ' was transferred in') RETURNING id INTO v_type;
    END IF;
    UPDATE equipment_owner SET status = 'Inactive' WHERE equipment_id = e.id AND status = 'Active';
    UPDATE equipment SET site_id = p_to_site, equipment_type_id = v_type, department_id = NULL, location_id = NULL WHERE id = e.id;
    INSERT INTO equipment_owner (equipment_id, group_id) VALUES (e.id, p_owner_group);
    INSERT INTO equipment_tag (equipment_id, reason, source, description)
    VALUES (e.id, 'Qualification', 'Transfer', 'Transferred in from ' || (SELECT site_code FROM lab_site WHERE id = e.site_id) || ': qualify before use') RETURNING id INTO v_tag;
    INSERT INTO equipment_transfer (equipment_id, from_site_id, to_site_id, tag_id, notes) VALUES (e.id, e.site_id, p_to_site, v_tag, p_notes) RETURNING id INTO v_id;
    PERFORM set_config('lims.equipment_internal', was, true);
    RETURN v_id;
END $$;

-- Tag out what is due: expired or missing calibration, maintenance due with "tag out when due". Made by System.
CREATE FUNCTION equipment_auto_tag(p_site uuid DEFAULT NULL) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE e record; s record; n integer := 0; c calibration; was text := COALESCE(current_setting('lims.equipment_internal', true), '');
BEGIN
    PERFORM set_config('lims.equipment_internal', '1', true);
    FOR e IN SELECT * FROM equipment WHERE admin_status = 'In Service' AND calibration_required AND (p_site IS NULL OR site_id = p_site) LOOP
        IF calibration_status(e.id) = 'Deficient'
           AND NOT EXISTS (SELECT 1 FROM equipment_tag WHERE equipment_id = e.id AND reason = 'Calibration' AND tagged_in_at IS NULL) THEN
            c := current_calibration(e.id);
            INSERT INTO equipment_tag (equipment_id, reason, source, description)
            VALUES (e.id, 'Calibration', 'Calibration due', CASE WHEN c.id IS NULL THEN 'No calibration on record'
                        WHEN c.result = 'Fail' THEN 'Last calibration ' || c.calibration_code || ' failed'
                        ELSE 'Calibration ' || c.calibration_code || ' expired ' || to_char(c.expiration_date, 'YYYY-MM-DD') END);
            n := n + 1;
        END IF;
    END LOOP;
    FOR s IN SELECT ms.*, eq.site_id FROM maintenance_schedule ms JOIN equipment eq ON eq.id = ms.equipment_id
              WHERE ms.status = 'Active' AND ms.tag_out_when_due AND eq.admin_status = 'In Service' AND (p_site IS NULL OR eq.site_id = p_site)
                AND ms.next_due_date <= site_today(eq.site_id) LOOP
        IF NOT EXISTS (SELECT 1 FROM equipment_tag WHERE schedule_id = s.id AND tagged_in_at IS NULL) THEN
            INSERT INTO equipment_tag (equipment_id, reason, source, schedule_id, description)
            VALUES (s.equipment_id, 'Maintenance', 'Maintenance due', s.id, s.task_name || ' due ' || to_char(s.next_due_date, 'YYYY-MM-DD'));
            n := n + 1;
        END IF;
    END LOOP;
    PERFORM set_config('lims.equipment_internal', was, true);
    RETURN n;
END $$;

-------------------------------------------------------------------------------
-- 11. VIEWS: the equipment list, and what is due
-------------------------------------------------------------------------------
CREATE VIEW equipment_view AS
SELECT e.*, s.site_code, s.site_name, t.type_name, d.department_code, d.department_name,
       loc.location_code, CASE WHEN loc.id IS NULL THEN NULL ELSE location_path(loc.id) END AS location_path,
       cal.id AS cal_id, cal.calibration_code AS cal_code, cal.performed_date AS cal_date, cal.expiration_date AS cal_expires, cal.result AS cal_result,
       CASE WHEN cal.id IS NULL THEN NULL ELSE cal.expiration_date - site_today(e.site_id) END AS cal_days_left,
       calibration_status(e.id) AS calibration_status,
       tg.tagged_for, COALESCE(tg.active_count, 0) AS active_tags,
       CASE WHEN e.admin_status <> 'In Service' THEN e.admin_status::text
            WHEN COALESCE(tg.active_count, 0) > 0 THEN 'Tagged out'
            ELSE 'Available' END AS availability,
       ow.owners, COALESCE(ow.owner_count, 0) AS owner_count,
       ms.next_due AS maintenance_due, ms.next_task AS maintenance_task,
       CASE WHEN ms.next_due IS NULL THEN NULL WHEN ms.next_due < site_today(e.site_id) THEN 'Overdue'
            WHEN ms.next_due = site_today(e.site_id) THEN 'Due today' WHEN ms.next_due - site_today(e.site_id) <= ms.alert THEN 'Due soon' ELSE 'Scheduled' END AS maintenance_status,
       cu.full_name AS created_by_name, mu.full_name AS modified_by_name
  FROM equipment e JOIN lab_site s ON s.id = e.site_id JOIN equipment_type t ON t.id = e.equipment_type_id
  LEFT JOIN department d ON d.id = e.department_id LEFT JOIN storage_location loc ON loc.id = e.location_id
  LEFT JOIN LATERAL (SELECT * FROM calibration c WHERE c.equipment_id = e.id AND c.status = 'Active' ORDER BY c.performed_date DESC, c.created_at DESC LIMIT 1) cal ON true
  LEFT JOIN LATERAL (SELECT string_agg(reason::text, ', ' ORDER BY reason) AS tagged_for, count(*) AS active_count FROM equipment_tag x WHERE x.equipment_id = e.id AND x.tagged_in_at IS NULL) tg ON true
  LEFT JOIN LATERAL (SELECT string_agg(COALESCE(g.group_name, u.full_name), ', ' ORDER BY o.user_id IS NOT NULL, COALESCE(g.group_name, u.full_name)) AS owners, count(*) AS owner_count
                       FROM equipment_owner o LEFT JOIN lab_group g ON g.id = o.group_id LEFT JOIN app_user u ON u.id = o.user_id
                      WHERE o.equipment_id = e.id AND o.status = 'Active') ow ON true
  LEFT JOIN LATERAL (SELECT m.next_due_date AS next_due, m.task_name AS next_task, m.alert_days AS alert FROM maintenance_schedule m
                      WHERE m.equipment_id = e.id AND m.status = 'Active' ORDER BY m.next_due_date LIMIT 1) ms ON true
  JOIN app_user cu ON cu.id = e.created_by JOIN app_user mu ON mu.id = e.modified_by;

-- Everything needing attention, one row per item (calibration, maintenance, open tag, no owner)
CREATE VIEW equipment_due_view AS
SELECT e.id AS equipment_id, e.site_id, e.equipment_code, e.equipment_name, e.type_name, e.owners,
       'Calibration'::text AS kind,
       CASE WHEN e.cal_id IS NULL THEN 'No calibration on record' WHEN e.cal_result = 'Fail' THEN 'Last calibration failed'
            WHEN e.calibration_status = 'Deficient' THEN 'Calibration expired' ELSE 'Calibration due soon' END AS what,
       e.cal_expires AS due_date,
       CASE WHEN e.calibration_status = 'Deficient' THEN 'Overdue' ELSE 'Due soon' END AS urgency, NULL::uuid AS tag_id, NULL::uuid AS schedule_id
  FROM equipment_view e WHERE e.admin_status = 'In Service' AND e.calibration_status IN ('Alert','Deficient')
   AND NOT (e.calibration_status = 'Deficient' AND COALESCE(e.tagged_for, '') LIKE '%Calibration%')   -- shown as its tag instead
UNION ALL
SELECT e.id, e.site_id, e.equipment_code, e.equipment_name, e.type_name, e.owners, 'Maintenance', m.task_name, m.next_due_date,
       CASE WHEN m.next_due_date <= site_today(e.site_id) THEN 'Overdue' ELSE 'Due soon' END, NULL, m.id
  FROM maintenance_schedule m JOIN equipment_view e ON e.id = m.equipment_id
 WHERE m.status = 'Active' AND e.admin_status = 'In Service' AND m.next_due_date - site_today(e.site_id) <= m.alert_days
   AND NOT EXISTS (SELECT 1 FROM equipment_tag t WHERE t.schedule_id = m.id AND t.tagged_in_at IS NULL)   -- shown as its tag instead
UNION ALL
SELECT e.id, e.site_id, e.equipment_code, e.equipment_name, e.type_name, e.owners, 'Tagged out',
       t.reason::text || COALESCE(': ' || t.description, '') ||
         CASE WHEN t.reason = 'Maintenance' THEN '' WHEN EXISTS (SELECT 1 FROM equipment_event v WHERE v.tag_id = t.id)
                OR EXISTS (SELECT 1 FROM calibration v WHERE v.tag_id = t.id) OR EXISTS (SELECT 1 FROM qualification v WHERE v.tag_id = t.id)
              THEN ' (work recorded: waiting for release)' ELSE '' END,
       t.tagged_out_at::date, 'Tagged out', t.id, t.schedule_id
  FROM equipment_tag t JOIN equipment_view e ON e.id = t.equipment_id WHERE t.tagged_in_at IS NULL
UNION ALL
SELECT e.id, e.site_id, e.equipment_code, e.equipment_name, e.type_name, e.owners, 'No owner', 'Nobody is responsible for it: add a group or person', NULL, 'Overdue', NULL, NULL
  FROM equipment_view e WHERE e.admin_status <> 'Retired' AND e.owner_count = 0;

-------------------------------------------------------------------------------
-- 12. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_slice8;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE lbl text; eq uuid; e equipment;
BEGIN
    IF p_table = 'department' THEN
        RETURN jsonb_build_object('label', 'Department ' || (r->>'department_code') || ' ' || (r->>'department_name'), 'link', '#/equipment/lists');
    ELSIF p_table = 'equipment_type' THEN
        RETURN jsonb_build_object('label', 'Equipment type ' || (r->>'type_name'), 'link', '#/equipment/lists');
    ELSIF p_table NOT IN ('equipment','equipment_owner','maintenance_schedule','equipment_tag','equipment_event','calibration','qualification','equipment_document','equipment_transfer') THEN
        RETURN audit_record_ref_slice8(p_table, p_id, r);
    END IF;
    eq := CASE WHEN p_table = 'equipment' THEN p_id ELSE (r->>'equipment_id')::uuid END;
    SELECT * INTO e FROM equipment WHERE id = eq;
    lbl := CASE p_table
        WHEN 'equipment' THEN ''
        WHEN 'equipment_owner' THEN ': owner ' || COALESCE((SELECT group_name FROM lab_group WHERE id = (r->>'group_id')::uuid), (SELECT full_name FROM app_user WHERE id = (r->>'user_id')::uuid), '')
        WHEN 'maintenance_schedule' THEN ': schedule ' || (r->>'task_name')
        WHEN 'equipment_tag' THEN ': ' || (r->>'tag_code') || ' (' || (r->>'reason') || ')'
        WHEN 'equipment_event' THEN ': ' || (r->>'event_code') || ' ' || (r->>'event_type')
        WHEN 'calibration' THEN ': ' || (r->>'calibration_code')
        WHEN 'qualification' THEN ': ' || (r->>'qualification_code') || ' ' || (r->>'qualification_type')
        WHEN 'equipment_document' THEN ': document ' || COALESCE(r->>'title', r->>'doc_type')
        WHEN 'equipment_transfer' THEN ': transfer'
    END;
    RETURN jsonb_build_object('label', COALESCE(e.equipment_code || ' ' || e.equipment_name, 'Equipment') || COALESCE(lbl, ''), 'link', '#/equipment/' || eq);
END $$;

-- Canned reasons can be kept for the Equipment module (the demo reasons are in seed_008)
ALTER TABLE reason_code DROP CONSTRAINT reason_code_module_check;
ALTER TABLE reason_code ADD CONSTRAINT reason_code_module_check CHECK (module IN ('General','Clients','Orders','Quotes','Catalog','Inventory','Equipment','Admin'));

SELECT set_config('lims.group_sync', '', true);
COMMIT;
