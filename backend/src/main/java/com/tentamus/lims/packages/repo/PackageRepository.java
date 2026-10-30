package com.tentamus.lims.packages.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.packages.domain.PriceChange;
import com.tentamus.lims.pricing.domain.Amount;
import com.tentamus.lims.pricing.domain.PriceAdjustment;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Repository;

/** Reads what the package rules need (tests, lines, quoted packages, price changes) and writes their results. */
@Repository
public class PackageRepository {

    /** A test as the package rules see it: its lab, name, pricing mode, and whether it is active and priced. */
    public Map<String, Object> test(Db d, Object testId) {
        return d.one("""
            SELECT t.id, t.site_id, t.test_name, e.pricing_mode::text AS pricing_mode, (t.status = 'Active' AND e.id IS NOT NULL) AS priced
              FROM test t LEFT JOIN test_catalog_entry e ON e.test_id = t.id WHERE t.id = ?::uuid""", testId);
    }

    /** A package line with its package's lab and its test. */
    public Map<String, Object> item(Db d, Object itemId, Object packageId) {
        return d.one("""
            SELECT i.id, i.test_id, i.status::text AS status, p.site_id FROM test_package_item i JOIN test_package p ON p.id = i.package_id
             WHERE i.id = ?::uuid AND i.package_id = ?::uuid""", itemId, packageId);
    }

    public boolean analytePricedOnTest(Db d, Object testId, Object analyteId) {
        return d.one("""
            SELECT 1 AS x FROM test_analyte_price ap JOIN test_catalog_entry e ON e.id = ap.catalog_entry_id
             WHERE e.test_id = ?::uuid AND ap.analyte_id = ?::uuid AND ap.status = 'Active'""", testId, analyteId) != null;
    }

    public Map<String, Object> packageRow(Db d, Object packageId) {
        return d.one("""
            SELECT p.id, p.package_code, p.package_name, p.status::text AS status, p.site_id, ls.site_code FROM test_package p
              JOIN lab_site ls ON ls.id = p.site_id WHERE p.id = ?::uuid""", packageId);
    }

    public List<String> errors(Db d, Object packageId) {
        return d.rows("SELECT problem FROM test_package_problems(?::uuid) WHERE severity = 'Error'", packageId).stream().map(r -> (String) r.get("problem")).toList();
    }

    /** The package's tests with their shares and the analytes in each (read from test_package_lines). */
    public List<Map<String, Object>> lines(Db d, Object packageId) {
        return d.rows("SELECT test_id, pricing_mode, analytes, share FROM test_package_lines(?::uuid) ORDER BY sort_order, test_name", packageId);
    }

    public String siteCode(Db d, Object siteId) {
        Map<String, Object> r = siteId == null ? null : d.one("SELECT site_code FROM lab_site WHERE id = ?::uuid", siteId);
        return r == null ? null : (String) r.get("site_code");
    }

    public boolean onVersion(Db d, Object versionId, Object packageId) {
        return d.one("SELECT 1 AS x FROM quoted_package WHERE project_version_id = ?::uuid AND package_id = ?::uuid AND status = 'Active'", versionId, packageId) != null;
    }

    /** Puts the package on the version: the quoted package, then each test at its share with the package's analytes. */
    public String addToVersion(Db d, Object versionId, Map<String, Object> pkg, int quantity, List<Map<String, Object>> lines) {
        BigDecimal price = BigDecimal.ZERO;
        for (Map<String, Object> l : lines) price = price.add(Amount.of(l.get("share")));
        String qp = (String) d.one("""
            INSERT INTO quoted_package (project_version_id, package_id, package_code, package_name, quantity, package_price)
            VALUES (?::uuid, ?::uuid, ?, ?, ?, ?) RETURNING id""", versionId, pkg.get("id"), pkg.get("package_code"), pkg.get("package_name"), quantity, price).get("id");
        for (Map<String, Object> l : lines) {
            Object line = d.one("INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, quoted_package_id) VALUES (?::uuid, ?::uuid, ?, ?::uuid) RETURNING id",
                versionId, l.get("test_id"), quantity, qp).get("id");
            if ("Analyte Selection".equals(l.get("pricing_mode")))
                d.update("UPDATE quoted_analyte_selection SET included = false WHERE line_id = ?::uuid AND NOT (analyte_id = ANY (?::uuid[]))", line, l.get("analytes"));
            d.update("UPDATE quoted_test_configuration SET final_price = ? WHERE id = ?::uuid", l.get("share"), line);
        }
        d.update("""
            UPDATE quoted_package qp SET list_price = (SELECT COALESCE(sum(list_price), 0) FROM quoted_test_configuration q WHERE q.quoted_package_id = qp.id AND q.status = 'Active')
             WHERE qp.id = ?::uuid""", qp);
        return qp;
    }

    /** A quoted package with its version id; null when it is not on a quote. */
    public Map<String, Object> quoted(Db d, Object quotedPackageId) {
        return d.one("SELECT id, project_version_id, package_price, status::text AS status FROM quoted_package WHERE id = ?::uuid", quotedPackageId);
    }

    public List<Map<String, Object>> quotedLines(Db d, Object quotedPackageId) {
        return d.rows("""
            SELECT q.id, q.final_price FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id
             WHERE q.quoted_package_id = ?::uuid AND q.status = 'Active' ORDER BY q.created_at, t.test_name""", quotedPackageId);
    }

    public void setQuoted(Db d, Object quotedPackageId, BigDecimal price, Long quantity, List<BigDecimal> shares) {
        d.update("UPDATE quoted_package SET package_price = COALESCE(?::numeric, package_price), quantity = COALESCE(?::int, quantity) WHERE id = ?::uuid", price, quantity, quotedPackageId);
        if (quantity != null) d.update("UPDATE quoted_test_configuration SET quantity = ? WHERE quoted_package_id = ?::uuid AND status = 'Active'", quantity, quotedPackageId);
        if (shares != null) {
            List<Map<String, Object>> lines = quotedLines(d, quotedPackageId);
            for (int i = 0; i < lines.size(); i++) d.update("UPDATE quoted_test_configuration SET final_price = ? WHERE id = ?::uuid", shares.get(i), lines.get(i).get("id"));
        }
    }

    public void removeQuoted(Db d, Object quotedPackageId) {
        d.update("UPDATE quoted_test_configuration SET status = 'Removed' WHERE quoted_package_id = ?::uuid AND status = 'Active'", quotedPackageId);
        d.update("UPDATE quoted_package SET status = 'Removed' WHERE id = ?::uuid", quotedPackageId);
    }

    // ---------------------------------------------------------------- dated price changes
    public boolean allOwnLab(Db d, List<?> tests, String siteId) {
        return tests == null || d.one("SELECT 1 AS x FROM test t WHERE t.id = ANY (?::uuid[]) AND t.site_id IS DISTINCT FROM ?::uuid", tests, siteId) == null;
    }

    @SuppressWarnings("unchecked")
    public PriceChange priceChange(Db d, Object id) {
        Map<String, Object> r = d.one("""
            SELECT id, change_code, site_id, tests, pct, rounding, include_packages, effective_on::text AS effective_on, status, reason
              FROM catalog_price_change WHERE id = ?::uuid""", id);
        if (r == null) return null;
        return new PriceChange((String) r.get("id"), (String) r.get("change_code"), (String) r.get("site_id"), (List<String>) r.get("tests"),
            Amount.of(r.get("pct")), (String) r.get("rounding"), Boolean.TRUE.equals(r.get("include_packages")), LocalDate.parse((String) r.get("effective_on")),
            (String) r.get("status"), (String) r.get("reason"));
    }

    /** Moves the change's tests' prices in every active package of the lab; returns how many packages were touched. */
    public int repricePackages(Db d, PriceChange c, PriceAdjustment a) {
        Set<Object> touched = new HashSet<>();
        for (Map<String, Object> i : d.rows("""
            SELECT i.id, i.package_id, i.component_price FROM test_package_item i JOIN test_package p ON p.id = i.package_id
             WHERE i.status = 'Active' AND p.status = 'Active' AND p.site_id = ?::uuid AND (?::uuid[] IS NULL OR i.test_id = ANY (?::uuid[]))""",
            c.siteId(), c.tests(), c.tests())) {
            d.update("UPDATE test_package_item SET component_price = ? WHERE id = ?::uuid", a.apply(Amount.of(i.get("component_price"))), i.get("id"));
            touched.add(i.get("package_id"));
        }
        return touched.size();
    }

    public void markApplied(Db d, PriceChange c, int tests, int packages) {
        d.update("""
            UPDATE catalog_price_change SET status = 'Applied', applied_at = clock_timestamp(), applied_tests = ?, applied_packages = ?, last_error = NULL
             WHERE id = ?::uuid""", tests, packages, c.id());
    }

    public void markCancelled(Db d, PriceChange c) {
        d.update("UPDATE catalog_price_change SET status = 'Cancelled', cancelled_at = clock_timestamp(), cancelled_by = current_app_user() WHERE id = ?::uuid", c.id());
    }

    /** Lists of rows as given; kept here so the service does not build SQL. */
    public static List<BigDecimal> prices(List<Map<String, Object>> lines) {
        List<BigDecimal> out = new ArrayList<>();
        for (Map<String, Object> l : lines) out.add(Amount.of(l.get("final_price")));
        return out;
    }
}
