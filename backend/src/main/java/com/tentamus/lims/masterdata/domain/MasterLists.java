package com.tentamus.lims.masterdata.domain;

import java.util.List;

/** The master data lists, their editable fields and the domain record that checks each saved row. */
public final class MasterLists {
    private MasterLists() {}

    public static final ControlledList MATRICES = ControlledList.of("matrix", "SELECT * FROM matrix ORDER BY lower(matrix_name)",
        List.of("matrix_name", "description", "product_category_id", "status")).checkedBy(Matrix::new).keptBy("master.matrices");

    public static final ControlledList PRODUCT_CATEGORIES = ControlledList.of("product_category",
        "SELECT * FROM product_category ORDER BY sort_order, lower(category_name)", List.of("category_name", "description", "sort_order", "status")).checkedBy(Category::new).keptBy("master.matrices");

    public static final ControlledList COMPLIANCE_CATEGORIES = ControlledList.of("compliance_category",
        "SELECT * FROM compliance_category ORDER BY sort_order, category_name", List.of("category_name", "is_gmp", "description", "sort_order", "status")).checkedBy(Category::new).keptBy("master.compliance");

    /** Molar mass changes are signed (the screen sends a signature then); other analyte changes are not. */
    public static final ControlledList ANALYTES = ControlledList.of("analyte", "SELECT * FROM analyte ORDER BY analyte_class, analyte_name",
        List.of("analyte_name", "report_name", "analyte_class", "cas_number", "synonyms", "status", "molar_mass", "molar_mass_source")).checkedBy(Analyte::new);

    public static final ControlledList UNITS = ControlledList.of("unit_of_measure", """
        SELECT u.*, (SELECT count(*) FROM unit_conversion x WHERE (x.from_unit_id = u.id OR x.to_unit_id = u.id) AND x.status = 'Active') AS conversion_count,
          (SELECT count(*) FROM inventory_lot l WHERE l.unit = u.unit_code OR l.concentration_unit = u.unit_code) AS used_count
          FROM unit_of_measure u ORDER BY u.sort_order, u.unit_code""",
        List.of("unit_code", "unit_name", "dimension", "sort_order", "is_serving_unit", "status")).signedAs("Changed by", "Units list", "Admin").checkedBy(Unit::new);

    public static final ControlledList UNIT_CONVERSIONS = ControlledList.of("unit_conversion", """
        SELECT x.*, f.unit_code AS from_code, t.unit_code AS to_code, f.dimension AS from_dimension FROM unit_conversion x
          JOIN unit_of_measure f ON f.id = x.from_unit_id JOIN unit_of_measure t ON t.id = x.to_unit_id ORDER BY f.sort_order, f.unit_code, t.unit_code""",
        List.of("from_unit_id", "to_unit_id", "factor", "applies_to", "assumption", "status")).signedAs("Changed by", "Unit conversions list", "Admin").checkedBy(UnitConversion::new);

    public static final ControlledList SITES = ControlledList.of("lab_site", """
        SELECT s.*, (SELECT count(*) FROM site_holiday h WHERE h.site_id = s.id AND h.status = 'Active') AS holiday_count
          FROM lab_site s ORDER BY site_code""",
        List.of("site_code", "site_name", "time_zone", "address", "default_oos_procedure", "require_workflow_verification", "subcontract_discount_pct",
            "subcontract_markup_pct", "accreditation_body", "accreditation_certificate", "accreditation_statement", "stability_pull_window_days",
            "stability_reserve_pct", "custody_signature_required", "require_training", "status")).checkedBy(LabSite::new);

    public static final ControlledList HOLIDAYS = ControlledList.of("site_holiday", "SELECT * FROM site_holiday WHERE site_id = ? ORDER BY holiday_date",
        List.of("holiday_date", "description", "status")).keptAtLabBy("admin.lab");
}
