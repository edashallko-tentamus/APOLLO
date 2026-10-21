-- LIMS3 schema, migration 010: EQUIPMENT FEEDBACK (Alex Kiddle, 2026-10-12)
--  - Analysts may add and change equipment (equipment.edit added to the standard Analyst group of every lab).
--  - Every piece of equipment belongs to a department of its lab (required unless retired); a transfer names the
--    receiving lab's department as well as its responsible group.

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);

UPDATE standard_group_template SET permissions = permissions || '{equipment.edit}'::text[]
 WHERE group_name = 'Analyst' AND NOT ('equipment.edit' = ANY (permissions));
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, 'equipment.edit' FROM lab_group g WHERE g.is_standard AND g.site_id IS NOT NULL AND g.group_name = 'Analyst'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION equipment_rules() RETURNS trigger LANGUAGE plpgsql AS $$
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
    -- every piece of equipment belongs to a department of its lab (Alex, 2026-10-12)
    IF NEW.department_id IS NULL AND NEW.admin_status <> 'Retired' THEN
        RAISE EXCEPTION 'Pick the department % belongs to (from this lab''s Departments list)', COALESCE(NEW.equipment_name, 'the equipment');
    END IF;
    IF equipment_internal() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('equipment.edit', CASE WHEN TG_OP = 'UPDATE' THEN OLD.site_id ELSE NEW.site_id END);
    PERFORM assert_signed(CASE TG_OP WHEN 'INSERT' THEN 'add equipment' ELSE 'change equipment' END);
    RETURN NEW;
END $$;

DROP FUNCTION transfer_equipment(uuid, uuid, uuid, text);
CREATE FUNCTION transfer_equipment(p_equipment uuid, p_to_site uuid, p_owner_group uuid, p_department uuid, p_notes text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
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
    IF (SELECT site_id FROM department WHERE id = p_department AND status = 'Active') IS DISTINCT FROM p_to_site THEN
        RAISE EXCEPTION 'Pick the department of the receiving lab it will belong to';
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
    UPDATE equipment SET site_id = p_to_site, equipment_type_id = v_type, department_id = p_department, location_id = NULL WHERE id = e.id;
    INSERT INTO equipment_owner (equipment_id, group_id) VALUES (e.id, p_owner_group);
    INSERT INTO equipment_tag (equipment_id, reason, source, description)
    VALUES (e.id, 'Qualification', 'Transfer', 'Transferred in from ' || (SELECT site_code FROM lab_site WHERE id = e.site_id) || ': qualify before use') RETURNING id INTO v_tag;
    INSERT INTO equipment_transfer (equipment_id, from_site_id, to_site_id, tag_id, notes) VALUES (e.id, e.site_id, p_to_site, v_tag, p_notes) RETURNING id INTO v_id;
    PERFORM set_config('lims.equipment_internal', was, true);
    RETURN v_id;
END $$;


SELECT set_config('lims.group_sync', '', true);
COMMIT;
