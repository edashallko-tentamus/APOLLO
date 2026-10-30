package com.tentamus.lims.purchasing.domain;

import com.tentamus.lims.core.web.ConstraintMessages;

/**
 * Readable messages for the purchasing database checks that remain (the Node backend's routes_purchasing.js MESSAGES).
 * The checks migration 065 dropped are Java's own refusals now, with the same words.
 */
public final class PurchasingMessages {
    public static final ConstraintMessages MESSAGES = new ConstraintMessages(
        "purchase_line_quantity_check", "Enter a quantity above zero.",
        "purchase_line_unit_price_check", "The price cannot be negative.",
        "purchase_line_description_check", "Describe what is to be bought.",
        "supplier_risk_class_uq", "That risk class name is already used.",
        "purchase_line_item_url_check", "The web link must be a full web address starting with http:// or https://.");

    private PurchasingMessages() {}
}
