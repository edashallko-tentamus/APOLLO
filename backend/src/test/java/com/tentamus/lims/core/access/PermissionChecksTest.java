package com.tentamus.lims.core.access;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.masterdata.domain.MasterLists;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * The permission checks that replaced the database's permission triggers in migration 072 (require_permission_at,
 * require_list_permission, the system-administrator-only rules): who passes, and the database's own refusal text.
 * Ported from the permission checks of the SQL rule tests (test_008, test_025, test_027, test_032, test_037, test_045...).
 */
class PermissionChecksTest {
    private static final String CFL = "11111111-1111-1111-1111-111111111111", TPS = "22222222-2222-2222-2222-222222222222";

    /** A policy over fixed people (no database): a permission's description is "do the thing". */
    private static AccessPolicy policy(UserAccess who) {
        Db db = new Db(null, null) {
            @Override public Map<String, Object> one(String sql, Object... params) { return Map.of("d", "do the thing"); }
        };
        return new AccessPolicy(db) { @Override public UserAccess load(String userId) { return who; } };
    }

    private static UserAccess person(boolean admin, UserAccess.Grant... grants) {
        return new UserAccess("u1", admin, List.of(grants), Set.of(CFL));
    }

    private static RequestContext at(String site) { return new RequestContext("u1", site, site, "", null); }

    private static String refusal(Runnable r) { return assertThrows(RuleException.class, r::run).getMessage(); }

    @Test
    void aPermissionAtTheRecordsLab() {
        AccessPolicy p = policy(person(false, new UserAccess.Grant(CFL, "trending.manage")));
        assertDoesNotThrow(() -> p.requireAt(at(TPS), "trending.manage", CFL));   // the record's lab counts, not the lab worked in
        assertEquals("You do not have permission to do this: do the thing (trending.manage). Ask your lab administrator to add you to a group that has it.",
            refusal(() -> p.requireAt(at(CFL), "trending.manage", TPS)));
        assertEquals("P0001", assertThrows(RuleException.class, () -> p.requireAt(at(CFL), "x.y", TPS)).code());
    }

    @Test
    void anAllLabsGroupAndASystemAdministratorPassEverywhere() {
        assertDoesNotThrow(() -> policy(person(false, new UserAccess.Grant(null, "finance.enter"))).requireAt(at(CFL), "finance.enter", TPS));
        assertDoesNotThrow(() -> policy(person(true)).requireAt(at(CFL), "stability.configure", TPS));
    }

    @Test
    void aSharedListNeedsThePermissionInTheLabWorkedIn() {
        AccessPolicy p = policy(person(false, new UserAccess.Grant(CFL, "master.matrices")));
        assertDoesNotThrow(() -> p.requireToChange(at(CFL), "matrix", "master.matrices"));
        assertEquals("You do not have permission to change product category: do the thing (master.matrices). Ask your lab administrator.",
            refusal(() -> p.requireToChange(at(TPS), "product_category", "master.matrices")));
    }

    @Test
    void everyLabRecordsAreTheSystemAdministrators() {
        AccessPolicy p = policy(person(false, new UserAccess.Grant(CFL, "catalog.edit")));
        assertEquals("Charges for every lab are kept by system administrators; choose your lab",
            refusal(() -> p.requireSystemAdmin(at(CFL), "Charges for every lab are kept by system administrators; choose your lab")));
        assertEquals("Only a system administrator can do this.", refusal(() -> p.requireSystemAdmin(at(CFL))));
        assertDoesNotThrow(() -> policy(person(true)).requireSystemAdmin(at(CFL), "x"));
    }

    @Test
    void aGridSaveIsCheckedOnlyWhenItWritesSomething() {
        RecordWriter w = new RecordWriter("matrix", List.of("matrix_name", "status"));
        assertFalse(w.writesAny(List.of(Map.of("id", "a", "other", 1))));   // an update of no listed column writes nothing
        assertTrue(w.writesAny(List.of(Map.of("id", "a", "status", "Inactive"))));
        assertTrue(w.writesAny(List.of(Map.of("matrix_name", "Gummy"))));   // an insert
        assertFalse(w.writesAny(List.of()));
    }

    @Test
    void theMasterListsSayWhoKeepsThem() {
        assertEquals("master.matrices", MasterLists.MATRICES.keeper().permission());
        assertEquals("master.matrices", MasterLists.PRODUCT_CATEGORIES.keeper().permission());
        assertEquals("master.compliance", MasterLists.COMPLIANCE_CATEGORIES.keeper().permission());
        assertTrue(MasterLists.HOLIDAYS.keeper().atLab());
        assertEquals("admin.lab", MasterLists.HOLIDAYS.keeper().permission());
    }
}
