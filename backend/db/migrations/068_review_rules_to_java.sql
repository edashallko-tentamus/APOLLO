-- 068: the QC Review rules and the calculation engine move to the Java backend (Edashall Konah, 2026-10-29; the database
-- keeps structures only). Java decides them for every review done through the app (testing/domain/review: ReviewBatch,
-- ReviewItem; testing/domain/calc: Formula, Rounding, AnalyteReporting, Specification, Serving, QcVerdict; loaded and
-- saved by testing/repo/ReviewStore through testing/service/ReviewService), with JUnit tests in ReviewRulesTest.
--
-- Dropped here (Java is now their only checker):
--   * the "Use the QC Review screen" guard (review_tables_rules as trigger a01_rules) on result_choice, qc_acceptance,
--     test_result, review_step_mark and load_acceptance: Java records choices, acceptances, step approvals and results;
--   * the non-blank justification checks on qc_acceptance and load_acceptance.
--
-- Kept, with Java's own copy for Java's writes:
--   * assert_can_review, assert_can_choose, choose_result (and choose_result_021), average_results, accept_qc,
--     accept_load, approve_review_step, withdraw_review_step, release_timepoint, approve_batch, return_batch,
--     cancel_batch, batch_review_problems (and its wrappers _l1 to _l3), timepoint_problems (and _l1),
--     batch_timepoints, step_feeds_release, assert_not_released, batch_used_runs, qc_verdict_counts: still called by
--     Node's workflow verification run (server/verification.js) and the demo data load (seeds 020, 021, 032), and
--     assert_not_released by the bench (reopen_step, add_analytical_run);
--   * the calculation engine and read functions batch_results, batch_review_items (and _039), batch_qc_verdicts (and
--     _022, _042), batch_invalid_readings, qc_criteria, formula_lex, formula_tokens, formula_check, formula_eval,
--     round_result, report_value, spec_conformance, per_serving, sample_per_serving, sig3, calc_undefined_at_zero:
--     still called by the bench's live results, the verification run, OOS checks, the COA, trending and logbooks. Java
--     reads batch_results, batch_review_items' candidates and batch_qc_verdicts_022's measurements, and makes every
--     decision on them itself (the choice, the average, rounding, LOQ/LOD, the specification and per serving
--     comparison, readings that are not results, controls counted 0, used runs, the problems), and recalculates each
--     reported calculated result with its own formula engine before approval;
--   * review_tables_rules itself (equipment_flag_acceptance and analyst_pick still use it), review_marks_on_reopen
--     (z_review_marks: the bench reopens steps), refresh_order_status, refresh_batch_orders and z_order_status (orders,
--     OOS and other features call them), and the test_result triggers of logbooks and serving sizes.
-- Sandbox only: other writers of these tables (data load scripts) are no longer checked by the dropped rules.

DROP TRIGGER IF EXISTS a01_rules ON result_choice;
DROP TRIGGER IF EXISTS a01_rules ON qc_acceptance;
DROP TRIGGER IF EXISTS a01_rules ON test_result;
DROP TRIGGER IF EXISTS a01_rules ON review_step_mark;
DROP TRIGGER IF EXISTS a01_rules ON load_acceptance;
ALTER TABLE qc_acceptance DROP CONSTRAINT IF EXISTS qc_acceptance_justification_check;
ALTER TABLE load_acceptance DROP CONSTRAINT IF EXISTS load_acceptance_justification_check;
