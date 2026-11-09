-- APOLLO (LIMS3) target schema: structures only.
-- Generated 2026-10-27 from the catalog of a database built by the 58 migrations of version 0.36.3.
-- Holds tables, columns, types, NOT NULL, plain defaults, primary and foreign keys, uniqueness, sequences and indexes.
-- Holds NO functions, procedures, triggers, views or rule-based CHECK constraints: that logic moves to the backend
-- (see README.md). Optional database protections are in integrity.sql.
-- Every row in today's database is demo data, so this file starts a fresh database; nothing is migrated.

CREATE SCHEMA IF NOT EXISTS lims;
SET search_path = lims, public;

-- ============================================================== enumerations (allowed values)
CREATE TYPE account_status AS ENUM ('Active', 'On Hold', 'Inactive');
CREATE TYPE analyte_class AS ENUM ('Chemical', 'Microbiological', 'Physical/General');
CREATE TYPE batch_status AS ENUM ('Open', 'In Progress', 'Awaiting Review', 'Approved', 'Cancelled');
CREATE TYPE cal_result AS ENUM ('Pass', 'Fail');
CREATE TYPE chemical_type AS ENUM ('Consumable', 'In-house mixture', 'Solvent', 'Reagent', 'Media', 'Reference Standard', 'Microbiological Strain');
CREATE TYPE dependency_type AS ENUM ('Sequential', 'Parallel');
CREATE TYPE equipment_admin_status AS ENUM ('In Service', 'Out of Service', 'Retired');
CREATE TYPE equipment_doc_type AS ENUM ('Calibration certificate', 'Service report', 'Qualification report', 'Manual', 'Photo', 'Error log', 'Invoice', 'Checklist', 'Other');
CREATE TYPE equipment_event_type AS ENUM ('Maintenance', 'Repair', 'Service visit', 'Check', 'Note');
CREATE TYPE inventory_txn_type AS ENUM ('Receipt', 'Usage', 'Adjustment', 'Transfer Out', 'Disposal');
CREATE TYPE lab_order_origin AS ENUM ('Client Submission', 'Stability Baseline', 'Stability Pull', 'Workflow Verification');
CREATE TYPE lab_order_status AS ENUM ('Draft', 'Submitted', 'Received', 'In Testing', 'In Review', 'Approved', 'Complete', 'Reported');
CREATE TYPE line_status AS ENUM ('Active', 'Removed');
CREATE TYPE location_type AS ENUM ('Building', 'Room', 'Refrigerator', 'Freezer', 'Cabinet', 'Shelf', 'Incubator', 'Other');
CREATE TYPE lot_status AS ENUM ('Available', 'On Hold', 'Depleted', 'Disposed', 'Cancelled');
CREATE TYPE master_status AS ENUM ('Active', 'Retired');
CREATE TYPE material_purpose AS ENUM ('Spike', 'Standard', 'Reagent', 'Diluent', 'Media', 'Other', 'Strain');
CREATE TYPE oos_procedure AS ENUM ('Full Phase I (21 CFR 211)', 'Check and Acknowledge');
CREATE TYPE pricing_mode AS ENUM ('Base Price Only', 'Base + Preparation Fee', 'Analyte Selection');
CREATE TYPE project_origin AS ENUM ('Lab', 'Portal');
CREATE TYPE project_version_status AS ENUM ('Draft', 'Submitted for Quote', 'Quoted', 'Accepted', 'Rejected', 'Expired', 'Superseded');
CREATE TYPE purchase_line_status AS ENUM ('Requested', 'Awaiting second approval', 'Approved', 'Rejected', 'Ordered', 'Partly received', 'Received', 'Cancelled');
CREATE TYPE purchase_line_type AS ENUM ('Inventory item', 'Equipment', 'Service', 'Other');
CREATE TYPE qualification_type AS ENUM ('IQ', 'OQ', 'PQ', 'IQ/OQ', 'IQ/OQ/PQ', 'Requalification');
CREATE TYPE receipt_discrepancy AS ENUM ('None', 'Damaged', 'Temperature excursion', 'Short shipped', 'Wrong item', 'Other');
CREATE TYPE receipt_status AS ENUM ('Requested', 'Approved', 'Ordered', 'In Transit', 'Received');
CREATE TYPE record_status AS ENUM ('Active', 'Inactive');
CREATE TYPE report_delivery AS ENUM ('Email', 'Portal');
CREATE TYPE requested_test_status AS ENUM ('Ordered', 'In Pool', 'Cancelled');
CREATE TYPE result_type AS ENUM ('Numeric', 'Qualitative', 'Count', 'Text');
CREATE TYPE rounding_mode AS ENUM ('Significant figures', 'Decimal places');
CREATE TYPE rush_decision_type AS ENUM ('Approved', 'Not Accepted');
CREATE TYPE rush_status AS ENUM ('None', 'Auto-accepted', 'Pending Approval', 'Approved', 'Not Accepted');
CREATE TYPE sample_status AS ENUM ('Expected', 'Logged', 'Cancelled');
CREATE TYPE spec_source AS ENUM ('Lab', 'Client', 'Client portal');
CREATE TYPE step_type AS ENUM ('Batching', 'Weighing', 'Preparation', 'Plating/Inoculation', 'Incubation', 'Dilution', 'Split off Test', 'Hold Point', 'Calculation', 'Data Entry', 'QC Review');
CREATE TYPE storage_condition AS ENUM ('Ambient (15-25 °C)', 'Refrigerated (2-8 °C)', 'Frozen (-20 °C)', 'Ultra-low (-80 °C)', 'Desiccator', 'Flammables cabinet', 'Corrosives cabinet');
CREATE TYPE submission_channel AS ENUM ('Online', 'Walk-in', 'Paper', 'Phone');
CREATE TYPE supplier_type AS ENUM ('Supplier', 'Manufacturer', 'Supplier and Manufacturer');
CREATE TYPE surcharge_type AS ENUM ('Percent', 'Flat');
CREATE TYPE tag_reason AS ENUM ('Maintenance', 'Repair', 'Calibration', 'Qualification');
CREATE TYPE tag_source AS ENUM ('Manual', 'Calibration due', 'Maintenance due', 'Transfer', 'New equipment');
CREATE TYPE tat_unit AS ENUM ('Business Days', 'Calendar Days');
CREATE TYPE test_source AS ENUM ('Quote', 'Client OOS Retest', 'Lab Investigation Retest');
CREATE TYPE test_version_status AS ENUM ('Draft', 'Effective', 'Superseded');
CREATE TYPE threshold_subject AS ENUM ('Lot Quantity', 'Lot Expiry', 'Sample Retain');
CREATE TYPE threshold_type AS ENUM ('Percentage of Base', 'Absolute Max-Min', 'Target ± Tolerance %', 'Days Until/Since');
CREATE TYPE unit_dimension AS ENUM ('Mass', 'Volume', 'Count', 'Mass/Volume', 'Mass/Mass', 'Volume/Volume', 'Parts per', 'Amount/Volume', 'Activity', 'Other');
CREATE TYPE user_job_role AS ENUM ('Analyst', 'Intake', 'Lab Supervisor', 'QA', 'General Manager', 'Account Manager');
CREATE TYPE vendor_approval_status AS ENUM ('Approved', 'Not Approved', 'Suspended');

-- ============================================================== sequences (human-readable codes)
CREATE SEQUENCE analyst_qualification_seq;
CREATE SEQUENCE analyte_code_seq;
CREATE SEQUENCE calibration_seq;
CREATE SEQUENCE catalog_price_change_seq;
CREATE SEQUENCE charge_item_seq;
CREATE SEQUENCE chemical_code_seq;
CREATE SEQUENCE client_code_seq;
CREATE SEQUENCE client_license_seq;
CREATE SEQUENCE competency_attempt_seq;
CREATE SEQUENCE contact_code_seq;
CREATE SEQUENCE custody_document_seq; -- drawn by code, not by a column default
CREATE SEQUENCE equipment_code_seq;
CREATE SEQUENCE equipment_event_seq;
CREATE SEQUENCE equipment_tag_seq;
CREATE SEQUENCE finalization_claim_seq;
CREATE SEQUENCE finalization_group_seq; -- drawn by code, not by a column default
CREATE SEQUENCE inventory_lot_seq;
CREATE SEQUENCE invoice_correction_seq;
CREATE SEQUENCE invoice_draft_seq;
CREATE SEQUENCE lab_order_seq;
CREATE SEQUENCE logbook_entry_seq;
CREATE SEQUENCE logbook_seq;
CREATE SEQUENCE media_qualification_seq;
CREATE SEQUENCE method_code_seq;
CREATE SEQUENCE oos_code_seq;
CREATE SEQUENCE order_charge_seq;
CREATE SEQUENCE ordered_package_seq;
CREATE SEQUENCE project_code_seq; -- drawn by code, not by a column default
CREATE SEQUENCE purchase_line_seq;
CREATE SEQUENCE purchase_order_seq; -- drawn by code, not by a column default
CREATE SEQUENCE purchase_receipt_seq;
CREATE SEQUENCE qualification_seq;
CREATE SEQUENCE quote_code_seq; -- drawn by code, not by a column default
CREATE SEQUENCE report_template_seq;
CREATE SEQUENCE stability_quote_code_seq; -- drawn by code, not by a column default
CREATE SEQUENCE stability_study_seq;
CREATE SEQUENCE supplier_code_seq;
CREATE SEQUENCE test_batch_seq;
CREATE SEQUENCE test_code_seq;
CREATE SEQUENCE test_package_seq;
CREATE SEQUENCE trend_chart_seq;
CREATE SEQUENCE vendor_promotion_seq;
CREATE SEQUENCE vendor_qualification_seq;
CREATE SEQUENCE waste_classification_seq;
CREATE SEQUENCE workflow_verification_seq;

-- ============================================================== tables

-- ---------------------------------------------- Analytes, units, matrices and canned reasons
CREATE TABLE analyte (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  analyte_code text DEFAULT ('ANL-'::text || lpad((nextval('analyte_code_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
  analyte_name text NOT NULL,
  report_name text,
  analyte_class analyte_class NOT NULL,
  cas_number text,
  synonyms text[] DEFAULT '{}'::text[] NOT NULL,
  status master_status DEFAULT 'Active'::master_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  molar_mass numeric(14,6),
  molar_mass_source text,
  CONSTRAINT analyte_pkey PRIMARY KEY (id),
  CONSTRAINT analyte_analyte_code_key UNIQUE (analyte_code)
);
CREATE TABLE compliance_category (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  category_name text NOT NULL,
  is_gmp boolean DEFAULT false NOT NULL,
  description text,
  sort_order integer DEFAULT 100 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT compliance_category_pkey PRIMARY KEY (id)
);
CREATE TABLE matrix (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  matrix_name text NOT NULL,
  description text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  product_category_id uuid,
  CONSTRAINT matrix_pkey PRIMARY KEY (id)
);
CREATE TABLE product_category (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  category_name text NOT NULL,
  description text,
  sort_order integer DEFAULT 0 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT product_category_pkey PRIMARY KEY (id)
);
CREATE TABLE reason_code (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  module text NOT NULL,
  reason_text text NOT NULL,
  sort_order integer DEFAULT 100 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT reason_code_pkey PRIMARY KEY (id)
);
CREATE TABLE unit_conversion (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  from_unit_id uuid NOT NULL,
  to_unit_id uuid NOT NULL,
  factor numeric(30,15) NOT NULL,
  applies_to text DEFAULT 'Any'::text NOT NULL,
  assumption text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT unit_conversion_pkey PRIMARY KEY (id)
);
CREATE TABLE unit_of_measure (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  unit_code text NOT NULL,
  unit_name text NOT NULL,
  dimension unit_dimension NOT NULL,
  sort_order integer DEFAULT 100 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  is_serving_unit boolean DEFAULT false NOT NULL,
  CONSTRAINT unit_of_measure_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------- Chain of custody and receipt photos
CREATE TABLE custody_document (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  coc_code text NOT NULL,
  lab_order_id uuid NOT NULL,
  site_id uuid NOT NULL,
  manifest jsonb DEFAULT '[]'::jsonb NOT NULL,
  made_at_migration boolean DEFAULT false NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT custody_document_pkey PRIMARY KEY (id),
  CONSTRAINT custody_document_coc_code_key UNIQUE (coc_code),
  CONSTRAINT custody_document_lab_order_id_key UNIQUE (lab_order_id)
);
CREATE TABLE custody_event (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  custody_document_id uuid NOT NULL,
  event_no integer NOT NULL,
  kind text NOT NULL,
  event_at timestamp with time zone NOT NULL,
  sample_ids uuid[],
  delivered_by text,
  tracking_no text,
  temperature numeric(6,2),
  temperature_unit text DEFAULT '°C'::text NOT NULL,
  condition text,
  seals text,
  note text,
  signature_id uuid,
  signer_title text,
  signature_image_id uuid,
  document_id uuid,
  sha256 text,
  made_txid bigint,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  thermometer_id uuid,
  CONSTRAINT custody_event_pkey PRIMARY KEY (id),
  CONSTRAINT custody_event_custody_document_id_event_no_key UNIQUE (custody_document_id, event_no)
);
CREATE TABLE sample_photo (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sample_id uuid NOT NULL,
  document_id uuid NOT NULL,
  width_px integer NOT NULL,
  height_px integer NOT NULL,
  caption text,
  taken_at timestamp with time zone DEFAULT now() NOT NULL,
  report_slot smallint,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT sample_photo_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------- Charges, service lines and the test picker
CREATE TABLE charge_item (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  charge_code text DEFAULT ('CHG-'::text || lpad((nextval('charge_item_seq'::regclass))::text, 3, '0'::text)) NOT NULL,
  charge_name text NOT NULL,
  kind text DEFAULT 'Other'::text NOT NULL,
  description text,
  price numeric(12,2) DEFAULT 0 NOT NULL,
  site_id uuid,
  service_line_id uuid,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT charge_item_pkey PRIMARY KEY (id),
  CONSTRAINT charge_item_charge_code_key UNIQUE (charge_code)
);
CREATE TABLE client_service_line (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  client_id uuid NOT NULL,
  service_line_id uuid NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT client_service_line_pkey PRIMARY KEY (id)
);
CREATE TABLE order_charge (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  charge_no text DEFAULT ('OC-'::text || lpad((nextval('order_charge_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  lab_order_id uuid NOT NULL,
  sample_id uuid,
  charge_item_id uuid NOT NULL,
  quantity integer DEFAULT 1 NOT NULL,
  list_price numeric(12,2) DEFAULT 0 NOT NULL,
  unit_price numeric(12,2),
  quoted_charge_id uuid,
  source text DEFAULT 'Order'::text NOT NULL,
  note text,
  status text DEFAULT 'Active'::text NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT order_charge_pkey PRIMARY KEY (id),
  CONSTRAINT order_charge_charge_no_key UNIQUE (charge_no)
);
CREATE TABLE quoted_charge (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_version_id uuid NOT NULL,
  charge_item_id uuid NOT NULL,
  quantity integer DEFAULT 1 NOT NULL,
  list_price numeric(12,2) DEFAULT 0 NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  note text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT quoted_charge_pkey PRIMARY KEY (id)
);
CREATE TABLE service_line (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  line_name text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT service_line_pkey PRIMARY KEY (id)
);
CREATE TABLE service_line_type (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  service_line_id uuid NOT NULL,
  type_name text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT service_line_type_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------- Clients, contacts and licenses
CREATE TABLE client (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  client_code text DEFAULT ('CL-'::text || lpad((nextval('client_code_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
  legal_name text NOT NULL,
  display_name text,
  parent_client_id uuid,
  account_status account_status DEFAULT 'Active'::account_status NOT NULL,
  is_gmp_client boolean DEFAULT false NOT NULL,
  billing_address text,
  site_address text,
  default_report_delivery report_delivery,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  is_internal boolean DEFAULT false NOT NULL,
  allow_partial_reports boolean DEFAULT true NOT NULL,
  payment_terms_days integer DEFAULT 30 NOT NULL,
  CONSTRAINT client_pkey PRIMARY KEY (id),
  CONSTRAINT client_client_code_key UNIQUE (client_code)
);
CREATE TABLE client_contact (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  client_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  roles text[] NOT NULL,
  portal_visible boolean DEFAULT true NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT client_contact_pkey PRIMARY KEY (id),
  CONSTRAINT client_contact_client_id_contact_id_key UNIQUE (client_id, contact_id)
);
CREATE TABLE client_license (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  license_code text DEFAULT ('LIC-'::text || lpad((nextval('client_license_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
  client_id uuid NOT NULL,
  license_type text NOT NULL,
  license_number text NOT NULL,
  issuing_authority text,
  issued_on date,
  expires_on date,
  document_id uuid,
  note text,
  status master_status DEFAULT 'Active'::master_status NOT NULL,
  retired_reason text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT client_license_pkey PRIMARY KEY (id),
  CONSTRAINT client_license_license_code_key UNIQUE (license_code)
);
CREATE TABLE contact (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contact_code text DEFAULT ('CT-'::text || lpad((nextval('contact_code_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text,
  job_title text,
  portal_access boolean DEFAULT false NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT contact_pkey PRIMARY KEY (id),
  CONSTRAINT contact_contact_code_key UNIQUE (contact_code)
);
CREATE TABLE contact_role (
  role_code text NOT NULL,
  role_name text NOT NULL,
  description text NOT NULL,
  one_per_client boolean DEFAULT false NOT NULL,
  sort_order integer NOT NULL,
  CONSTRAINT contact_role_pkey PRIMARY KEY (role_code),
  CONSTRAINT contact_role_role_name_key UNIQUE (role_name)
);

-- ---------------------------------------------- Dashboards, finance figures and the performance report
CREATE TABLE dashboard_widget (
  code text NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  needs_any text[] DEFAULT '{}'::text[] NOT NULL,
  default_w integer DEFAULT 4 NOT NULL,
  default_h integer DEFAULT 2 NOT NULL,
  boards text[] DEFAULT '{home}'::text[] NOT NULL,
  sort_order integer DEFAULT 100 NOT NULL,
  CONSTRAINT dashboard_widget_pkey PRIMARY KEY (code)
);
CREATE TABLE finance_plan (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  month date NOT NULL,
  plan text NOT NULL,
  revenue numeric(14,2) DEFAULT 0 NOT NULL,
  costs numeric(14,2) DEFAULT 0 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT finance_plan_pkey PRIMARY KEY (id),
  CONSTRAINT finance_plan_site_id_month_plan_key UNIQUE (site_id, month, plan)
);
CREATE TABLE finance_week (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  week_ending date NOT NULL,
  revenue numeric(14,2),
  costs numeric(14,2) DEFAULT 0 NOT NULL,
  note text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT finance_week_pkey PRIMARY KEY (id),
  CONSTRAINT finance_week_site_id_week_ending_key UNIQUE (site_id, week_ending)
);
CREATE TABLE group_widget (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  group_id uuid NOT NULL,
  widget_code text NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT group_widget_pkey PRIMARY KEY (id),
  CONSTRAINT group_widget_group_id_widget_code_key UNIQUE (group_id, widget_code)
);
CREATE TABLE standard_group_widget (
  group_name text NOT NULL,
  widget_code text NOT NULL,
  CONSTRAINT standard_group_widget_pkey PRIMARY KEY (group_name, widget_code)
);
CREATE TABLE user_dashboard_layout (
  user_id uuid NOT NULL,
  board text NOT NULL,
  layout jsonb DEFAULT '[]'::jsonb NOT NULL,
  hidden text[] DEFAULT '{}'::text[] NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT user_dashboard_layout_pkey PRIMARY KEY (user_id, board)
);

-- ---------------------------------------------- Electronic logbooks and sensors
CREATE TABLE equipment_flag_acceptance (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  batch_id uuid NOT NULL,
  logbook_entry_id uuid NOT NULL,
  justification text NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT equipment_flag_acceptance_pkey PRIMARY KEY (id)
);
CREATE TABLE logbook (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  logbook_code text DEFAULT ('LB-'::text || lpad((nextval('logbook_seq'::regclass))::text, 4, '0'::text)) NOT NULL,
  site_id uuid NOT NULL,
  logbook_name text NOT NULL,
  kind text DEFAULT 'General'::text NOT NULL,
  subject text DEFAULT 'None'::text NOT NULL,
  entry_frequency text DEFAULT 'As needed'::text NOT NULL,
  review_frequency text DEFAULT 'Weekly'::text NOT NULL,
  signing text DEFAULT 'Signature'::text NOT NULL,
  review_route text DEFAULT 'Logbook'::text NOT NULL,
  validity_hours numeric,
  creates_lot boolean DEFAULT false NOT NULL,
  lot_name text,
  lot_unit text DEFAULT 'mL'::text NOT NULL,
  description text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT logbook_pkey PRIMARY KEY (id),
  CONSTRAINT logbook_logbook_code_key UNIQUE (logbook_code)
);
CREATE TABLE logbook_entry (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  entry_code text DEFAULT ('LBE-'::text || lpad((nextval('logbook_entry_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  logbook_id uuid NOT NULL,
  version_id uuid NOT NULL,
  site_id uuid NOT NULL,
  entry_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  equipment_id uuid,
  lot_id uuid,
  sample_id uuid,
  entry_values jsonb DEFAULT '{}'::jsonb NOT NULL,
  result text,
  problems text[] DEFAULT '{}'::text[] NOT NULL,
  failure_reason text,
  valid_until timestamp with time zone,
  status text DEFAULT 'Recorded'::text NOT NULL,
  recorded_signature_id uuid,
  approved_by uuid,
  approved_at timestamp with time zone,
  review_id uuid,
  approved_in_batch_id uuid,
  returned_note text,
  void_reason text,
  created_lot_id uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  source text DEFAULT 'Manual'::text NOT NULL,
  sensor_link_id uuid,
  sensor_kind text,
  period_start timestamp with time zone,
  period_end timestamp with time zone,
  sensor_summary jsonb,
  CONSTRAINT logbook_entry_pkey PRIMARY KEY (id),
  CONSTRAINT logbook_entry_entry_code_key UNIQUE (entry_code)
);
CREATE TABLE logbook_equipment (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  logbook_id uuid NOT NULL,
  equipment_id uuid NOT NULL,
  limits jsonb DEFAULT '{}'::jsonb NOT NULL,
  notes text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT logbook_equipment_pkey PRIMARY KEY (id)
);
CREATE TABLE logbook_field (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  version_id uuid NOT NULL,
  field_key text NOT NULL,
  label text NOT NULL,
  field_type text DEFAULT 'Number'::text NOT NULL,
  unit text,
  limit_min numeric,
  limit_max numeric,
  equipment_limits boolean DEFAULT false NOT NULL,
  choices text[],
  required boolean DEFAULT true NOT NULL,
  formula text,
  publish boolean DEFAULT false NOT NULL,
  help text,
  sort_order integer DEFAULT 10 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT logbook_field_pkey PRIMARY KEY (id)
);
CREATE TABLE logbook_result_flag (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  test_result_id uuid NOT NULL,
  logbook_entry_id uuid NOT NULL,
  used_values jsonb NOT NULL,
  corrected_values jsonb NOT NULL,
  status text DEFAULT 'Open'::text NOT NULL,
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT logbook_result_flag_pkey PRIMARY KEY (id)
);
CREATE TABLE logbook_result_use (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  test_result_id uuid NOT NULL,
  logbook_entry_id uuid NOT NULL,
  via text NOT NULL,
  entry_record_version integer NOT NULL,
  entry_values jsonb NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT logbook_result_use_pkey PRIMARY KEY (id)
);
CREATE TABLE logbook_review (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  logbook_id uuid NOT NULL,
  site_id uuid NOT NULL,
  entry_count integer NOT NULL,
  first_entry_at timestamp with time zone,
  last_entry_at timestamp with time zone,
  comment text,
  signature_id uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT logbook_review_pkey PRIMARY KEY (id)
);
CREATE TABLE logbook_version (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  logbook_id uuid NOT NULL,
  version_no integer NOT NULL,
  status text DEFAULT 'Draft'::text NOT NULL,
  change_summary text,
  approved_by uuid,
  approved_at timestamp with time zone,
  signature_id uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT logbook_version_pkey PRIMARY KEY (id),
  CONSTRAINT logbook_version_logbook_id_version_no_key UNIQUE (logbook_id, version_no)
);
CREATE TABLE sensor_connection (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  mode text DEFAULT 'Pretend (sandbox)'::text NOT NULL,
  base_url text,
  enabled boolean DEFAULT false NOT NULL,
  read_every_minutes integer DEFAULT 10 NOT NULL,
  lookback_hours integer DEFAULT 24 NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT sensor_connection_pkey PRIMARY KEY (id),
  CONSTRAINT sensor_connection_site_id_key UNIQUE (site_id)
);
CREATE TABLE sensor_link (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  external_id text NOT NULL,
  sensor_name text,
  measures text NOT NULL,
  equipment_id uuid NOT NULL,
  logbook_id uuid NOT NULL,
  field_key text NOT NULL,
  gap_minutes integer DEFAULT 30 NOT NULL,
  status text DEFAULT 'Awaiting QA'::text NOT NULL,
  approved_by uuid,
  approved_at timestamp with time zone,
  feeds_from timestamp with time zone,
  approval_signature_id uuid,
  retired_reason text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  rejudge_from timestamp with time zone,
  rejudge_reason text,
  rejudge_by uuid,
  rejudge_signature_id uuid,
  CONSTRAINT sensor_link_pkey PRIMARY KEY (id)
);
CREATE TABLE sensor_reading (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  link_id uuid NOT NULL,
  guid text NOT NULL,
  read_at timestamp with time zone NOT NULL,
  "value" numeric NOT NULL,
  battery numeric,
  signal numeric,
  received_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT sensor_reading_pkey PRIMARY KEY (id),
  CONSTRAINT sensor_reading_link_id_guid_key UNIQUE (link_id, guid)
);
CREATE TABLE sensor_sync_log (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  site_id uuid NOT NULL,
  started_at timestamp with time zone NOT NULL,
  finished_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ok boolean NOT NULL,
  readings integer DEFAULT 0 NOT NULL,
  entries integer DEFAULT 0 NOT NULL,
  message text,
  run_by uuid,
  CONSTRAINT sensor_sync_log_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------- Equipment
CREATE TABLE calibration (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  calibration_code text DEFAULT ('CAL-'::text || lpad((nextval('calibration_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  equipment_id uuid NOT NULL,
  tag_id uuid,
  performed_date date NOT NULL,
  expiration_date date NOT NULL,
  result cal_result NOT NULL,
  performed_by_user_id uuid,
  performed_by_vendor text,
  certificate_number text,
  notes text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT calibration_pkey PRIMARY KEY (id),
  CONSTRAINT calibration_calibration_code_key UNIQUE (calibration_code)
);
CREATE TABLE department (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  department_code text NOT NULL,
  department_name text NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT department_pkey PRIMARY KEY (id)
);
CREATE TABLE equipment (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  equipment_code text DEFAULT ('EQ-'::text || lpad((nextval('equipment_code_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
  site_id uuid NOT NULL,
  equipment_name text NOT NULL,
  equipment_type_id uuid NOT NULL,
  department_id uuid,
  manufacturer text,
  model text,
  serial_number text,
  asset_tag text,
  location_id uuid,
  location_note text,
  calibration_required boolean DEFAULT false NOT NULL,
  calibration_interval_months integer,
  calibration_alert_days integer DEFAULT 30 NOT NULL,
  qualification_required boolean DEFAULT false NOT NULL,
  in_service_date date,
  admin_status equipment_admin_status DEFAULT 'In Service'::equipment_admin_status NOT NULL,
  notes text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT equipment_pkey PRIMARY KEY (id),
  CONSTRAINT equipment_equipment_code_key UNIQUE (equipment_code)
);
CREATE TABLE equipment_document (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  equipment_id uuid NOT NULL,
  document_id uuid NOT NULL,
  doc_type equipment_doc_type NOT NULL,
  title text,
  calibration_id uuid,
  qualification_id uuid,
  event_id uuid,
  tag_id uuid,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT equipment_document_pkey PRIMARY KEY (id)
);
CREATE TABLE equipment_event (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  event_code text DEFAULT ('EV-'::text || lpad((nextval('equipment_event_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  equipment_id uuid NOT NULL,
  tag_id uuid,
  schedule_id uuid,
  event_type equipment_event_type NOT NULL,
  performed_date date NOT NULL,
  performed_by_user_id uuid,
  performed_by_vendor text,
  summary text NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT equipment_event_pkey PRIMARY KEY (id),
  CONSTRAINT equipment_event_event_code_key UNIQUE (event_code)
);
CREATE TABLE equipment_owner (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  equipment_id uuid NOT NULL,
  group_id uuid,
  user_id uuid,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT equipment_owner_pkey PRIMARY KEY (id)
);
CREATE TABLE equipment_tag (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tag_code text DEFAULT ('TAG-'::text || lpad((nextval('equipment_tag_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  equipment_id uuid NOT NULL,
  reason tag_reason NOT NULL,
  source tag_source DEFAULT 'Manual'::tag_source NOT NULL,
  schedule_id uuid,
  description text,
  tagged_out_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  tagged_out_by uuid NOT NULL,
  tag_out_signature_id uuid,
  tagged_in_at timestamp with time zone,
  tagged_in_by uuid,
  tag_in_signature_id uuid,
  tag_in_meaning text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT equipment_tag_pkey PRIMARY KEY (id),
  CONSTRAINT equipment_tag_tag_code_key UNIQUE (tag_code)
);
CREATE TABLE equipment_transfer (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  equipment_id uuid NOT NULL,
  from_site_id uuid NOT NULL,
  to_site_id uuid NOT NULL,
  tag_id uuid,
  notes text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT equipment_transfer_pkey PRIMARY KEY (id)
);
CREATE TABLE equipment_type (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  type_name text NOT NULL,
  description text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT equipment_type_pkey PRIMARY KEY (id)
);
CREATE TABLE maintenance_schedule (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  equipment_id uuid NOT NULL,
  task_name text NOT NULL,
  interval_count integer NOT NULL,
  interval_unit text NOT NULL,
  next_due_date date NOT NULL,
  alert_days integer DEFAULT 7 NOT NULL,
  tag_out_when_due boolean DEFAULT true NOT NULL,
  instructions text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT maintenance_schedule_pkey PRIMARY KEY (id)
);
CREATE TABLE qualification (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  qualification_code text DEFAULT ('QL-'::text || lpad((nextval('qualification_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  equipment_id uuid NOT NULL,
  tag_id uuid,
  qualification_type qualification_type NOT NULL,
  performed_date date NOT NULL,
  result cal_result NOT NULL,
  performed_by_user_id uuid,
  performed_by_vendor text,
  protocol_reference text,
  notes text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT qualification_pkey PRIMARY KEY (id),
  CONSTRAINT qualification_qualification_code_key UNIQUE (qualification_code)
);

-- ---------------------------------------------- Inventory, mixtures and QA testing of lots
CREATE TABLE chemical (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  chemical_code text DEFAULT ('CHEM-'::text || lpad((nextval('chemical_code_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
  chemical_name text NOT NULL,
  cas_number text,
  analyte_id uuid,
  synonyms text[] DEFAULT '{}'::text[] NOT NULL,
  hazard_notes text,
  status master_status DEFAULT 'Active'::master_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT chemical_pkey PRIMARY KEY (id),
  CONSTRAINT chemical_chemical_code_key UNIQUE (chemical_code)
);
CREATE TABLE inventory_lot (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lot_code text DEFAULT ('INV-'::text || lpad((nextval('inventory_lot_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  site_id uuid NOT NULL,
  chemical_id uuid,
  item_description text,
  chemical_types chemical_type[] NOT NULL,
  supplier_id uuid,
  manufacturer_id uuid,
  catalog_number text,
  manufacturer_lot text,
  receipt_status receipt_status DEFAULT 'Received'::receipt_status NOT NULL,
  status lot_status DEFAULT 'Available'::lot_status NOT NULL,
  requested_quantity numeric(14,4),
  quantity_received numeric(14,4),
  unit text,
  container_count integer,
  concentration numeric(14,6),
  concentration_unit text,
  purity_pct numeric(7,4),
  received_date date,
  opened_date date,
  expiration_date date,
  retest_date date,
  storage_condition storage_condition,
  storage_location_id uuid,
  transferred_from_lot_id uuid,
  reorder_of_lot_id uuid,
  approved_by uuid,
  approved_at timestamp with time zone,
  notes text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  item_name text,
  cas_number text,
  physical_form text,
  purchase_line_id uuid,
  item_url text,
  qualification_required boolean DEFAULT false NOT NULL,
  department_id uuid,
  waste_classification_id uuid,
  CONSTRAINT inventory_lot_pkey PRIMARY KEY (id),
  CONSTRAINT inventory_lot_lot_code_key UNIQUE (lot_code)
);
CREATE TABLE inventory_transaction (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lot_id uuid NOT NULL,
  txn_type inventory_txn_type NOT NULL,
  quantity_change numeric(14,4) NOT NULL,
  txn_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  related_lot_id uuid,
  reference text,
  notes text,
  reason text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  corrects_txn_id uuid,
  waste_classification_id uuid,
  CONSTRAINT inventory_transaction_pkey PRIMARY KEY (id)
);
CREATE TABLE lot_analyte (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lot_id uuid NOT NULL,
  analyte_id uuid NOT NULL,
  concentration numeric(24,10),
  concentration_unit text,
  target_concentration numeric(24,10),
  tolerance_pct numeric(7,3),
  calculated boolean DEFAULT false NOT NULL,
  calc_note text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  expressed_as text,
  formula_weight numeric(14,6),
  analyte_per_unit numeric(10,4),
  CONSTRAINT lot_analyte_pkey PRIMARY KEY (id),
  CONSTRAINT lot_analyte_lot_id_analyte_id_key UNIQUE (lot_id, analyte_id)
);
CREATE TABLE lot_component (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lot_id uuid NOT NULL,
  component_lot_id uuid NOT NULL,
  quantity_used numeric(14,4) NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  entered_quantity numeric(14,6),
  entered_unit text,
  CONSTRAINT lot_component_pkey PRIMARY KEY (id),
  CONSTRAINT lot_component_lot_id_component_lot_id_key UNIQUE (lot_id, component_lot_id)
);
CREATE TABLE media_qualification (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  qualification_code text DEFAULT ('MQ-'::text || lpad((nextval('media_qualification_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  lot_id uuid NOT NULL,
  use_test_id uuid,
  qualification_test_id uuid NOT NULL,
  requested_test_id uuid NOT NULL,
  status text DEFAULT 'Testing'::text NOT NULL,
  batch_id uuid,
  decided_at timestamp with time zone,
  decided_by uuid,
  decision_note text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  retest_of_id uuid,
  CONSTRAINT media_qualification_pkey PRIMARY KEY (id),
  CONSTRAINT media_qualification_qualification_code_key UNIQUE (qualification_code)
);
CREATE TABLE qa_testing_default (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  chemical_type chemical_type NOT NULL,
  required boolean DEFAULT false NOT NULL,
  note text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT qa_testing_default_pkey PRIMARY KEY (id),
  CONSTRAINT qa_testing_default_site_id_chemical_type_key UNIQUE (site_id, chemical_type)
);
CREATE TABLE storage_location (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  location_code text NOT NULL,
  location_name text NOT NULL,
  location_type location_type DEFAULT 'Other'::location_type NOT NULL,
  parent_location_id uuid,
  supported_conditions storage_condition[] DEFAULT '{}'::storage_condition[] NOT NULL,
  holds_samples boolean DEFAULT false NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT storage_location_pkey PRIMARY KEY (id)
);
CREATE TABLE supplier_coa (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lot_id uuid NOT NULL,
  document_id uuid NOT NULL,
  file_name text NOT NULL,
  sha256 text NOT NULL,
  extraction_method text DEFAULT 'Manual'::text NOT NULL,
  ai_model text,
  ai_proposed jsonb,
  values_confirmed jsonb,
  confirmed_by uuid,
  confirmed_at timestamp with time zone,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT supplier_coa_pkey PRIMARY KEY (id)
);
CREATE TABLE threshold_rule (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  rule_name text NOT NULL,
  subject threshold_subject NOT NULL,
  rule_type threshold_type NOT NULL,
  "value" numeric(14,4) NOT NULL,
  site_id uuid,
  chemical_id uuid,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT threshold_rule_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------- Invoicing
CREATE TABLE accounting_connection (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  provider text DEFAULT 'QuickBooks Online'::text NOT NULL,
  company_name text,
  company_id text,
  environment text DEFAULT 'Sandbox'::text NOT NULL,
  status text DEFAULT 'Not connected'::text NOT NULL,
  item_name text DEFAULT 'Laboratory testing'::text NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT accounting_connection_pkey PRIMARY KEY (id),
  CONSTRAINT accounting_connection_site_id_key UNIQUE (site_id)
);
CREATE TABLE accounting_customer (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  client_id uuid NOT NULL,
  external_id text NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT accounting_customer_pkey PRIMARY KEY (id),
  CONSTRAINT accounting_customer_site_id_client_id_key UNIQUE (site_id, client_id)
);
CREATE TABLE accounting_push (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  invoice_id uuid NOT NULL,
  site_id uuid NOT NULL,
  provider text NOT NULL,
  entity text NOT NULL,
  payload jsonb NOT NULL,
  status text DEFAULT 'Waiting for connection'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  last_error text,
  external_id text,
  sent_at timestamp with time zone,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT accounting_push_pkey PRIMARY KEY (id),
  CONSTRAINT accounting_push_invoice_id_key UNIQUE (invoice_id)
);
CREATE TABLE invoice (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  draft_code text DEFAULT ('DR-'::text || lpad((nextval('invoice_draft_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  invoice_number text,
  kind text DEFAULT 'Invoice'::text NOT NULL,
  status text DEFAULT 'Draft'::text NOT NULL,
  site_id uuid NOT NULL,
  client_id uuid NOT NULL,
  lab_order_id uuid NOT NULL,
  credit_of_id uuid,
  claimed_by uuid,
  note text,
  internal_note text,
  po_number text,
  bill_to_name text,
  bill_to_address text,
  payment_terms_days integer,
  invoice_date date,
  due_date date,
  currency text DEFAULT 'USD'::text NOT NULL,
  list_total numeric(12,2) DEFAULT 0 NOT NULL,
  discount_total numeric(12,2) DEFAULT 0 NOT NULL,
  rush_total numeric(12,2) DEFAULT 0 NOT NULL,
  total numeric(12,2) DEFAULT 0 NOT NULL,
  catchup boolean DEFAULT false NOT NULL,
  reason text,
  issued_at timestamp with time zone,
  issued_by uuid,
  signature_id uuid,
  issue_txid bigint,
  document_id uuid,
  sha256 text,
  sent_at timestamp with time zone,
  discarded_at timestamp with time zone,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  paid_on date,
  paid_note text,
  paid_recorded_by uuid,
  paid_recorded_at timestamp with time zone,
  CONSTRAINT invoice_pkey PRIMARY KEY (id),
  CONSTRAINT invoice_draft_code_key UNIQUE (draft_code),
  CONSTRAINT invoice_invoice_number_key UNIQUE (invoice_number)
);
CREATE TABLE invoice_correction (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  correction_no integer DEFAULT nextval('invoice_correction_seq'::regclass) NOT NULL,
  invoice_id uuid NOT NULL,
  field text NOT NULL,
  old_value text,
  new_value text,
  reason text NOT NULL,
  signature_id uuid,
  txid bigint DEFAULT txid_current() NOT NULL,
  document_id uuid,
  sha256 text,
  push_payload jsonb,
  push_status text DEFAULT 'Waiting for connection'::text NOT NULL,
  sent_at timestamp with time zone,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT invoice_correction_pkey PRIMARY KEY (id)
);
CREATE TABLE invoice_counter (
  site_id uuid NOT NULL,
  kind text NOT NULL,
  last_no integer DEFAULT 0 NOT NULL,
  CONSTRAINT invoice_counter_pkey PRIMARY KEY (site_id, kind)
);
CREATE TABLE invoice_line (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  invoice_id uuid NOT NULL,
  line_no integer NOT NULL,
  kind text DEFAULT 'Charge'::text NOT NULL,
  status text DEFAULT 'Active'::text NOT NULL,
  requested_test_id uuid,
  credits_line_id uuid,
  rebill boolean,
  sample_code text,
  client_sample_id text,
  test_code text,
  test_name text NOT NULL,
  completed_on date,
  due_date date,
  late_days integer DEFAULT 0 NOT NULL,
  list_price numeric(12,2) DEFAULT 0 NOT NULL,
  quoted_price numeric(12,2) DEFAULT 0 NOT NULL,
  price numeric(12,2) DEFAULT 0 NOT NULL,
  price_note text,
  rush_ordered text,
  rush_ordered_fee numeric(12,2) DEFAULT 0 NOT NULL,
  rush_tier_id uuid,
  rush_billed text,
  rush_fee numeric(12,2) DEFAULT 0 NOT NULL,
  rush_note text,
  retest_of_id uuid,
  line_note text,
  amount numeric(12,2) NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  order_charge_id uuid,
  CONSTRAINT invoice_line_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------- Lab orders, samples and intake
CREATE TABLE email_outbox (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  template text NOT NULL,
  to_address text,
  to_name text,
  subject text NOT NULL,
  body text NOT NULL,
  lab_order_id uuid,
  delivery_status text DEFAULT 'Not sent (Sandbox)'::text NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  coa_version_id uuid,
  document_id uuid,
  project_version_id uuid,
  site_id uuid,
  split_request_id uuid,
  CONSTRAINT email_outbox_pkey PRIMARY KEY (id)
);
CREATE TABLE lab_order (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  order_code text DEFAULT ('LO-'::text || lpad((nextval('lab_order_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  client_id uuid NOT NULL,
  site_id uuid NOT NULL,
  ordering_contact_id uuid NOT NULL,
  submission_channel submission_channel DEFAULT 'Walk-in'::submission_channel NOT NULL,
  origin lab_order_origin DEFAULT 'Client Submission'::lab_order_origin NOT NULL,
  po_number text,
  notes text,
  status lab_order_status DEFAULT 'Draft'::lab_order_status NOT NULL,
  submitted_at timestamp with time zone,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  client_license_id uuid,
  CONSTRAINT lab_order_pkey PRIMARY KEY (id),
  CONSTRAINT lab_order_order_code_key UNIQUE (order_code)
);
CREATE TABLE ordered_package (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  order_package_code text DEFAULT ('OP-'::text || lpad((nextval('ordered_package_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  sample_id uuid NOT NULL,
  quoted_package_id uuid NOT NULL,
  package_id uuid NOT NULL,
  status text DEFAULT 'Intact'::text NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT ordered_package_pkey PRIMARY KEY (id),
  CONSTRAINT ordered_package_order_package_code_key UNIQUE (order_package_code)
);
CREATE TABLE requested_analyte (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  requested_test_id uuid NOT NULL,
  analyte_id uuid NOT NULL,
  analyte_price numeric(12,2) NOT NULL,
  included boolean DEFAULT true NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT requested_analyte_pkey PRIMARY KEY (id),
  CONSTRAINT requested_analyte_requested_test_id_analyte_id_key UNIQUE (requested_test_id, analyte_id)
);
CREATE TABLE requested_test (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sample_id uuid NOT NULL,
  test_id uuid NOT NULL,
  test_version_id uuid NOT NULL,
  quoted_line_id uuid,
  source test_source DEFAULT 'Quote'::test_source NOT NULL,
  status requested_test_status DEFAULT 'Ordered'::requested_test_status NOT NULL,
  special_instructions text,
  rush_tier_id uuid,
  rush_status rush_status DEFAULT 'None'::rush_status NOT NULL,
  rush_requested_at timestamp with time zone,
  list_price numeric(12,2) DEFAULT 0 NOT NULL,
  price numeric(12,2) DEFAULT 0 NOT NULL,
  rush_fee numeric(12,2) DEFAULT 0 NOT NULL,
  tat_days integer,
  tat_unit tat_unit,
  clock_start timestamp with time zone,
  day0 date,
  due_date date,
  recalc_at timestamp with time zone,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  tat_override integer,
  media_lot_id uuid,
  retest_of_id uuid,
  oos_investigation_id uuid,
  billing_status text,
  retest_replicates integer,
  stability_study_id uuid,
  stability_cell_id uuid,
  stability_pull_id uuid,
  serving_order boolean DEFAULT false NOT NULL,
  ordered_package_id uuid,
  competency_attempt_id uuid,
  catalogue_order boolean DEFAULT false NOT NULL,
  CONSTRAINT requested_test_pkey PRIMARY KEY (id)
);
CREATE TABLE rush_decision (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  requested_test_id uuid NOT NULL,
  decision rush_decision_type NOT NULL,
  requested_tier_id uuid NOT NULL,
  replacement_tier_id uuid,
  reason text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT rush_decision_pkey PRIMARY KEY (id)
);
CREATE TABLE sample (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lab_order_id uuid NOT NULL,
  sample_code text,
  client_sample_id text,
  description text,
  matrix text,
  product text,
  lot text,
  batch text,
  quantity_received numeric(12,3),
  quantity_unit text,
  number_of_units integer,
  condition text,
  receipt_temperature numeric(6,2),
  preservation text,
  received_at timestamp with time zone,
  logged_at timestamp with time zone,
  logged_by uuid,
  status sample_status DEFAULT 'Expected'::sample_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  storage_location_id uuid,
  storage_condition storage_condition,
  retained_quantity numeric(12,3),
  retained_unit text,
  compliance_category text,
  serving_size numeric(14,4),
  serving_unit text,
  serving_count numeric(10,3),
  serving_count_unit text,
  servings_per_package numeric(12,3),
  report_per_serving boolean DEFAULT false NOT NULL,
  unit_weight numeric(14,6),
  unit_weight_unit text,
  unit_weight_result_id uuid,
  density numeric(14,6),
  density_unit text,
  density_result_id uuid,
  metrc_id text,
  CONSTRAINT sample_pkey PRIMARY KEY (id),
  CONSTRAINT sample_sample_code_key UNIQUE (sample_code)
);
CREATE TABLE site_day_counter (
  site_id uuid NOT NULL,
  day date NOT NULL,
  last_no integer NOT NULL,
  CONSTRAINT site_day_counter_pkey PRIMARY KEY (site_id, day)
);

-- ---------------------------------------------- Lab setup: sites, report templates, waste
CREATE TABLE lab_site (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_code text NOT NULL,
  site_name text NOT NULL,
  time_zone text NOT NULL,
  address text,
  default_oos_procedure oos_procedure DEFAULT 'Check and Acknowledge'::oos_procedure NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  require_workflow_verification boolean DEFAULT false NOT NULL,
  accreditation_body text,
  accreditation_certificate text,
  accreditation_statement text,
  subcontract_discount_pct numeric(5,2) DEFAULT 20 NOT NULL,
  subcontract_markup_pct numeric(6,2) DEFAULT 30 NOT NULL,
  stability_pull_window_days integer DEFAULT 7 NOT NULL,
  stability_reserve_pct numeric(5,2) DEFAULT 10 NOT NULL,
  invoice_remit_to text,
  custody_signature_required boolean DEFAULT false NOT NULL,
  require_training boolean DEFAULT false NOT NULL,
  CONSTRAINT lab_site_pkey PRIMARY KEY (id),
  CONSTRAINT lab_site_site_code_key UNIQUE (site_code)
);
CREATE TABLE report_template (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  template_code text DEFAULT ('RT-'::text || lpad((nextval('report_template_seq'::regclass))::text, 3, '0'::text)) NOT NULL,
  template_name text NOT NULL,
  description text,
  layout text DEFAULT 'Standard COA'::text NOT NULL,
  site_id uuid,
  is_default boolean DEFAULT false NOT NULL,
  options jsonb DEFAULT '{}'::jsonb NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT report_template_pkey PRIMARY KEY (id),
  CONSTRAINT report_template_template_code_key UNIQUE (template_code)
);
CREATE TABLE site_holiday (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  holiday_date date NOT NULL,
  description text NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT site_holiday_pkey PRIMARY KEY (id)
);
CREATE TABLE site_media (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  kind text NOT NULL,
  title text,
  document_id uuid NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT site_media_pkey PRIMARY KEY (id)
);
CREATE TABLE system_setting (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  setting_key text NOT NULL,
  setting_value text NOT NULL,
  description text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT system_setting_pkey PRIMARY KEY (id),
  CONSTRAINT system_setting_setting_key_key UNIQUE (setting_key)
);
CREATE TABLE waste_classification (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  waste_code text DEFAULT ('WC-'::text || lpad((nextval('waste_classification_seq'::regclass))::text, 3, '0'::text)) NOT NULL,
  site_id uuid,
  waste_name text NOT NULL,
  hazard_classes text[] DEFAULT '{}'::text[] NOT NULL,
  epa_codes text,
  waste_stream text,
  container text,
  disposal_instructions text,
  segregation text,
  default_for chemical_type[] DEFAULT '{}'::chemical_type[] NOT NULL,
  needs_review boolean DEFAULT false NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT waste_classification_pkey PRIMARY KEY (id),
  CONSTRAINT waste_classification_waste_code_key UNIQUE (waste_code)
);

-- ---------------------------------------------- OOS investigations
CREATE TABLE oos_checklist_item (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  procedure oos_procedure NOT NULL,
  section text NOT NULL,
  item_text text NOT NULL,
  sort_order integer DEFAULT 100 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT oos_checklist_item_pkey PRIMARY KEY (id)
);
CREATE TABLE oos_client_response (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  oos_id uuid NOT NULL,
  choice text NOT NULL,
  note text,
  contact_name text,
  received_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  handled_by uuid,
  handled_at timestamp with time zone,
  handled_note text,
  retest_requested_test_id uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT oos_client_response_pkey PRIMARY KEY (id)
);
CREATE TABLE oos_investigation (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  oos_code text DEFAULT ('OOS-'::text || lpad((nextval('oos_code_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  site_id uuid NOT NULL,
  sample_id uuid NOT NULL,
  requested_test_id uuid NOT NULL,
  analyte_id uuid NOT NULL,
  batch_id uuid,
  test_result_id uuid,
  procedure oos_procedure NOT NULL,
  is_gmp boolean NOT NULL,
  reported text,
  value_num numeric,
  unit text,
  spec_text text,
  opened_reason text,
  status text DEFAULT 'Open'::text NOT NULL,
  opened_by uuid NOT NULL,
  opened_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  open_signature_id uuid,
  due_date date,
  auto_checks jsonb DEFAULT '[]'::jsonb NOT NULL,
  auto_checked_at timestamp with time zone,
  analyst_answers jsonb,
  analyst_comment text,
  hypothesis text,
  analyst_by uuid,
  analyst_at timestamp with time zone,
  analyst_signature_id uuid,
  supervisor_answers jsonb,
  supervisor_comment text,
  supervisor_by uuid,
  supervisor_at timestamp with time zone,
  supervisor_signature_id uuid,
  reviewer_answers jsonb,
  conclusion text,
  assignable_cause text,
  conclusion_comment text,
  concluded_by uuid,
  concluded_at timestamp with time zone,
  conclusion_signature_id uuid,
  report_document_id uuid,
  report_sha256 text,
  client_token text,
  client_notified_at timestamp with time zone,
  retest_determination text,
  determination_reason text,
  determined_by uuid,
  determined_at timestamp with time zone,
  determination_signature_id uuid,
  cancelled_reason text,
  cancelled_by uuid,
  cancelled_at timestamp with time zone,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  phase2_decision text,
  phase2_note text,
  phase2_by uuid,
  phase2_at timestamp with time zone,
  CONSTRAINT oos_investigation_pkey PRIMARY KEY (id),
  CONSTRAINT oos_investigation_client_token_key UNIQUE (client_token),
  CONSTRAINT oos_investigation_oos_code_key UNIQUE (oos_code)
);
CREATE TABLE oos_procedure_setting (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  procedure oos_procedure NOT NULL,
  close_within_days integer NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT oos_procedure_setting_pkey PRIMARY KEY (id),
  CONSTRAINT oos_procedure_setting_procedure_key UNIQUE (procedure)
);

-- ---------------------------------------------- Platform: search, paging, audit trail, security
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL,
  record_version integer NOT NULL,
  changed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  changed_by uuid NOT NULL,
  reason text,
  changed_fields jsonb NOT NULL,
  new_row jsonb NOT NULL,
  signature_id uuid,
  CONSTRAINT audit_log_pkey PRIMARY KEY (id)
);
CREATE TABLE document_file (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  content bytea NOT NULL,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT document_file_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------- Purchasing and vendor approvals
CREATE TABLE purchase_line (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  line_code text DEFAULT ('PR-'::text || lpad((nextval('purchase_line_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  site_id uuid NOT NULL,
  line_type purchase_line_type NOT NULL,
  description text NOT NULL,
  supplier_id uuid,
  catalog_number text,
  quantity numeric NOT NULL,
  unit text,
  unit_price numeric(12,2),
  needed_by date,
  justification text,
  lot_id uuid,
  equipment_id uuid,
  status purchase_line_status DEFAULT 'Requested'::purchase_line_status NOT NULL,
  requested_by uuid NOT NULL,
  requested_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  approved_by uuid,
  approved_at timestamp with time zone,
  approved2_by uuid,
  approved2_at timestamp with time zone,
  rejected_reason text,
  purchase_order_id uuid,
  received_quantity numeric DEFAULT 0 NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  item_url text,
  scope_ids uuid[],
  CONSTRAINT purchase_line_pkey PRIMARY KEY (id),
  CONSTRAINT purchase_line_line_code_key UNIQUE (line_code)
);
CREATE TABLE purchase_order (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  po_code text NOT NULL,
  site_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  external_po_number text,
  confirmation_number text,
  ordered_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  notes text,
  signature_id uuid,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT purchase_order_pkey PRIMARY KEY (id),
  CONSTRAINT purchase_order_po_code_key UNIQUE (po_code)
);
CREATE TABLE purchase_receipt (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  receipt_code text DEFAULT ('RC-'::text || lpad((nextval('purchase_receipt_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  purchase_line_id uuid NOT NULL,
  quantity numeric NOT NULL,
  received_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  lot_id uuid,
  equipment_id uuid,
  discrepancy receipt_discrepancy DEFAULT 'None'::receipt_discrepancy NOT NULL,
  note text,
  packing_slip_id uuid,
  signature_id uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  actual_unit_price numeric(12,2),
  CONSTRAINT purchase_receipt_pkey PRIMARY KEY (id),
  CONSTRAINT purchase_receipt_receipt_code_key UNIQUE (receipt_code)
);
CREATE TABLE purchasing_setting (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  second_approval_over numeric(12,2),
  currency text DEFAULT 'USD'::text NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT purchasing_setting_pkey PRIMARY KEY (id),
  CONSTRAINT purchasing_setting_site_id_key UNIQUE (site_id)
);
CREATE TABLE supplier (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  supplier_code text DEFAULT ('SUP-'::text || lpad((nextval('supplier_code_seq'::regclass))::text, 4, '0'::text)) NOT NULL,
  supplier_name text NOT NULL,
  supplier_type supplier_type DEFAULT 'Supplier and Manufacturer'::supplier_type NOT NULL,
  website text,
  email text,
  phone text,
  notes text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  account_number text,
  contact_name text,
  address text,
  CONSTRAINT supplier_pkey PRIMARY KEY (id),
  CONSTRAINT supplier_supplier_code_key UNIQUE (supplier_code)
);
CREATE TABLE supplier_risk_class (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid,
  class_name text NOT NULL,
  requal_months integer NOT NULL,
  description text,
  sort_order integer DEFAULT 0 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT supplier_risk_class_pkey PRIMARY KEY (id)
);
CREATE TABLE supply_scope (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  scope_name text NOT NULL,
  description text,
  chemical_types chemical_type[] DEFAULT '{}'::chemical_type[] NOT NULL,
  line_types purchase_line_type[] DEFAULT '{}'::purchase_line_type[] NOT NULL,
  default_for purchase_line_type,
  sort_order integer DEFAULT 0 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT supply_scope_pkey PRIMARY KEY (id)
);
CREATE TABLE vendor_document (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  qualification_id uuid,
  promotion_id uuid,
  document_id uuid NOT NULL,
  doc_kind text NOT NULL,
  title text,
  certificate_expires date,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT vendor_document_pkey PRIMARY KEY (id)
);
CREATE TABLE vendor_notice (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  qualification_id uuid,
  promotion_id uuid,
  notice text NOT NULL,
  acknowledged_by uuid,
  acknowledged_at timestamp with time zone,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT vendor_notice_pkey PRIMARY KEY (id)
);
CREATE TABLE vendor_promotion (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  promotion_code text DEFAULT ('VP-'::text || lpad((nextval('vendor_promotion_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
  supplier_id uuid NOT NULL,
  site_id uuid NOT NULL,
  from_qualification_id uuid NOT NULL,
  risk_class_id uuid NOT NULL,
  scope_ids uuid[],
  note text,
  status text DEFAULT 'Proposed'::text NOT NULL,
  decided_by uuid,
  decided_at timestamp with time zone,
  decision_note text,
  decision_signature_id uuid,
  corporate_qualification_id uuid,
  proposal_signature_id uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT vendor_promotion_pkey PRIMARY KEY (id),
  CONSTRAINT vendor_promotion_promotion_code_key UNIQUE (promotion_code)
);
CREATE TABLE vendor_qualification (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  qualification_code text DEFAULT ('VQ-'::text || lpad((nextval('vendor_qualification_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
  supplier_id uuid NOT NULL,
  site_id uuid,
  risk_class_id uuid NOT NULL,
  approval_status vendor_approval_status NOT NULL,
  accreditations text,
  approval_date date NOT NULL,
  expiration_date date,
  justification text,
  is_legacy boolean DEFAULT false NOT NULL,
  signature_id uuid,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  scope_ids uuid[],
  promoted_from_id uuid,
  promotion_id uuid,
  CONSTRAINT vendor_qualification_pkey PRIMARY KEY (id),
  CONSTRAINT vendor_qualification_qualification_code_key UNIQUE (qualification_code)
);

-- ---------------------------------------------- Quotes and projects
CREATE TABLE project (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_code text NOT NULL,
  client_id uuid NOT NULL,
  project_name text NOT NULL,
  purpose text,
  origin project_origin DEFAULT 'Lab'::project_origin NOT NULL,
  requested_by_contact_id uuid,
  available_to_child_clients boolean DEFAULT false NOT NULL,
  is_list_price_acceptance boolean DEFAULT false NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  kind text DEFAULT 'Project'::text NOT NULL,
  owner_id uuid,
  quote_contact_id uuid,
  site_id uuid,
  CONSTRAINT project_pkey PRIMARY KEY (id),
  CONSTRAINT project_project_code_key UNIQUE (project_code)
);
CREATE TABLE project_version (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_id uuid NOT NULL,
  version_no integer NOT NULL,
  status project_version_status DEFAULT 'Draft'::project_version_status NOT NULL,
  quoted_at timestamp with time zone,
  valid_until date,
  accepted_by_contact_id uuid,
  accepted_at timestamp with time zone,
  notes text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  quoted_by uuid,
  sent_at timestamp with time zone,
  sent_by uuid,
  sent_to_contact_id uuid,
  quote_document_id uuid,
  client_token text,
  decided_via text,
  client_response_name text,
  client_response_note text,
  rejected_reason text,
  rejected_at timestamp with time zone,
  rejected_by uuid,
  CONSTRAINT project_version_pkey PRIMARY KEY (id),
  CONSTRAINT project_version_client_token_key UNIQUE (client_token),
  CONSTRAINT project_version_project_id_version_no_key UNIQUE (project_id, version_no)
);
CREATE TABLE quote_rush_term (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_version_id uuid NOT NULL,
  tier_id uuid NOT NULL,
  schedule_name text NOT NULL,
  tier_name text NOT NULL,
  rush_tat integer NOT NULL,
  tat_unit tat_unit NOT NULL,
  surcharge_type surcharge_type NOT NULL,
  surcharge_value numeric(12,2) NOT NULL,
  discount_pct numeric(5,2) DEFAULT 0 NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT quote_rush_term_pkey PRIMARY KEY (id),
  CONSTRAINT quote_rush_term_project_version_id_tier_id_key UNIQUE (project_version_id, tier_id)
);
CREATE TABLE quoted_analyte_selection (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  line_id uuid NOT NULL,
  analyte_id uuid NOT NULL,
  analyte_price numeric(12,2) NOT NULL,
  included boolean DEFAULT true NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT quoted_analyte_selection_pkey PRIMARY KEY (id),
  CONSTRAINT quoted_analyte_selection_line_id_analyte_id_key UNIQUE (line_id, analyte_id)
);
CREATE TABLE quoted_package (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_version_id uuid NOT NULL,
  package_id uuid NOT NULL,
  package_code text NOT NULL,
  package_name text NOT NULL,
  quantity integer DEFAULT 1 NOT NULL,
  list_price numeric(12,2) DEFAULT 0 NOT NULL,
  package_price numeric(12,2) NOT NULL,
  status line_status DEFAULT 'Active'::line_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT quoted_package_pkey PRIMARY KEY (id)
);
CREATE TABLE quoted_test_configuration (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_version_id uuid NOT NULL,
  test_id uuid NOT NULL,
  quantity integer DEFAULT 1 NOT NULL,
  list_price numeric(12,2) DEFAULT 0 NOT NULL,
  final_price numeric(12,2),
  discount_amount numeric(12,2),
  discount_pct numeric(6,2),
  line_total numeric(14,2),
  special_instructions text,
  status line_status DEFAULT 'Active'::line_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  is_subcontracted boolean DEFAULT false NOT NULL,
  performing_site_id uuid,
  cost_price numeric(12,2),
  sc_discount_pct numeric(5,2),
  sc_markup_pct numeric(6,2),
  quoted_package_id uuid,
  CONSTRAINT quoted_test_configuration_pkey PRIMARY KEY (id)
);
CREATE TABLE specification (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  quoted_line_id uuid,
  requested_test_id uuid,
  analyte_id uuid NOT NULL,
  min_value numeric,
  max_value numeric,
  text_value text,
  unit text,
  source spec_source DEFAULT 'Client'::spec_source NOT NULL,
  copied_from_spec_id uuid,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  basis text DEFAULT 'As reported'::text NOT NULL,
  CONSTRAINT specification_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------- Report Finalization and the COA
CREATE TABLE coa (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sample_id uuid NOT NULL,
  coa_code text NOT NULL,
  site_id uuid NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT coa_pkey PRIMARY KEY (id),
  CONSTRAINT coa_coa_code_key UNIQUE (coa_code),
  CONSTRAINT coa_sample_id_key UNIQUE (sample_id)
);
CREATE TABLE coa_note (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sample_id uuid NOT NULL,
  requested_test_id uuid,
  analyte_id uuid,
  kind text NOT NULL,
  note_text text NOT NULL,
  reason_code_id uuid,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT coa_note_pkey PRIMARY KEY (id)
);
CREATE TABLE coa_version (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  coa_id uuid NOT NULL,
  version_no integer NOT NULL,
  is_final boolean NOT NULL,
  content jsonb NOT NULL,
  document_id uuid NOT NULL,
  sha256 text NOT NULL,
  prev_sha256 text,
  verify_code text NOT NULL,
  release_checks jsonb DEFAULT '[]'::jsonb NOT NULL,
  internal_note text,
  group_code text NOT NULL,
  issued_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  issued_by uuid NOT NULL,
  signature_id uuid NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  signature_image_id uuid,
  signer_title text,
  report_template_ids uuid[],
  CONSTRAINT coa_version_pkey PRIMARY KEY (id),
  CONSTRAINT coa_version_coa_id_version_no_key UNIQUE (coa_id, version_no),
  CONSTRAINT coa_version_verify_code_key UNIQUE (verify_code)
);
CREATE TABLE email_template (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  template_code text NOT NULL,
  template_name text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  placeholders text,
  is_active boolean DEFAULT true NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT email_template_pkey PRIMARY KEY (id),
  CONSTRAINT email_template_template_code_key UNIQUE (template_code)
);
CREATE TABLE finalization_claim (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  claim_code text DEFAULT ('FB-'::text || lpad((nextval('finalization_claim_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  site_id uuid NOT NULL,
  claimed_by uuid NOT NULL,
  status text DEFAULT 'Active'::text NOT NULL,
  note text,
  closed_at timestamp with time zone,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT finalization_claim_pkey PRIMARY KEY (id),
  CONSTRAINT finalization_claim_claim_code_key UNIQUE (claim_code)
);
CREATE TABLE finalization_claim_test (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  claim_id uuid NOT NULL,
  requested_test_id uuid NOT NULL,
  status text DEFAULT 'Active'::text NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT finalization_claim_test_pkey PRIMARY KEY (id)
);
CREATE TABLE result_finalization (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  requested_test_id uuid NOT NULL,
  result_ids uuid[] NOT NULL,
  coa_version_id uuid,
  group_code text NOT NULL,
  finalized_by uuid NOT NULL,
  finalized_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  signature_id uuid NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT result_finalization_pkey PRIMARY KEY (id)
);
CREATE TABLE sample_attachment (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lab_order_id uuid NOT NULL,
  sample_id uuid,
  document_id uuid NOT NULL,
  kind text DEFAULT 'Other'::text NOT NULL,
  label text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT sample_attachment_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------- Sign-in, people, groups and permissions
CREATE TABLE app_user (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  username text NOT NULL,
  full_name text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  is_admin boolean DEFAULT false NOT NULL,
  job_role user_job_role DEFAULT 'Analyst'::user_job_role NOT NULL,
  password_hash text,
  password_changed_at timestamp with time zone,
  must_change_password boolean DEFAULT false NOT NULL,
  failed_attempts integer DEFAULT 0 NOT NULL,
  locked_at timestamp with time zone,
  last_login_at timestamp with time zone,
  is_automated boolean DEFAULT false NOT NULL,
  title text,
  signature_document_id uuid,
  signature_set_at timestamp with time zone,
  signature_set_by uuid,
  CONSTRAINT app_user_pkey PRIMARY KEY (id),
  CONSTRAINT app_user_username_key UNIQUE (username)
);
CREATE TABLE auth_event (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid,
  username text,
  event text NOT NULL,
  detail text,
  by_user uuid,
  at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT auth_event_pkey PRIMARY KEY (id)
);
CREATE TABLE group_member (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT group_member_pkey PRIMARY KEY (id),
  CONSTRAINT group_member_group_id_user_id_key UNIQUE (group_id, user_id)
);
CREATE TABLE group_permission (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  group_id uuid NOT NULL,
  permission_code text NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT group_permission_pkey PRIMARY KEY (id),
  CONSTRAINT group_permission_group_id_permission_code_key UNIQUE (group_id, permission_code)
);
CREATE TABLE lab_group (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid,
  group_name text NOT NULL,
  description text,
  is_standard boolean DEFAULT false NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  department_id uuid,
  CONSTRAINT lab_group_pkey PRIMARY KEY (id)
);
CREATE TABLE permission (
  code text NOT NULL,
  module text NOT NULL,
  area text NOT NULL,
  description text NOT NULL,
  cross_lab boolean DEFAULT false NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  CONSTRAINT permission_pkey PRIMARY KEY (code)
);
CREATE TABLE signature_event (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  full_name text NOT NULL,
  meaning text NOT NULL,
  action text NOT NULL,
  module text,
  reason text,
  method text NOT NULL,
  signed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  verification_id uuid,
  CONSTRAINT signature_event_pkey PRIMARY KEY (id)
);
CREATE TABLE standard_group_template (
  group_name text NOT NULL,
  description text NOT NULL,
  permissions text[] NOT NULL,
  sort_order integer NOT NULL
);
CREATE TABLE user_site_access (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  site_id uuid NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT user_site_access_pkey PRIMARY KEY (id),
  CONSTRAINT user_site_access_user_id_site_id_key UNIQUE (user_id, site_id)
);

-- ---------------------------------------------- Stability studies
CREATE TABLE stability_amendment (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  study_id uuid NOT NULL,
  amendment_no integer NOT NULL,
  from_version_id uuid NOT NULL,
  to_version_id uuid NOT NULL,
  pulls_added integer DEFAULT 0 NOT NULL,
  pulls_cancelled integer DEFAULT 0 NOT NULL,
  pulls_changed integer DEFAULT 0 NOT NULL,
  applied_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  applied_by uuid NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT stability_amendment_pkey PRIMARY KEY (id)
);
CREATE TABLE stability_cell (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_version_id uuid NOT NULL,
  line_id uuid NOT NULL,
  timepoint_id uuid NOT NULL,
  condition_id uuid,
  units_required integer DEFAULT 1 NOT NULL,
  status line_status DEFAULT 'Active'::line_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT stability_cell_pkey PRIMARY KEY (id)
);
CREATE TABLE stability_chamber (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  equipment_id uuid NOT NULL,
  site_id uuid NOT NULL,
  condition_id uuid NOT NULL,
  notes text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT stability_chamber_pkey PRIMARY KEY (id),
  CONSTRAINT stability_chamber_equipment_id_key UNIQUE (equipment_id)
);
CREATE TABLE stability_condition (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid,
  condition_name text NOT NULL,
  condition_type text DEFAULT 'Long term'::text NOT NULL,
  temperature_c numeric(5,1),
  temperature_tol numeric(4,1),
  humidity_pct numeric(5,1),
  humidity_tol numeric(4,1),
  description text,
  sort_order integer DEFAULT 100 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT stability_condition_pkey PRIMARY KEY (id)
);
CREATE TABLE stability_excursion_assessment (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  study_id uuid NOT NULL,
  logbook_entry_id uuid NOT NULL,
  storage_id uuid NOT NULL,
  decision text NOT NULL,
  justification text NOT NULL,
  excursion_text text,
  affected_pull_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  assessed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  assessed_by uuid NOT NULL,
  signature_id uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT stability_excursion_assessment_pkey PRIMARY KEY (id)
);
CREATE TABLE stability_plan (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_version_id uuid NOT NULL,
  site_id uuid NOT NULL,
  product text,
  lot text,
  protocol_ref text,
  unit_name text DEFAULT 'units'::text NOT NULL,
  planned_placement date,
  escalation_pct numeric(5,2) DEFAULT 0 NOT NULL,
  reserve_pct numeric(5,2),
  notes text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT stability_plan_pkey PRIMARY KEY (id),
  CONSTRAINT stability_plan_project_version_id_key UNIQUE (project_version_id)
);
CREATE TABLE stability_pull (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  study_id uuid NOT NULL,
  storage_id uuid NOT NULL,
  condition_id uuid NOT NULL,
  timepoint_id uuid NOT NULL,
  nominal_date date NOT NULL,
  scheduled_date date NOT NULL,
  window_start date NOT NULL,
  window_end date NOT NULL,
  units_required integer NOT NULL,
  status text DEFAULT 'Scheduled'::text NOT NULL,
  lab_order_id uuid,
  sample_id uuid,
  pulled_at timestamp with time zone,
  pulled_by uuid,
  units_pulled integer,
  within_window boolean,
  pull_note text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT stability_pull_pkey PRIMARY KEY (id)
);
CREATE TABLE stability_rack (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  chamber_id uuid NOT NULL,
  rack_code text NOT NULL,
  description text,
  positions integer,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT stability_rack_pkey PRIMARY KEY (id)
);
CREATE TABLE stability_report (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  report_code text NOT NULL,
  study_id uuid NOT NULL,
  version_no integer NOT NULL,
  is_final boolean DEFAULT false NOT NULL,
  content jsonb NOT NULL,
  fingerprint text NOT NULL,
  document_id uuid NOT NULL,
  sha256 text NOT NULL,
  issued_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  issued_by uuid NOT NULL,
  signature_id uuid NOT NULL,
  signer_title text,
  signature_image_id uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT stability_report_pkey PRIMARY KEY (id),
  CONSTRAINT stability_report_report_code_key UNIQUE (report_code)
);
CREATE TABLE stability_storage (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  storage_code text NOT NULL,
  study_id uuid NOT NULL,
  condition_id uuid NOT NULL,
  rack_id uuid NOT NULL,
  "position" text,
  units_received integer NOT NULL,
  units_required integer DEFAULT 0 NOT NULL,
  shortfall integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'Stored'::text NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  placed_on date,
  disposed_at timestamp with time zone,
  disposed_by uuid,
  disposition_note text,
  CONSTRAINT stability_storage_pkey PRIMARY KEY (id),
  CONSTRAINT stability_storage_storage_code_key UNIQUE (storage_code)
);
CREATE TABLE stability_study (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  study_code text DEFAULT ('STB-'::text || lpad((nextval('stability_study_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
  project_id uuid NOT NULL,
  project_version_id uuid NOT NULL,
  client_id uuid NOT NULL,
  site_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  product text,
  lot text,
  status text DEFAULT 'Awaiting material'::text NOT NULL,
  accepted_at timestamp with time zone NOT NULL,
  escalation_pct numeric(5,2) DEFAULT 0 NOT NULL,
  reserve_pct numeric(5,2) DEFAULT 10 NOT NULL,
  placement_date date,
  placed_at timestamp with time zone,
  placed_by uuid,
  t0_order_id uuid,
  t0_sample_id uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  amendment_no integer DEFAULT 0 NOT NULL,
  cancelled_at timestamp with time zone,
  cancelled_by uuid,
  cancel_reason text,
  CONSTRAINT stability_study_pkey PRIMARY KEY (id),
  CONSTRAINT stability_study_project_id_key UNIQUE (project_id),
  CONSTRAINT stability_study_study_code_key UNIQUE (study_code)
);
CREATE TABLE stability_timepoint (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_version_id uuid NOT NULL,
  label text NOT NULL,
  interval_value integer NOT NULL,
  interval_unit text DEFAULT 'Months'::text NOT NULL,
  days_early integer DEFAULT 7 NOT NULL,
  days_late integer DEFAULT 7 NOT NULL,
  status line_status DEFAULT 'Active'::line_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  carried_from_id uuid,
  CONSTRAINT stability_timepoint_pkey PRIMARY KEY (id)
);
CREATE TABLE stability_version_condition (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  project_version_id uuid NOT NULL,
  condition_id uuid NOT NULL,
  sort_order integer DEFAULT 1 NOT NULL,
  status line_status DEFAULT 'Active'::line_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT stability_version_condition_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------- Test catalogue, pricing and packages
CREATE TABLE catalog_price_change (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  change_code text DEFAULT ('PC-'::text || lpad((nextval('catalog_price_change_seq'::regclass))::text, 4, '0'::text)) NOT NULL,
  site_id uuid NOT NULL,
  tests uuid[],
  pct numeric(7,2) NOT NULL,
  rounding text DEFAULT 'Cent'::text NOT NULL,
  include_packages boolean DEFAULT true NOT NULL,
  effective_on date NOT NULL,
  status text DEFAULT 'Scheduled'::text NOT NULL,
  reason text NOT NULL,
  applied_at timestamp with time zone,
  applied_tests integer,
  applied_packages integer,
  last_error text,
  cancelled_at timestamp with time zone,
  cancelled_by uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT catalog_price_change_pkey PRIMARY KEY (id),
  CONSTRAINT catalog_price_change_change_code_key UNIQUE (change_code)
);
CREATE TABLE rush_fee_schedule (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  schedule_name text NOT NULL,
  description text,
  status master_status DEFAULT 'Active'::master_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT rush_fee_schedule_pkey PRIMARY KEY (id)
);
CREATE TABLE rush_fee_tier (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  schedule_id uuid NOT NULL,
  tier_name text NOT NULL,
  rush_tat integer NOT NULL,
  tat_unit tat_unit DEFAULT 'Business Days'::tat_unit NOT NULL,
  surcharge_type surcharge_type DEFAULT 'Percent'::surcharge_type NOT NULL,
  surcharge_value numeric(12,2) NOT NULL,
  requires_approval boolean DEFAULT false NOT NULL,
  escalation_hours numeric(6,2) DEFAULT 2 NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT rush_fee_tier_pkey PRIMARY KEY (id)
);
CREATE TABLE test (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  test_code text DEFAULT ('T-'::text || lpad((nextval('test_code_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
  test_name text NOT NULL,
  status master_status DEFAULT 'Active'::master_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  site_id uuid,
  department_id uuid,
  copied_from_test_id uuid,
  serving_role text,
  service_line_type_id uuid,
  CONSTRAINT test_pkey PRIMARY KEY (id),
  CONSTRAINT test_test_code_key UNIQUE (test_code)
);
CREATE TABLE test_analyte_price (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  catalog_entry_id uuid NOT NULL,
  analyte_id uuid NOT NULL,
  price numeric(12,2) DEFAULT 0 NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT test_analyte_price_pkey PRIMARY KEY (id)
);
CREATE TABLE test_catalog_entry (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  test_id uuid NOT NULL,
  description text,
  pricing_mode pricing_mode DEFAULT 'Base Price Only'::pricing_mode NOT NULL,
  base_price numeric(12,2) DEFAULT 0 NOT NULL,
  prep_fee numeric(12,2) DEFAULT 0 NOT NULL,
  standard_tat integer DEFAULT 5 NOT NULL,
  tat_unit tat_unit DEFAULT 'Business Days'::tat_unit NOT NULL,
  cutoff_time time without time zone DEFAULT '15:00:00'::time without time zone NOT NULL,
  rush_schedule_id uuid,
  show_in_public_catalogue boolean DEFAULT false NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT test_catalog_entry_pkey PRIMARY KEY (id),
  CONSTRAINT test_catalog_entry_test_id_key UNIQUE (test_id)
);
CREATE TABLE test_package (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  package_code text DEFAULT ('PKG-'::text || lpad((nextval('test_package_seq'::regclass))::text, 4, '0'::text)) NOT NULL,
  site_id uuid NOT NULL,
  package_name text NOT NULL,
  description text,
  show_in_public_catalogue boolean DEFAULT false NOT NULL,
  status master_status DEFAULT 'Active'::master_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT test_package_pkey PRIMARY KEY (id),
  CONSTRAINT test_package_package_code_key UNIQUE (package_code)
);
CREATE TABLE test_package_analyte (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  item_id uuid NOT NULL,
  analyte_id uuid NOT NULL,
  included boolean DEFAULT true NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT test_package_analyte_pkey PRIMARY KEY (id),
  CONSTRAINT test_package_analyte_item_id_analyte_id_key UNIQUE (item_id, analyte_id)
);
CREATE TABLE test_package_item (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  package_id uuid NOT NULL,
  test_id uuid NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  component_price numeric(12,2) NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT test_package_item_pkey PRIMARY KEY (id)
);
CREATE TABLE test_rush_approval (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  catalog_entry_id uuid NOT NULL,
  tier_id uuid NOT NULL,
  requires_approval boolean NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT test_rush_approval_pkey PRIMARY KEY (id),
  CONSTRAINT test_rush_approval_catalog_entry_id_tier_id_key UNIQUE (catalog_entry_id, tier_id)
);

-- ---------------------------------------------- Test workflow designer
CREATE TABLE method (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  method_code text DEFAULT ('MTH-'::text || lpad((nextval('method_code_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
  site_id uuid NOT NULL,
  method_name text NOT NULL,
  sop_code text,
  sop_link text,
  sop_document_id uuid,
  description text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT method_pkey PRIMARY KEY (id),
  CONSTRAINT method_method_code_key UNIQUE (method_code)
);
CREATE TABLE qc_limit_type (
  limit_type text NOT NULL,
  shape text NOT NULL,
  sort_order integer NOT NULL,
  CONSTRAINT qc_limit_type_pkey PRIMARY KEY (limit_type)
);
CREATE TABLE qc_type (
  qc_type text NOT NULL,
  default_class text NOT NULL,
  sort_order integer NOT NULL,
  CONSTRAINT qc_type_pkey PRIMARY KEY (qc_type)
);
CREATE TABLE test_version (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  test_id uuid NOT NULL,
  version_no integer NOT NULL,
  status test_version_status DEFAULT 'Draft'::test_version_status NOT NULL,
  effective_from timestamp with time zone,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  method_id uuid,
  procedure_text text,
  change_summary text,
  rounding_mode rounding_mode DEFAULT 'Significant figures'::rounding_mode NOT NULL,
  rounding_digits integer DEFAULT 3 NOT NULL,
  nd_below_lod boolean DEFAULT false NOT NULL,
  approved_by uuid,
  approved_at timestamp with time zone,
  approval_signature_id uuid,
  copied_from_version_id uuid,
  report_per_serving boolean DEFAULT false NOT NULL,
  report_template_id uuid,
  CONSTRAINT test_version_pkey PRIMARY KEY (id),
  CONSTRAINT test_version_test_id_version_no_key UNIQUE (test_id, version_no)
);
CREATE TABLE test_version_analyte (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  test_version_id uuid NOT NULL,
  analyte_id uuid NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  result_type result_type DEFAULT 'Numeric'::result_type NOT NULL,
  reporting_unit text,
  loq numeric,
  lod numeric,
  rounding_mode rounding_mode,
  rounding_digits integer,
  hide_on_report boolean DEFAULT false NOT NULL,
  default_spec_min numeric,
  default_spec_max numeric,
  default_spec_text text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  result_values text[] DEFAULT '{Absent,Present}'::text[] NOT NULL,
  found_values text[] DEFAULT '{Present}'::text[] NOT NULL,
  hide_loq boolean DEFAULT false NOT NULL,
  hide_lod boolean DEFAULT false NOT NULL,
  uncertainty numeric,
  uncertainty_kind text,
  report_uncertainty boolean DEFAULT false NOT NULL,
  invalid_values text[] DEFAULT '{}'::text[] NOT NULL,
  CONSTRAINT test_version_analyte_pkey PRIMARY KEY (id)
);
CREATE TABLE workflow_step (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  test_version_id uuid NOT NULL,
  step_key text NOT NULL,
  step_name text NOT NULL,
  step_type step_type NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  department_id uuid,
  instructions text,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT workflow_step_pkey PRIMARY KEY (id)
);
CREATE TABLE workflow_step_dependency (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  step_id uuid NOT NULL,
  depends_on_step_id uuid NOT NULL,
  dependency_type dependency_type DEFAULT 'Sequential'::dependency_type NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT workflow_step_dependency_pkey PRIMARY KEY (id)
);
CREATE TABLE workflow_step_equipment (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  step_id uuid NOT NULL,
  equipment_type_id uuid NOT NULL,
  is_main boolean DEFAULT false NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT workflow_step_equipment_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------- Testing bench and QC Review
CREATE TABLE analyst_pick (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  batch_id uuid NOT NULL,
  requested_test_id uuid NOT NULL,
  analyte_id uuid,
  entry_id uuid NOT NULL,
  run_no integer NOT NULL,
  note text NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT analyst_pick_pkey PRIMARY KEY (id)
);
CREATE TABLE analytical_run (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  step_run_id uuid NOT NULL,
  run_no integer NOT NULL,
  reason text NOT NULL,
  signature_id uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT analytical_run_pkey PRIMARY KEY (id),
  CONSTRAINT analytical_run_step_run_id_run_no_key UNIQUE (step_run_id, run_no)
);
CREATE TABLE batch_entry (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  batch_id uuid NOT NULL,
  "position" integer NOT NULL,
  entry_type text NOT NULL,
  requested_test_id uuid,
  qc_type text,
  qc_class text,
  label text NOT NULL,
  parent_entry_id uuid,
  replicate_no integer DEFAULT 1 NOT NULL,
  reprep_request_id uuid,
  status text DEFAULT 'Active'::text NOT NULL,
  superseded_reason text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  daily_of_entry_id uuid,
  removed_at timestamp with time zone,
  removed_by uuid,
  CONSTRAINT batch_entry_pkey PRIMARY KEY (id)
);
CREATE TABLE entry_equipment (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  step_run_id uuid NOT NULL,
  entry_id uuid,
  equipment_id uuid NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  analytical_run_no integer DEFAULT 1 NOT NULL,
  CONSTRAINT entry_equipment_pkey PRIMARY KEY (id)
);
CREATE TABLE entry_material (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  step_run_id uuid NOT NULL,
  entry_id uuid,
  lot_id uuid NOT NULL,
  purpose material_purpose NOT NULL,
  volume numeric,
  volume_unit text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  usage_txn_id uuid,
  return_txn_id uuid,
  logbook_entry_id uuid,
  CONSTRAINT entry_material_pkey PRIMARY KEY (id)
);
CREATE TABLE entry_value (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  step_run_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  analyte_id uuid,
  run_no integer DEFAULT 1 NOT NULL,
  value_num numeric,
  value_text text,
  data jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'Active'::text NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  logbook_entry_id uuid,
  CONSTRAINT entry_value_pkey PRIMARY KEY (id)
);
CREATE TABLE incubation_load (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  step_run_id uuid NOT NULL,
  equipment_id uuid NOT NULL,
  entry_ids uuid[],
  time_in timestamp with time zone NOT NULL,
  time_out timestamp with time zone,
  temperature numeric,
  note text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT incubation_load_pkey PRIMARY KEY (id)
);
CREATE TABLE load_acceptance (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  batch_id uuid NOT NULL,
  load_id uuid NOT NULL,
  check_text text NOT NULL,
  justification text NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT load_acceptance_pkey PRIMARY KEY (id)
);
CREATE TABLE qc_acceptance (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  batch_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  analyte_id uuid,
  limit_type text NOT NULL,
  verdict text NOT NULL,
  measured numeric,
  justification text NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  analytical_run integer DEFAULT 1 NOT NULL,
  CONSTRAINT qc_acceptance_pkey PRIMARY KEY (id)
);
CREATE TABLE reanalysis_request (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  step_run_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  runs integer NOT NULL,
  first_run_no integer NOT NULL,
  reason text NOT NULL,
  signature_id uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  analytical_run_id uuid,
  CONSTRAINT reanalysis_request_pkey PRIMARY KEY (id)
);
CREATE TABLE reprep_request (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  requested_test_id uuid NOT NULL,
  origin_entry_id uuid NOT NULL,
  replicates integer NOT NULL,
  reason text NOT NULL,
  status text DEFAULT 'Pooled'::text NOT NULL,
  batch_id uuid,
  signature_id uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT reprep_request_pkey PRIMARY KEY (id)
);
CREATE TABLE result_choice (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  batch_id uuid NOT NULL,
  requested_test_id uuid NOT NULL,
  analyte_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  run_no integer NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  mode text DEFAULT 'Pick'::text NOT NULL,
  justification text,
  readings jsonb,
  result_key text,
  CONSTRAINT result_choice_pkey PRIMARY KEY (id)
);
CREATE TABLE review_step_mark (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  batch_id uuid NOT NULL,
  step_run_id uuid NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  withdrawn_note text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT review_step_mark_pkey PRIMARY KEY (id)
);
CREATE TABLE split_request (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  step_run_id uuid,
  batch_id uuid,
  entry_id uuid,
  sample_id uuid NOT NULL,
  origin_requested_test_id uuid NOT NULL,
  test_id uuid NOT NULL,
  finding text,
  status text DEFAULT 'Awaiting consent'::text NOT NULL,
  decision_note text,
  decided_by uuid,
  decided_at timestamp with time zone,
  ordered_requested_test_id uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  serving_role text,
  CONSTRAINT split_request_pkey PRIMARY KEY (id)
);
CREATE TABLE step_attachment (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  step_run_id uuid NOT NULL,
  document_id uuid NOT NULL,
  label text,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  analytical_run_no integer DEFAULT 1 NOT NULL,
  CONSTRAINT step_attachment_pkey PRIMARY KEY (id)
);
CREATE TABLE step_run (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  batch_id uuid NOT NULL,
  step_id uuid NOT NULL,
  status text DEFAULT 'Not started'::text NOT NULL,
  fields jsonb DEFAULT '{}'::jsonb NOT NULL,
  notes text,
  performed_by uuid,
  completed_at timestamp with time zone,
  signature_id uuid,
  witness_id uuid,
  witness_signature_id uuid,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT step_run_pkey PRIMARY KEY (id),
  CONSTRAINT step_run_batch_id_step_id_key UNIQUE (batch_id, step_id)
);
CREATE TABLE test_batch (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  batch_code text DEFAULT ('BAT-'::text || lpad((nextval('test_batch_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  site_id uuid NOT NULL,
  test_id uuid NOT NULL,
  test_version_id uuid NOT NULL,
  department_id uuid,
  status batch_status DEFAULT 'Open'::batch_status NOT NULL,
  assigned_to uuid NOT NULL,
  notes text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  review_signature_id uuid,
  returned_by uuid,
  returned_at timestamp with time zone,
  returned_reason text,
  cancelled_by uuid,
  cancelled_at timestamp with time zone,
  cancelled_reason text,
  is_verification boolean DEFAULT false NOT NULL,
  verification_id uuid,
  CONSTRAINT test_batch_pkey PRIMARY KEY (id),
  CONSTRAINT test_batch_batch_code_key UNIQUE (batch_code)
);
CREATE TABLE test_result (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  requested_test_id uuid NOT NULL,
  analyte_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  run_no integer NOT NULL,
  value_num numeric,
  value_text text,
  reported text,
  unit text,
  spec_min numeric,
  spec_max numeric,
  spec_text text,
  spec_unit text,
  conformance text NOT NULL,
  approved_by uuid NOT NULL,
  approved_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  signature_id uuid,
  status text DEFAULT 'Active'::text NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  result_key text,
  stage text DEFAULT 'Final'::text NOT NULL,
  basis text DEFAULT 'Single'::text NOT NULL,
  justification text,
  averaged jsonb,
  released_step_run_id uuid,
  carried_from_id uuid,
  invalidated_oos_id uuid,
  CONSTRAINT test_result_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------- Training and competency
CREATE TABLE analyst_qualification (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  qualification_code text DEFAULT ('AQ-'::text || lpad((nextval('analyst_qualification_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
  user_id uuid NOT NULL,
  test_id uuid NOT NULL,
  site_id uuid NOT NULL,
  source text NOT NULL,
  granted_at timestamp with time zone DEFAULT now() NOT NULL,
  attempt_id uuid,
  last_competency_at timestamp with time zone DEFAULT now() NOT NULL,
  conditions text,
  approved_by uuid,
  signature_id uuid,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  withdrawn_reason text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT analyst_qualification_pkey PRIMARY KEY (id),
  CONSTRAINT analyst_qualification_qualification_code_key UNIQUE (qualification_code)
);
CREATE TABLE competency_attempt (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  attempt_code text DEFAULT ('TA-'::text || lpad((nextval('competency_attempt_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
  user_id uuid NOT NULL,
  test_id uuid NOT NULL,
  site_id uuid NOT NULL,
  kind text NOT NULL,
  route text NOT NULL,
  qualification_id uuid,
  known_values jsonb DEFAULT '[]'::jsonb NOT NULL,
  lab_order_id uuid,
  description text,
  trained_on date,
  status text DEFAULT 'In progress'::text NOT NULL,
  evaluation text,
  evaluation_note text,
  evaluated_by uuid,
  evaluated_at timestamp with time zone,
  evaluation_signature_id uuid,
  decision_note text,
  decided_by uuid,
  decided_at timestamp with time zone,
  decision_signature_id uuid,
  withdrawn_reason text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT competency_attempt_pkey PRIMARY KEY (id),
  CONSTRAINT competency_attempt_attempt_code_key UNIQUE (attempt_code)
);
CREATE TABLE competency_evidence (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  attempt_id uuid NOT NULL,
  document_id uuid NOT NULL,
  title text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT competency_evidence_pkey PRIMARY KEY (id)
);
CREATE TABLE training_rule (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  site_id uuid NOT NULL,
  department_id uuid,
  dept_trained_after integer,
  unlock_any_test boolean DEFAULT true NOT NULL,
  unlock_can_train boolean DEFAULT true NOT NULL,
  continuing_months integer,
  due_soon_days integer DEFAULT 30 NOT NULL,
  min_runs integer,
  min_runs_months integer,
  allow_training_samples boolean DEFAULT true NOT NULL,
  allow_records boolean DEFAULT true NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT training_rule_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------- Trending and control charts
CREATE TABLE trend_chart (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  chart_code text DEFAULT ('TC-'::text || lpad((nextval('trend_chart_seq'::regclass))::text, 4, '0'::text)) NOT NULL,
  site_id uuid NOT NULL,
  chart_name text NOT NULL,
  description text,
  source text NOT NULL,
  params jsonb DEFAULT '{}'::jsonb NOT NULL,
  rules text[] DEFAULT '{R1,R2,R3,R4,R5,LIM}'::text[] NOT NULL,
  watch boolean DEFAULT true NOT NULL,
  show_in_review boolean DEFAULT false NOT NULL,
  frozen_cl numeric,
  frozen_sigma numeric,
  frozen_from date,
  frozen_to date,
  frozen_n integer,
  frozen_by uuid,
  frozen_at timestamp with time zone,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  qa_review boolean DEFAULT false NOT NULL,
  qa_status text DEFAULT 'Not required'::text NOT NULL,
  qa_approved_by uuid,
  qa_approved_at timestamp with time zone,
  qa_signature_id uuid,
  applied_version_id uuid,
  applied_by uuid,
  applied_at timestamp with time zone,
  CONSTRAINT trend_chart_pkey PRIMARY KEY (id),
  CONSTRAINT trend_chart_chart_code_key UNIQUE (chart_code)
);
CREATE TABLE trend_signal_review (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  chart_id uuid NOT NULL,
  point_key text NOT NULL,
  point_label text,
  rule text NOT NULL,
  outcome text NOT NULL,
  comment text NOT NULL,
  reviewed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  reviewed_by uuid NOT NULL,
  status record_status DEFAULT 'Active'::record_status NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT trend_signal_review_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------- Workflow verification
CREATE TABLE verification_check (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  verification_id uuid NOT NULL,
  check_code text NOT NULL,
  case_label text NOT NULL,
  title text NOT NULL,
  procedure_text text,
  requirement_codes text[] DEFAULT '{}'::text[] NOT NULL,
  sample_key text,
  inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
  expected jsonb DEFAULT '{}'::jsonb NOT NULL,
  actual jsonb,
  result text,
  note text,
  batch_id uuid,
  evidence_ref text,
  executed_at timestamp with time zone,
  sort_order integer DEFAULT 0 NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT verification_check_pkey PRIMARY KEY (id),
  CONSTRAINT verification_check_verification_id_check_code_key UNIQUE (verification_id, check_code)
);
CREATE TABLE verification_evidence (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  verification_id uuid NOT NULL,
  seq integer NOT NULL,
  title text NOT NULL,
  page_ref text NOT NULL,
  check_codes text[] DEFAULT '{}'::text[] NOT NULL,
  document_id uuid NOT NULL,
  sha256 text NOT NULL,
  width_px integer,
  height_px integer,
  captured_at timestamp with time zone NOT NULL,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT verification_evidence_pkey PRIMARY KEY (id),
  CONSTRAINT verification_evidence_verification_id_seq_key UNIQUE (verification_id, seq)
);
CREATE TABLE verification_requirement (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  verification_id uuid NOT NULL,
  req_code text NOT NULL,
  kind text NOT NULL,
  statement text NOT NULL,
  source text,
  traces text[] DEFAULT '{}'::text[] NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  result text,
  result_note text,
  qa_justification text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  CONSTRAINT verification_requirement_pkey PRIMARY KEY (id),
  CONSTRAINT verification_requirement_verification_id_req_code_key UNIQUE (verification_id, req_code)
);
CREATE TABLE workflow_verification (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  verification_code text DEFAULT ('VER-'::text || lpad((nextval('workflow_verification_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  test_version_id uuid NOT NULL,
  site_id uuid NOT NULL,
  status text DEFAULT 'Protocol draft'::text NOT NULL,
  config_hash text NOT NULL,
  definition jsonb NOT NULL,
  generator text NOT NULL,
  plan jsonb DEFAULT '{}'::jsonb NOT NULL,
  prepared_signature_id uuid,
  protocol_approved_by uuid,
  protocol_approved_at timestamp with time zone,
  protocol_signature_id uuid,
  executed_by uuid,
  executed_at timestamp with time zone,
  execution_signature_id uuid,
  finished_at timestamp with time zone,
  lab_order_id uuid,
  outcome text,
  run_log jsonb,
  report_conclusion text,
  report_signed_by uuid,
  report_signed_at timestamp with time zone,
  report_signature_id uuid,
  cancelled_reason text,
  record_version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid NOT NULL,
  modified_at timestamp with time zone DEFAULT now() NOT NULL,
  modified_by uuid NOT NULL,
  evidence_captured_at timestamp with time zone,
  evidence_captured_by uuid,
  evidence_signature_id uuid,
  evidence_note text,
  CONSTRAINT workflow_verification_pkey PRIMARY KEY (id),
  CONSTRAINT workflow_verification_verification_code_key UNIQUE (verification_code)
);

-- ============================================================== foreign keys (added after every table exists)
ALTER TABLE analyte ADD CONSTRAINT analyte_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE analyte ADD CONSTRAINT analyte_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE compliance_category ADD CONSTRAINT compliance_category_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE compliance_category ADD CONSTRAINT compliance_category_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE matrix ADD CONSTRAINT matrix_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE matrix ADD CONSTRAINT matrix_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE matrix ADD CONSTRAINT matrix_product_category_id_fkey FOREIGN KEY (product_category_id) REFERENCES product_category(id);
ALTER TABLE product_category ADD CONSTRAINT product_category_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE product_category ADD CONSTRAINT product_category_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE reason_code ADD CONSTRAINT reason_code_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE reason_code ADD CONSTRAINT reason_code_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE unit_conversion ADD CONSTRAINT unit_conversion_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE unit_conversion ADD CONSTRAINT unit_conversion_from_unit_id_fkey FOREIGN KEY (from_unit_id) REFERENCES unit_of_measure(id);
ALTER TABLE unit_conversion ADD CONSTRAINT unit_conversion_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE unit_conversion ADD CONSTRAINT unit_conversion_to_unit_id_fkey FOREIGN KEY (to_unit_id) REFERENCES unit_of_measure(id);
ALTER TABLE unit_of_measure ADD CONSTRAINT unit_of_measure_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE unit_of_measure ADD CONSTRAINT unit_of_measure_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE custody_document ADD CONSTRAINT custody_document_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE custody_document ADD CONSTRAINT custody_document_lab_order_id_fkey FOREIGN KEY (lab_order_id) REFERENCES lab_order(id);
ALTER TABLE custody_document ADD CONSTRAINT custody_document_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE custody_document ADD CONSTRAINT custody_document_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE custody_event ADD CONSTRAINT custody_event_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE custody_event ADD CONSTRAINT custody_event_custody_document_id_fkey FOREIGN KEY (custody_document_id) REFERENCES custody_document(id);
ALTER TABLE custody_event ADD CONSTRAINT custody_event_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE custody_event ADD CONSTRAINT custody_event_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE custody_event ADD CONSTRAINT custody_event_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE custody_event ADD CONSTRAINT custody_event_signature_image_id_fkey FOREIGN KEY (signature_image_id) REFERENCES document_file(id);
ALTER TABLE custody_event ADD CONSTRAINT custody_event_thermometer_id_fkey FOREIGN KEY (thermometer_id) REFERENCES equipment(id);
ALTER TABLE sample_photo ADD CONSTRAINT sample_photo_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE sample_photo ADD CONSTRAINT sample_photo_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE sample_photo ADD CONSTRAINT sample_photo_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE sample_photo ADD CONSTRAINT sample_photo_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES sample(id);
ALTER TABLE charge_item ADD CONSTRAINT charge_item_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE charge_item ADD CONSTRAINT charge_item_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE charge_item ADD CONSTRAINT charge_item_service_line_id_fkey FOREIGN KEY (service_line_id) REFERENCES service_line(id);
ALTER TABLE charge_item ADD CONSTRAINT charge_item_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE client_service_line ADD CONSTRAINT client_service_line_client_id_fkey FOREIGN KEY (client_id) REFERENCES client(id);
ALTER TABLE client_service_line ADD CONSTRAINT client_service_line_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE client_service_line ADD CONSTRAINT client_service_line_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE client_service_line ADD CONSTRAINT client_service_line_service_line_id_fkey FOREIGN KEY (service_line_id) REFERENCES service_line(id);
ALTER TABLE order_charge ADD CONSTRAINT order_charge_charge_item_id_fkey FOREIGN KEY (charge_item_id) REFERENCES charge_item(id);
ALTER TABLE order_charge ADD CONSTRAINT order_charge_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE order_charge ADD CONSTRAINT order_charge_lab_order_id_fkey FOREIGN KEY (lab_order_id) REFERENCES lab_order(id);
ALTER TABLE order_charge ADD CONSTRAINT order_charge_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE order_charge ADD CONSTRAINT order_charge_quoted_charge_id_fkey FOREIGN KEY (quoted_charge_id) REFERENCES quoted_charge(id);
ALTER TABLE order_charge ADD CONSTRAINT order_charge_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES sample(id);
ALTER TABLE quoted_charge ADD CONSTRAINT quoted_charge_charge_item_id_fkey FOREIGN KEY (charge_item_id) REFERENCES charge_item(id);
ALTER TABLE quoted_charge ADD CONSTRAINT quoted_charge_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE quoted_charge ADD CONSTRAINT quoted_charge_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE quoted_charge ADD CONSTRAINT quoted_charge_project_version_id_fkey FOREIGN KEY (project_version_id) REFERENCES project_version(id);
ALTER TABLE service_line ADD CONSTRAINT service_line_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE service_line ADD CONSTRAINT service_line_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE service_line_type ADD CONSTRAINT service_line_type_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE service_line_type ADD CONSTRAINT service_line_type_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE service_line_type ADD CONSTRAINT service_line_type_service_line_id_fkey FOREIGN KEY (service_line_id) REFERENCES service_line(id);
ALTER TABLE client ADD CONSTRAINT client_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE client ADD CONSTRAINT client_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE client ADD CONSTRAINT client_parent_client_id_fkey FOREIGN KEY (parent_client_id) REFERENCES client(id);
ALTER TABLE client_contact ADD CONSTRAINT client_contact_client_id_fkey FOREIGN KEY (client_id) REFERENCES client(id);
ALTER TABLE client_contact ADD CONSTRAINT client_contact_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contact(id);
ALTER TABLE client_contact ADD CONSTRAINT client_contact_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE client_contact ADD CONSTRAINT client_contact_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE client_license ADD CONSTRAINT client_license_client_id_fkey FOREIGN KEY (client_id) REFERENCES client(id);
ALTER TABLE client_license ADD CONSTRAINT client_license_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE client_license ADD CONSTRAINT client_license_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE client_license ADD CONSTRAINT client_license_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE contact ADD CONSTRAINT contact_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE contact ADD CONSTRAINT contact_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE finance_plan ADD CONSTRAINT finance_plan_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE finance_plan ADD CONSTRAINT finance_plan_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE finance_plan ADD CONSTRAINT finance_plan_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE finance_week ADD CONSTRAINT finance_week_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE finance_week ADD CONSTRAINT finance_week_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE finance_week ADD CONSTRAINT finance_week_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE group_widget ADD CONSTRAINT group_widget_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE group_widget ADD CONSTRAINT group_widget_group_id_fkey FOREIGN KEY (group_id) REFERENCES lab_group(id);
ALTER TABLE group_widget ADD CONSTRAINT group_widget_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE group_widget ADD CONSTRAINT group_widget_widget_code_fkey FOREIGN KEY (widget_code) REFERENCES dashboard_widget(code);
ALTER TABLE standard_group_widget ADD CONSTRAINT standard_group_widget_widget_code_fkey FOREIGN KEY (widget_code) REFERENCES dashboard_widget(code);
ALTER TABLE user_dashboard_layout ADD CONSTRAINT user_dashboard_layout_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id);
ALTER TABLE equipment_flag_acceptance ADD CONSTRAINT equipment_flag_acceptance_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES test_batch(id);
ALTER TABLE equipment_flag_acceptance ADD CONSTRAINT equipment_flag_acceptance_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE equipment_flag_acceptance ADD CONSTRAINT equipment_flag_acceptance_logbook_entry_id_fkey FOREIGN KEY (logbook_entry_id) REFERENCES logbook_entry(id);
ALTER TABLE equipment_flag_acceptance ADD CONSTRAINT equipment_flag_acceptance_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE logbook ADD CONSTRAINT logbook_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE logbook ADD CONSTRAINT logbook_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE logbook ADD CONSTRAINT logbook_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE logbook_entry ADD CONSTRAINT logbook_entry_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES app_user(id);
ALTER TABLE logbook_entry ADD CONSTRAINT logbook_entry_approved_in_batch_id_fkey FOREIGN KEY (approved_in_batch_id) REFERENCES test_batch(id);
ALTER TABLE logbook_entry ADD CONSTRAINT logbook_entry_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE logbook_entry ADD CONSTRAINT logbook_entry_created_lot_id_fkey FOREIGN KEY (created_lot_id) REFERENCES inventory_lot(id);
ALTER TABLE logbook_entry ADD CONSTRAINT logbook_entry_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE logbook_entry ADD CONSTRAINT logbook_entry_logbook_id_fkey FOREIGN KEY (logbook_id) REFERENCES logbook(id);
ALTER TABLE logbook_entry ADD CONSTRAINT logbook_entry_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES inventory_lot(id);
ALTER TABLE logbook_entry ADD CONSTRAINT logbook_entry_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE logbook_entry ADD CONSTRAINT logbook_entry_recorded_signature_id_fkey FOREIGN KEY (recorded_signature_id) REFERENCES signature_event(id);
ALTER TABLE logbook_entry ADD CONSTRAINT logbook_entry_review_id_fkey FOREIGN KEY (review_id) REFERENCES logbook_review(id);
ALTER TABLE logbook_entry ADD CONSTRAINT logbook_entry_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES sample(id);
ALTER TABLE logbook_entry ADD CONSTRAINT logbook_entry_sensor_link_id_fkey FOREIGN KEY (sensor_link_id) REFERENCES sensor_link(id);
ALTER TABLE logbook_entry ADD CONSTRAINT logbook_entry_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE logbook_entry ADD CONSTRAINT logbook_entry_version_id_fkey FOREIGN KEY (version_id) REFERENCES logbook_version(id);
ALTER TABLE logbook_equipment ADD CONSTRAINT logbook_equipment_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE logbook_equipment ADD CONSTRAINT logbook_equipment_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE logbook_equipment ADD CONSTRAINT logbook_equipment_logbook_id_fkey FOREIGN KEY (logbook_id) REFERENCES logbook(id);
ALTER TABLE logbook_equipment ADD CONSTRAINT logbook_equipment_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE logbook_field ADD CONSTRAINT logbook_field_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE logbook_field ADD CONSTRAINT logbook_field_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE logbook_field ADD CONSTRAINT logbook_field_version_id_fkey FOREIGN KEY (version_id) REFERENCES logbook_version(id);
ALTER TABLE logbook_result_flag ADD CONSTRAINT logbook_result_flag_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE logbook_result_flag ADD CONSTRAINT logbook_result_flag_logbook_entry_id_fkey FOREIGN KEY (logbook_entry_id) REFERENCES logbook_entry(id);
ALTER TABLE logbook_result_flag ADD CONSTRAINT logbook_result_flag_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE logbook_result_flag ADD CONSTRAINT logbook_result_flag_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES app_user(id);
ALTER TABLE logbook_result_flag ADD CONSTRAINT logbook_result_flag_test_result_id_fkey FOREIGN KEY (test_result_id) REFERENCES test_result(id);
ALTER TABLE logbook_result_use ADD CONSTRAINT logbook_result_use_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE logbook_result_use ADD CONSTRAINT logbook_result_use_logbook_entry_id_fkey FOREIGN KEY (logbook_entry_id) REFERENCES logbook_entry(id);
ALTER TABLE logbook_result_use ADD CONSTRAINT logbook_result_use_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE logbook_result_use ADD CONSTRAINT logbook_result_use_test_result_id_fkey FOREIGN KEY (test_result_id) REFERENCES test_result(id);
ALTER TABLE logbook_review ADD CONSTRAINT logbook_review_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE logbook_review ADD CONSTRAINT logbook_review_logbook_id_fkey FOREIGN KEY (logbook_id) REFERENCES logbook(id);
ALTER TABLE logbook_review ADD CONSTRAINT logbook_review_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE logbook_review ADD CONSTRAINT logbook_review_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE logbook_review ADD CONSTRAINT logbook_review_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE logbook_version ADD CONSTRAINT logbook_version_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES app_user(id);
ALTER TABLE logbook_version ADD CONSTRAINT logbook_version_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE logbook_version ADD CONSTRAINT logbook_version_logbook_id_fkey FOREIGN KEY (logbook_id) REFERENCES logbook(id);
ALTER TABLE logbook_version ADD CONSTRAINT logbook_version_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE logbook_version ADD CONSTRAINT logbook_version_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE sensor_connection ADD CONSTRAINT sensor_connection_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE sensor_connection ADD CONSTRAINT sensor_connection_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE sensor_connection ADD CONSTRAINT sensor_connection_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE sensor_link ADD CONSTRAINT sensor_link_approval_signature_id_fkey FOREIGN KEY (approval_signature_id) REFERENCES signature_event(id);
ALTER TABLE sensor_link ADD CONSTRAINT sensor_link_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES app_user(id);
ALTER TABLE sensor_link ADD CONSTRAINT sensor_link_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE sensor_link ADD CONSTRAINT sensor_link_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE sensor_link ADD CONSTRAINT sensor_link_logbook_id_fkey FOREIGN KEY (logbook_id) REFERENCES logbook(id);
ALTER TABLE sensor_link ADD CONSTRAINT sensor_link_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE sensor_link ADD CONSTRAINT sensor_link_rejudge_by_fkey FOREIGN KEY (rejudge_by) REFERENCES app_user(id);
ALTER TABLE sensor_link ADD CONSTRAINT sensor_link_rejudge_signature_id_fkey FOREIGN KEY (rejudge_signature_id) REFERENCES signature_event(id);
ALTER TABLE sensor_link ADD CONSTRAINT sensor_link_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE sensor_reading ADD CONSTRAINT sensor_reading_link_id_fkey FOREIGN KEY (link_id) REFERENCES sensor_link(id);
ALTER TABLE sensor_sync_log ADD CONSTRAINT sensor_sync_log_run_by_fkey FOREIGN KEY (run_by) REFERENCES app_user(id);
ALTER TABLE sensor_sync_log ADD CONSTRAINT sensor_sync_log_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE calibration ADD CONSTRAINT calibration_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE calibration ADD CONSTRAINT calibration_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE calibration ADD CONSTRAINT calibration_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE calibration ADD CONSTRAINT calibration_performed_by_user_id_fkey FOREIGN KEY (performed_by_user_id) REFERENCES app_user(id);
ALTER TABLE calibration ADD CONSTRAINT calibration_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES equipment_tag(id);
ALTER TABLE department ADD CONSTRAINT department_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE department ADD CONSTRAINT department_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE department ADD CONSTRAINT department_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE equipment ADD CONSTRAINT equipment_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE equipment ADD CONSTRAINT equipment_department_id_fkey FOREIGN KEY (department_id) REFERENCES department(id);
ALTER TABLE equipment ADD CONSTRAINT equipment_equipment_type_id_fkey FOREIGN KEY (equipment_type_id) REFERENCES equipment_type(id);
ALTER TABLE equipment ADD CONSTRAINT equipment_location_id_fkey FOREIGN KEY (location_id) REFERENCES storage_location(id);
ALTER TABLE equipment ADD CONSTRAINT equipment_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE equipment ADD CONSTRAINT equipment_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE equipment_document ADD CONSTRAINT equipment_document_calibration_id_fkey FOREIGN KEY (calibration_id) REFERENCES calibration(id);
ALTER TABLE equipment_document ADD CONSTRAINT equipment_document_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE equipment_document ADD CONSTRAINT equipment_document_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE equipment_document ADD CONSTRAINT equipment_document_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE equipment_document ADD CONSTRAINT equipment_document_event_id_fkey FOREIGN KEY (event_id) REFERENCES equipment_event(id);
ALTER TABLE equipment_document ADD CONSTRAINT equipment_document_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE equipment_document ADD CONSTRAINT equipment_document_qualification_id_fkey FOREIGN KEY (qualification_id) REFERENCES qualification(id);
ALTER TABLE equipment_document ADD CONSTRAINT equipment_document_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES equipment_tag(id);
ALTER TABLE equipment_event ADD CONSTRAINT equipment_event_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE equipment_event ADD CONSTRAINT equipment_event_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE equipment_event ADD CONSTRAINT equipment_event_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE equipment_event ADD CONSTRAINT equipment_event_performed_by_user_id_fkey FOREIGN KEY (performed_by_user_id) REFERENCES app_user(id);
ALTER TABLE equipment_event ADD CONSTRAINT equipment_event_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES maintenance_schedule(id);
ALTER TABLE equipment_event ADD CONSTRAINT equipment_event_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES equipment_tag(id);
ALTER TABLE equipment_owner ADD CONSTRAINT equipment_owner_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE equipment_owner ADD CONSTRAINT equipment_owner_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE equipment_owner ADD CONSTRAINT equipment_owner_group_id_fkey FOREIGN KEY (group_id) REFERENCES lab_group(id);
ALTER TABLE equipment_owner ADD CONSTRAINT equipment_owner_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE equipment_owner ADD CONSTRAINT equipment_owner_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id);
ALTER TABLE equipment_tag ADD CONSTRAINT equipment_tag_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE equipment_tag ADD CONSTRAINT equipment_tag_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE equipment_tag ADD CONSTRAINT equipment_tag_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE equipment_tag ADD CONSTRAINT equipment_tag_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES maintenance_schedule(id);
ALTER TABLE equipment_tag ADD CONSTRAINT equipment_tag_tag_in_signature_id_fkey FOREIGN KEY (tag_in_signature_id) REFERENCES signature_event(id);
ALTER TABLE equipment_tag ADD CONSTRAINT equipment_tag_tag_out_signature_id_fkey FOREIGN KEY (tag_out_signature_id) REFERENCES signature_event(id);
ALTER TABLE equipment_tag ADD CONSTRAINT equipment_tag_tagged_in_by_fkey FOREIGN KEY (tagged_in_by) REFERENCES app_user(id);
ALTER TABLE equipment_tag ADD CONSTRAINT equipment_tag_tagged_out_by_fkey FOREIGN KEY (tagged_out_by) REFERENCES app_user(id);
ALTER TABLE equipment_transfer ADD CONSTRAINT equipment_transfer_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE equipment_transfer ADD CONSTRAINT equipment_transfer_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE equipment_transfer ADD CONSTRAINT equipment_transfer_from_site_id_fkey FOREIGN KEY (from_site_id) REFERENCES lab_site(id);
ALTER TABLE equipment_transfer ADD CONSTRAINT equipment_transfer_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE equipment_transfer ADD CONSTRAINT equipment_transfer_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES equipment_tag(id);
ALTER TABLE equipment_transfer ADD CONSTRAINT equipment_transfer_to_site_id_fkey FOREIGN KEY (to_site_id) REFERENCES lab_site(id);
ALTER TABLE equipment_type ADD CONSTRAINT equipment_type_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE equipment_type ADD CONSTRAINT equipment_type_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE equipment_type ADD CONSTRAINT equipment_type_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE maintenance_schedule ADD CONSTRAINT maintenance_schedule_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE maintenance_schedule ADD CONSTRAINT maintenance_schedule_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE maintenance_schedule ADD CONSTRAINT maintenance_schedule_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE qualification ADD CONSTRAINT qualification_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE qualification ADD CONSTRAINT qualification_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE qualification ADD CONSTRAINT qualification_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE qualification ADD CONSTRAINT qualification_performed_by_user_id_fkey FOREIGN KEY (performed_by_user_id) REFERENCES app_user(id);
ALTER TABLE qualification ADD CONSTRAINT qualification_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES equipment_tag(id);
ALTER TABLE chemical ADD CONSTRAINT chemical_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE chemical ADD CONSTRAINT chemical_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE chemical ADD CONSTRAINT chemical_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE inventory_lot ADD CONSTRAINT inventory_lot_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES app_user(id);
ALTER TABLE inventory_lot ADD CONSTRAINT inventory_lot_chemical_id_fkey FOREIGN KEY (chemical_id) REFERENCES chemical(id);
ALTER TABLE inventory_lot ADD CONSTRAINT inventory_lot_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE inventory_lot ADD CONSTRAINT inventory_lot_department_id_fkey FOREIGN KEY (department_id) REFERENCES department(id);
ALTER TABLE inventory_lot ADD CONSTRAINT inventory_lot_manufacturer_id_fkey FOREIGN KEY (manufacturer_id) REFERENCES supplier(id);
ALTER TABLE inventory_lot ADD CONSTRAINT inventory_lot_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE inventory_lot ADD CONSTRAINT inventory_lot_purchase_line_id_fkey FOREIGN KEY (purchase_line_id) REFERENCES purchase_line(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE inventory_lot ADD CONSTRAINT inventory_lot_reorder_of_lot_id_fkey FOREIGN KEY (reorder_of_lot_id) REFERENCES inventory_lot(id);
ALTER TABLE inventory_lot ADD CONSTRAINT inventory_lot_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE inventory_lot ADD CONSTRAINT inventory_lot_storage_location_id_fkey FOREIGN KEY (storage_location_id) REFERENCES storage_location(id);
ALTER TABLE inventory_lot ADD CONSTRAINT inventory_lot_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES supplier(id);
ALTER TABLE inventory_lot ADD CONSTRAINT inventory_lot_transferred_from_lot_id_fkey FOREIGN KEY (transferred_from_lot_id) REFERENCES inventory_lot(id);
ALTER TABLE inventory_lot ADD CONSTRAINT inventory_lot_waste_classification_id_fkey FOREIGN KEY (waste_classification_id) REFERENCES waste_classification(id);
ALTER TABLE inventory_transaction ADD CONSTRAINT inventory_transaction_corrects_txn_id_fkey FOREIGN KEY (corrects_txn_id) REFERENCES inventory_transaction(id);
ALTER TABLE inventory_transaction ADD CONSTRAINT inventory_transaction_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE inventory_transaction ADD CONSTRAINT inventory_transaction_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES inventory_lot(id);
ALTER TABLE inventory_transaction ADD CONSTRAINT inventory_transaction_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE inventory_transaction ADD CONSTRAINT inventory_transaction_related_lot_id_fkey FOREIGN KEY (related_lot_id) REFERENCES inventory_lot(id);
ALTER TABLE inventory_transaction ADD CONSTRAINT inventory_transaction_waste_classification_id_fkey FOREIGN KEY (waste_classification_id) REFERENCES waste_classification(id);
ALTER TABLE lot_analyte ADD CONSTRAINT lot_analyte_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE lot_analyte ADD CONSTRAINT lot_analyte_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE lot_analyte ADD CONSTRAINT lot_analyte_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES inventory_lot(id);
ALTER TABLE lot_analyte ADD CONSTRAINT lot_analyte_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE lot_component ADD CONSTRAINT lot_component_component_lot_id_fkey FOREIGN KEY (component_lot_id) REFERENCES inventory_lot(id);
ALTER TABLE lot_component ADD CONSTRAINT lot_component_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE lot_component ADD CONSTRAINT lot_component_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES inventory_lot(id);
ALTER TABLE lot_component ADD CONSTRAINT lot_component_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE media_qualification ADD CONSTRAINT media_qualification_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES test_batch(id);
ALTER TABLE media_qualification ADD CONSTRAINT media_qualification_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE media_qualification ADD CONSTRAINT media_qualification_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES app_user(id);
ALTER TABLE media_qualification ADD CONSTRAINT media_qualification_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES inventory_lot(id);
ALTER TABLE media_qualification ADD CONSTRAINT media_qualification_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE media_qualification ADD CONSTRAINT media_qualification_qualification_test_id_fkey FOREIGN KEY (qualification_test_id) REFERENCES test(id);
ALTER TABLE media_qualification ADD CONSTRAINT media_qualification_requested_test_id_fkey FOREIGN KEY (requested_test_id) REFERENCES requested_test(id);
ALTER TABLE media_qualification ADD CONSTRAINT media_qualification_retest_of_id_fkey FOREIGN KEY (retest_of_id) REFERENCES media_qualification(id);
ALTER TABLE media_qualification ADD CONSTRAINT media_qualification_use_test_id_fkey FOREIGN KEY (use_test_id) REFERENCES test(id);
ALTER TABLE qa_testing_default ADD CONSTRAINT qa_testing_default_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE qa_testing_default ADD CONSTRAINT qa_testing_default_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE qa_testing_default ADD CONSTRAINT qa_testing_default_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE storage_location ADD CONSTRAINT storage_location_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE storage_location ADD CONSTRAINT storage_location_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE storage_location ADD CONSTRAINT storage_location_parent_location_id_fkey FOREIGN KEY (parent_location_id) REFERENCES storage_location(id);
ALTER TABLE storage_location ADD CONSTRAINT storage_location_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE supplier_coa ADD CONSTRAINT supplier_coa_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES app_user(id);
ALTER TABLE supplier_coa ADD CONSTRAINT supplier_coa_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE supplier_coa ADD CONSTRAINT supplier_coa_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE supplier_coa ADD CONSTRAINT supplier_coa_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES inventory_lot(id);
ALTER TABLE supplier_coa ADD CONSTRAINT supplier_coa_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE threshold_rule ADD CONSTRAINT threshold_rule_chemical_id_fkey FOREIGN KEY (chemical_id) REFERENCES chemical(id);
ALTER TABLE threshold_rule ADD CONSTRAINT threshold_rule_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE threshold_rule ADD CONSTRAINT threshold_rule_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE threshold_rule ADD CONSTRAINT threshold_rule_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE accounting_connection ADD CONSTRAINT accounting_connection_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE accounting_connection ADD CONSTRAINT accounting_connection_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE accounting_connection ADD CONSTRAINT accounting_connection_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE accounting_customer ADD CONSTRAINT accounting_customer_client_id_fkey FOREIGN KEY (client_id) REFERENCES client(id);
ALTER TABLE accounting_customer ADD CONSTRAINT accounting_customer_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE accounting_customer ADD CONSTRAINT accounting_customer_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE accounting_customer ADD CONSTRAINT accounting_customer_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE accounting_push ADD CONSTRAINT accounting_push_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE accounting_push ADD CONSTRAINT accounting_push_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoice(id);
ALTER TABLE accounting_push ADD CONSTRAINT accounting_push_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE accounting_push ADD CONSTRAINT accounting_push_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE invoice ADD CONSTRAINT invoice_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES app_user(id);
ALTER TABLE invoice ADD CONSTRAINT invoice_client_id_fkey FOREIGN KEY (client_id) REFERENCES client(id);
ALTER TABLE invoice ADD CONSTRAINT invoice_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE invoice ADD CONSTRAINT invoice_credit_of_id_fkey FOREIGN KEY (credit_of_id) REFERENCES invoice(id);
ALTER TABLE invoice ADD CONSTRAINT invoice_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE invoice ADD CONSTRAINT invoice_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES app_user(id);
ALTER TABLE invoice ADD CONSTRAINT invoice_lab_order_id_fkey FOREIGN KEY (lab_order_id) REFERENCES lab_order(id);
ALTER TABLE invoice ADD CONSTRAINT invoice_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE invoice ADD CONSTRAINT invoice_paid_recorded_by_fkey FOREIGN KEY (paid_recorded_by) REFERENCES app_user(id);
ALTER TABLE invoice ADD CONSTRAINT invoice_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE invoice ADD CONSTRAINT invoice_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE invoice_correction ADD CONSTRAINT invoice_correction_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE invoice_correction ADD CONSTRAINT invoice_correction_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE invoice_correction ADD CONSTRAINT invoice_correction_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoice(id);
ALTER TABLE invoice_correction ADD CONSTRAINT invoice_correction_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE invoice_correction ADD CONSTRAINT invoice_correction_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE invoice_counter ADD CONSTRAINT invoice_counter_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE invoice_line ADD CONSTRAINT invoice_line_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE invoice_line ADD CONSTRAINT invoice_line_credits_line_id_fkey FOREIGN KEY (credits_line_id) REFERENCES invoice_line(id);
ALTER TABLE invoice_line ADD CONSTRAINT invoice_line_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoice(id);
ALTER TABLE invoice_line ADD CONSTRAINT invoice_line_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE invoice_line ADD CONSTRAINT invoice_line_order_charge_id_fkey FOREIGN KEY (order_charge_id) REFERENCES order_charge(id);
ALTER TABLE invoice_line ADD CONSTRAINT invoice_line_requested_test_id_fkey FOREIGN KEY (requested_test_id) REFERENCES requested_test(id);
ALTER TABLE invoice_line ADD CONSTRAINT invoice_line_retest_of_id_fkey FOREIGN KEY (retest_of_id) REFERENCES requested_test(id);
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_coa_version_fk FOREIGN KEY (coa_version_id) REFERENCES coa_version(id);
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_lab_order_id_fkey FOREIGN KEY (lab_order_id) REFERENCES lab_order(id);
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_project_version_id_fkey FOREIGN KEY (project_version_id) REFERENCES project_version(id);
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_split_request_id_fkey FOREIGN KEY (split_request_id) REFERENCES split_request(id);
ALTER TABLE lab_order ADD CONSTRAINT lab_order_client_id_fkey FOREIGN KEY (client_id) REFERENCES client(id);
ALTER TABLE lab_order ADD CONSTRAINT lab_order_client_license_id_fkey FOREIGN KEY (client_license_id) REFERENCES client_license(id);
ALTER TABLE lab_order ADD CONSTRAINT lab_order_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE lab_order ADD CONSTRAINT lab_order_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE lab_order ADD CONSTRAINT lab_order_ordering_contact_id_fkey FOREIGN KEY (ordering_contact_id) REFERENCES contact(id);
ALTER TABLE lab_order ADD CONSTRAINT lab_order_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE ordered_package ADD CONSTRAINT ordered_package_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE ordered_package ADD CONSTRAINT ordered_package_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE ordered_package ADD CONSTRAINT ordered_package_package_id_fkey FOREIGN KEY (package_id) REFERENCES test_package(id);
ALTER TABLE ordered_package ADD CONSTRAINT ordered_package_quoted_package_id_fkey FOREIGN KEY (quoted_package_id) REFERENCES quoted_package(id);
ALTER TABLE ordered_package ADD CONSTRAINT ordered_package_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES sample(id);
ALTER TABLE requested_analyte ADD CONSTRAINT requested_analyte_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE requested_analyte ADD CONSTRAINT requested_analyte_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE requested_analyte ADD CONSTRAINT requested_analyte_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE requested_analyte ADD CONSTRAINT requested_analyte_requested_test_id_fkey FOREIGN KEY (requested_test_id) REFERENCES requested_test(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_competency_attempt_id_fkey FOREIGN KEY (competency_attempt_id) REFERENCES competency_attempt(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_media_lot_id_fkey FOREIGN KEY (media_lot_id) REFERENCES inventory_lot(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_oos_investigation_id_fkey FOREIGN KEY (oos_investigation_id) REFERENCES oos_investigation(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_ordered_package_id_fkey FOREIGN KEY (ordered_package_id) REFERENCES ordered_package(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_quoted_line_id_fkey FOREIGN KEY (quoted_line_id) REFERENCES quoted_test_configuration(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_retest_of_id_fkey FOREIGN KEY (retest_of_id) REFERENCES requested_test(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_rush_tier_id_fkey FOREIGN KEY (rush_tier_id) REFERENCES rush_fee_tier(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES sample(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_stability_cell_id_fkey FOREIGN KEY (stability_cell_id) REFERENCES stability_cell(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_stability_pull_id_fkey FOREIGN KEY (stability_pull_id) REFERENCES stability_pull(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_stability_study_id_fkey FOREIGN KEY (stability_study_id) REFERENCES stability_study(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_test_id_fkey FOREIGN KEY (test_id) REFERENCES test(id);
ALTER TABLE requested_test ADD CONSTRAINT requested_test_test_version_id_fkey FOREIGN KEY (test_version_id) REFERENCES test_version(id);
ALTER TABLE rush_decision ADD CONSTRAINT rush_decision_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE rush_decision ADD CONSTRAINT rush_decision_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE rush_decision ADD CONSTRAINT rush_decision_replacement_tier_id_fkey FOREIGN KEY (replacement_tier_id) REFERENCES rush_fee_tier(id);
ALTER TABLE rush_decision ADD CONSTRAINT rush_decision_requested_test_id_fkey FOREIGN KEY (requested_test_id) REFERENCES requested_test(id);
ALTER TABLE rush_decision ADD CONSTRAINT rush_decision_requested_tier_id_fkey FOREIGN KEY (requested_tier_id) REFERENCES rush_fee_tier(id);
ALTER TABLE sample ADD CONSTRAINT sample_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE sample ADD CONSTRAINT sample_density_result_id_fkey FOREIGN KEY (density_result_id) REFERENCES test_result(id);
ALTER TABLE sample ADD CONSTRAINT sample_lab_order_id_fkey FOREIGN KEY (lab_order_id) REFERENCES lab_order(id);
ALTER TABLE sample ADD CONSTRAINT sample_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES app_user(id);
ALTER TABLE sample ADD CONSTRAINT sample_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE sample ADD CONSTRAINT sample_storage_location_id_fkey FOREIGN KEY (storage_location_id) REFERENCES storage_location(id);
ALTER TABLE sample ADD CONSTRAINT sample_unit_weight_result_id_fkey FOREIGN KEY (unit_weight_result_id) REFERENCES test_result(id);
ALTER TABLE site_day_counter ADD CONSTRAINT site_day_counter_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE lab_site ADD CONSTRAINT lab_site_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE lab_site ADD CONSTRAINT lab_site_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE report_template ADD CONSTRAINT report_template_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE report_template ADD CONSTRAINT report_template_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE report_template ADD CONSTRAINT report_template_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE site_holiday ADD CONSTRAINT site_holiday_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE site_holiday ADD CONSTRAINT site_holiday_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE site_holiday ADD CONSTRAINT site_holiday_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE site_media ADD CONSTRAINT site_media_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE site_media ADD CONSTRAINT site_media_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE site_media ADD CONSTRAINT site_media_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE site_media ADD CONSTRAINT site_media_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE system_setting ADD CONSTRAINT system_setting_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE system_setting ADD CONSTRAINT system_setting_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE waste_classification ADD CONSTRAINT waste_classification_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE waste_classification ADD CONSTRAINT waste_classification_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE waste_classification ADD CONSTRAINT waste_classification_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE oos_checklist_item ADD CONSTRAINT oos_checklist_item_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE oos_checklist_item ADD CONSTRAINT oos_checklist_item_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE oos_client_response ADD CONSTRAINT oos_client_response_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE oos_client_response ADD CONSTRAINT oos_client_response_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES app_user(id);
ALTER TABLE oos_client_response ADD CONSTRAINT oos_client_response_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE oos_client_response ADD CONSTRAINT oos_client_response_oos_id_fkey FOREIGN KEY (oos_id) REFERENCES oos_investigation(id);
ALTER TABLE oos_client_response ADD CONSTRAINT oos_client_response_retest_requested_test_id_fkey FOREIGN KEY (retest_requested_test_id) REFERENCES requested_test(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_analyst_by_fkey FOREIGN KEY (analyst_by) REFERENCES app_user(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_analyst_signature_id_fkey FOREIGN KEY (analyst_signature_id) REFERENCES signature_event(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES test_batch(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES app_user(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_concluded_by_fkey FOREIGN KEY (concluded_by) REFERENCES app_user(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_conclusion_signature_id_fkey FOREIGN KEY (conclusion_signature_id) REFERENCES signature_event(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_determination_signature_id_fkey FOREIGN KEY (determination_signature_id) REFERENCES signature_event(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_determined_by_fkey FOREIGN KEY (determined_by) REFERENCES app_user(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_open_signature_id_fkey FOREIGN KEY (open_signature_id) REFERENCES signature_event(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES app_user(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_phase2_by_fkey FOREIGN KEY (phase2_by) REFERENCES app_user(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_report_document_id_fkey FOREIGN KEY (report_document_id) REFERENCES document_file(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_requested_test_id_fkey FOREIGN KEY (requested_test_id) REFERENCES requested_test(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES sample(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_supervisor_by_fkey FOREIGN KEY (supervisor_by) REFERENCES app_user(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_supervisor_signature_id_fkey FOREIGN KEY (supervisor_signature_id) REFERENCES signature_event(id);
ALTER TABLE oos_investigation ADD CONSTRAINT oos_investigation_test_result_id_fkey FOREIGN KEY (test_result_id) REFERENCES test_result(id);
ALTER TABLE oos_procedure_setting ADD CONSTRAINT oos_procedure_setting_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE oos_procedure_setting ADD CONSTRAINT oos_procedure_setting_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE audit_log ADD CONSTRAINT audit_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES app_user(id);
ALTER TABLE audit_log ADD CONSTRAINT audit_log_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE document_file ADD CONSTRAINT document_file_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES app_user(id);
ALTER TABLE purchase_line ADD CONSTRAINT purchase_line_approved2_by_fkey FOREIGN KEY (approved2_by) REFERENCES app_user(id);
ALTER TABLE purchase_line ADD CONSTRAINT purchase_line_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES app_user(id);
ALTER TABLE purchase_line ADD CONSTRAINT purchase_line_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE purchase_line ADD CONSTRAINT purchase_line_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE purchase_line ADD CONSTRAINT purchase_line_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES inventory_lot(id);
ALTER TABLE purchase_line ADD CONSTRAINT purchase_line_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE purchase_line ADD CONSTRAINT purchase_line_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES purchase_order(id);
ALTER TABLE purchase_line ADD CONSTRAINT purchase_line_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES app_user(id);
ALTER TABLE purchase_line ADD CONSTRAINT purchase_line_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE purchase_line ADD CONSTRAINT purchase_line_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES supplier(id);
ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES supplier(id);
ALTER TABLE purchase_receipt ADD CONSTRAINT purchase_receipt_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE purchase_receipt ADD CONSTRAINT purchase_receipt_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE purchase_receipt ADD CONSTRAINT purchase_receipt_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES inventory_lot(id);
ALTER TABLE purchase_receipt ADD CONSTRAINT purchase_receipt_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE purchase_receipt ADD CONSTRAINT purchase_receipt_packing_slip_id_fkey FOREIGN KEY (packing_slip_id) REFERENCES document_file(id);
ALTER TABLE purchase_receipt ADD CONSTRAINT purchase_receipt_purchase_line_id_fkey FOREIGN KEY (purchase_line_id) REFERENCES purchase_line(id);
ALTER TABLE purchase_receipt ADD CONSTRAINT purchase_receipt_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE purchasing_setting ADD CONSTRAINT purchasing_setting_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE purchasing_setting ADD CONSTRAINT purchasing_setting_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE purchasing_setting ADD CONSTRAINT purchasing_setting_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE supplier ADD CONSTRAINT supplier_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE supplier ADD CONSTRAINT supplier_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE supplier_risk_class ADD CONSTRAINT supplier_risk_class_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE supplier_risk_class ADD CONSTRAINT supplier_risk_class_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE supplier_risk_class ADD CONSTRAINT supplier_risk_class_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE supply_scope ADD CONSTRAINT supply_scope_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE supply_scope ADD CONSTRAINT supply_scope_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE vendor_document ADD CONSTRAINT vendor_document_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE vendor_document ADD CONSTRAINT vendor_document_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE vendor_document ADD CONSTRAINT vendor_document_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE vendor_document ADD CONSTRAINT vendor_document_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES vendor_promotion(id);
ALTER TABLE vendor_document ADD CONSTRAINT vendor_document_qualification_id_fkey FOREIGN KEY (qualification_id) REFERENCES vendor_qualification(id);
ALTER TABLE vendor_notice ADD CONSTRAINT vendor_notice_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES app_user(id);
ALTER TABLE vendor_notice ADD CONSTRAINT vendor_notice_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE vendor_notice ADD CONSTRAINT vendor_notice_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE vendor_notice ADD CONSTRAINT vendor_notice_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES vendor_promotion(id);
ALTER TABLE vendor_notice ADD CONSTRAINT vendor_notice_qualification_id_fkey FOREIGN KEY (qualification_id) REFERENCES vendor_qualification(id);
ALTER TABLE vendor_notice ADD CONSTRAINT vendor_notice_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE vendor_notice ADD CONSTRAINT vendor_notice_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES supplier(id);
ALTER TABLE vendor_promotion ADD CONSTRAINT vendor_promotion_corporate_qualification_id_fkey FOREIGN KEY (corporate_qualification_id) REFERENCES vendor_qualification(id);
ALTER TABLE vendor_promotion ADD CONSTRAINT vendor_promotion_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE vendor_promotion ADD CONSTRAINT vendor_promotion_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES app_user(id);
ALTER TABLE vendor_promotion ADD CONSTRAINT vendor_promotion_decision_signature_id_fkey FOREIGN KEY (decision_signature_id) REFERENCES signature_event(id);
ALTER TABLE vendor_promotion ADD CONSTRAINT vendor_promotion_from_qualification_id_fkey FOREIGN KEY (from_qualification_id) REFERENCES vendor_qualification(id);
ALTER TABLE vendor_promotion ADD CONSTRAINT vendor_promotion_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE vendor_promotion ADD CONSTRAINT vendor_promotion_proposal_signature_id_fkey FOREIGN KEY (proposal_signature_id) REFERENCES signature_event(id);
ALTER TABLE vendor_promotion ADD CONSTRAINT vendor_promotion_risk_class_id_fkey FOREIGN KEY (risk_class_id) REFERENCES supplier_risk_class(id);
ALTER TABLE vendor_promotion ADD CONSTRAINT vendor_promotion_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE vendor_promotion ADD CONSTRAINT vendor_promotion_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES supplier(id);
ALTER TABLE vendor_qualification ADD CONSTRAINT vendor_qualification_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE vendor_qualification ADD CONSTRAINT vendor_qualification_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE vendor_qualification ADD CONSTRAINT vendor_qualification_promoted_from_id_fkey FOREIGN KEY (promoted_from_id) REFERENCES vendor_qualification(id);
ALTER TABLE vendor_qualification ADD CONSTRAINT vendor_qualification_promotion_fk FOREIGN KEY (promotion_id) REFERENCES vendor_promotion(id);
ALTER TABLE vendor_qualification ADD CONSTRAINT vendor_qualification_risk_class_id_fkey FOREIGN KEY (risk_class_id) REFERENCES supplier_risk_class(id);
ALTER TABLE vendor_qualification ADD CONSTRAINT vendor_qualification_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE vendor_qualification ADD CONSTRAINT vendor_qualification_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE vendor_qualification ADD CONSTRAINT vendor_qualification_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES supplier(id);
ALTER TABLE project ADD CONSTRAINT project_client_id_fkey FOREIGN KEY (client_id) REFERENCES client(id);
ALTER TABLE project ADD CONSTRAINT project_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE project ADD CONSTRAINT project_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE project ADD CONSTRAINT project_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES app_user(id);
ALTER TABLE project ADD CONSTRAINT project_quote_contact_id_fkey FOREIGN KEY (quote_contact_id) REFERENCES contact(id);
ALTER TABLE project ADD CONSTRAINT project_requested_by_contact_id_fkey FOREIGN KEY (requested_by_contact_id) REFERENCES contact(id);
ALTER TABLE project ADD CONSTRAINT project_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE project_version ADD CONSTRAINT project_version_accepted_by_contact_id_fkey FOREIGN KEY (accepted_by_contact_id) REFERENCES contact(id);
ALTER TABLE project_version ADD CONSTRAINT project_version_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE project_version ADD CONSTRAINT project_version_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE project_version ADD CONSTRAINT project_version_project_id_fkey FOREIGN KEY (project_id) REFERENCES project(id);
ALTER TABLE project_version ADD CONSTRAINT project_version_quote_document_id_fkey FOREIGN KEY (quote_document_id) REFERENCES document_file(id);
ALTER TABLE project_version ADD CONSTRAINT project_version_quoted_by_fkey FOREIGN KEY (quoted_by) REFERENCES app_user(id);
ALTER TABLE project_version ADD CONSTRAINT project_version_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES app_user(id);
ALTER TABLE project_version ADD CONSTRAINT project_version_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES app_user(id);
ALTER TABLE project_version ADD CONSTRAINT project_version_sent_to_contact_id_fkey FOREIGN KEY (sent_to_contact_id) REFERENCES contact(id);
ALTER TABLE quote_rush_term ADD CONSTRAINT quote_rush_term_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE quote_rush_term ADD CONSTRAINT quote_rush_term_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE quote_rush_term ADD CONSTRAINT quote_rush_term_project_version_id_fkey FOREIGN KEY (project_version_id) REFERENCES project_version(id);
ALTER TABLE quote_rush_term ADD CONSTRAINT quote_rush_term_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES rush_fee_tier(id);
ALTER TABLE quoted_analyte_selection ADD CONSTRAINT quoted_analyte_selection_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE quoted_analyte_selection ADD CONSTRAINT quoted_analyte_selection_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE quoted_analyte_selection ADD CONSTRAINT quoted_analyte_selection_line_id_fkey FOREIGN KEY (line_id) REFERENCES quoted_test_configuration(id);
ALTER TABLE quoted_analyte_selection ADD CONSTRAINT quoted_analyte_selection_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE quoted_package ADD CONSTRAINT quoted_package_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE quoted_package ADD CONSTRAINT quoted_package_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE quoted_package ADD CONSTRAINT quoted_package_package_id_fkey FOREIGN KEY (package_id) REFERENCES test_package(id);
ALTER TABLE quoted_package ADD CONSTRAINT quoted_package_project_version_id_fkey FOREIGN KEY (project_version_id) REFERENCES project_version(id);
ALTER TABLE quoted_test_configuration ADD CONSTRAINT quoted_test_configuration_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE quoted_test_configuration ADD CONSTRAINT quoted_test_configuration_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE quoted_test_configuration ADD CONSTRAINT quoted_test_configuration_performing_site_id_fkey FOREIGN KEY (performing_site_id) REFERENCES lab_site(id);
ALTER TABLE quoted_test_configuration ADD CONSTRAINT quoted_test_configuration_project_version_id_fkey FOREIGN KEY (project_version_id) REFERENCES project_version(id);
ALTER TABLE quoted_test_configuration ADD CONSTRAINT quoted_test_configuration_quoted_package_id_fkey FOREIGN KEY (quoted_package_id) REFERENCES quoted_package(id);
ALTER TABLE quoted_test_configuration ADD CONSTRAINT quoted_test_configuration_test_id_fkey FOREIGN KEY (test_id) REFERENCES test(id);
ALTER TABLE specification ADD CONSTRAINT specification_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE specification ADD CONSTRAINT specification_copied_from_spec_id_fkey FOREIGN KEY (copied_from_spec_id) REFERENCES specification(id);
ALTER TABLE specification ADD CONSTRAINT specification_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE specification ADD CONSTRAINT specification_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE specification ADD CONSTRAINT specification_quoted_line_id_fkey FOREIGN KEY (quoted_line_id) REFERENCES quoted_test_configuration(id);
ALTER TABLE specification ADD CONSTRAINT specification_requested_test_id_fkey FOREIGN KEY (requested_test_id) REFERENCES requested_test(id);
ALTER TABLE coa ADD CONSTRAINT coa_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE coa ADD CONSTRAINT coa_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE coa ADD CONSTRAINT coa_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES sample(id);
ALTER TABLE coa ADD CONSTRAINT coa_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE coa_note ADD CONSTRAINT coa_note_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE coa_note ADD CONSTRAINT coa_note_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE coa_note ADD CONSTRAINT coa_note_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE coa_note ADD CONSTRAINT coa_note_reason_code_id_fkey FOREIGN KEY (reason_code_id) REFERENCES reason_code(id);
ALTER TABLE coa_note ADD CONSTRAINT coa_note_requested_test_id_fkey FOREIGN KEY (requested_test_id) REFERENCES requested_test(id);
ALTER TABLE coa_note ADD CONSTRAINT coa_note_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES sample(id);
ALTER TABLE coa_version ADD CONSTRAINT coa_version_coa_id_fkey FOREIGN KEY (coa_id) REFERENCES coa(id);
ALTER TABLE coa_version ADD CONSTRAINT coa_version_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE coa_version ADD CONSTRAINT coa_version_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE coa_version ADD CONSTRAINT coa_version_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES app_user(id);
ALTER TABLE coa_version ADD CONSTRAINT coa_version_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE coa_version ADD CONSTRAINT coa_version_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE coa_version ADD CONSTRAINT coa_version_signature_image_id_fkey FOREIGN KEY (signature_image_id) REFERENCES document_file(id);
ALTER TABLE email_template ADD CONSTRAINT email_template_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE email_template ADD CONSTRAINT email_template_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE finalization_claim ADD CONSTRAINT finalization_claim_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES app_user(id);
ALTER TABLE finalization_claim ADD CONSTRAINT finalization_claim_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE finalization_claim ADD CONSTRAINT finalization_claim_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE finalization_claim ADD CONSTRAINT finalization_claim_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE finalization_claim_test ADD CONSTRAINT finalization_claim_test_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES finalization_claim(id);
ALTER TABLE finalization_claim_test ADD CONSTRAINT finalization_claim_test_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE finalization_claim_test ADD CONSTRAINT finalization_claim_test_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE finalization_claim_test ADD CONSTRAINT finalization_claim_test_requested_test_id_fkey FOREIGN KEY (requested_test_id) REFERENCES requested_test(id);
ALTER TABLE result_finalization ADD CONSTRAINT result_finalization_coa_version_id_fkey FOREIGN KEY (coa_version_id) REFERENCES coa_version(id);
ALTER TABLE result_finalization ADD CONSTRAINT result_finalization_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE result_finalization ADD CONSTRAINT result_finalization_finalized_by_fkey FOREIGN KEY (finalized_by) REFERENCES app_user(id);
ALTER TABLE result_finalization ADD CONSTRAINT result_finalization_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE result_finalization ADD CONSTRAINT result_finalization_requested_test_id_fkey FOREIGN KEY (requested_test_id) REFERENCES requested_test(id);
ALTER TABLE result_finalization ADD CONSTRAINT result_finalization_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE sample_attachment ADD CONSTRAINT sample_attachment_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE sample_attachment ADD CONSTRAINT sample_attachment_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE sample_attachment ADD CONSTRAINT sample_attachment_lab_order_id_fkey FOREIGN KEY (lab_order_id) REFERENCES lab_order(id);
ALTER TABLE sample_attachment ADD CONSTRAINT sample_attachment_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE sample_attachment ADD CONSTRAINT sample_attachment_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES sample(id);
ALTER TABLE app_user ADD CONSTRAINT app_user_signature_document_id_fkey FOREIGN KEY (signature_document_id) REFERENCES document_file(id);
ALTER TABLE app_user ADD CONSTRAINT app_user_signature_set_by_fkey FOREIGN KEY (signature_set_by) REFERENCES app_user(id);
ALTER TABLE auth_event ADD CONSTRAINT auth_event_by_user_fkey FOREIGN KEY (by_user) REFERENCES app_user(id);
ALTER TABLE auth_event ADD CONSTRAINT auth_event_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id);
ALTER TABLE group_member ADD CONSTRAINT group_member_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE group_member ADD CONSTRAINT group_member_group_id_fkey FOREIGN KEY (group_id) REFERENCES lab_group(id);
ALTER TABLE group_member ADD CONSTRAINT group_member_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE group_member ADD CONSTRAINT group_member_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id);
ALTER TABLE group_permission ADD CONSTRAINT group_permission_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE group_permission ADD CONSTRAINT group_permission_group_id_fkey FOREIGN KEY (group_id) REFERENCES lab_group(id);
ALTER TABLE group_permission ADD CONSTRAINT group_permission_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE group_permission ADD CONSTRAINT group_permission_permission_code_fkey FOREIGN KEY (permission_code) REFERENCES permission(code);
ALTER TABLE lab_group ADD CONSTRAINT lab_group_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE lab_group ADD CONSTRAINT lab_group_department_id_fkey FOREIGN KEY (department_id) REFERENCES department(id);
ALTER TABLE lab_group ADD CONSTRAINT lab_group_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE lab_group ADD CONSTRAINT lab_group_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE signature_event ADD CONSTRAINT signature_event_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id);
ALTER TABLE signature_event ADD CONSTRAINT signature_event_verification_id_fkey FOREIGN KEY (verification_id) REFERENCES workflow_verification(id);
ALTER TABLE user_site_access ADD CONSTRAINT user_site_access_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE user_site_access ADD CONSTRAINT user_site_access_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE user_site_access ADD CONSTRAINT user_site_access_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE user_site_access ADD CONSTRAINT user_site_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id);
ALTER TABLE stability_amendment ADD CONSTRAINT stability_amendment_applied_by_fkey FOREIGN KEY (applied_by) REFERENCES app_user(id);
ALTER TABLE stability_amendment ADD CONSTRAINT stability_amendment_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE stability_amendment ADD CONSTRAINT stability_amendment_from_version_id_fkey FOREIGN KEY (from_version_id) REFERENCES project_version(id);
ALTER TABLE stability_amendment ADD CONSTRAINT stability_amendment_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE stability_amendment ADD CONSTRAINT stability_amendment_study_id_fkey FOREIGN KEY (study_id) REFERENCES stability_study(id);
ALTER TABLE stability_amendment ADD CONSTRAINT stability_amendment_to_version_id_fkey FOREIGN KEY (to_version_id) REFERENCES project_version(id);
ALTER TABLE stability_cell ADD CONSTRAINT stability_cell_condition_id_fkey FOREIGN KEY (condition_id) REFERENCES stability_condition(id);
ALTER TABLE stability_cell ADD CONSTRAINT stability_cell_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE stability_cell ADD CONSTRAINT stability_cell_line_id_fkey FOREIGN KEY (line_id) REFERENCES quoted_test_configuration(id);
ALTER TABLE stability_cell ADD CONSTRAINT stability_cell_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE stability_cell ADD CONSTRAINT stability_cell_project_version_id_fkey FOREIGN KEY (project_version_id) REFERENCES project_version(id);
ALTER TABLE stability_cell ADD CONSTRAINT stability_cell_timepoint_id_fkey FOREIGN KEY (timepoint_id) REFERENCES stability_timepoint(id);
ALTER TABLE stability_chamber ADD CONSTRAINT stability_chamber_condition_id_fkey FOREIGN KEY (condition_id) REFERENCES stability_condition(id);
ALTER TABLE stability_chamber ADD CONSTRAINT stability_chamber_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE stability_chamber ADD CONSTRAINT stability_chamber_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE stability_chamber ADD CONSTRAINT stability_chamber_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE stability_chamber ADD CONSTRAINT stability_chamber_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE stability_condition ADD CONSTRAINT stability_condition_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE stability_condition ADD CONSTRAINT stability_condition_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE stability_condition ADD CONSTRAINT stability_condition_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE stability_excursion_assessment ADD CONSTRAINT stability_excursion_assessment_assessed_by_fkey FOREIGN KEY (assessed_by) REFERENCES app_user(id);
ALTER TABLE stability_excursion_assessment ADD CONSTRAINT stability_excursion_assessment_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE stability_excursion_assessment ADD CONSTRAINT stability_excursion_assessment_logbook_entry_id_fkey FOREIGN KEY (logbook_entry_id) REFERENCES logbook_entry(id);
ALTER TABLE stability_excursion_assessment ADD CONSTRAINT stability_excursion_assessment_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE stability_excursion_assessment ADD CONSTRAINT stability_excursion_assessment_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE stability_excursion_assessment ADD CONSTRAINT stability_excursion_assessment_storage_id_fkey FOREIGN KEY (storage_id) REFERENCES stability_storage(id);
ALTER TABLE stability_excursion_assessment ADD CONSTRAINT stability_excursion_assessment_study_id_fkey FOREIGN KEY (study_id) REFERENCES stability_study(id);
ALTER TABLE stability_plan ADD CONSTRAINT stability_plan_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE stability_plan ADD CONSTRAINT stability_plan_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE stability_plan ADD CONSTRAINT stability_plan_project_version_id_fkey FOREIGN KEY (project_version_id) REFERENCES project_version(id);
ALTER TABLE stability_plan ADD CONSTRAINT stability_plan_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE stability_pull ADD CONSTRAINT stability_pull_condition_id_fkey FOREIGN KEY (condition_id) REFERENCES stability_condition(id);
ALTER TABLE stability_pull ADD CONSTRAINT stability_pull_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE stability_pull ADD CONSTRAINT stability_pull_lab_order_id_fkey FOREIGN KEY (lab_order_id) REFERENCES lab_order(id);
ALTER TABLE stability_pull ADD CONSTRAINT stability_pull_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE stability_pull ADD CONSTRAINT stability_pull_pulled_by_fkey FOREIGN KEY (pulled_by) REFERENCES app_user(id);
ALTER TABLE stability_pull ADD CONSTRAINT stability_pull_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES sample(id);
ALTER TABLE stability_pull ADD CONSTRAINT stability_pull_storage_id_fkey FOREIGN KEY (storage_id) REFERENCES stability_storage(id);
ALTER TABLE stability_pull ADD CONSTRAINT stability_pull_study_id_fkey FOREIGN KEY (study_id) REFERENCES stability_study(id);
ALTER TABLE stability_pull ADD CONSTRAINT stability_pull_timepoint_id_fkey FOREIGN KEY (timepoint_id) REFERENCES stability_timepoint(id);
ALTER TABLE stability_rack ADD CONSTRAINT stability_rack_chamber_id_fkey FOREIGN KEY (chamber_id) REFERENCES stability_chamber(id);
ALTER TABLE stability_rack ADD CONSTRAINT stability_rack_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE stability_rack ADD CONSTRAINT stability_rack_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE stability_report ADD CONSTRAINT stability_report_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE stability_report ADD CONSTRAINT stability_report_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE stability_report ADD CONSTRAINT stability_report_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES app_user(id);
ALTER TABLE stability_report ADD CONSTRAINT stability_report_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE stability_report ADD CONSTRAINT stability_report_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE stability_report ADD CONSTRAINT stability_report_signature_image_id_fkey FOREIGN KEY (signature_image_id) REFERENCES document_file(id);
ALTER TABLE stability_report ADD CONSTRAINT stability_report_study_id_fkey FOREIGN KEY (study_id) REFERENCES stability_study(id);
ALTER TABLE stability_storage ADD CONSTRAINT stability_storage_condition_id_fkey FOREIGN KEY (condition_id) REFERENCES stability_condition(id);
ALTER TABLE stability_storage ADD CONSTRAINT stability_storage_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE stability_storage ADD CONSTRAINT stability_storage_disposed_by_fkey FOREIGN KEY (disposed_by) REFERENCES app_user(id);
ALTER TABLE stability_storage ADD CONSTRAINT stability_storage_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE stability_storage ADD CONSTRAINT stability_storage_rack_id_fkey FOREIGN KEY (rack_id) REFERENCES stability_rack(id);
ALTER TABLE stability_storage ADD CONSTRAINT stability_storage_study_id_fkey FOREIGN KEY (study_id) REFERENCES stability_study(id);
ALTER TABLE stability_study ADD CONSTRAINT stability_study_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES app_user(id);
ALTER TABLE stability_study ADD CONSTRAINT stability_study_client_id_fkey FOREIGN KEY (client_id) REFERENCES client(id);
ALTER TABLE stability_study ADD CONSTRAINT stability_study_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contact(id);
ALTER TABLE stability_study ADD CONSTRAINT stability_study_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE stability_study ADD CONSTRAINT stability_study_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE stability_study ADD CONSTRAINT stability_study_placed_by_fkey FOREIGN KEY (placed_by) REFERENCES app_user(id);
ALTER TABLE stability_study ADD CONSTRAINT stability_study_project_id_fkey FOREIGN KEY (project_id) REFERENCES project(id);
ALTER TABLE stability_study ADD CONSTRAINT stability_study_project_version_id_fkey FOREIGN KEY (project_version_id) REFERENCES project_version(id);
ALTER TABLE stability_study ADD CONSTRAINT stability_study_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE stability_study ADD CONSTRAINT stability_study_t0_order_id_fkey FOREIGN KEY (t0_order_id) REFERENCES lab_order(id);
ALTER TABLE stability_study ADD CONSTRAINT stability_study_t0_sample_id_fkey FOREIGN KEY (t0_sample_id) REFERENCES sample(id);
ALTER TABLE stability_timepoint ADD CONSTRAINT stability_timepoint_carried_from_id_fkey FOREIGN KEY (carried_from_id) REFERENCES stability_timepoint(id);
ALTER TABLE stability_timepoint ADD CONSTRAINT stability_timepoint_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE stability_timepoint ADD CONSTRAINT stability_timepoint_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE stability_timepoint ADD CONSTRAINT stability_timepoint_project_version_id_fkey FOREIGN KEY (project_version_id) REFERENCES project_version(id);
ALTER TABLE stability_version_condition ADD CONSTRAINT stability_version_condition_condition_id_fkey FOREIGN KEY (condition_id) REFERENCES stability_condition(id);
ALTER TABLE stability_version_condition ADD CONSTRAINT stability_version_condition_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE stability_version_condition ADD CONSTRAINT stability_version_condition_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE stability_version_condition ADD CONSTRAINT stability_version_condition_project_version_id_fkey FOREIGN KEY (project_version_id) REFERENCES project_version(id);
ALTER TABLE catalog_price_change ADD CONSTRAINT catalog_price_change_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES app_user(id);
ALTER TABLE catalog_price_change ADD CONSTRAINT catalog_price_change_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE catalog_price_change ADD CONSTRAINT catalog_price_change_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE catalog_price_change ADD CONSTRAINT catalog_price_change_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE rush_fee_schedule ADD CONSTRAINT rush_fee_schedule_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE rush_fee_schedule ADD CONSTRAINT rush_fee_schedule_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE rush_fee_tier ADD CONSTRAINT rush_fee_tier_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE rush_fee_tier ADD CONSTRAINT rush_fee_tier_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE rush_fee_tier ADD CONSTRAINT rush_fee_tier_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES rush_fee_schedule(id);
ALTER TABLE test ADD CONSTRAINT test_copied_from_test_id_fkey FOREIGN KEY (copied_from_test_id) REFERENCES test(id);
ALTER TABLE test ADD CONSTRAINT test_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE test ADD CONSTRAINT test_department_id_fkey FOREIGN KEY (department_id) REFERENCES department(id);
ALTER TABLE test ADD CONSTRAINT test_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE test ADD CONSTRAINT test_service_line_type_id_fkey FOREIGN KEY (service_line_type_id) REFERENCES service_line_type(id);
ALTER TABLE test ADD CONSTRAINT test_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE test_analyte_price ADD CONSTRAINT test_analyte_price_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE test_analyte_price ADD CONSTRAINT test_analyte_price_catalog_entry_id_fkey FOREIGN KEY (catalog_entry_id) REFERENCES test_catalog_entry(id);
ALTER TABLE test_analyte_price ADD CONSTRAINT test_analyte_price_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE test_analyte_price ADD CONSTRAINT test_analyte_price_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE test_catalog_entry ADD CONSTRAINT test_catalog_entry_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE test_catalog_entry ADD CONSTRAINT test_catalog_entry_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE test_catalog_entry ADD CONSTRAINT test_catalog_entry_rush_schedule_id_fkey FOREIGN KEY (rush_schedule_id) REFERENCES rush_fee_schedule(id);
ALTER TABLE test_catalog_entry ADD CONSTRAINT test_catalog_entry_test_id_fkey FOREIGN KEY (test_id) REFERENCES test(id);
ALTER TABLE test_package ADD CONSTRAINT test_package_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE test_package ADD CONSTRAINT test_package_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE test_package ADD CONSTRAINT test_package_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE test_package_analyte ADD CONSTRAINT test_package_analyte_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE test_package_analyte ADD CONSTRAINT test_package_analyte_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE test_package_analyte ADD CONSTRAINT test_package_analyte_item_id_fkey FOREIGN KEY (item_id) REFERENCES test_package_item(id);
ALTER TABLE test_package_analyte ADD CONSTRAINT test_package_analyte_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE test_package_item ADD CONSTRAINT test_package_item_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE test_package_item ADD CONSTRAINT test_package_item_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE test_package_item ADD CONSTRAINT test_package_item_package_id_fkey FOREIGN KEY (package_id) REFERENCES test_package(id);
ALTER TABLE test_package_item ADD CONSTRAINT test_package_item_test_id_fkey FOREIGN KEY (test_id) REFERENCES test(id);
ALTER TABLE test_rush_approval ADD CONSTRAINT test_rush_approval_catalog_entry_id_fkey FOREIGN KEY (catalog_entry_id) REFERENCES test_catalog_entry(id);
ALTER TABLE test_rush_approval ADD CONSTRAINT test_rush_approval_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE test_rush_approval ADD CONSTRAINT test_rush_approval_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE test_rush_approval ADD CONSTRAINT test_rush_approval_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES rush_fee_tier(id);
ALTER TABLE method ADD CONSTRAINT method_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE method ADD CONSTRAINT method_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE method ADD CONSTRAINT method_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE method ADD CONSTRAINT method_sop_document_id_fkey FOREIGN KEY (sop_document_id) REFERENCES document_file(id);
ALTER TABLE test_version ADD CONSTRAINT test_version_approval_signature_id_fkey FOREIGN KEY (approval_signature_id) REFERENCES signature_event(id);
ALTER TABLE test_version ADD CONSTRAINT test_version_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES app_user(id);
ALTER TABLE test_version ADD CONSTRAINT test_version_copied_from_version_id_fkey FOREIGN KEY (copied_from_version_id) REFERENCES test_version(id);
ALTER TABLE test_version ADD CONSTRAINT test_version_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE test_version ADD CONSTRAINT test_version_method_id_fkey FOREIGN KEY (method_id) REFERENCES method(id);
ALTER TABLE test_version ADD CONSTRAINT test_version_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE test_version ADD CONSTRAINT test_version_report_template_id_fkey FOREIGN KEY (report_template_id) REFERENCES report_template(id);
ALTER TABLE test_version ADD CONSTRAINT test_version_test_id_fkey FOREIGN KEY (test_id) REFERENCES test(id);
ALTER TABLE test_version_analyte ADD CONSTRAINT test_version_analyte_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE test_version_analyte ADD CONSTRAINT test_version_analyte_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE test_version_analyte ADD CONSTRAINT test_version_analyte_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE test_version_analyte ADD CONSTRAINT test_version_analyte_test_version_id_fkey FOREIGN KEY (test_version_id) REFERENCES test_version(id);
ALTER TABLE workflow_step ADD CONSTRAINT workflow_step_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE workflow_step ADD CONSTRAINT workflow_step_department_id_fkey FOREIGN KEY (department_id) REFERENCES department(id);
ALTER TABLE workflow_step ADD CONSTRAINT workflow_step_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE workflow_step ADD CONSTRAINT workflow_step_test_version_id_fkey FOREIGN KEY (test_version_id) REFERENCES test_version(id);
ALTER TABLE workflow_step_dependency ADD CONSTRAINT workflow_step_dependency_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE workflow_step_dependency ADD CONSTRAINT workflow_step_dependency_depends_on_step_id_fkey FOREIGN KEY (depends_on_step_id) REFERENCES workflow_step(id);
ALTER TABLE workflow_step_dependency ADD CONSTRAINT workflow_step_dependency_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE workflow_step_dependency ADD CONSTRAINT workflow_step_dependency_step_id_fkey FOREIGN KEY (step_id) REFERENCES workflow_step(id);
ALTER TABLE workflow_step_equipment ADD CONSTRAINT workflow_step_equipment_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE workflow_step_equipment ADD CONSTRAINT workflow_step_equipment_equipment_type_id_fkey FOREIGN KEY (equipment_type_id) REFERENCES equipment_type(id);
ALTER TABLE workflow_step_equipment ADD CONSTRAINT workflow_step_equipment_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE workflow_step_equipment ADD CONSTRAINT workflow_step_equipment_step_id_fkey FOREIGN KEY (step_id) REFERENCES workflow_step(id);
ALTER TABLE analyst_pick ADD CONSTRAINT analyst_pick_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE analyst_pick ADD CONSTRAINT analyst_pick_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES test_batch(id);
ALTER TABLE analyst_pick ADD CONSTRAINT analyst_pick_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE analyst_pick ADD CONSTRAINT analyst_pick_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES batch_entry(id);
ALTER TABLE analyst_pick ADD CONSTRAINT analyst_pick_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE analyst_pick ADD CONSTRAINT analyst_pick_requested_test_id_fkey FOREIGN KEY (requested_test_id) REFERENCES requested_test(id);
ALTER TABLE analytical_run ADD CONSTRAINT analytical_run_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE analytical_run ADD CONSTRAINT analytical_run_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE analytical_run ADD CONSTRAINT analytical_run_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE analytical_run ADD CONSTRAINT analytical_run_step_run_id_fkey FOREIGN KEY (step_run_id) REFERENCES step_run(id);
ALTER TABLE batch_entry ADD CONSTRAINT batch_entry_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES test_batch(id);
ALTER TABLE batch_entry ADD CONSTRAINT batch_entry_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE batch_entry ADD CONSTRAINT batch_entry_daily_of_entry_id_fkey FOREIGN KEY (daily_of_entry_id) REFERENCES batch_entry(id);
ALTER TABLE batch_entry ADD CONSTRAINT batch_entry_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE batch_entry ADD CONSTRAINT batch_entry_parent_entry_id_fkey FOREIGN KEY (parent_entry_id) REFERENCES batch_entry(id);
ALTER TABLE batch_entry ADD CONSTRAINT batch_entry_qc_type_fkey FOREIGN KEY (qc_type) REFERENCES qc_type(qc_type);
ALTER TABLE batch_entry ADD CONSTRAINT batch_entry_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES app_user(id);
ALTER TABLE batch_entry ADD CONSTRAINT batch_entry_reprep_request_id_fkey FOREIGN KEY (reprep_request_id) REFERENCES reprep_request(id);
ALTER TABLE batch_entry ADD CONSTRAINT batch_entry_requested_test_id_fkey FOREIGN KEY (requested_test_id) REFERENCES requested_test(id);
ALTER TABLE entry_equipment ADD CONSTRAINT entry_equipment_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE entry_equipment ADD CONSTRAINT entry_equipment_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES batch_entry(id);
ALTER TABLE entry_equipment ADD CONSTRAINT entry_equipment_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE entry_equipment ADD CONSTRAINT entry_equipment_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE entry_equipment ADD CONSTRAINT entry_equipment_step_run_id_fkey FOREIGN KEY (step_run_id) REFERENCES step_run(id);
ALTER TABLE entry_material ADD CONSTRAINT entry_material_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE entry_material ADD CONSTRAINT entry_material_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES batch_entry(id);
ALTER TABLE entry_material ADD CONSTRAINT entry_material_logbook_entry_id_fkey FOREIGN KEY (logbook_entry_id) REFERENCES logbook_entry(id);
ALTER TABLE entry_material ADD CONSTRAINT entry_material_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES inventory_lot(id);
ALTER TABLE entry_material ADD CONSTRAINT entry_material_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE entry_material ADD CONSTRAINT entry_material_return_txn_id_fkey FOREIGN KEY (return_txn_id) REFERENCES inventory_transaction(id);
ALTER TABLE entry_material ADD CONSTRAINT entry_material_step_run_id_fkey FOREIGN KEY (step_run_id) REFERENCES step_run(id);
ALTER TABLE entry_material ADD CONSTRAINT entry_material_usage_txn_id_fkey FOREIGN KEY (usage_txn_id) REFERENCES inventory_transaction(id);
ALTER TABLE entry_value ADD CONSTRAINT entry_value_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE entry_value ADD CONSTRAINT entry_value_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE entry_value ADD CONSTRAINT entry_value_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES batch_entry(id);
ALTER TABLE entry_value ADD CONSTRAINT entry_value_logbook_entry_id_fkey FOREIGN KEY (logbook_entry_id) REFERENCES logbook_entry(id);
ALTER TABLE entry_value ADD CONSTRAINT entry_value_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE entry_value ADD CONSTRAINT entry_value_step_run_id_fkey FOREIGN KEY (step_run_id) REFERENCES step_run(id);
ALTER TABLE incubation_load ADD CONSTRAINT incubation_load_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE incubation_load ADD CONSTRAINT incubation_load_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE incubation_load ADD CONSTRAINT incubation_load_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE incubation_load ADD CONSTRAINT incubation_load_step_run_id_fkey FOREIGN KEY (step_run_id) REFERENCES step_run(id);
ALTER TABLE load_acceptance ADD CONSTRAINT load_acceptance_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES test_batch(id);
ALTER TABLE load_acceptance ADD CONSTRAINT load_acceptance_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE load_acceptance ADD CONSTRAINT load_acceptance_load_id_fkey FOREIGN KEY (load_id) REFERENCES incubation_load(id);
ALTER TABLE load_acceptance ADD CONSTRAINT load_acceptance_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE qc_acceptance ADD CONSTRAINT qc_acceptance_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE qc_acceptance ADD CONSTRAINT qc_acceptance_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES test_batch(id);
ALTER TABLE qc_acceptance ADD CONSTRAINT qc_acceptance_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE qc_acceptance ADD CONSTRAINT qc_acceptance_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES batch_entry(id);
ALTER TABLE qc_acceptance ADD CONSTRAINT qc_acceptance_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE reanalysis_request ADD CONSTRAINT reanalysis_request_analytical_run_id_fkey FOREIGN KEY (analytical_run_id) REFERENCES analytical_run(id);
ALTER TABLE reanalysis_request ADD CONSTRAINT reanalysis_request_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE reanalysis_request ADD CONSTRAINT reanalysis_request_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES batch_entry(id);
ALTER TABLE reanalysis_request ADD CONSTRAINT reanalysis_request_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE reanalysis_request ADD CONSTRAINT reanalysis_request_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE reanalysis_request ADD CONSTRAINT reanalysis_request_step_run_id_fkey FOREIGN KEY (step_run_id) REFERENCES step_run(id);
ALTER TABLE reprep_request ADD CONSTRAINT reprep_origin_fk FOREIGN KEY (origin_entry_id) REFERENCES batch_entry(id);
ALTER TABLE reprep_request ADD CONSTRAINT reprep_request_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES test_batch(id);
ALTER TABLE reprep_request ADD CONSTRAINT reprep_request_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE reprep_request ADD CONSTRAINT reprep_request_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE reprep_request ADD CONSTRAINT reprep_request_requested_test_id_fkey FOREIGN KEY (requested_test_id) REFERENCES requested_test(id);
ALTER TABLE reprep_request ADD CONSTRAINT reprep_request_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE result_choice ADD CONSTRAINT result_choice_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE result_choice ADD CONSTRAINT result_choice_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES test_batch(id);
ALTER TABLE result_choice ADD CONSTRAINT result_choice_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE result_choice ADD CONSTRAINT result_choice_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES batch_entry(id);
ALTER TABLE result_choice ADD CONSTRAINT result_choice_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE result_choice ADD CONSTRAINT result_choice_requested_test_id_fkey FOREIGN KEY (requested_test_id) REFERENCES requested_test(id);
ALTER TABLE review_step_mark ADD CONSTRAINT review_step_mark_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES test_batch(id);
ALTER TABLE review_step_mark ADD CONSTRAINT review_step_mark_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE review_step_mark ADD CONSTRAINT review_step_mark_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE review_step_mark ADD CONSTRAINT review_step_mark_step_run_id_fkey FOREIGN KEY (step_run_id) REFERENCES step_run(id);
ALTER TABLE split_request ADD CONSTRAINT split_request_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES test_batch(id);
ALTER TABLE split_request ADD CONSTRAINT split_request_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE split_request ADD CONSTRAINT split_request_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES app_user(id);
ALTER TABLE split_request ADD CONSTRAINT split_request_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES batch_entry(id);
ALTER TABLE split_request ADD CONSTRAINT split_request_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE split_request ADD CONSTRAINT split_request_ordered_requested_test_id_fkey FOREIGN KEY (ordered_requested_test_id) REFERENCES requested_test(id);
ALTER TABLE split_request ADD CONSTRAINT split_request_origin_requested_test_id_fkey FOREIGN KEY (origin_requested_test_id) REFERENCES requested_test(id);
ALTER TABLE split_request ADD CONSTRAINT split_request_sample_id_fkey FOREIGN KEY (sample_id) REFERENCES sample(id);
ALTER TABLE split_request ADD CONSTRAINT split_request_step_run_id_fkey FOREIGN KEY (step_run_id) REFERENCES step_run(id);
ALTER TABLE split_request ADD CONSTRAINT split_request_test_id_fkey FOREIGN KEY (test_id) REFERENCES test(id);
ALTER TABLE step_attachment ADD CONSTRAINT step_attachment_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE step_attachment ADD CONSTRAINT step_attachment_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE step_attachment ADD CONSTRAINT step_attachment_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE step_attachment ADD CONSTRAINT step_attachment_step_run_id_fkey FOREIGN KEY (step_run_id) REFERENCES step_run(id);
ALTER TABLE step_run ADD CONSTRAINT step_run_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES test_batch(id);
ALTER TABLE step_run ADD CONSTRAINT step_run_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE step_run ADD CONSTRAINT step_run_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE step_run ADD CONSTRAINT step_run_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES app_user(id);
ALTER TABLE step_run ADD CONSTRAINT step_run_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE step_run ADD CONSTRAINT step_run_step_id_fkey FOREIGN KEY (step_id) REFERENCES workflow_step(id);
ALTER TABLE step_run ADD CONSTRAINT step_run_witness_id_fkey FOREIGN KEY (witness_id) REFERENCES app_user(id);
ALTER TABLE step_run ADD CONSTRAINT step_run_witness_signature_id_fkey FOREIGN KEY (witness_signature_id) REFERENCES signature_event(id);
ALTER TABLE test_batch ADD CONSTRAINT test_batch_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES app_user(id);
ALTER TABLE test_batch ADD CONSTRAINT test_batch_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES app_user(id);
ALTER TABLE test_batch ADD CONSTRAINT test_batch_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE test_batch ADD CONSTRAINT test_batch_department_id_fkey FOREIGN KEY (department_id) REFERENCES department(id);
ALTER TABLE test_batch ADD CONSTRAINT test_batch_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE test_batch ADD CONSTRAINT test_batch_returned_by_fkey FOREIGN KEY (returned_by) REFERENCES app_user(id);
ALTER TABLE test_batch ADD CONSTRAINT test_batch_review_signature_id_fkey FOREIGN KEY (review_signature_id) REFERENCES signature_event(id);
ALTER TABLE test_batch ADD CONSTRAINT test_batch_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES app_user(id);
ALTER TABLE test_batch ADD CONSTRAINT test_batch_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE test_batch ADD CONSTRAINT test_batch_test_id_fkey FOREIGN KEY (test_id) REFERENCES test(id);
ALTER TABLE test_batch ADD CONSTRAINT test_batch_test_version_id_fkey FOREIGN KEY (test_version_id) REFERENCES test_version(id);
ALTER TABLE test_batch ADD CONSTRAINT test_batch_verification_id_fkey FOREIGN KEY (verification_id) REFERENCES workflow_verification(id);
ALTER TABLE test_result ADD CONSTRAINT test_result_analyte_id_fkey FOREIGN KEY (analyte_id) REFERENCES analyte(id);
ALTER TABLE test_result ADD CONSTRAINT test_result_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES app_user(id);
ALTER TABLE test_result ADD CONSTRAINT test_result_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES test_batch(id);
ALTER TABLE test_result ADD CONSTRAINT test_result_carried_from_id_fkey FOREIGN KEY (carried_from_id) REFERENCES test_result(id);
ALTER TABLE test_result ADD CONSTRAINT test_result_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE test_result ADD CONSTRAINT test_result_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES batch_entry(id);
ALTER TABLE test_result ADD CONSTRAINT test_result_invalidated_oos_id_fkey FOREIGN KEY (invalidated_oos_id) REFERENCES oos_investigation(id);
ALTER TABLE test_result ADD CONSTRAINT test_result_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE test_result ADD CONSTRAINT test_result_released_step_run_id_fkey FOREIGN KEY (released_step_run_id) REFERENCES step_run(id);
ALTER TABLE test_result ADD CONSTRAINT test_result_requested_test_id_fkey FOREIGN KEY (requested_test_id) REFERENCES requested_test(id);
ALTER TABLE test_result ADD CONSTRAINT test_result_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE analyst_qualification ADD CONSTRAINT analyst_qualification_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES app_user(id);
ALTER TABLE analyst_qualification ADD CONSTRAINT analyst_qualification_attempt FOREIGN KEY (attempt_id) REFERENCES competency_attempt(id);
ALTER TABLE analyst_qualification ADD CONSTRAINT analyst_qualification_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE analyst_qualification ADD CONSTRAINT analyst_qualification_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE analyst_qualification ADD CONSTRAINT analyst_qualification_signature_id_fkey FOREIGN KEY (signature_id) REFERENCES signature_event(id);
ALTER TABLE analyst_qualification ADD CONSTRAINT analyst_qualification_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE analyst_qualification ADD CONSTRAINT analyst_qualification_test_id_fkey FOREIGN KEY (test_id) REFERENCES test(id);
ALTER TABLE analyst_qualification ADD CONSTRAINT analyst_qualification_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id);
ALTER TABLE competency_attempt ADD CONSTRAINT competency_attempt_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE competency_attempt ADD CONSTRAINT competency_attempt_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES app_user(id);
ALTER TABLE competency_attempt ADD CONSTRAINT competency_attempt_decision_signature_id_fkey FOREIGN KEY (decision_signature_id) REFERENCES signature_event(id);
ALTER TABLE competency_attempt ADD CONSTRAINT competency_attempt_evaluated_by_fkey FOREIGN KEY (evaluated_by) REFERENCES app_user(id);
ALTER TABLE competency_attempt ADD CONSTRAINT competency_attempt_evaluation_signature_id_fkey FOREIGN KEY (evaluation_signature_id) REFERENCES signature_event(id);
ALTER TABLE competency_attempt ADD CONSTRAINT competency_attempt_lab_order_id_fkey FOREIGN KEY (lab_order_id) REFERENCES lab_order(id);
ALTER TABLE competency_attempt ADD CONSTRAINT competency_attempt_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE competency_attempt ADD CONSTRAINT competency_attempt_qualification_id_fkey FOREIGN KEY (qualification_id) REFERENCES analyst_qualification(id);
ALTER TABLE competency_attempt ADD CONSTRAINT competency_attempt_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE competency_attempt ADD CONSTRAINT competency_attempt_test_id_fkey FOREIGN KEY (test_id) REFERENCES test(id);
ALTER TABLE competency_attempt ADD CONSTRAINT competency_attempt_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id);
ALTER TABLE competency_evidence ADD CONSTRAINT competency_evidence_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES competency_attempt(id);
ALTER TABLE competency_evidence ADD CONSTRAINT competency_evidence_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE competency_evidence ADD CONSTRAINT competency_evidence_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE competency_evidence ADD CONSTRAINT competency_evidence_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE training_rule ADD CONSTRAINT training_rule_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE training_rule ADD CONSTRAINT training_rule_department_id_fkey FOREIGN KEY (department_id) REFERENCES department(id);
ALTER TABLE training_rule ADD CONSTRAINT training_rule_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE training_rule ADD CONSTRAINT training_rule_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE trend_chart ADD CONSTRAINT trend_chart_applied_by_fkey FOREIGN KEY (applied_by) REFERENCES app_user(id);
ALTER TABLE trend_chart ADD CONSTRAINT trend_chart_applied_version_id_fkey FOREIGN KEY (applied_version_id) REFERENCES test_version(id);
ALTER TABLE trend_chart ADD CONSTRAINT trend_chart_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE trend_chart ADD CONSTRAINT trend_chart_frozen_by_fkey FOREIGN KEY (frozen_by) REFERENCES app_user(id);
ALTER TABLE trend_chart ADD CONSTRAINT trend_chart_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE trend_chart ADD CONSTRAINT trend_chart_qa_approved_by_fkey FOREIGN KEY (qa_approved_by) REFERENCES app_user(id);
ALTER TABLE trend_chart ADD CONSTRAINT trend_chart_qa_signature_id_fkey FOREIGN KEY (qa_signature_id) REFERENCES signature_event(id);
ALTER TABLE trend_chart ADD CONSTRAINT trend_chart_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE trend_signal_review ADD CONSTRAINT trend_signal_review_chart_id_fkey FOREIGN KEY (chart_id) REFERENCES trend_chart(id);
ALTER TABLE trend_signal_review ADD CONSTRAINT trend_signal_review_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE trend_signal_review ADD CONSTRAINT trend_signal_review_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE trend_signal_review ADD CONSTRAINT trend_signal_review_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES app_user(id);
ALTER TABLE verification_check ADD CONSTRAINT verification_check_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES test_batch(id);
ALTER TABLE verification_check ADD CONSTRAINT verification_check_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE verification_check ADD CONSTRAINT verification_check_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE verification_check ADD CONSTRAINT verification_check_verification_id_fkey FOREIGN KEY (verification_id) REFERENCES workflow_verification(id);
ALTER TABLE verification_evidence ADD CONSTRAINT verification_evidence_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE verification_evidence ADD CONSTRAINT verification_evidence_document_id_fkey FOREIGN KEY (document_id) REFERENCES document_file(id);
ALTER TABLE verification_evidence ADD CONSTRAINT verification_evidence_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE verification_evidence ADD CONSTRAINT verification_evidence_verification_id_fkey FOREIGN KEY (verification_id) REFERENCES workflow_verification(id);
ALTER TABLE verification_requirement ADD CONSTRAINT verification_requirement_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE verification_requirement ADD CONSTRAINT verification_requirement_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE verification_requirement ADD CONSTRAINT verification_requirement_verification_id_fkey FOREIGN KEY (verification_id) REFERENCES workflow_verification(id);
ALTER TABLE workflow_verification ADD CONSTRAINT workflow_verification_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE workflow_verification ADD CONSTRAINT workflow_verification_evidence_captured_by_fkey FOREIGN KEY (evidence_captured_by) REFERENCES app_user(id);
ALTER TABLE workflow_verification ADD CONSTRAINT workflow_verification_evidence_signature_id_fkey FOREIGN KEY (evidence_signature_id) REFERENCES signature_event(id);
ALTER TABLE workflow_verification ADD CONSTRAINT workflow_verification_executed_by_fkey FOREIGN KEY (executed_by) REFERENCES app_user(id);
ALTER TABLE workflow_verification ADD CONSTRAINT workflow_verification_execution_signature_id_fkey FOREIGN KEY (execution_signature_id) REFERENCES signature_event(id);
ALTER TABLE workflow_verification ADD CONSTRAINT workflow_verification_lab_order_id_fkey FOREIGN KEY (lab_order_id) REFERENCES lab_order(id);
ALTER TABLE workflow_verification ADD CONSTRAINT workflow_verification_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES app_user(id);
ALTER TABLE workflow_verification ADD CONSTRAINT workflow_verification_prepared_signature_id_fkey FOREIGN KEY (prepared_signature_id) REFERENCES signature_event(id);
ALTER TABLE workflow_verification ADD CONSTRAINT workflow_verification_protocol_approved_by_fkey FOREIGN KEY (protocol_approved_by) REFERENCES app_user(id);
ALTER TABLE workflow_verification ADD CONSTRAINT workflow_verification_protocol_signature_id_fkey FOREIGN KEY (protocol_signature_id) REFERENCES signature_event(id);
ALTER TABLE workflow_verification ADD CONSTRAINT workflow_verification_report_signature_id_fkey FOREIGN KEY (report_signature_id) REFERENCES signature_event(id);
ALTER TABLE workflow_verification ADD CONSTRAINT workflow_verification_report_signed_by_fkey FOREIGN KEY (report_signed_by) REFERENCES app_user(id);
ALTER TABLE workflow_verification ADD CONSTRAINT workflow_verification_site_id_fkey FOREIGN KEY (site_id) REFERENCES lab_site(id);
ALTER TABLE workflow_verification ADD CONSTRAINT workflow_verification_test_version_id_fkey FOREIGN KEY (test_version_id) REFERENCES test_version(id);

-- ============================================================== indexes (uniqueness without a WHERE clause, and lookups)
CREATE INDEX analyst_qualification_user ON analyst_qualification USING btree (user_id);
CREATE UNIQUE INDEX analyte_name_uq ON analyte USING btree (lower(analyte_name));
CREATE INDEX audit_log_record_idx ON audit_log USING btree (table_name, record_id, changed_at);
CREATE INDEX batch_entry_batch_idx ON batch_entry USING btree (batch_id, "position");
CREATE INDEX batch_entry_rt_idx ON batch_entry USING btree (requested_test_id);
CREATE INDEX calibration_eq_idx ON calibration USING btree (equipment_id, performed_date DESC);
CREATE UNIQUE INDEX chemical_name_uq ON chemical USING btree (lower(chemical_name));
CREATE UNIQUE INDEX client_legal_name_uq ON client USING btree (lower(legal_name));
CREATE INDEX client_parent_idx ON client USING btree (parent_client_id);
CREATE INDEX client_contact_contact_idx ON client_contact USING btree (contact_id);
CREATE UNIQUE INDEX client_service_line_one ON client_service_line USING btree (client_id, service_line_id);
CREATE INDEX coa_note_sample_idx ON coa_note USING btree (sample_id);
CREATE INDEX competency_attempt_user ON competency_attempt USING btree (user_id);
CREATE UNIQUE INDEX compliance_category_uq ON compliance_category USING btree (lower(category_name));
CREATE UNIQUE INDEX contact_email_uq ON contact USING btree (lower(email));
CREATE UNIQUE INDEX department_code_uq ON department USING btree (site_id, upper(department_code));
CREATE UNIQUE INDEX department_name_uq ON department USING btree (site_id, lower(department_name));
CREATE INDEX equipment_site_idx ON equipment USING btree (site_id);
CREATE INDEX equipment_event_eq_idx ON equipment_event USING btree (equipment_id);
CREATE INDEX equipment_tag_active_idx ON equipment_tag USING btree (equipment_id) WHERE (tagged_in_at IS NULL);
CREATE UNIQUE INDEX equipment_type_name_uq ON equipment_type USING btree (site_id, lower(type_name));
CREATE INDEX group_member_user_idx ON group_member USING btree (user_id);
CREATE INDEX inventory_lot_site_idx ON inventory_lot USING btree (site_id);
CREATE INDEX inventory_txn_lot_idx ON inventory_transaction USING btree (lot_id);
CREATE INDEX invoice_order ON invoice USING btree (lab_order_id);
CREATE INDEX invoice_site_date ON invoice USING btree (site_id, invoice_date);
CREATE INDEX invoice_line_charge ON invoice_line USING btree (order_charge_id);
CREATE INDEX invoice_line_invoice ON invoice_line USING btree (invoice_id);
CREATE INDEX invoice_line_test ON invoice_line USING btree (requested_test_id);
CREATE UNIQUE INDEX lab_group_name_uq ON lab_group USING btree (COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(group_name));
CREATE INDEX lab_order_client_idx ON lab_order USING btree (client_id);
CREATE INDEX logbook_entry_equipment_idx ON logbook_entry USING btree (equipment_id, entry_at) WHERE (equipment_id IS NOT NULL);
CREATE INDEX logbook_entry_logbook_idx ON logbook_entry USING btree (logbook_id, entry_at);
CREATE INDEX logbook_entry_lot_idx ON logbook_entry USING btree (lot_id) WHERE (lot_id IS NOT NULL);
CREATE INDEX logbook_entry_sample_idx ON logbook_entry USING btree (sample_id) WHERE (sample_id IS NOT NULL);
CREATE INDEX logbook_entry_sensor_idx ON logbook_entry USING btree (sensor_link_id, sensor_kind, period_start) WHERE (sensor_link_id IS NOT NULL);
CREATE INDEX logbook_result_flag_result_idx ON logbook_result_flag USING btree (test_result_id);
CREATE INDEX logbook_result_use_entry_idx ON logbook_result_use USING btree (logbook_entry_id);
CREATE INDEX logbook_result_use_result_idx ON logbook_result_use USING btree (test_result_id);
CREATE INDEX lot_analyte_lot_idx ON lot_analyte USING btree (lot_id);
CREATE UNIQUE INDEX matrix_name_uq ON matrix USING btree (lower(matrix_name));
CREATE INDEX media_qualification_rt_idx ON media_qualification USING btree (requested_test_id);
CREATE UNIQUE INDEX method_name_uq ON method USING btree (site_id, lower(method_name));
CREATE INDEX oos_rt_idx ON oos_investigation USING btree (requested_test_id, analyte_id);
CREATE INDEX order_charge_order ON order_charge USING btree (lab_order_id);
CREATE INDEX ordered_package_sample_idx ON ordered_package USING btree (sample_id);
CREATE UNIQUE INDEX product_category_uq ON product_category USING btree (lower(category_name));
CREATE INDEX project_client_idx ON project USING btree (client_id);
CREATE INDEX purchase_line_site_idx ON purchase_line USING btree (site_id, status);
CREATE UNIQUE INDEX reason_code_uq ON reason_code USING btree (module, lower(reason_text));
CREATE INDEX requested_test_package_idx ON requested_test USING btree (ordered_package_id) WHERE (ordered_package_id IS NOT NULL);
CREATE INDEX requested_test_sample_idx ON requested_test USING btree (sample_id);
CREATE INDEX result_finalization_rt_idx ON result_finalization USING btree (requested_test_id);
CREATE UNIQUE INDEX rush_schedule_name_uq ON rush_fee_schedule USING btree (lower(schedule_name));
CREATE INDEX sample_metrc_idx ON sample USING btree (metrc_id) WHERE (metrc_id IS NOT NULL);
CREATE INDEX sample_order_idx ON sample USING btree (lab_order_id);
CREATE INDEX sample_attachment_order_idx ON sample_attachment USING btree (lab_order_id);
CREATE INDEX sample_photo_sample_idx ON sample_photo USING btree (sample_id);
CREATE INDEX sensor_reading_time_idx ON sensor_reading USING btree (link_id, read_at);
CREATE INDEX sensor_sync_log_idx ON sensor_sync_log USING btree (site_id, finished_at DESC);
CREATE UNIQUE INDEX service_line_name ON service_line USING btree (lower(line_name));
CREATE UNIQUE INDEX service_line_type_name ON service_line_type USING btree (service_line_id, lower(type_name));
CREATE INDEX signature_event_user_idx ON signature_event USING btree (user_id, signed_at);
CREATE UNIQUE INDEX stability_amendment_uq ON stability_amendment USING btree (study_id, amendment_no);
CREATE UNIQUE INDEX stability_condition_name_uq ON stability_condition USING btree (COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(condition_name)));
CREATE INDEX stability_pull_due_idx ON stability_pull USING btree (status, scheduled_date);
CREATE UNIQUE INDEX stability_pull_uq ON stability_pull USING btree (study_id, condition_id, timepoint_id);
CREATE UNIQUE INDEX stability_report_uq ON stability_report USING btree (study_id, version_no);
CREATE UNIQUE INDEX stability_storage_one_per_condition ON stability_storage USING btree (study_id, condition_id);
CREATE UNIQUE INDEX storage_location_code_uq ON storage_location USING btree (site_id, upper(location_code));
CREATE UNIQUE INDEX supplier_name_uq ON supplier USING btree (lower(supplier_name));
CREATE UNIQUE INDEX supplier_risk_class_uq ON supplier_risk_class USING btree (COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(class_name));
CREATE UNIQUE INDEX supply_scope_name_uq ON supply_scope USING btree (lower(scope_name));
CREATE UNIQUE INDEX test_name_uq ON test USING btree (COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(test_name));
CREATE INDEX test_batch_site_idx ON test_batch USING btree (site_id, status);
CREATE UNIQUE INDEX unit_code_uq ON unit_of_measure USING btree (lower(unit_code));
CREATE INDEX vendor_document_qual_idx ON vendor_document USING btree (qualification_id);
CREATE INDEX vendor_notice_site_idx ON vendor_notice USING btree (site_id) WHERE (acknowledged_at IS NULL);
CREATE INDEX vendor_qualification_supplier_idx ON vendor_qualification USING btree (supplier_id);
CREATE INDEX workflow_step_version_idx ON workflow_step USING btree (test_version_id);
CREATE INDEX workflow_verification_version_idx ON workflow_verification USING btree (test_version_id);

-- recommended by the enterprise assessment (findings PF-12, PF-13): not in today's database
CREATE INDEX entry_value_entry_analyte_idx ON entry_value (entry_id, analyte_id) WHERE status = 'Active';
CREATE INDEX lab_order_site_status_idx ON lab_order (site_id, status);
CREATE INDEX requested_test_test_idx ON requested_test (test_id);
CREATE INDEX requested_test_status_due_idx ON requested_test (status, due_date);
CREATE INDEX test_result_batch_idx ON test_result (batch_id);
CREATE INDEX email_outbox_order_idx ON email_outbox (lab_order_id);
CREATE INDEX audit_log_changed_at_idx ON audit_log (changed_at);

-- ============================================================== table descriptions (owning feature)
COMMENT ON TABLE analyte IS 'Analytes, units, matrices and canned reasons';
COMMENT ON TABLE compliance_category IS 'Analytes, units, matrices and canned reasons';
COMMENT ON TABLE matrix IS 'Analytes, units, matrices and canned reasons';
COMMENT ON TABLE product_category IS 'Analytes, units, matrices and canned reasons';
COMMENT ON TABLE reason_code IS 'Analytes, units, matrices and canned reasons';
COMMENT ON TABLE unit_conversion IS 'Analytes, units, matrices and canned reasons';
COMMENT ON TABLE unit_of_measure IS 'Analytes, units, matrices and canned reasons';
COMMENT ON TABLE custody_document IS 'Chain of custody and receipt photos';
COMMENT ON TABLE custody_event IS 'Chain of custody and receipt photos';
COMMENT ON TABLE sample_photo IS 'Chain of custody and receipt photos';
COMMENT ON TABLE charge_item IS 'Charges, service lines and the test picker';
COMMENT ON TABLE client_service_line IS 'Charges, service lines and the test picker';
COMMENT ON TABLE order_charge IS 'Charges, service lines and the test picker';
COMMENT ON TABLE quoted_charge IS 'Charges, service lines and the test picker';
COMMENT ON TABLE service_line IS 'Charges, service lines and the test picker';
COMMENT ON TABLE service_line_type IS 'Charges, service lines and the test picker';
COMMENT ON TABLE client IS 'Clients, contacts and licenses';
COMMENT ON TABLE client_contact IS 'Clients, contacts and licenses';
COMMENT ON TABLE client_license IS 'Clients, contacts and licenses';
COMMENT ON TABLE contact IS 'Clients, contacts and licenses';
COMMENT ON TABLE contact_role IS 'Clients, contacts and licenses';
COMMENT ON TABLE dashboard_widget IS 'Dashboards, finance figures and the performance report';
COMMENT ON TABLE finance_plan IS 'Dashboards, finance figures and the performance report';
COMMENT ON TABLE finance_week IS 'Dashboards, finance figures and the performance report';
COMMENT ON TABLE group_widget IS 'Dashboards, finance figures and the performance report';
COMMENT ON TABLE standard_group_widget IS 'Dashboards, finance figures and the performance report';
COMMENT ON TABLE user_dashboard_layout IS 'Dashboards, finance figures and the performance report';
COMMENT ON TABLE equipment_flag_acceptance IS 'Electronic logbooks and sensors';
COMMENT ON TABLE logbook IS 'Electronic logbooks and sensors';
COMMENT ON TABLE logbook_entry IS 'Electronic logbooks and sensors';
COMMENT ON TABLE logbook_equipment IS 'Electronic logbooks and sensors';
COMMENT ON TABLE logbook_field IS 'Electronic logbooks and sensors';
COMMENT ON TABLE logbook_result_flag IS 'Electronic logbooks and sensors';
COMMENT ON TABLE logbook_result_use IS 'Electronic logbooks and sensors';
COMMENT ON TABLE logbook_review IS 'Electronic logbooks and sensors';
COMMENT ON TABLE logbook_version IS 'Electronic logbooks and sensors';
COMMENT ON TABLE sensor_connection IS 'Electronic logbooks and sensors';
COMMENT ON TABLE sensor_link IS 'Electronic logbooks and sensors';
COMMENT ON TABLE sensor_reading IS 'Electronic logbooks and sensors';
COMMENT ON TABLE sensor_sync_log IS 'Electronic logbooks and sensors';
COMMENT ON TABLE calibration IS 'Equipment';
COMMENT ON TABLE department IS 'Equipment';
COMMENT ON TABLE equipment IS 'Equipment';
COMMENT ON TABLE equipment_document IS 'Equipment';
COMMENT ON TABLE equipment_event IS 'Equipment';
COMMENT ON TABLE equipment_owner IS 'Equipment';
COMMENT ON TABLE equipment_tag IS 'Equipment';
COMMENT ON TABLE equipment_transfer IS 'Equipment';
COMMENT ON TABLE equipment_type IS 'Equipment';
COMMENT ON TABLE maintenance_schedule IS 'Equipment';
COMMENT ON TABLE qualification IS 'Equipment';
COMMENT ON TABLE chemical IS 'Inventory, mixtures and QA testing of lots';
COMMENT ON TABLE inventory_lot IS 'Inventory, mixtures and QA testing of lots';
COMMENT ON TABLE inventory_transaction IS 'Inventory, mixtures and QA testing of lots';
COMMENT ON TABLE lot_analyte IS 'Inventory, mixtures and QA testing of lots';
COMMENT ON TABLE lot_component IS 'Inventory, mixtures and QA testing of lots';
COMMENT ON TABLE media_qualification IS 'Inventory, mixtures and QA testing of lots';
COMMENT ON TABLE qa_testing_default IS 'Inventory, mixtures and QA testing of lots';
COMMENT ON TABLE storage_location IS 'Inventory, mixtures and QA testing of lots';
COMMENT ON TABLE supplier_coa IS 'Inventory, mixtures and QA testing of lots';
COMMENT ON TABLE threshold_rule IS 'Inventory, mixtures and QA testing of lots';
COMMENT ON TABLE accounting_connection IS 'Invoicing';
COMMENT ON TABLE accounting_customer IS 'Invoicing';
COMMENT ON TABLE accounting_push IS 'Invoicing';
COMMENT ON TABLE invoice IS 'Invoicing';
COMMENT ON TABLE invoice_correction IS 'Invoicing';
COMMENT ON TABLE invoice_counter IS 'Invoicing';
COMMENT ON TABLE invoice_line IS 'Invoicing';
COMMENT ON TABLE email_outbox IS 'Lab orders, samples and intake';
COMMENT ON TABLE lab_order IS 'Lab orders, samples and intake';
COMMENT ON TABLE ordered_package IS 'Lab orders, samples and intake';
COMMENT ON TABLE requested_analyte IS 'Lab orders, samples and intake';
COMMENT ON TABLE requested_test IS 'Lab orders, samples and intake';
COMMENT ON TABLE rush_decision IS 'Lab orders, samples and intake';
COMMENT ON TABLE sample IS 'Lab orders, samples and intake';
COMMENT ON TABLE site_day_counter IS 'Lab orders, samples and intake';
COMMENT ON TABLE lab_site IS 'Lab setup: sites, report templates, waste';
COMMENT ON TABLE report_template IS 'Lab setup: sites, report templates, waste';
COMMENT ON TABLE site_holiday IS 'Lab setup: sites, report templates, waste';
COMMENT ON TABLE site_media IS 'Lab setup: sites, report templates, waste';
COMMENT ON TABLE system_setting IS 'Lab setup: sites, report templates, waste';
COMMENT ON TABLE waste_classification IS 'Lab setup: sites, report templates, waste';
COMMENT ON TABLE oos_checklist_item IS 'OOS investigations';
COMMENT ON TABLE oos_client_response IS 'OOS investigations';
COMMENT ON TABLE oos_investigation IS 'OOS investigations';
COMMENT ON TABLE oos_procedure_setting IS 'OOS investigations';
COMMENT ON TABLE audit_log IS 'Platform: search, paging, audit trail, security';
COMMENT ON TABLE document_file IS 'Platform: search, paging, audit trail, security';
COMMENT ON TABLE purchase_line IS 'Purchasing and vendor approvals';
COMMENT ON TABLE purchase_order IS 'Purchasing and vendor approvals';
COMMENT ON TABLE purchase_receipt IS 'Purchasing and vendor approvals';
COMMENT ON TABLE purchasing_setting IS 'Purchasing and vendor approvals';
COMMENT ON TABLE supplier IS 'Purchasing and vendor approvals';
COMMENT ON TABLE supplier_risk_class IS 'Purchasing and vendor approvals';
COMMENT ON TABLE supply_scope IS 'Purchasing and vendor approvals';
COMMENT ON TABLE vendor_document IS 'Purchasing and vendor approvals';
COMMENT ON TABLE vendor_notice IS 'Purchasing and vendor approvals';
COMMENT ON TABLE vendor_promotion IS 'Purchasing and vendor approvals';
COMMENT ON TABLE vendor_qualification IS 'Purchasing and vendor approvals';
COMMENT ON TABLE project IS 'Quotes and projects';
COMMENT ON TABLE project_version IS 'Quotes and projects';
COMMENT ON TABLE quote_rush_term IS 'Quotes and projects';
COMMENT ON TABLE quoted_analyte_selection IS 'Quotes and projects';
COMMENT ON TABLE quoted_package IS 'Quotes and projects';
COMMENT ON TABLE quoted_test_configuration IS 'Quotes and projects';
COMMENT ON TABLE specification IS 'Quotes and projects';
COMMENT ON TABLE coa IS 'Report Finalization and the COA';
COMMENT ON TABLE coa_note IS 'Report Finalization and the COA';
COMMENT ON TABLE coa_version IS 'Report Finalization and the COA';
COMMENT ON TABLE email_template IS 'Report Finalization and the COA';
COMMENT ON TABLE finalization_claim IS 'Report Finalization and the COA';
COMMENT ON TABLE finalization_claim_test IS 'Report Finalization and the COA';
COMMENT ON TABLE result_finalization IS 'Report Finalization and the COA';
COMMENT ON TABLE sample_attachment IS 'Report Finalization and the COA';
COMMENT ON TABLE app_user IS 'Sign-in, people, groups and permissions';
COMMENT ON TABLE auth_event IS 'Sign-in, people, groups and permissions';
COMMENT ON TABLE group_member IS 'Sign-in, people, groups and permissions';
COMMENT ON TABLE group_permission IS 'Sign-in, people, groups and permissions';
COMMENT ON TABLE lab_group IS 'Sign-in, people, groups and permissions';
COMMENT ON TABLE permission IS 'Sign-in, people, groups and permissions';
COMMENT ON TABLE signature_event IS 'Sign-in, people, groups and permissions';
COMMENT ON TABLE standard_group_template IS 'Sign-in, people, groups and permissions';
COMMENT ON TABLE user_site_access IS 'Sign-in, people, groups and permissions';
COMMENT ON TABLE stability_amendment IS 'Stability studies';
COMMENT ON TABLE stability_cell IS 'Stability studies';
COMMENT ON TABLE stability_chamber IS 'Stability studies';
COMMENT ON TABLE stability_condition IS 'Stability studies';
COMMENT ON TABLE stability_excursion_assessment IS 'Stability studies';
COMMENT ON TABLE stability_plan IS 'Stability studies';
COMMENT ON TABLE stability_pull IS 'Stability studies';
COMMENT ON TABLE stability_rack IS 'Stability studies';
COMMENT ON TABLE stability_report IS 'Stability studies';
COMMENT ON TABLE stability_storage IS 'Stability studies';
COMMENT ON TABLE stability_study IS 'Stability studies';
COMMENT ON TABLE stability_timepoint IS 'Stability studies';
COMMENT ON TABLE stability_version_condition IS 'Stability studies';
COMMENT ON TABLE catalog_price_change IS 'Test catalogue, pricing and packages';
COMMENT ON TABLE rush_fee_schedule IS 'Test catalogue, pricing and packages';
COMMENT ON TABLE rush_fee_tier IS 'Test catalogue, pricing and packages';
COMMENT ON TABLE test IS 'Test catalogue, pricing and packages';
COMMENT ON TABLE test_analyte_price IS 'Test catalogue, pricing and packages';
COMMENT ON TABLE test_catalog_entry IS 'Test catalogue, pricing and packages';
COMMENT ON TABLE test_package IS 'Test catalogue, pricing and packages';
COMMENT ON TABLE test_package_analyte IS 'Test catalogue, pricing and packages';
COMMENT ON TABLE test_package_item IS 'Test catalogue, pricing and packages';
COMMENT ON TABLE test_rush_approval IS 'Test catalogue, pricing and packages';
COMMENT ON TABLE method IS 'Test workflow designer';
COMMENT ON TABLE qc_limit_type IS 'Test workflow designer';
COMMENT ON TABLE qc_type IS 'Test workflow designer';
COMMENT ON TABLE test_version IS 'Test workflow designer';
COMMENT ON TABLE test_version_analyte IS 'Test workflow designer';
COMMENT ON TABLE workflow_step IS 'Test workflow designer';
COMMENT ON TABLE workflow_step_dependency IS 'Test workflow designer';
COMMENT ON TABLE workflow_step_equipment IS 'Test workflow designer';
COMMENT ON TABLE analyst_pick IS 'Testing bench and QC Review';
COMMENT ON TABLE analytical_run IS 'Testing bench and QC Review';
COMMENT ON TABLE batch_entry IS 'Testing bench and QC Review';
COMMENT ON TABLE entry_equipment IS 'Testing bench and QC Review';
COMMENT ON TABLE entry_material IS 'Testing bench and QC Review';
COMMENT ON TABLE entry_value IS 'Testing bench and QC Review';
COMMENT ON TABLE incubation_load IS 'Testing bench and QC Review';
COMMENT ON TABLE load_acceptance IS 'Testing bench and QC Review';
COMMENT ON TABLE qc_acceptance IS 'Testing bench and QC Review';
COMMENT ON TABLE reanalysis_request IS 'Testing bench and QC Review';
COMMENT ON TABLE reprep_request IS 'Testing bench and QC Review';
COMMENT ON TABLE result_choice IS 'Testing bench and QC Review';
COMMENT ON TABLE review_step_mark IS 'Testing bench and QC Review';
COMMENT ON TABLE split_request IS 'Testing bench and QC Review';
COMMENT ON TABLE step_attachment IS 'Testing bench and QC Review';
COMMENT ON TABLE step_run IS 'Testing bench and QC Review';
COMMENT ON TABLE test_batch IS 'Testing bench and QC Review';
COMMENT ON TABLE test_result IS 'Testing bench and QC Review';
COMMENT ON TABLE analyst_qualification IS 'Training and competency';
COMMENT ON TABLE competency_attempt IS 'Training and competency';
COMMENT ON TABLE competency_evidence IS 'Training and competency';
COMMENT ON TABLE training_rule IS 'Training and competency';
COMMENT ON TABLE trend_chart IS 'Trending and control charts';
COMMENT ON TABLE trend_signal_review IS 'Trending and control charts';
COMMENT ON TABLE verification_check IS 'Workflow verification';
COMMENT ON TABLE verification_evidence IS 'Workflow verification';
COMMENT ON TABLE verification_requirement IS 'Workflow verification';
COMMENT ON TABLE workflow_verification IS 'Workflow verification';
