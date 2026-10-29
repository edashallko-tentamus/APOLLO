-- 064: the equipment rules move to the Java backend (Edashall Konah, 2026-10-29; the database keeps structures only).
-- Java checks them before every write (equipment/domain: Equipment, Owners, EquipmentTag, WorkRecord, MaintenanceSchedule,
-- Transfer, AutoTag, CalibrationStatus, LabListEntry; run by equipment/service/EquipmentService through repo/EquipmentStore),
-- with JUnit tests in EquipmentRulesTest.
--
-- Dropped here (Java is now their only checker):
--   * the rules part of equipment_list_rules (department codes in capitals, names trimmed) and the non-blank checks on
--     department codes and names and equipment type names;
--   * the rules part of equipment_work_rules (not on retired equipment, the tag and schedule of the same equipment and the
--     tag still open, not in the future, the person recording it as the default performer, the calibration expiry from
--     the instrument's interval, a correction never by the person who did or recorded it) and the checks on who did it,
--     the summary, the calibration dates and the schedule's task, interval and warning days;
--   * equipment_event_advance_schedule (z_advance): Java moves the schedule's next due date on;
--   * the tag-in half of equipment_tag_rules (closed tags frozen, a tag never edited, the work recorded, a passing
--     calibration or qualification, the release by someone who did not tag it out or do the work, who and what is
--     stamped): Java checks it and writes tagged_in_by, tag_in_meaning and tag_in_signature_id itself;
--   * the rules part of equipment_document_rules (a file never swapped, links to records of the same equipment);
--   * equipment_transfer_rules and transfer_equipment(): Java's Transfer does the move (the Node route that called it
--     was ported to Java), and the check that a transfer goes to another lab.
--
-- Kept, with Java's own copy for Java's writes:
--   * equipment_rules, equipment_owner_rules, equipment_owner_required (z_owner_required), the tag-out half of
--     equipment_tag_rules, the equipment column checks and equipment_owner_one_kind: still called by purchasing
--     (receive_purchase_line writes received equipment, its owner and its Qualification tag), the Node server's hourly
--     automatic tag-out and the demo data load, which write these tables directly;
--   * equipment_auto_tag: still called by the Node server's hourly job (Java's own copy is AutoTag, run before the lists);
--   * calibration_status, current_calibration, tag_workers, is_equipment_owner, interval_of, equipment_view and
--     equipment_due_view: read by the views, the bench (entry_equipment), logbooks, custody, labels and the read models;
--   * equipment_internal(): read by the kept triggers and set by purchasing.
-- Every permission check and signature check of these triggers stays (a later wave moves the permission triggers).
-- Sandbox only: other writers of the dropped rules' tables (data load scripts) are no longer checked by the database.

-- department and equipment_type: who may change the lists and the signature only
CREATE OR REPLACE FUNCTION equipment_list_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF equipment_internal() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('equipment.lists', NEW.site_id);
    PERFORM assert_signed('change the ' || replace(TG_TABLE_NAME, '_', ' ') || ' list');
    RETURN NEW;
END $$;
ALTER TABLE department DROP CONSTRAINT IF EXISTS department_department_code_check;
ALTER TABLE department DROP CONSTRAINT IF EXISTS department_department_name_check;
ALTER TABLE equipment_type DROP CONSTRAINT IF EXISTS equipment_type_type_name_check;

-- equipment_event, calibration, qualification, maintenance_schedule: who may record or correct, and the signature only
CREATE OR REPLACE FUNCTION equipment_work_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e equipment; j jsonb := to_jsonb(NEW); o jsonb; v_code text;
        v_core text[] := '{expiration_date,performed_date,result,status}';
BEGIN
    IF equipment_internal() THEN RETURN NEW; END IF;
    SELECT * INTO e FROM equipment WHERE id = NEW.equipment_id;
    v_code := CASE TG_TABLE_NAME WHEN 'equipment_event' THEN 'equipment.tag' WHEN 'maintenance_schedule' THEN 'equipment.edit' ELSE 'equipment.calibrate' END;
    -- correcting a calibration or qualification (expiry, date, result, or withdrawing it) needs the release permission
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('calibration','qualification') THEN
        o := to_jsonb(OLD);
        IF EXISTS (SELECT 1 FROM unnest(v_core) k WHERE j->k IS DISTINCT FROM o->k) THEN
            IF NOT has_permission_at('equipment.release', e.site_id) THEN
                RAISE EXCEPTION 'Changing a % record''s expiry, date, result or status needs the release permission (equipment.release), usually QA', replace(TG_TABLE_NAME, '_', ' ');
            END IF;
            v_code := 'equipment.release';
        END IF;
    END IF;
    PERFORM require_permission_at(v_code, e.site_id);
    PERFORM assert_signed(CASE TG_OP WHEN 'INSERT' THEN 'record ' ELSE 'change ' END || replace(replace(TG_TABLE_NAME, 'equipment_event', 'maintenance log entry'), '_', ' '));
    RETURN NEW;
END $$;
ALTER TABLE calibration DROP CONSTRAINT IF EXISTS calibration_who;
ALTER TABLE calibration DROP CONSTRAINT IF EXISTS calibration_dates;
ALTER TABLE qualification DROP CONSTRAINT IF EXISTS qualification_who;
ALTER TABLE equipment_event DROP CONSTRAINT IF EXISTS equipment_event_who;
ALTER TABLE equipment_event DROP CONSTRAINT IF EXISTS equipment_event_summary_check;
ALTER TABLE maintenance_schedule DROP CONSTRAINT IF EXISTS maintenance_schedule_task_name_check;
ALTER TABLE maintenance_schedule DROP CONSTRAINT IF EXISTS maintenance_schedule_interval_count_check;
ALTER TABLE maintenance_schedule DROP CONSTRAINT IF EXISTS maintenance_schedule_interval_unit_check;
ALTER TABLE maintenance_schedule DROP CONSTRAINT IF EXISTS maintenance_schedule_alert_days_check;

-- scheduled work moving the next due date on: now Java's (MaintenanceSchedule.nextDueAfter)
DROP TRIGGER IF EXISTS z_advance ON equipment_event;
DROP FUNCTION IF EXISTS equipment_event_advance_schedule();

-- equipment_tag: the tag-out half stays (purchasing and the hourly job); the tag-in keeps only who may and the signature
CREATE OR REPLACE FUNCTION equipment_tag_rules() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF NEW.reason = 'Maintenance' THEN
        PERFORM require_permission_at('equipment.tag', e.site_id);
    ELSIF NOT has_permission_at('equipment.release', e.site_id) THEN
        RAISE EXCEPTION 'Releasing equipment after % needs the release permission (equipment.release), usually QA', lower(NEW.reason::text);
    END IF;
    PERFORM assert_signed('tag equipment back in');
    RETURN NEW;
END $$;

-- equipment_document: who may add documents and the signature only
CREATE OR REPLACE FUNCTION equipment_document_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e equipment;
BEGIN
    IF equipment_internal() THEN RETURN NEW; END IF;
    SELECT * INTO e FROM equipment WHERE id = NEW.equipment_id;
    IF NOT (has_permission_at('equipment.edit', e.site_id) OR has_permission_at('equipment.tag', e.site_id) OR has_permission_at('equipment.calibrate', e.site_id)) THEN
        RAISE EXCEPTION 'You do not have permission to add documents to this lab''s equipment (equipment.edit, equipment.tag or equipment.calibrate)';
    END IF;
    PERFORM assert_signed('add or change an equipment document');
    RETURN NEW;
END $$;

-- transfers: now Java's Transfer
DROP TRIGGER IF EXISTS a0_rules ON equipment_transfer;
DROP FUNCTION IF EXISTS equipment_transfer_rules();
DROP FUNCTION IF EXISTS transfer_equipment(uuid, uuid, uuid, uuid, text);
ALTER TABLE equipment_transfer DROP CONSTRAINT IF EXISTS equipment_transfer_other_lab;
