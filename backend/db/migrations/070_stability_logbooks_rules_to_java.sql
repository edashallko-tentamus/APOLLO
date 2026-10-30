-- 070: the stability, logbook design, sensor link, trend chart and dashboard rules move to the Java backend (Edashall
-- Konah, 2026-10-29; the database keeps structures only). Java checks them before every write: stability/domain
-- (StabilitySetup, StabilityDesign, ExcursionAssessment), logbooks/domain (Logbook, LogbookField, CoveredEquipment),
-- sensors/domain (SensorConnection, SensorLink), trending/domain (TrendChart, SignalReview), dashboard/domain
-- (DashboardLayout, FinanceFigure), loaded and saved by each feature's repo/, with JUnit tests StabilityRulesTest,
-- LogbookDesignRulesTest, SensorRulesTest, TrendChartRulesTest and DashboardRulesTest.
--
-- Dropped here (Java is now their only checker):
--   * trend_chart_qa_rules (a02_qa: QA review and status follow the chart), approve_trend_chart, record_trend_limits_applied
--     and the rule part of trend_rules (stays with its lab, frozen limits and their baseline, only QC charts in QC Review);
--     the chart name and review comment checks;
--   * user_dashboard_layout_rules (own layout only, widget sizes, updated_at: Java writes it); the rule part of
--     finance_rules (a week at most a week ahead, nothing negative) and of group_widget_rules (a row keeps its keys);
--   * approve_sensor_link, retire_sensor_link, the rule part of sensor_connection_rules (the address) and of
--     sensor_link_rules on insert (the sensor's lab, sensor_link_problem, trimming); the sensor ID, gap, read-every and
--     look-back checks;
--   * the rule part of logbook_rules, logbook_field_rules and logbook_equipment_rules (names, keys, choices, limits,
--     publishing, what a logbook is about, lots it makes, equipment of its lab, an Effective design locked); the name,
--     label and validity checks;
--   * assess_stability_excursion; the rule part of stability_setup_rules (retired equipment, a chamber's equipment and
--     condition, material stored in a chamber or rack, a condition on a quote) and stability_design_rules (the plan's lab,
--     conditions of the lab, T0 and pulls, the test's lab, the design locked once issued, what an amendment may change);
--     the condition name, humidity, rack code, positions, timepoint, units, escalation, reserve and justification checks.
--
-- Kept, with Java's own copy where Java writes:
--   * every permission check of these triggers (a later wave moves the permission triggers), the electronic signature
--     on a new sensor link, a chamber taking its lab from its equipment (seed_025 inserts chambers without one), and the
--     "only through its actions" guard on sensor_link updates: Node's Re-judge (request_sensor_rejudge) and the sensor
--     feed (sensor_feed_refresh) still run in Node and rely on it; Java's approve and retire are such actions;
--   * sensor_link_problem: Node's Sensors page lists it; Java reads it and refuses itself;
--   * logbook_version_rules, logbook_entry_rules and the sensor entry triggers: only kept functions (new_logbook_version,
--     approve_logbook_version, called by seeds 027 and 028) and the Node sensor feed write those rows;
--   * stability_record_rules, stability_report_rules, the quote issue check (d_stability_issue), z_line_quantity and every
--     study action (place_stability_study, record_stability_pull, create_due_stability_pulls, issue_stability_report,
--     cancel_stability_study, dispose_stability_material, new_stability_version): seed_025, Node's issue route and the
--     hourly pull job call them; stability_study_of_version and stability_timepoint_used, which Java reads;
--   * trend_limits_for_test (a read model Java uses) and inventory_lot_department_rule (inventory writes it).
-- Sandbox only: other writers of these tables (data load scripts) are no longer checked by the dropped rules.

-- trending ------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trend_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid;
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'trend_chart' THEN v_site := NEW.site_id;
    ELSE SELECT site_id INTO v_site FROM trend_chart WHERE id = NEW.chart_id; END IF;
    PERFORM require_permission_at('trending.manage', v_site);
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a02_qa ON trend_chart;
DROP FUNCTION IF EXISTS trend_chart_qa_rules();
DROP FUNCTION IF EXISTS approve_trend_chart(uuid);
DROP FUNCTION IF EXISTS record_trend_limits_applied(uuid, uuid);
ALTER TABLE trend_chart DROP CONSTRAINT IF EXISTS trend_chart_chart_name_check;
ALTER TABLE trend_signal_review DROP CONSTRAINT IF EXISTS trend_signal_review_comment_check;

-- dashboards and finance figures --------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS a01_rules ON user_dashboard_layout;
DROP FUNCTION IF EXISTS user_dashboard_layout_rules();
CREATE OR REPLACE FUNCTION finance_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NOT has_permission_at('finance.enter', NEW.site_id) THEN
        RAISE EXCEPTION 'Only system administrators and the Finance group type the finance figures (finance.enter)';
    END IF;
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION group_widget_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g lab_group;
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    SELECT * INTO g FROM lab_group WHERE id = NEW.group_id;
    IF g.site_id IS NULL THEN
        IF NOT current_user_is_admin() THEN RAISE EXCEPTION 'Only a system administrator sets an all-labs group''s widgets'; END IF;
    ELSE PERFORM require_permission_at('admin.groups', g.site_id); END IF;
    RETURN NEW;
END $$;

-- sensors -------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sensor_connection_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NOT current_user_is_admin() THEN RAISE EXCEPTION 'Only a system administrator sets the sensor connection'; END IF;
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION sensor_link_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NOT sensor_internal() THEN RAISE EXCEPTION 'A sensor link is approved or retired with its own actions; to change one, retire it and link the sensor again'; END IF;
        RETURN NEW;
    END IF;
    PERFORM require_permission_at('sensors.configure', NEW.site_id);
    PERFORM assert_signed('link a sensor');
    RETURN NEW;
END $$;
DROP FUNCTION IF EXISTS approve_sensor_link(uuid, timestamptz);
DROP FUNCTION IF EXISTS retire_sensor_link(uuid, text);
ALTER TABLE sensor_link DROP CONSTRAINT IF EXISTS sensor_link_external_id_check;
ALTER TABLE sensor_link DROP CONSTRAINT IF EXISTS sensor_link_gap_minutes_check;
ALTER TABLE sensor_connection DROP CONSTRAINT IF EXISTS sensor_connection_read_every_minutes_check;
ALTER TABLE sensor_connection DROP CONSTRAINT IF EXISTS sensor_connection_lookback_hours_check;

-- logbook design ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION logbook_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF logbook_internal() OR in_group_sync() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('logbook.design', NEW.site_id);
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION logbook_field_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF logbook_internal() OR in_group_sync() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('logbook.design', (SELECT l.site_id FROM logbook_version v JOIN logbook l ON l.id = v.logbook_id WHERE v.id = NEW.version_id));
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION logbook_equipment_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF logbook_internal() OR in_group_sync() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('logbook.design', (SELECT site_id FROM logbook WHERE id = NEW.logbook_id));
    RETURN NEW;
END $$;
ALTER TABLE logbook DROP CONSTRAINT IF EXISTS logbook_logbook_name_check;
ALTER TABLE logbook DROP CONSTRAINT IF EXISTS logbook_validity_hours_check;
ALTER TABLE logbook_field DROP CONSTRAINT IF EXISTS logbook_field_label_check;

-- stability -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stability_setup_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid;
BEGIN
    IF TG_TABLE_NAME = 'stability_chamber' THEN
        NEW.site_id := (SELECT site_id FROM equipment WHERE id = NEW.equipment_id);   -- seed_025 inserts chambers without their lab
        v_site := NEW.site_id;
    ELSIF TG_TABLE_NAME = 'stability_rack' THEN
        SELECT site_id INTO v_site FROM stability_chamber WHERE id = NEW.chamber_id;
    ELSE -- stability_condition
        IF in_group_sync() THEN RETURN NEW; END IF;
        IF NEW.site_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.site_id IS NULL) THEN
            IF NOT current_user_is_admin() THEN RAISE EXCEPTION 'Conditions for every lab are kept by a system administrator; add one for your lab instead'; END IF;
            RETURN NEW;
        END IF;
        v_site := NEW.site_id;
    END IF;
    IF in_group_sync() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('stability.configure', v_site);
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION stability_design_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF stability_internal() THEN RETURN NEW; END IF;
    IF NOT has_permission('quotes.edit') THEN RAISE EXCEPTION 'You do not have permission to change quotes (quotes.edit). Ask your lab administrator.'; END IF;
    RETURN NEW;
END $$;
DROP FUNCTION IF EXISTS assess_stability_excursion(uuid, uuid, text, text);
ALTER TABLE stability_condition DROP CONSTRAINT IF EXISTS stability_condition_condition_name_check;
ALTER TABLE stability_condition DROP CONSTRAINT IF EXISTS stability_condition_humidity_pct_check;
ALTER TABLE stability_rack DROP CONSTRAINT IF EXISTS stability_rack_rack_code_check;
ALTER TABLE stability_rack DROP CONSTRAINT IF EXISTS stability_rack_positions_check;
ALTER TABLE stability_plan DROP CONSTRAINT IF EXISTS stability_plan_escalation_pct_check;
ALTER TABLE stability_plan DROP CONSTRAINT IF EXISTS stability_plan_reserve_pct_check;
ALTER TABLE stability_timepoint DROP CONSTRAINT IF EXISTS stability_timepoint_label_check;
ALTER TABLE stability_timepoint DROP CONSTRAINT IF EXISTS stability_timepoint_interval_value_check;
ALTER TABLE stability_timepoint DROP CONSTRAINT IF EXISTS stability_timepoint_days_early_check;
ALTER TABLE stability_timepoint DROP CONSTRAINT IF EXISTS stability_timepoint_days_late_check;
ALTER TABLE stability_cell DROP CONSTRAINT IF EXISTS stability_cell_units_required_check;
ALTER TABLE stability_excursion_assessment DROP CONSTRAINT IF EXISTS stability_excursion_assessment_justification_check;
