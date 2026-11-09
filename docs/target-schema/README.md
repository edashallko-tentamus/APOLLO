# Target schema: structures only, with the logic moved to the backend

**Built:** 2026-10-27, from version 0.36.3. **For:** the decision to keep only data structures in the database and move all rule logic to the backend.
**Data:** every row today is demo data, so the target is a fresh database. Nothing is migrated.

## Files in this folder

| File | What it is |
|---|---|
| `schema.sql` | The target database: **structures only**. It contains 182 tables, 50 enumerations, the sequences, primary and foreign keys (876 foreign keys), uniqueness and indexes. It has **no functions, triggers, views or rule checks**. |
| `integrity.sql` | **Optional** protections, still with no functions or triggers. Applied after `schema.sql`, it adds: 279 simple value checks, 60 "only one in this state" uniqueness rules, and database privileges (no deletes anywhere; append-only audit trail, signatures, sign-in events, stored files and stock movements). Recommended for real GxP records. |
| `target-schema-changes.xlsx` | Every item removed or changed between today's database and the target, by feature, plus this plan as a table. |
| `../database-logic/LIMS3 database business logic.xlsx` | The logic being removed: every function, trigger, rule, view and switch, by feature. |

## How it was checked

1. **Exported:** the structures of today's database, read from PostgreSQL's own catalog after building a fresh database from all 58 migrations.
2. **Generated:** `schema.sql` and `integrity.sql` from that export.
3. **Loaded:** both files into an empty database (PGlite, PostgreSQL 16), then compared its catalog with today's.

Result: **zero differences**.
- **Tables:** 182 (184 today less the 2 helper tables).
- **Columns:** all 2,763 present, with identical types and NOT NULL settings.
- **Keys and uniqueness:** all 1,149 primary keys, foreign keys and unique constraints identical.
- **Indexes:** every index present; the partial unique ones are in `integrity.sql`.
- **Logic:** none. **0 functions, 0 triggers and 0 views**, with and without `integrity.sql`.

## What changed from today's database

| Change | Count | Detail |
|---|---|---|
| Functions and procedures removed | 743 | 54 of them are earlier versions kept alive by wrapper chains; they collapse into their current version when rewritten |
| Named triggers removed | 343 | Business rules, permission checks, stamping and status updates |
| Generic audit triggers removed | 660 | 4 per regulated table (stamp, audit, no delete, no truncate) from `make_gxp` on 165 tables |
| Views removed | 51 | Become backend queries |
| Check constraints moved to the backend | 44 | Rules across several columns or calling a function (for example the CAS number checksum) |
| Check constraints moved to `integrity.sql` | 279 | Simple one-column rules: not blank, not negative, one of a list |
| Partial unique rules moved to `integrity.sql` | 60 | For example one Effective version per test |
| Column defaults removed | 338 | All call `current_app_user()` (created_by, modified_by and similar); the backend sets them |
| Computed columns made plain | 3 | Quote line discount amount, discount % and line total; the backend computes them |
| Tables dropped | 2 | `audit_ref_chain`, `audit_ref_route`: they exist only for the audit-label function chain |
| Kept as structures | n/a | Tables, columns, types, NOT NULL, keys, uniqueness, enumerations, sequences (including the 6 drawn by code: quote, project, PO, custody and finalization numbers), plain defaults (ids, timestamps, statuses, codes from sequences) |

## How each database mechanism moves to the backend

| Today, in the database | In the backend |
|---|---|
| `gxp_stamp` trigger (who, when, version; Reason for Change) | One **repository write path** for every regulated table: sets `created_by/at`, `modified_by/at`, increments `record_version` (with optimistic locking: `WHERE record_version = $n`) and refuses a change without a reason |
| `gxp_audit` trigger (audit_log row per change) | The same write path writes the `audit_log` row (old and new value per field, who, when, reason, signature) **in the same transaction**. A lint rule forbids SQL writes outside the write path, because a missed write path means a missing audit entry |
| `gxp_no_delete` triggers | The write path has no delete. With `integrity.sql`, the database also refuses DELETE through privileges |
| `a01_permission` triggers and `user_has_permission_at` / `require_permission_at` | An **access service** called at the start of every service method: permission per lab, lab access, all-labs groups, system administrators, automated accounts |
| `assert_signed`, `sign_action`, signature triggers | A **signature service**: verify the password, write `signature_event`, and pass its id to the write path for the audit rows of that transaction |
| Business-rule triggers (`*_rules`, status triggers) | **Validation and workflow code** in the feature's service, run before the write in the same transaction |
| Action functions (`create_batch`, `finalize_sample`, `issue_invoices`…) | Service methods with the same names, each one transaction, with row locks (`SELECT … FOR UPDATE`) where they lock today |
| Calculations (`batch_results`, `formula_eval`, `round_result`, `spec_conformance`, pricing) | Calculation modules. The independent calculator in `verification.js` already exists and can serve as the cross-check |
| Views (status from history) | Queries. Better: **stored status columns** updated by the services (assessment ticket T3-03) |
| Internal switches (`lims.*_internal`, `lims.group_sync`) | **Gone**. A service calls its own internal methods directly, so nothing needs to relax a rule. This also closes security finding SEC-01 |
| Codes drawn by functions (quote, project, PO, custody numbers) | The service calls `nextval` on the kept sequence. Gapless numbers (`invoice_counter`, `site_day_counter`) use the same counter tables with a row lock |

## Per-feature plan

**Columns:**
- **Logic to move:** current functions, plus named triggers, plus views, plus cross-column checks. Wrapper layers are not counted.
- **Rules:** the refusal messages, each one a rule to re-implement and test.

**Proposed home:** `backend/server/services/<feature>/`.

| Wave | Feature | Tables | Logic to move | Rules | Depends on |
|---|---|---|---|---|---|
| 0. Foundation | Sign-in, people, groups and permissions | 9 | 66 | 34 | Foundation only |
| 0. Foundation | Platform: search, paging, audit trail, security | 2 | 17 | 14 | Foundation only |
| 1. Reference data | Clients, contacts and licenses | 5 | 24 | 11 | Foundation only |
| 1. Reference data | Analytes, units, matrices and canned reasons | 7 | 30 | 10 | Foundation only |
| 1. Reference data | Lab setup: sites, report templates, waste | 6 | 34 | 17 | Foundation only |
| 2. Commercial | Test catalogue, pricing and packages | 10 | 29 | 23 | Foundation only |
| 2. Commercial | Quotes and projects | 7 | 60 | 53 | Clients, contacts and licenses |
| 2. Commercial | Charges, service lines and the test picker | 6 | 23 | 20 | Clients, contacts and licenses |
| 3. Intake | Lab orders, samples and intake | 8 | 101 | 69 | Clients, contacts and licenses, Test catalogue, pricing and packages, Quotes and projects, Analytes, units, matrices and canned reasons, Lab setup: sites, report templates, waste, Charges, service lines and the test picker |
| 3. Intake | Chain of custody and receipt photos | 3 | 14 | 24 | Lab setup: sites, report templates, waste |
| 3. Intake | Barcode labels | 0 | 0 | 0 | Foundation only |
| 4. Methods | Test workflow designer | 8 | 69 | 37 | Analytes, units, matrices and canned reasons, Lab setup: sites, report templates, waste |
| 4. Methods | Workflow verification | 4 | 21 | 36 | Foundation only |
| 5. Lab supplies | Inventory, mixtures and QA testing of lots | 10 | 99 | 86 | Analytes, units, matrices and canned reasons, Lab setup: sites, report templates, waste |
| 5. Lab supplies | Purchasing and vendor approvals | 11 | 58 | 71 | Foundation only |
| 5. Lab supplies | Equipment | 11 | 41 | 43 | Foundation only |
| 6. Bench | Testing bench and QC Review | 18 | 147 | 169 | Lab orders, samples and intake, Test workflow designer, Workflow verification, Inventory, mixtures and QA testing of lots, Equipment |
| 6. Bench | Electronic logbooks and sensors | 13 | 75 | 123 | Equipment |
| 6. Bench | Training and competency | 4 | 27 | 43 | Lab setup: sites, report templates, waste |
| 7. Release | Report Finalization and the COA | 8 | 46 | 42 | Clients, contacts and licenses, Lab orders, samples and intake, Chain of custody and receipt photos, Testing bench and QC Review, Test workflow designer, Lab setup: sites, report templates, waste |
| 7. Release | OOS investigations | 4 | 24 | 52 | Clients, contacts and licenses, Testing bench and QC Review |
| 7. Release | Invoicing | 7 | 50 | 57 | Clients, contacts and licenses, Lab orders, samples and intake, Test catalogue, pricing and packages, Charges, service lines and the test picker |
| 8. Long-running and oversight | Dashboards, finance figures and the performance report | 6 | 17 | 8 | Testing bench and QC Review, Report Finalization and the COA, Inventory, mixtures and QA testing of lots, Invoicing |
| 8. Long-running and oversight | Stability studies | 13 | 46 | 74 | Clients, contacts and licenses, Quotes and projects, Electronic logbooks and sensors, Equipment |
| 8. Long-running and oversight | Trending and control charts | 2 | 9 | 14 | Testing bench and QC Review, Electronic logbooks and sensors |
| | **Total** | **182** | **1127** | **1130** | |

### Waves (the order matters)
- **0. Foundation:** Platform: search, paging, audit trail, security; Sign-in, people, groups and permissions. The write path every other service uses: transaction, request context, stamping (who, when, version), the audit writer, signatures, and authorization. Replaces make_gxp, gxp_stamp, gxp_audit, assert_signed, user_has_permission_at and the a01_permission triggers.
- **1. Reference data:** Analytes, units, matrices and canned reasons; Lab setup: sites, report templates, waste; Clients, contacts and licenses. Controlled lists, lab settings and the lab calendar, clients and contacts: read by almost everything else.
- **2. Commercial:** Test catalogue, pricing and packages; Charges, service lines and the test picker; Quotes and projects. Prices, packages, charges and quotes: they set what can be ordered and at what price.
- **3. Intake:** Lab orders, samples and intake; Chain of custody and receipt photos; Barcode labels. Orders, samples, due dates, logging and receipt.
- **4. Methods:** Test workflow designer; Workflow verification. Test designs and their verification: the bench runs approved versions.
- **5. Lab supplies:** Inventory, mixtures and QA testing of lots; Purchasing and vendor approvals; Equipment. Lots, purchasing and equipment, which the bench checks before use.
- **6. Bench:** Testing bench and QC Review; Electronic logbooks and sensors; Training and competency. Batches, bench steps, calculations, QC Review, logbooks and the training gate: the largest and most validation-critical wave.
- **7. Release:** Report Finalization and the COA; OOS investigations; Invoicing. COA release, OOS investigations and invoicing.
- **8. Long-running and oversight:** Stability studies; Trending and control charts; Dashboards, finance figures and the performance report. Stability studies, trending and dashboards: they read everything above.

Each wave depends on the waves above it: a feature moves only after the features it reads from.

### Feature by feature

#### Sign-in, people, groups and permissions (0. Foundation)
- **Tables (9):** `app_user`, `auth_event`, `signature_event`, `permission`, `lab_group`, `group_member`, `group_permission`, `standard_group_template`, `user_site_access`
- **Logic to move:** 66 items, 34 rules. Proposed service `backend/server/services/signin/`:
  - rules.js: 17 trigger rules and 0 cross-column checks become validations
  - actions.js: 3 actions (each one transaction)
  - queries.js: 2 views and 8 lookups
  - authorization: 13 permission functions (into the shared access service)
  - signatures: 3 signature functions (into the shared signature service)
- **Port first:** `user_has_permission_at`, `has_permission`, `has_permission_at`, `require_permission_at`, `user_can_access_site`, `user_can_view_site`, `sign_action`, `assert_signed`
- **Also:** 8 column defaults (who-did-it stamps) handled by the write path; 4 simple checks and 0 uniqueness rules in `integrity.sql`; 16 generic audit triggers replaced by the write path.
- **Depends on:** the Foundation wave only.
- **Tests to port:** `test_007_signatures_reasons_molar.sql`, `test_008_permissions_groups.sql`, `test_049_database_roles.sql`

#### Platform: search, paging, audit trail, security (0. Foundation)
- **Tables (2):** `audit_log`, `document_file`
- **Logic to move:** 17 items, 14 rules. Proposed service `backend/server/services/platform/`:
  - rules.js: 4 trigger rules and 0 cross-column checks become validations
  - actions.js: 1 actions (each one transaction)
  - checks.js: 1 validation checks
  - queries.js: 0 views and 2 lookups
  - audit: 9 audit functions (into the shared write path)
- **Port first:** `make_gxp`, `gxp_stamp`, `gxp_audit`, `gxp_no_delete`, `current_app_user`, `current_reason`, `audit_record_ref`, `audit_ref_rebuild`
- **Also:** 1 column defaults (who-did-it stamps) handled by the write path; 1 simple checks and 0 uniqueness rules in `integrity.sql`.
- **Depends on:** the Foundation wave only.
- **Updated later by:** Barcode labels, Analytes, units, matrices and canned reasons, Sign-in, people, groups and permissions (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_047_audit_ref_routing.sql`, `test_049_database_roles.sql`

#### Clients, contacts and licenses (1. Reference data)
- **Tables (5):** `client`, `contact`, `client_contact`, `contact_role`, `client_license`
- **Logic to move:** 24 items, 11 rules. Proposed service `backend/server/services/clients/`:
  - rules.js: 8 trigger rules and 2 cross-column checks become validations
  - actions.js: 2 actions (each one transaction)
  - queries.js: 2 views and 6 lookups
- **Port first:** `client_can_order`, `client_can_release_report`, `license_state`, `license_state_on`
- **Also:** 8 column defaults (who-did-it stamps) handled by the write path; 8 simple checks and 1 uniqueness rules in `integrity.sql`; 16 generic audit triggers replaced by the write path.
- **Depends on:** the Foundation wave only.
- **Tests to port:** `test_001_core.sql`, `test_048_dept_training_metrc_licenses.sql`

#### Analytes, units, matrices and canned reasons (1. Reference data)
- **Tables (7):** `analyte`, `unit_of_measure`, `unit_conversion`, `matrix`, `product_category`, `compliance_category`, `reason_code`
- **Logic to move:** 30 items, 10 rules. Proposed service `backend/server/services/master/`:
  - rules.js: 14 trigger rules and 3 cross-column checks become validations
  - checks.js: 1 validation checks
  - queries.js: 0 views and 4 lookups
- **Port first:** `is_valid_cas`, `require_list_permission`, `sample_is_gmp`
- **Also:** 14 column defaults (who-did-it stamps) handled by the write path; 13 simple checks and 1 uniqueness rules in `integrity.sql`; 28 generic audit triggers replaced by the write path.
- **Depends on:** the Foundation wave only.
- **Tests to port:** `test_001_core.sql`, `test_004_access_matrix_tat.sql`, `test_006_items_units.sql`, `test_007_signatures_reasons_molar.sql`

#### Lab setup: sites, report templates, waste (1. Reference data)
- **Tables (6):** `lab_site`, `site_holiday`, `report_template`, `site_media`, `system_setting`, `waste_classification`
- **Logic to move:** 34 items, 17 rules. Proposed service `backend/server/services/labsetup/`:
  - rules.js: 15 trigger rules and 0 cross-column checks become validations
  - calc.js: 1 calculations
  - queries.js: 1 views and 5 lookups
- **Port first:** `site_today`, `default_report_template`, `test_report_template`, `waste_hazard_classes`
- **Also:** 12 column defaults (who-did-it stamps) handled by the write path; 10 simple checks and 4 uniqueness rules in `integrity.sql`; 24 generic audit triggers replaced by the write path.
- **Depends on:** the Foundation wave only.
- **Tests to port:** `test_025_report_templates.sql`, `test_045_waste.sql`

#### Test catalogue, pricing and packages (2. Commercial)
- **Tables (10):** `test`, `test_catalog_entry`, `test_analyte_price`, `rush_fee_schedule`, `rush_fee_tier`, `test_rush_approval`, `test_package`, `test_package_item`, `test_package_analyte`, `catalog_price_change`
- **Logic to move:** 29 items, 23 rules. Proposed service `backend/server/services/catalog/`:
  - rules.js: 11 trigger rules and 1 cross-column checks become validations
  - calc.js: 5 calculations
  - checks.js: 1 validation checks
  - queries.js: 3 views and 5 lookups
- **Port first:** `test_package_price`, `test_package_lines`, `test_package_problems`, `apply_catalog_price_change`, `reprice_catalog`, `subcontract_price`, `catalog_list_price`
- **Also:** 20 column defaults (who-did-it stamps) handled by the write path; 17 simple checks and 4 uniqueness rules in `integrity.sql`; 40 generic audit triggers replaced by the write path.
- **Depends on:** the Foundation wave only.
- **Tests to port:** `test_002_catalog_projects.sql`, `test_026_quote_pricing_serving.sql`, `test_041_packages.sql`

#### Quotes and projects (2. Commercial)
- **Tables (7):** `project`, `project_version`, `quoted_test_configuration`, `quoted_analyte_selection`, `quote_rush_term`, `quoted_package`, `specification`
- **Logic to move:** 60 items, 53 rules. Proposed service `backend/server/services/quotes/`:
  - rules.js: 24 trigger rules and 5 cross-column checks become validations
  - actions.js: 7 actions (each one transaction)
  - queries.js: 2 views and 3 lookups
- **Port first:** `orderable_lines`, `new_project_version`, `send_quote`, `record_quote_response`, `qas_reprice`, `add_package_to_quote`, `set_quoted_package`, `remove_quoted_package`
- **Also:** 15 column defaults (who-did-it stamps) handled by the write path; 9 simple checks and 6 uniqueness rules in `integrity.sql`; 28 generic audit triggers replaced by the write path.
- **Depends on:** Clients, contacts and licenses.
- **Updated later by:** Test catalogue, pricing and packages, Test workflow designer, Charges, service lines and the test picker (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_002_catalog_projects.sql`, `test_024_quotes.sql`, `test_026_quote_pricing_serving.sql`

#### Charges, service lines and the test picker (2. Commercial)
- **Tables (6):** `charge_item`, `quoted_charge`, `order_charge`, `service_line`, `service_line_type`, `client_service_line`
- **Logic to move:** 23 items, 20 rules. Proposed service `backend/server/services/charges/`:
  - rules.js: 8 trigger rules and 0 cross-column checks become validations
  - actions.js: 4 actions (each one transaction)
  - calc.js: 1 calculations
  - checks.js: 1 validation checks
  - queries.js: 1 views and 4 lookups
- **Port first:** `charge_sign`, `client_charge_price`, `catalogue_order_problem`, `order_catalogue_test`, `charge_invoice_line`, `charge_billing_closed`, `claim_invoice_charges`, `add_invoice_charge`
- **Also:** 12 column defaults (who-did-it stamps) handled by the write path; 10 simple checks and 1 uniqueness rules in `integrity.sql`; 24 generic audit triggers replaced by the write path.
- **Depends on:** Clients, contacts and licenses.
- **Updated later by:** Test catalogue, pricing and packages (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_051_charges_catalogue_orders.sql`

#### Lab orders, samples and intake (3. Intake)
- **Tables (8):** `lab_order`, `sample`, `requested_test`, `requested_analyte`, `rush_decision`, `email_outbox`, `site_day_counter`, `ordered_package`
- **Logic to move:** 101 items, 69 rules. Proposed service `backend/server/services/orders/`:
  - rules.js: 38 trigger rules and 2 cross-column checks become validations
  - actions.js: 9 actions (each one transaction)
  - calc.js: 3 calculations
  - checks.js: 2 validation checks
  - queries.js: 4 views and 14 lookups
- **Port first:** `requested_test_derive`, `order_test`, `apply_project`, `log_samples`, `refresh_order_status`, `queue_email`, `order_serving_test`, `request_serving_test`
- **Also:** 14 column defaults (who-did-it stamps) handled by the write path; 10 simple checks and 1 uniqueness rules in `integrity.sql`; 28 generic audit triggers replaced by the write path.
- **Depends on:** Clients, contacts and licenses, Test catalogue, pricing and packages, Quotes and projects, Analytes, units, matrices and canned reasons, Lab setup: sites, report templates, waste, Charges, service lines and the test picker.
- **Updated later by:** Chain of custody and receipt photos, Testing bench and QC Review, Report Finalization and the COA, OOS investigations, Stability studies, Training and competency, Test workflow designer, Inventory, mixtures and QA testing of lots (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_003_orders_samples.sql`, `test_004_access_matrix_tat.sql`, `test_028_serving_measurement.sql`, `test_050_cancel_thermometer.sql`

#### Chain of custody and receipt photos (3. Intake)
- **Tables (3):** `custody_document`, `custody_event`, `sample_photo`
- **Logic to move:** 14 items, 24 rules. Proposed service `backend/server/services/custody/`:
  - rules.js: 3 trigger rules and 1 cross-column checks become validations
  - actions.js: 3 actions (each one transaction)
  - calc.js: 1 calculations
  - queries.js: 1 views and 2 lookups
- **Port first:** `make_custody_document`, `receive_samples`, `record_custody_pdf`, `sample_report_photos_missing`, `layout_photo_count`
- **Also:** 6 column defaults (who-did-it stamps) handled by the write path; 5 simple checks and 1 uniqueness rules in `integrity.sql`; 12 generic audit triggers replaced by the write path.
- **Depends on:** Lab setup: sites, report templates, waste.
- **Updated later by:** Lab orders, samples and intake, Equipment (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_044_custody_photos.sql`, `test_050_cancel_thermometer.sql`

#### Barcode labels (3. Intake)
- **Tables (0):** none (it uses other features' tables)
- **Logic to move:** 0 items, 0 rules. Proposed service `backend/server/services/labels/`:
  - no database logic of its own
- **Port first:** n/a
- **Also:** 0 column defaults (who-did-it stamps) handled by the write path; 0 simple checks and 0 uniqueness rules in `integrity.sql`.
- **Depends on:** the Foundation wave only.
- **Updated later by:** Lab orders, samples and intake, Testing bench and QC Review, Inventory, mixtures and QA testing of lots, Equipment (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** none

#### Test workflow designer (4. Methods)
- **Tables (8):** `test_version`, `test_version_analyte`, `workflow_step`, `workflow_step_equipment`, `workflow_step_dependency`, `method`, `qc_type`, `qc_limit_type`
- **Logic to move:** 69 items, 37 rules. Proposed service `backend/server/services/designer/`:
  - rules.js: 20 trigger rules and 6 cross-column checks become validations
  - actions.js: 5 actions (each one transaction)
  - calc.js: 7 calculations
  - checks.js: 3 validation checks
  - queries.js: 1 views and 11 lookups
  - authorization: 1 permission functions (into the shared access service)
- **Port first:** `create_test`, `new_test_version`, `copy_test`, `copy_version_content`, `approve_test_version`, `test_version_problems`, `test_version_authors`, `formula_check`
- **Also:** 12 column defaults (who-did-it stamps) handled by the write path; 12 simple checks and 5 uniqueness rules in `integrity.sql`; 24 generic audit triggers replaced by the write path.
- **Depends on:** Analytes, units, matrices and canned reasons, Lab setup: sites, report templates, waste.
- **Updated later by:** Trending and control charts, Workflow verification (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_011_methods.sql`, `test_012_micro_definitions.sql`, `test_013_qc_criteria.sql`, `test_014_methods_signatures.sql`, `test_034_matrix_bench_alerts.sql`

#### Workflow verification (4. Methods)
- **Tables (4):** `workflow_verification`, `verification_requirement`, `verification_check`, `verification_evidence`
- **Logic to move:** 21 items, 36 rules. Proposed service `backend/server/services/verification/`:
  - rules.js: 5 trigger rules and 0 cross-column checks become validations
  - actions.js: 7 actions (each one transaction)
  - checks.js: 2 validation checks
  - queries.js: 0 views and 4 lookups
  - authorization: 1 permission functions (into the shared access service)
- **Port first:** `start_verification_run`, `finish_verification_run`, `version_verification`, `record_verification_evidence`, `sign_verification_report`, `automated_grant`, `verification_running`
- **Also:** 8 column defaults (who-did-it stamps) handled by the write path; 9 simple checks and 0 uniqueness rules in `integrity.sql`; 16 generic audit triggers replaced by the write path.
- **Depends on:** the Foundation wave only.
- **Updated later by:** Test workflow designer (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_021_verification.sql`

#### Inventory, mixtures and QA testing of lots (5. Lab supplies)
- **Tables (10):** `chemical`, `inventory_lot`, `inventory_transaction`, `lot_component`, `lot_analyte`, `storage_location`, `supplier_coa`, `threshold_rule`, `media_qualification`, `qa_testing_default`
- **Logic to move:** 99 items, 86 rules. Proposed service `backend/server/services/inventory/`:
  - rules.js: 35 trigger rules and 5 cross-column checks become validations
  - actions.js: 6 actions (each one transaction)
  - calc.js: 10 calculations
  - checks.js: 2 validation checks
  - queries.js: 1 views and 17 lookups
- **Port first:** `unit_factor`, `canonical_unit`, `mixture_concentrations`, `prepare_mixture`, `lot_qa_status`, `lot_qa_problem`, `send_lot_for_qa_testing`, `qualify_media`
- **Also:** 20 column defaults (who-did-it stamps) handled by the write path; 22 simple checks and 2 uniqueness rules in `integrity.sql`; 40 generic audit triggers replaced by the write path.
- **Depends on:** Analytes, units, matrices and canned reasons, Lab setup: sites, report templates, waste.
- **Updated later by:** Testing bench and QC Review, Electronic logbooks and sensors, Purchasing and vendor approvals (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_005_inventory.sql`, `test_006_items_units.sql`, `test_020_media_batches_purchasing.sql`, `test_035_lot_qa_testing.sql`, `test_045_waste.sql`

#### Purchasing and vendor approvals (5. Lab supplies)
- **Tables (11):** `supplier`, `purchase_line`, `purchase_order`, `purchase_receipt`, `purchasing_setting`, `supplier_risk_class`, `vendor_qualification`, `supply_scope`, `vendor_promotion`, `vendor_document`, `vendor_notice`
- **Logic to move:** 58 items, 71 rules. Proposed service `backend/server/services/purchasing/`:
  - rules.js: 15 trigger rules and 3 cross-column checks become validations
  - actions.js: 8 actions (each one transaction)
  - checks.js: 2 validation checks
  - queries.js: 4 views and 14 lookups
- **Port first:** `approve_purchase_lines`, `reject_purchase_lines`, `create_purchase_order`, `receive_purchase_line`, `supplier_status_at`, `assert_supplier_approved`, `vendor_decision`, `propose_vendor_promotion`
- **Also:** 23 column defaults (who-did-it stamps) handled by the write path; 14 simple checks and 2 uniqueness rules in `integrity.sql`; 44 generic audit triggers replaced by the write path.
- **Depends on:** the Foundation wave only.
- **Updated later by:** Inventory, mixtures and QA testing of lots (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_010_purchasing.sql`, `test_020_media_batches_purchasing.sql`, `test_043_vendor_approvals.sql`

#### Equipment (5. Lab supplies)
- **Tables (11):** `equipment`, `equipment_type`, `department`, `equipment_owner`, `equipment_tag`, `equipment_event`, `calibration`, `qualification`, `maintenance_schedule`, `equipment_document`, `equipment_transfer`
- **Logic to move:** 41 items, 43 rules. Proposed service `backend/server/services/equipment/`:
  - rules.js: 15 trigger rules and 6 cross-column checks become validations
  - actions.js: 2 actions (each one transaction)
  - queries.js: 2 views and 5 lookups
  - authorization: 1 permission functions (into the shared access service)
- **Port first:** `equipment_auto_tag`, `calibration_status`, `transfer_equipment`, `tag_workers`, `is_equipment_owner`
- **Also:** 23 column defaults (who-did-it stamps) handled by the write path; 11 simple checks and 3 uniqueness rules in `integrity.sql`; 44 generic audit triggers replaced by the write path.
- **Depends on:** the Foundation wave only.
- **Updated later by:** Electronic logbooks and sensors, Purchasing and vendor approvals (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_009_equipment.sql`

#### Testing bench and QC Review (6. Bench)
- **Tables (18):** `test_batch`, `batch_entry`, `step_run`, `entry_value`, `entry_equipment`, `entry_material`, `step_attachment`, `reanalysis_request`, `reprep_request`, `test_result`, `result_choice`, `qc_acceptance`, `incubation_load`, `split_request`, `review_step_mark`, `analytical_run`, `load_acceptance`, `analyst_pick`
- **Logic to move:** 147 items, 169 rules. Proposed service `backend/server/services/testing/`:
  - rules.js: 40 trigger rules and 2 cross-column checks become validations
  - actions.js: 22 actions (each one transaction)
  - calc.js: 11 calculations
  - checks.js: 9 validation checks
  - queries.js: 5 views and 27 lookups
  - signatures: 1 signature functions (into the shared signature service)
- **Port first:** `create_batch`, `complete_step`, `sign_witness`, `reopen_step`, `batch_results`, `batch_qc_verdicts`, `step_run_missing`, `add_analytical_run`
- **Also:** 36 column defaults (who-did-it stamps) handled by the write path; 28 simple checks and 8 uniqueness rules in `integrity.sql`; 72 generic audit triggers replaced by the write path.
- **Depends on:** Lab orders, samples and intake, Test workflow designer, Workflow verification, Inventory, mixtures and QA testing of lots, Equipment.
- **Updated later by:** Electronic logbooks and sensors, Trending and control charts, Training and competency (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_015_execution.sql`, `test_016_qc_review.sql`, `test_017_micro_bench.sql`, `test_018_runs_preliminary.sql`, `test_019_spike_basis.sql`, `test_034_matrix_bench_alerts.sql`, `test_042_run_dilution_pick.sql`

#### Electronic logbooks and sensors (6. Bench)
- **Tables (13):** `logbook`, `logbook_version`, `logbook_field`, `logbook_equipment`, `logbook_entry`, `logbook_review`, `equipment_flag_acceptance`, `logbook_result_use`, `logbook_result_flag`, `sensor_connection`, `sensor_link`, `sensor_reading`, `sensor_sync_log`
- **Logic to move:** 75 items, 123 rules. Proposed service `backend/server/services/logbooks/`:
  - rules.js: 19 trigger rules and 0 cross-column checks become validations
  - actions.js: 14 actions (each one transaction)
  - calc.js: 5 calculations
  - checks.js: 4 validation checks
  - queries.js: 5 views and 14 lookups
- **Port first:** `approve_logbook_version`, `logbook_entry_rules`, `approve_logbook_entries`, `return_logbook_entry`, `void_logbook_entry`, `logbook_entry_make_lot`, `material_value`, `scan_aliquot`
- **Also:** 22 column defaults (who-did-it stamps) handled by the write path; 25 simple checks and 8 uniqueness rules in `integrity.sql`; 44 generic audit triggers replaced by the write path.
- **Depends on:** Equipment.
- **Tests to port:** `test_029_logbooks.sql`, `test_030_logbook_values.sql`, `test_039_sensor_feed.sql`, `test_040_sensor_rejudge.sql`

#### Training and competency (6. Bench)
- **Tables (4):** `training_rule`, `analyst_qualification`, `competency_attempt`, `competency_evidence`
- **Logic to move:** 27 items, 43 rules. Proposed service `backend/server/services/training/`:
  - rules.js: 4 trigger rules and 2 cross-column checks become validations
  - actions.js: 8 actions (each one transaction)
  - checks.js: 1 validation checks
  - queries.js: 2 views and 6 lookups
- **Port first:** `training_rule_for`, `training_runs`, `qualification_state`, `qualification_current`, `department_trained`, `start_competency_attempt`, `evaluate_competency_attempt`, `decide_competency_attempt`
- **Also:** 8 column defaults (who-did-it stamps) handled by the write path; 10 simple checks and 2 uniqueness rules in `integrity.sql`; 16 generic audit triggers replaced by the write path.
- **Depends on:** Lab setup: sites, report templates, waste.
- **Updated later by:** Testing bench and QC Review (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_046_training.sql`, `test_048_dept_training_metrc_licenses.sql`

#### Report Finalization and the COA (7. Release)
- **Tables (8):** `coa`, `coa_version`, `coa_note`, `result_finalization`, `sample_attachment`, `email_template`, `finalization_claim`, `finalization_claim_test`
- **Logic to move:** 46 items, 42 rules. Proposed service `backend/server/services/reports/`:
  - rules.js: 16 trigger rules and 1 cross-column checks become validations
  - actions.js: 5 actions (each one transaction)
  - calc.js: 1 calculations
  - checks.js: 1 validation checks
  - queries.js: 2 views and 10 lookups
- **Port first:** `finalize_sample`, `claim_finalization`, `release_finalization_claim`, `test_awaits_finalization`, `test_is_finalized`, `test_final_result_ids`, `next_finalization_group`, `sample_fully_reported`
- **Also:** 16 column defaults (who-did-it stamps) handled by the write path; 10 simple checks and 1 uniqueness rules in `integrity.sql`; 32 generic audit triggers replaced by the write path.
- **Depends on:** Clients, contacts and licenses, Lab orders, samples and intake, Chain of custody and receipt photos, Testing bench and QC Review, Test workflow designer, Lab setup: sites, report templates, waste.
- **Updated later by:** OOS investigations (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_021a_report_followup.sql`, `test_022_result_finalization.sql`, `test_025_report_templates.sql`

#### OOS investigations (7. Release)
- **Tables (4):** `oos_investigation`, `oos_checklist_item`, `oos_procedure_setting`, `oos_client_response`
- **Logic to move:** 24 items, 52 rules. Proposed service `backend/server/services/oos/`:
  - rules.js: 4 trigger rules and 1 cross-column checks become validations
  - actions.js: 11 actions (each one transaction)
  - checks.js: 2 validation checks
  - queries.js: 0 views and 5 lookups
- **Port first:** `open_oos`, `record_oos_checks`, `sign_oos_analyst`, `sign_oos_supervisor`, `conclude_oos`, `cancel_oos`, `order_oos_retest`, `record_retest_determination`
- **Also:** 8 column defaults (who-did-it stamps) handled by the write path; 8 simple checks and 0 uniqueness rules in `integrity.sql`; 16 generic audit triggers replaced by the write path.
- **Depends on:** Clients, contacts and licenses, Testing bench and QC Review.
- **Tests to port:** `test_023_oos.sql`

#### Invoicing (7. Release)
- **Tables (7):** `invoice`, `invoice_line`, `invoice_counter`, `invoice_correction`, `accounting_connection`, `accounting_customer`, `accounting_push`
- **Logic to move:** 50 items, 57 rules. Proposed service `backend/server/services/invoicing/`:
  - rules.js: 7 trigger rules and 4 cross-column checks become validations
  - actions.js: 15 actions (each one transaction)
  - calc.js: 2 calculations
  - queries.js: 3 views and 13 lookups
- **Port first:** `claim_invoice_work`, `issue_invoices`, `credit_invoice`, `set_invoice_line_price`, `set_invoice_line_rush`, `send_invoice`, `qbo_payload`, `invoice_catch_up`
- **Also:** 12 column defaults (who-did-it stamps) handled by the write path; 11 simple checks and 1 uniqueness rules in `integrity.sql`; 24 generic audit triggers replaced by the write path.
- **Depends on:** Clients, contacts and licenses, Lab orders, samples and intake, Test catalogue, pricing and packages, Charges, service lines and the test picker.
- **Updated later by:** Report Finalization and the COA, OOS investigations, Stability studies (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_031_invoicing.sql`, `test_051_charges_catalogue_orders.sql`

#### Dashboards, finance figures and the performance report (8. Long-running and oversight)
- **Tables (6):** `dashboard_widget`, `group_widget`, `standard_group_widget`, `user_dashboard_layout`, `finance_week`, `finance_plan`
- **Logic to move:** 17 items, 8 rules. Proposed service `backend/server/services/dash/`:
  - rules.js: 4 trigger rules and 0 cross-column checks become validations
  - calc.js: 1 calculations
  - queries.js: 6 views and 3 lookups
- **Port first:** `my_home_widgets`, `client_hold_periods`, `client_hold_days`, `lims_week_revenue`
- **Also:** 6 column defaults (who-did-it stamps) handled by the write path; 5 simple checks and 0 uniqueness rules in `integrity.sql`; 12 generic audit triggers replaced by the write path.
- **Depends on:** Testing bench and QC Review, Report Finalization and the COA, Inventory, mixtures and QA testing of lots, Invoicing.
- **Updated later by:** Trending and control charts (these write back into this feature once they move; until then the old database logic for those writes stays).
- **Tests to port:** `test_032_dashboards.sql`, `test_033_dashboards_followup.sql`

#### Stability studies (8. Long-running and oversight)
- **Tables (13):** `stability_condition`, `stability_chamber`, `stability_rack`, `stability_plan`, `stability_version_condition`, `stability_timepoint`, `stability_cell`, `stability_study`, `stability_storage`, `stability_pull`, `stability_amendment`, `stability_excursion_assessment`, `stability_report`
- **Logic to move:** 46 items, 74 rules. Proposed service `backend/server/services/stability/`:
  - rules.js: 14 trigger rules and 0 cross-column checks become validations
  - actions.js: 10 actions (each one transaction)
  - calc.js: 2 calculations
  - checks.js: 2 validation checks
  - queries.js: 4 views and 9 lookups
- **Port first:** `create_stability_study`, `place_stability_study`, `create_due_stability_pulls`, `record_stability_pull`, `new_stability_version`, `apply_stability_amendment`, `cancel_stability_study`, `dispose_stability_material`
- **Also:** 29 column defaults (who-did-it stamps) handled by the write path; 20 simple checks and 7 uniqueness rules in `integrity.sql`; 52 generic audit triggers replaced by the write path.
- **Depends on:** Clients, contacts and licenses, Quotes and projects, Electronic logbooks and sensors, Equipment.
- **Tests to port:** `test_027_stability.sql`, `test_036_stability_s2.sql`

#### Trending and control charts (8. Long-running and oversight)
- **Tables (2):** `trend_chart`, `trend_signal_review`
- **Logic to move:** 9 items, 14 rules. Proposed service `backend/server/services/trending/`:
  - rules.js: 3 trigger rules and 0 cross-column checks become validations
  - actions.js: 2 actions (each one transaction)
  - queries.js: 0 views and 2 lookups
- **Port first:** `trend_rules`, `approve_trend_chart`, `trend_limits_for_test`, `record_trend_limits_applied`
- **Also:** 5 column defaults (who-did-it stamps) handled by the write path; 7 simple checks and 2 uniqueness rules in `integrity.sql`; 8 generic audit triggers replaced by the write path.
- **Depends on:** Testing bench and QC Review, Electronic logbooks and sensors.
- **Tests to port:** `test_037_trending.sql`, `test_038_trending_qa.sql`

## How to do it safely

1. **Work feature by feature inside today's app, not as a big-bang rewrite.** For each feature:
   1. Write its service.
   2. Point the routes at the service.
   3. Drop that feature's database functions and triggers in a new migration.
   4. Keep every test green.

   The clean `schema.sql` is the **end state**. When the last wave is done, it replaces the 58 migrations as the single baseline. The data is fake, so this is a simple reset.
2. **Port the rule tests first, per feature.** The 52 SQL rule-test files (1,898 checks) describe today's behaviour precisely.
   - Rewrite them as backend tests (`node:test`) that call the services.
   - Run them against the old logic, so they pass before any change.
   - Then run them against the new service. They are the proof that behaviour did not change.
3. **Compare calculations on the same inputs.** For calculations, pricing, due dates and QC verdicts, run the old SQL function and the new code on the demo data and require identical results before deleting the SQL.
4. **Start with the Foundation wave.** The write path, the audit writer, the access service and the signature service carry the Part 11 guarantees. Every later wave depends on them being right.
5. **Concurrency moves too.** Today 48 database functions lock rows and the single connection hides races. The services must take the same locks, and optimistic locking must be in the write path from the start (assessment tickets T1-10, T1-11).

## Risks

| Risk | Why | Mitigation |
|---|---|---|
| Behaviour drift | 1130 rules and 689 functions are re-implemented by hand | Port the rule tests first; compare calculations side by side |
| Missing audit entries | Any write that bypasses the repository write path leaves no audit row (today the database makes that impossible) | One write path; lint rule against raw writes; `integrity.sql` privileges; a nightly check that every changed row has its audit row |
| Concurrency defects | Database locks and serialization hid races | Optimistic locking and row locks in the services; concurrency tests (assessment T2-07) |
| Re-validation | Calculations, signatures and the audit trail are validated functions (GAMP 5) | Plan the URS/FS/IQ/OQ updates per wave with QA |
| Performance | Logic that ran inside the database now makes round trips | Set-based queries, stored status, the connection pool (assessment T3-01, T3-03) |
| Scope | This is the largest change the project has made: about 26,000 lines of SQL behaviour | Waves; each wave ships and is tested on its own |

**Effort.** This is extra large: in practice a rewrite of most of the system's behaviour. A reliable estimate needs the Foundation wave built first; its size and speed calibrate the rest. Recommended first step: build wave 0 and wave 1, port their rule tests, then estimate the remaining waves from that experience.
