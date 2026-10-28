package com.tentamus.lims.purchasing.domain;

import com.tentamus.lims.core.web.ConstraintMessages;

/** Readable messages for the purchasing database checks (the Node backend's routes_purchasing.js MESSAGES). */
public final class PurchasingMessages {
    public static final ConstraintMessages MESSAGES = new ConstraintMessages(
        "purchase_receipt_note", "Describe the problem with the delivery (what was damaged, how warm it arrived, what was missing).",
        "purchase_line_quantity_check", "Enter a quantity above zero.",
        "purchase_line_unit_price_check", "The price cannot be negative.",
        "purchase_line_description_check", "Describe what is to be bought.",
        "vendor_qualification_dates", "The expiry cannot be before the approval date.",
        "supplier_risk_class_uq", "That risk class name is already used.",
        "supplier_risk_class_requal_months_check", "Re-qualify every 1 month or more.",
        "purchasing_setting_second_approval_over_check", "The amount cannot be negative.",
        "purchase_line_item_url_check", "The web link must be a full web address starting with http:// or https://.",
        "purchase_receipt_actual_unit_price_check", "The actual price cannot be negative.");

    private PurchasingMessages() {}
}
