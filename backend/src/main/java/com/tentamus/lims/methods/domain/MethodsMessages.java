package com.tentamus.lims.methods.domain;

import com.tentamus.lims.core.web.ConstraintMessages;

/** Readable messages for the Workflow Designer's database checks (the Node backend's routes_methods.js MESSAGES). */
public final class MethodsMessages {
    public static final ConstraintMessages MESSAGES = new ConstraintMessages(
        "test_name_uq", "This lab already has a test with that name.",
        "method_name_uq", "This lab already has a method with that name.",
        "tva_uq", "That analyte is already on this version.",
        "tva_lod_le_loq", "The LOD cannot be above the LOQ.",
        "tva_spec_order", "The suggested minimum cannot be above the maximum.",
        "tva_rounding_pair", "Choose both the rounding (significant figures or decimal places) and the number of digits, or neither.",
        "tva_sig_figs", "Use at least 1 significant figure.",
        "test_version_sig_figs", "Use at least 1 significant figure.",
        "workflow_step_key_uq", "Another step in this version already uses that key.",
        "workflow_step_step_key_check", "The step key is a short lower-case word (letters, numbers, _), used in formulas like {weigh.weight}.",
        "workflow_step_dependency_uq", "That dependency is already there.",
        "step_not_own_dependency", "A step cannot come after itself.",
        "specification_has_limit", "Give each limit a minimum, a maximum or a text (e.g. Absent); leave the row empty for unspecified.",
        "specification_order", "The minimum cannot be above the maximum.",
        "specification_line_uq", "That analyte already has a specification here.",
        "specification_rt_uq", "That analyte already has a specification here.");

    private MethodsMessages() {}
}
