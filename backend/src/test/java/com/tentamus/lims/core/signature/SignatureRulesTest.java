package com.tentamus.lims.core.signature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.tentamus.lims.masterdata.domain.ControlledList;
import com.tentamus.lims.masterdata.domain.MasterLists;
import org.junit.jupiter.api.Test;

/**
 * The "refuse a change without a signature in this transaction" triggers dropped in migration 072 (require_signature on
 * units, unit conversions, storage locations and warning rules; sample storage; require_methods_signature on the
 * designer's tables): Java writes those tables only inside SignatureService.signed (the designer's design(), the inventory
 * lists, the Excel upload). These checks pin what the lists declare; the signing itself is SignatureService's.
 */
class SignatureRulesTest {
    @Test
    void theUnitListsAreSavedSigned() {
        assertEquals(new ControlledList.Signing("Changed by", "Units list", "Admin"), MasterLists.UNITS.signing());
        assertEquals(new ControlledList.Signing("Changed by", "Unit conversions list", "Admin"), MasterLists.UNIT_CONVERSIONS.signing());
    }

    @Test
    void listsThatWereNeverSignedStayUnsigned() {
        assertNull(MasterLists.MATRICES.signing());
        assertNull(MasterLists.HOLIDAYS.signing());
    }
}
