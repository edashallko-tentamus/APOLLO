package com.tentamus.lims.inventory.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * One inventory lot (an item, a purchase request, a transfer arriving, an in-house mixture). Holds the lot's stored
 * values and the rules for changing it: what it is, its purchase and receipt steps, its status, its storage, whether it
 * may be used, and the actions receive, transfer, reorder and dispose.
 *
 * <p>Java's own implementation of the database's inventory_lot_rules trigger and of receive_lot(), transfer_lot(),
 * reorder_lot() and dispose_lot(). The trigger and the first three functions stay in the database: purchasing,
 * the bench, logbooks, workflow verification and the demo data load write lots through them (migration 062 header).
 */
public final class Lot {
    /** What the lot's checks need beyond the lot itself. */
    public record Context(Units units, StorageLocation location, String transferSourceSite, LocalDate today,
                          LocalDate earliestComponentExpiry, boolean disposing, Chemical chemical) {}

    /** An old Chemical-list link: it fills in the name and CAS. */
    public record Chemical(String name, String cas, boolean active) {}

    private final Map<String, Object> v;

    private Lot(Map<String, Object> values) { this.v = values; }

    public static Lot of(Map<String, Object> row) { return row == null ? null : new Lot(new LinkedHashMap<>(row)); }

    /** This lot with the given changes applied (the values it will have once written). */
    public Lot with(Map<String, Object> changes) {
        Map<String, Object> m = new LinkedHashMap<>(v);
        m.putAll(changes);
        return new Lot(m);
    }

    public Map<String, Object> values() { return v; }

    public String id() { return Values.str(v.get("id")); }
    public String code() { return Values.str(v.get("lot_code")); }
    public String siteId() { return Values.str(v.get("site_id")); }
    public String name() { return Values.str(v.get("item_name")); }
    public ChemicalTypes types() { return ChemicalTypes.of(v.get("chemical_types")); }
    public String status() { return v.get("status") == null ? "Available" : v.get("status").toString(); }
    public String receiptStatus() { return v.get("receipt_status") == null ? "Received" : v.get("receipt_status").toString(); }
    public String unit() { return Values.str(v.get("unit")); }
    public String physicalForm() { return Values.str(v.get("physical_form")); }
    public BigDecimal quantityReceived() { return Values.dec(v.get("quantity_received")); }
    public LocalDate expires() { return Values.date(v.get("expiration_date")); }
    public LocalDate retestDue() { return Values.date(v.get("retest_date")); }
    public String storageCondition() { return Values.str(v.get("storage_condition")); }
    public String storageLocationId() { return Values.str(v.get("storage_location_id")); }
    public String transferredFrom() { return Values.str(v.get("transferred_from_lot_id")); }
    public boolean isClosed() { return List.of("Disposed", "Cancelled").contains(status()); }

    /**
     * Checks this lot, about to be written, against its stored self (null for a new lot) and returns the values to
     * write: the changes, plus the name, units and Solid or Liquid as the rules settle them.
     */
    public Map<String, Object> checkSave(Lot before, Map<String, Object> changes, Context ctx) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        boolean insert = before == null;
        ChemicalTypes types = types();
        if (insert && transferredFrom() != null) {
            if (!"In Transit".equals(receiptStatus())) throw RuleException.database("A transferred lot starts In Transit until the receiving lab receives it");
            if (Objects.equals(siteId(), ctx.transferSourceSite())) throw RuleException.database("A transfer must go to a different lab");
        }
        if (!insert && !Objects.equals(siteId(), before.siteId()))
            throw RuleException.database("A lot cannot move to another lab; use Transfer, which logs it as a new lot at the receiving lab");
        if (!insert && (!Objects.equals(transferredFrom(), before.transferredFrom()) || !Objects.equals(Values.str(v.get("reorder_of_lot_id")), Values.str(before.v.get("reorder_of_lot_id")))))
            throw RuleException.database("The transfer and reorder links on a lot cannot be changed");

        // what the lot is: its own name and CAS (an old Chemical-list link fills them in)
        String name = name();
        if (ctx.chemical() != null && (insert || !Objects.equals(Values.str(v.get("chemical_id")), Values.str(before.v.get("chemical_id"))))) {
            if (!ctx.chemical().active()) throw RuleException.database("That chemical is Retired on the Chemical list");
            if (name == null) name = ctx.chemical().name();
            if (v.get("cas_number") == null && ctx.chemical().cas() != null) out.put("cas_number", ctx.chemical().cas());
        }
        name = Values.trimmed(name == null ? v.get("item_description") : name);
        if (name == null) throw RuleException.database("Enter the item name (for example \"Sodium Standard 1000 ppm\" or \"Pipette tips, 1000 µL\")");
        if (!name.equals(name())) out.put("item_name", name);
        if (types.isConsumableOnly() && (v.get("purity_pct") != null || v.get("concentration") != null))
            throw RuleException.database("Purity and concentration do not apply to consumables");

        // units from the Units table; Solid or Liquid defaults from the unit
        String unit = unit();
        if (insert || !Objects.equals(unit, before.unit())) {
            unit = ctx.units().canonical(unit, Units.QUANTITY, "Unit");
            if (!Objects.equals(unit, unit()) && (insert || changes.containsKey("unit"))) out.put("unit", unit);
        }
        String cu = Values.str(v.get("concentration_unit"));
        if (insert || !Objects.equals(cu, Values.str(before.v.get("concentration_unit")))) {
            cu = ctx.units().canonical(cu, Units.CONCENTRATION, "Concentration unit");
            if (!Objects.equals(cu, Values.str(v.get("concentration_unit")))) out.put("concentration_unit", cu);
        }
        if (v.get("concentration") != null && cu == null) throw RuleException.database("Give the concentration a unit");
        if (physicalForm() == null && unit != null && !types.isConsumableOnly()) {
            String dim = ctx.units().dimension(unit);
            String form = "Volume".equals(dim) ? "Liquid" : "Mass".equals(dim) ? "Solid" : null;
            if (form != null) out.put("physical_form", form);
        }

        // purchase and receipt: Requested -> Approved -> Ordered -> Received; transfers: In Transit -> Received
        String rs = receiptStatus();
        if (!insert && !rs.equals(before.receiptStatus())) {
            String old = before.receiptStatus();
            if ("Received".equals(old)) throw RuleException.database("A received lot cannot go back to " + rs);
            boolean ok = ("Requested".equals(old) && "Approved".equals(rs)) || ("Approved".equals(old) && "Ordered".equals(rs))
                || (List.of("Ordered", "In Transit").contains(old) && "Received".equals(rs));
            if (!ok) throw RuleException.database("A lot cannot go from " + old + " to " + rs);
        }
        if (insert && List.of("Approved", "Ordered").contains(rs))
            throw RuleException.database("A new purchase starts as Requested and is approved by a Lab Supervisor");
        String st = status();
        if (!"Received".equals(rs) && !List.of("Available", "Cancelled").contains(st))
            throw RuleException.database("A lot that has not been received can only be cancelled");
        if ("Received".equals(rs) && "Cancelled".equals(st)) throw RuleException.database("A received lot cannot be cancelled; dispose of it instead");
        if (!insert && "Disposed".equals(st) && !"Disposed".equals(before.status()) && !ctx.disposing())
            throw RuleException.database("Use Dispose to dispose of a lot, so the remaining quantity is written off");
        if (!insert && before.isClosed() && !st.equals(before.status()))
            throw RuleException.database("A " + before.status().toLowerCase() + " lot cannot be reopened");
        if (!insert && "Received".equals(before.receiptStatus())
            && (!eq(quantityReceived(), before.quantityReceived()) || !Objects.equals(unit, before.unit())))
            throw RuleException.database("The quantity received and its unit cannot be changed after receipt; record an Adjustment instead");

        // a received lot needs its physical details
        if ("Received".equals(rs)) {
            if (quantityReceived() == null || unit == null) throw RuleException.database("Enter the quantity received and its unit");
            if (v.get("manufacturer_lot") == null && !types.isMixture() && !types.isConsumableOnly())
                throw RuleException.database("Enter the manufacturer's lot number");
            if (v.get("received_date") == null && ctx.today() != null) out.put("received_date", ctx.today().toString());
        }
        if (types.isMixture() && v.get("manufacturer_lot") != null)
            throw RuleException.database("An in-house mixture has no manufacturer lot; its lab ID (" + code() + ") is its Resource ID");

        // a mixture cannot outlive its earliest-expiring component
        LocalDate min = ctx.earliestComponentExpiry();
        if (types.isMixture() && !insert && min != null && (expires() == null || expires().isAfter(min)))
            throw RuleException.database("This mixture must expire on or before " + min + " (its earliest-expiring component)");

        if (ctx.location() != null) ctx.location().assertAccepts(siteId(), storageCondition(), "Lot " + code());
        return out;
    }

    /** Reference Standards and Microbiological Strains name at least one analyte (checked when the whole save is done). */
    public void assertHasAnalyte(int activeAnalytes) {
        if (v.get("chemical_id") == null && types().needsAnalyte() && !isClosed() && activeAnalytes == 0)
            throw RuleException.database("Lot " + code() + " (" + name() + "): a Reference Standard or Microbiological Strain must be linked to at least one analyte");
    }

    /** Why the lot cannot be used today, or null when it can (inventory_lot_view's not_usable_because). */
    public String notUsableBecause(LocalDate today) {
        if (!"Received".equals(receiptStatus())) return "Not received yet (" + receiptStatus() + ")";
        if (!"Available".equals(status())) return status();
        if (expires() != null && expires().isBefore(today)) return "Expired";
        if (retestDue() != null && retestDue().isBefore(today)) return "Retest due";
        return null;
    }

    /** A stock movement may be recorded only on a received lot that is not closed; using it needs it usable today. */
    void assertMovable() {
        if (!"Received".equals(receiptStatus())) throw RuleException.database("Lot " + code() + " has not been received yet");
        if (isClosed()) throw RuleException.database("Lot " + code() + " is " + status().toLowerCase());
    }

    void assertUsable(LocalDate today) {
        if (!"Available".equals(status())) throw RuleException.database("Lot " + code() + " is " + status() + " and cannot be used");
        if (expires() != null && expires().isBefore(today)) throw RuleException.database("Lot " + code() + " expired on " + expires() + " and cannot be used");
        if (retestDue() != null && retestDue().isBefore(today))
            throw RuleException.database("Lot " + code() + " was due for retest on " + retestDue() + " and cannot be used until it is re-qualified");
    }

    /** What arrived for an Ordered purchase or an In Transit transfer: the changes that receive it (one lot, never a second one). */
    public Map<String, Object> receive(BigDecimal quantity, String unit, String manufacturerLot, String expires, String retest, String location, String received, LocalDate today) {
        if (!List.of("Ordered", "In Transit").contains(receiptStatus()))
            throw RuleException.database("Only an Ordered purchase or an In Transit transfer can be received (this lot is " + receiptStatus() + ")");
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("quantity_received", quantity != null ? quantity : quantityReceived() != null ? quantityReceived() : Values.dec(v.get("requested_quantity")));
        c.put("unit", unit != null ? unit : unit());
        String ml = Values.trimmed(manufacturerLot);
        c.put("manufacturer_lot", ml != null ? ml : v.get("manufacturer_lot"));
        c.put("expiration_date", expires != null ? expires : v.get("expiration_date"));
        c.put("retest_date", retest != null ? retest : v.get("retest_date"));
        c.put("storage_location_id", location != null ? location : v.get("storage_location_id"));
        c.put("received_date", received != null ? received : today.toString());
        c.put("receipt_status", "Received");
        return c;
    }

    /** The receiving lab's new lot for a transfer: same material, manufacturer lot, expiry and COA, In Transit. */
    public Map<String, Object> transferTo(String toSite, BigDecimal quantity, String notes) {
        if (quantity == null || quantity.signum() <= 0) throw RuleException.database("Enter the quantity to transfer");
        if (Objects.equals(toSite, siteId())) throw RuleException.database("A transfer must go to a different lab");
        Map<String, Object> n = copy("item_name", "cas_number", "physical_form", "chemical_id", "item_description", "chemical_types", "supplier_id",
            "manufacturer_id", "catalog_number", "manufacturer_lot", "unit", "concentration", "concentration_unit", "purity_pct", "expiration_date",
            "retest_date", "storage_condition");
        n.put("site_id", toSite);
        n.put("receipt_status", "In Transit");
        n.put("requested_quantity", quantity);
        n.put("quantity_received", quantity);
        n.put("transferred_from_lot_id", id());
        n.put("notes", notes);
        return n;
    }

    /** Reorder (any lot but a mixture): a new Requested lot like this one. */
    public Map<String, Object> reorder(BigDecimal quantity, String notes) {
        if (types().isMixture()) throw RuleException.database("An in-house mixture is prepared, not ordered; reorder its components");
        Map<String, Object> n = copy("site_id", "item_name", "cas_number", "physical_form", "chemical_id", "item_description", "chemical_types",
            "supplier_id", "manufacturer_id", "catalog_number", "unit", "concentration", "concentration_unit", "storage_condition", "storage_location_id");
        n.put("receipt_status", "Requested");
        n.put("requested_quantity", quantity != null ? quantity : quantityReceived());
        n.put("reorder_of_lot_id", id());
        n.put("notes", notes);
        return n;
    }

    /** Dispose: the movement that writes off whatever is left (null when nothing is), before the lot is closed. */
    public StockMovement dispose(BigDecimal onHand, String reason) {
        if (reason == null || reason.isBlank()) throw RuleException.database("A reason is required to dispose of a lot");
        if (onHand == null || onHand.signum() == 0) return null;
        // a negative remainder is put back with an Adjustment; either way the lot ends at zero
        return new StockMovement(id(), onHand.signum() > 0 ? "Disposal" : "Adjustment", onHand.negate(), null, "Written off at disposal", null, reason);
    }

    private Map<String, Object> copy(String... cols) {
        Map<String, Object> n = new LinkedHashMap<>();
        for (String c : cols) n.put(c, v.get(c));
        return n;
    }

    private static boolean eq(BigDecimal a, BigDecimal b) { return a == null ? b == null : b != null && a.compareTo(b) == 0; }
}
