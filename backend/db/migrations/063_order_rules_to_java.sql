-- 063: the orders and intake rules move to the Java backend (Edashall Konah, 2026-10-29; the database keeps structures only).
-- Java checks them before every write (orders/domain: LabOrder, Sample, MetrcId, SampleCode, TatClock, RequestedTest,
-- TestOrdering, AnalyteTrim, RushDecision, EmailTemplate, ServingTestOrder; custody/domain: SamplePhoto; saved through
-- orders/service OrderService, SampleService, TestOrderingService, IntakeService and custody/service CustodyService), with
-- JUnit tests in OrderRulesTest and SamplePhotoRulesTest.
--
-- Dropped here (Java is now their only checker):
--   * lab_order_rules' checks (the client may order, the contact is its active ordering contact, no client change once
--     samples are on the order) and lab_order_license_rule (the client's own license, not newly a retired one);
--     contact_can_order, which only they called;
--   * sample_rules (a logged sample keeps its ID, logging time and order; edits need a reason), sample_matrix_check,
--     sample_compliance_check, sample_serving_rules, sample_metrc_rule, sample_measured_guard, sample_custody_rule
--     (Java logs only where the lab does not require a signed receipt), sample_cancel_rule and sample_cancel_tests (Java
--     cancels a sample's tests), sample_per_serving_order (Java orders the serving test), and the quantity checks;
--   * requested_analyte_rules and requested_analyte_reprice (Java asks for the reprice and keeps one analyte);
--   * rush_decision_apply and decline_needs_reason (Java applies the decision and queues the Rush Not Accepted email);
--   * email_template_rules; the rule part of sample_photo_rules and the photo size and 4:3 checks;
--   * the tat_override check (whole days, not negative).
--
-- Kept, with Java's own copy for Java's writes:
--   * lab_order_rules, now only stamping submitted_at: log_samples, receive_samples and the stability study submit orders;
--   * requested_test_derive (price, rush, TAT, Day 0, due date, and its change checks), tat_day0, tat_due, is_working_day,
--     next_working_day, rush_requires_approval: every ordering function of quotes, packages, stability, OOS, training,
--     media, catalogue orders and the demo data load inserts requested tests;
--   * order_test, apply_project, log_samples: called by catalogue and serving orders, packages, receive_samples (Node),
--     stability and the demo data load;
--   * order_serving_test (split request consent), request_serving_test (a split request: testing's record, Node too),
--     order_catalogue_test and catalogue_order_problem (the charges routes);
--   * requested_test_cancel_rule and requested_test_cancel_problem: packages cancel tests (cancel_ordered_package);
--   * queue_email and fill_template: report release, OOS, quotes, invoicing, stability and the bench alerts send through them;
--   * custody_document_rules, custody_event_rules, make_custody_document, lab_order_custody, receive_samples,
--     record_custody_pdf: Receive and sign and the chain of custody PDF stay in Node;
--   * sample_measured_serving: the approved serving result (testing) sets the unit weight;
--   * license_state_on, sample_is_gmp, refresh_order_status, client_can_order: read by views, Node routes and other rules.
-- Sandbox only: other writers of these tables (data load scripts, other features' database functions) are no longer
-- checked by the dropped rules.

-- lab_order: only the submitted time is stamped here
CREATE OR REPLACE FUNCTION lab_order_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'Submitted' AND NEW.submitted_at IS NULL THEN NEW.submitted_at := clock_timestamp(); END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a_order_license ON lab_order;
DROP FUNCTION IF EXISTS lab_order_license_rule();
DROP FUNCTION IF EXISTS contact_can_order(uuid, uuid);

-- sample
DROP TRIGGER IF EXISTS a_sample_rules ON sample;
DROP FUNCTION IF EXISTS sample_rules();
DROP TRIGGER IF EXISTS a_sample_matrix ON sample;
DROP FUNCTION IF EXISTS sample_matrix_check();
DROP TRIGGER IF EXISTS b_sample_compliance ON sample;
DROP FUNCTION IF EXISTS sample_compliance_check();
DROP TRIGGER IF EXISTS a_sample_serving ON sample;
DROP FUNCTION IF EXISTS sample_serving_rules();
DROP TRIGGER IF EXISTS a_sample_metrc ON sample;
DROP FUNCTION IF EXISTS sample_metrc_rule();
DROP TRIGGER IF EXISTS a_sample_measured_guard ON sample;
DROP FUNCTION IF EXISTS sample_measured_guard();
DROP TRIGGER IF EXISTS a02_custody ON sample;
DROP FUNCTION IF EXISTS sample_custody_rule();
DROP TRIGGER IF EXISTS c_sample_cancel ON sample;
DROP FUNCTION IF EXISTS sample_cancel_rule();
DROP TRIGGER IF EXISTS z_sample_cancel_tests ON sample;
DROP FUNCTION IF EXISTS sample_cancel_tests();
DROP TRIGGER IF EXISTS z_sample_per_serving ON sample;
DROP FUNCTION IF EXISTS sample_per_serving_order();
ALTER TABLE sample DROP CONSTRAINT IF EXISTS sample_quantity_received_check;
ALTER TABLE sample DROP CONSTRAINT IF EXISTS sample_number_of_units_check;

-- requested_test and requested_analyte
ALTER TABLE requested_test DROP CONSTRAINT IF EXISTS requested_test_tat_override_check;
DROP TRIGGER IF EXISTS a_requested_analyte_rules ON requested_analyte;
DROP FUNCTION IF EXISTS requested_analyte_rules();
DROP TRIGGER IF EXISTS z_requested_analyte_reprice ON requested_analyte;
DROP FUNCTION IF EXISTS requested_analyte_reprice();

-- rush decisions
DROP TRIGGER IF EXISTS z_rush_decision_apply ON rush_decision;
DROP FUNCTION IF EXISTS rush_decision_apply();
ALTER TABLE rush_decision DROP CONSTRAINT IF EXISTS decline_needs_reason;

-- email templates (the permission trigger stays)
DROP TRIGGER IF EXISTS a02_rules ON email_template;
DROP FUNCTION IF EXISTS email_template_rules();

-- sample photos: the permission check only
CREATE OR REPLACE FUNCTION sample_photo_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT in_group_sync() THEN
        PERFORM require_permission_at('orders.edit', (SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = NEW.sample_id));
    END IF;
    RETURN NEW;
END $$;
ALTER TABLE sample_photo DROP CONSTRAINT IF EXISTS sample_photo_4_3;
ALTER TABLE sample_photo DROP CONSTRAINT IF EXISTS sample_photo_width_px_check;
ALTER TABLE sample_photo DROP CONSTRAINT IF EXISTS sample_photo_height_px_check;
