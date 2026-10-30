package com.tentamus.lims.inventory.domain;

import com.tentamus.lims.core.web.ConstraintMessages;
import com.tentamus.lims.core.web.RuleException;

/** Readable messages for the inventory database checks (the Node backend's routes_inventory.js MESSAGES). */
public final class InventoryMessages {
    public static final ConstraintMessages MESSAGES = new ConstraintMessages(
        "inventory_lot_unit_check", "Pick a unit from the list (g, mg, µg, kg, mL, L, µL, each, pack, box, vial, bottle, plate, tube, ampoule).",
        "inventory_lot_chemical_types_check", "Pick at least one Chemical Type.",
        "inventory_lot_purity_pct_check", "Purity must be above 0 and at most 100%.",
        "chemical_cas_number_check", "CAS Number is not valid (format or check digit).",
        "chemical_name_uq", "That chemical is already on the list (names are unique, ignoring capitals).",
        "chemical_cas_uq", "Another chemical already has that CAS Number.",
        "supplier_name_uq", "That supplier is already on the list.",
        "storage_location_code_uq", "That location code is already used in this lab.",
        "threshold_rule_type_fits", "That rule type does not fit what it watches: quantities use Percentage of Base or Absolute Max-Min; expiry uses Days Until/Since.",
        "threshold_rule_chemical_fits", "Only stock (Lot Quantity) rules can be limited to one chemical.",
        "threshold_rule_pct", "A percentage cannot be more than 100.",
        "inventory_transaction_quantity_change_check", "Enter a quantity other than zero.",
        "lot_component_quantity_used_check", "Enter how much of each component was used.",
        "inventory_lot_cas_number_check", "CAS Number is not valid (format or check digit).",
        "inventory_lot_physical_form_check", "Solid or liquid: pick Solid or Liquid.",
        "unit_code_uq", "That unit code is already on the Units list (codes are unique, ignoring capitals).",
        "unit_conversion_uq", "That conversion is already on the list (set the old one Inactive first).",
        "unit_conversion_not_self", "A unit cannot be converted to itself.",
        "unit_conversion_factor_check", "The factor must be more than 0.",
        "lot_analyte_lot_id_analyte_id_key", "That analyte is already on this item (each analyte once).",
        "lot_analyte_tolerance_pct_check", "Tolerance cannot be negative.",
        "inventory_lot_item_url_check", "The web link must be a full web address starting with http:// or https://.",
        "media_qualification_one_live", "That lot is already released, or in QA testing, for that use.");

    private InventoryMessages() {}

    public static Exception translate(Exception e) { return MESSAGES.translate(e); }

    /** "Row 3 (INV-000012): <message>", as the Node backend words a refused row of an Excel upload. */
    public static RuleException forRow(Exception e, Object row, Object key) { return MESSAGES.withPrefix(e, "Row " + row + " (" + key + "): "); }
}
