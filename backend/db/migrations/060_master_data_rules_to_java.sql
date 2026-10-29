-- 060: the master data rules move to the Java backend (Edashall Konah, 2026-10-28; the database keeps structures only).
-- Java now checks them before every write: masterdata/domain (Analyte, CasNumber, LabSite, Matrix, Category, Unit,
-- UnitConversion, UnitGraph) and admin/domain (ReasonCode), run by masterdata/service/ControlledListService for every
-- grid row, with JUnit tests in MasterDataRulesTest and ReasonCodeRulesTest. What stays here:
--   * keys and references: the unique analyte, matrix, category, unit and reason names (ignoring capitals), one active
--     conversion per pair and form, one active holiday per lab and day, NOT NULL (report_name_present included);
--   * the GxP backstop on every table and the permission triggers (a01_permission, a_admin_only, a_maintainer);
--   * analyte_molar_mass_rules, now only who may change a molar mass and its signature (the source rule moved);
--   * is_valid_cas: kept, still called by the inventory checks on inventory_lot and chemical;
--   * unit_factor, convertible_units, canonical_unit, quantity_dims, concentration_dims: kept, still called by
--     inventory, testing, serving and logbook database code (Java has its own copy in UnitGraph);
--   * the triggers on lab_site that make other modules' per-lab rows (purchasing, invoicing, dashboards, QA testing,
--     sensors, training, the creator's access): kept, they belong to those modules and are tested by their rule tests.
-- contact_role and site_holiday had no rule triggers or checks. Sandbox only: other writers of these tables (data load
-- scripts, the Excel upload of units and conversions in inventory/bulk) are no longer checked by the database.
-- Later migrations must not DROP reason_code_module_check: it is gone (a new module goes in ReasonCode.MODULES).

-- analyte: the name, report name, CAS and molar mass checks, and the report name default
DROP TRIGGER IF EXISTS a_analyte_default_report_name ON analyte;
DROP FUNCTION IF EXISTS analyte_default_report_name();
ALTER TABLE analyte DROP CONSTRAINT IF EXISTS analyte_analyte_name_check;
ALTER TABLE analyte DROP CONSTRAINT IF EXISTS analyte_report_name_check;
ALTER TABLE analyte DROP CONSTRAINT IF EXISTS analyte_cas_number_check;
ALTER TABLE analyte DROP CONSTRAINT IF EXISTS cas_only_for_chemicals;
ALTER TABLE analyte DROP CONSTRAINT IF EXISTS analyte_molar_mass_check;
CREATE OR REPLACE FUNCTION analyte_molar_mass_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.molar_mass IS NULL AND NEW.molar_mass_source IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND (NEW.molar_mass, NEW.molar_mass_source) IS NOT DISTINCT FROM (OLD.molar_mass, OLD.molar_mass_source) THEN RETURN NEW; END IF;
    IF NOT has_permission('master.molar_mass') THEN
        RAISE EXCEPTION 'You do not have permission to change a molar mass (master.molar_mass). Ask your lab administrator.';
    END IF;
    PERFORM assert_signed('change a molar mass');
    RETURN NEW;
END $$;

-- lab_site: the time zone, the code format and the setting ranges
DROP TRIGGER IF EXISTS a_lab_site_check_tz ON lab_site;
DROP FUNCTION IF EXISTS lab_site_check_tz();
ALTER TABLE lab_site DROP CONSTRAINT IF EXISTS lab_site_site_code_check;
ALTER TABLE lab_site DROP CONSTRAINT IF EXISTS lab_site_subcontract_discount_pct_check;
ALTER TABLE lab_site DROP CONSTRAINT IF EXISTS lab_site_subcontract_markup_pct_check;
ALTER TABLE lab_site DROP CONSTRAINT IF EXISTS lab_site_stability_pull_window_days_check;
ALTER TABLE lab_site DROP CONSTRAINT IF EXISTS lab_site_stability_reserve_pct_check;

-- matrix, product and compliance categories: the names, and a matrix in use keeps its name
DROP TRIGGER IF EXISTS a_matrix_rules ON matrix;
DROP FUNCTION IF EXISTS matrix_rules();
ALTER TABLE matrix DROP CONSTRAINT IF EXISTS matrix_matrix_name_check;
ALTER TABLE product_category DROP CONSTRAINT IF EXISTS product_category_category_name_check;
ALTER TABLE compliance_category DROP CONSTRAINT IF EXISTS compliance_category_category_name_check;

-- units: the code and name, a unit in use keeps its code, a unit with conversions keeps its dimension
DROP TRIGGER IF EXISTS a0_rules ON unit_of_measure;
DROP FUNCTION IF EXISTS unit_rules();
ALTER TABLE unit_of_measure DROP CONSTRAINT IF EXISTS unit_of_measure_unit_code_check;
ALTER TABLE unit_of_measure DROP CONSTRAINT IF EXISTS unit_of_measure_unit_name_check;

-- unit conversions: the dimensions joined, ppm-type for liquids or solids, the factor, the form, not to itself
DROP TRIGGER IF EXISTS a0_rules ON unit_conversion;
DROP FUNCTION IF EXISTS unit_conversion_rules();
ALTER TABLE unit_conversion DROP CONSTRAINT IF EXISTS unit_conversion_factor_check;
ALTER TABLE unit_conversion DROP CONSTRAINT IF EXISTS unit_conversion_applies_to_check;
ALTER TABLE unit_conversion DROP CONSTRAINT IF EXISTS unit_conversion_not_self;

-- canned reasons: a known module, a reason text
ALTER TABLE reason_code DROP CONSTRAINT IF EXISTS reason_code_module_check;
ALTER TABLE reason_code DROP CONSTRAINT IF EXISTS reason_code_reason_text_check;
