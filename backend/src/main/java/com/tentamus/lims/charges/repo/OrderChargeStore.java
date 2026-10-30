package com.tentamus.lims.charges.repo;

import com.tentamus.lims.charges.domain.OrderCharge;
import com.tentamus.lims.core.db.Db;
import java.math.BigDecimal;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** Adds charges to lab orders with the amounts {@link OrderCharge#price} works out (used by the order page and by Billing). */
@Repository
public class OrderChargeStore {

    /** The charge item: status, lab, price and kind; null when it does not exist. */
    public Map<String, Object> item(Db d, Object id) {
        return d.one("SELECT status::text AS status, site_id, price, kind FROM charge_item WHERE id = ?::uuid", id);
    }

    private static BigDecimal n(Object v) { return v == null ? null : v instanceof BigDecimal b ? b : new BigDecimal(v.toString()); }

    /**
     * Inserts the charge: its signed list price and the client's price (typed, else their accepted quote's, else the item's).
     *
     * @param typed  the price typed, or null
     * @param source Order or Invoice
     * @return {id, charge_no}
     */
    public Map<String, Object> insert(Db d, Object order, Object sample, Object itemId, long quantity, BigDecimal typed, Object note, String source) {
        Map<String, Object> item = item(d, itemId);
        String kind = (String) item.get("kind");
        Map<String, Object> cp = typed != null ? null : d.one("""
            SELECT cp.quoted_charge_id, cp.unit_price FROM lab_order o, LATERAL client_charge_price(o.client_id, ?::uuid) cp WHERE o.id = ?::uuid""", itemId, order);
        OrderCharge.Price p = OrderCharge.price(kind, n(item.get("price")), typed, cp == null ? null : n(cp.get("unit_price")),
            cp == null ? null : (String) cp.get("quoted_charge_id"));
        return d.one("""
            INSERT INTO order_charge (lab_order_id, sample_id, charge_item_id, quantity, list_price, unit_price, quoted_charge_id, source, note)
            VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?::numeric, ?::numeric, ?::uuid, ?, ?) RETURNING id, charge_no""",
            order, sample, itemId, quantity, p.listPrice(), p.unitPrice(), p.quotedChargeId(), source, note);
    }
}
