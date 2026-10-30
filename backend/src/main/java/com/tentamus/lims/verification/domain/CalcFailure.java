package com.tentamus.lims.verification.domain;

import com.tentamus.lims.core.web.RuleException;

/** Why the independent calculation could not give a value (its message is shown in the protocol and the checks). */
public class CalcFailure extends RuleException {
    public CalcFailure(String message) { super(message); }
}
