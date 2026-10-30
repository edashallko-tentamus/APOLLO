package com.tentamus.lims.purchasing.repo;

import com.tentamus.lims.core.db.Db;
import org.springframework.stereotype.Repository;

/**
 * The database checks that stay there for every feature (permissions, signatures, the reason recorded), called by
 * purchasing's steps so their refusals keep the database's own words.
 */
@Repository
public class DatabaseChecks {
    public void requirePermission(Db d, String code, String site) { d.one("SELECT require_permission_at(?, ?::uuid)", code, site); }

    public boolean hasPermission(Db d, String code, String site) {
        return Boolean.TRUE.equals(d.one("SELECT has_permission_at(?, ?::uuid) AS ok", code, site).get("ok"));
    }

    /** Held through an all-labs group (or a system administrator). */
    public boolean corporate(Db d) {
        return Boolean.TRUE.equals(d.one("SELECT has_corporate_permission('purchasing.qualify_corporate') AS ok").get("ok"));
    }

    public void assertSigned(Db d, String what) { d.one("SELECT assert_signed(?)", what); }

    public void ensureReason(Db d, String reason) { d.one("SELECT ensure_reason(?)", reason); }
}
