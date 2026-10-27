package com.tentamus.lims.inventory.domain;

import com.tentamus.lims.core.web.ApiExceptionHandler;
import com.tentamus.lims.core.web.RuleException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;

/** Readable messages for the inventory database checks, matched on the constraint's name (the Node backend's translate()). */
public final class InventoryMessages {
    private static final Map<String, String> MESSAGES = new LinkedHashMap<>();
    static {
        MESSAGES.put("inventory_lot_unit_check", "Pick a unit from the list (g, mg, µg, kg, mL, L, µL, each, pack, box, vial, bottle, plate, tube, ampoule).");
        MESSAGES.put("inventory_lot_chemical_types_check", "Pick at least one Chemical Type.");
        MESSAGES.put("inventory_lot_purity_pct_check", "Purity must be above 0 and at most 100%.");
        MESSAGES.put("chemical_cas_number_check", "CAS Number is not valid (format or check digit).");
        MESSAGES.put("chemical_name_uq", "That chemical is already on the list (names are unique, ignoring capitals).");
        MESSAGES.put("chemical_cas_uq", "Another chemical already has that CAS Number.");
        MESSAGES.put("supplier_name_uq", "That supplier is already on the list.");
        MESSAGES.put("storage_location_code_uq", "That location code is already used in this lab.");
        MESSAGES.put("threshold_rule_type_fits", "That rule type does not fit what it watches: quantities use Percentage of Base or Absolute Max-Min; expiry uses Days Until/Since.");
        MESSAGES.put("threshold_rule_chemical_fits", "Only stock (Lot Quantity) rules can be limited to one chemical.");
        MESSAGES.put("threshold_rule_pct", "A percentage cannot be more than 100.");
        MESSAGES.put("inventory_transaction_quantity_change_check", "Enter a quantity other than zero.");
        MESSAGES.put("lot_component_quantity_used_check", "Enter how much of each component was used.");
        MESSAGES.put("inventory_lot_cas_number_check", "CAS Number is not valid (format or check digit).");
        MESSAGES.put("inventory_lot_physical_form_check", "Solid or liquid: pick Solid or Liquid.");
        MESSAGES.put("unit_code_uq", "That unit code is already on the Units list (codes are unique, ignoring capitals).");
        MESSAGES.put("unit_conversion_uq", "That conversion is already on the list (set the old one Inactive first).");
        MESSAGES.put("unit_conversion_not_self", "A unit cannot be converted to itself.");
        MESSAGES.put("unit_conversion_factor_check", "The factor must be more than 0.");
        MESSAGES.put("lot_analyte_lot_id_analyte_id_key", "That analyte is already on this item (each analyte once).");
        MESSAGES.put("lot_analyte_tolerance_pct_check", "Tolerance cannot be negative.");
        MESSAGES.put("inventory_lot_item_url_check", "The web link must be a full web address starting with http:// or https://.");
        MESSAGES.put("media_qualification_one_live", "That lot is already released, or in QA testing, for that use.");
    }

    private InventoryMessages() {}

    /** The readable message for a database refusal of one of these checks, keeping its SQL state; anything else unchanged. */
    public static Exception translate(Exception e) {
        String own = own(e);
        if (own == null) return e;
        return RuleException.withCode(own, ApiExceptionHandler.find(e).getServerErrorMessage().getSQLState());
    }

    /** "Row 3 (INV-000012): <message>", as the Node backend words a refused row of an Excel upload. */
    public static RuleException forRow(Exception e, Object row, Object key) {
        String prefix = "Row " + row + " (" + key + "): ";
        PSQLException pg = ApiExceptionHandler.find(e);
        if (pg == null || pg.getServerErrorMessage() == null) return RuleException.withCode(prefix + e.getMessage(), e instanceof RuleException r ? r.code() : null);
        ServerErrorMessage m = pg.getServerErrorMessage();
        String own = own(e);
        return RuleException.withCode(own != null ? prefix + own : ApiExceptionHandler.friendly(prefix + m.getMessage(), m.getDetail()), m.getSQLState());
    }

    private static String own(Exception e) {
        PSQLException pg = ApiExceptionHandler.find(e);
        if (pg == null || pg.getServerErrorMessage() == null || pg.getServerErrorMessage().getMessage() == null) return null;
        String m = pg.getServerErrorMessage().getMessage();
        for (Map.Entry<String, String> x : MESSAGES.entrySet()) if (m.contains("\"" + x.getKey() + "\"")) return x.getValue();
        return null;
    }
}
