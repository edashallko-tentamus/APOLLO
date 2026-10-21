-- LIMS3 schema, migration 017: WORKFLOW DESIGNER, WD-2.1: materials used at the bench reduce the lot's stock
-- Alex Kiddle, 2026-10-13 (vault: "Decision - Chemistry Execution Scope and Rules", WD-2.1):
--  - Using a lot at the bench reduces its quantity on hand: every material recorded at a step writes a Usage movement
--    (routine usage: attributed and audited, not signed, like Inventory > Usage), referencing the batch and entry.
--  - So the amount used is required for every material (not only spikes), in a unit that converts to the lot's unit.
--  - Removing a material while its step is open returns the stock (a correcting Usage movement linked to the first).
--  - Who may witness a step (WD-2 build choice, now confirmed): someone else with testing.perform in the lab; the step's
--    department is not required.

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);

ALTER TABLE entry_material ADD COLUMN usage_txn_id uuid REFERENCES inventory_transaction(id);
ALTER TABLE entry_material ADD COLUMN return_txn_id uuid REFERENCES inventory_transaction(id);
ALTER TABLE inventory_transaction ADD COLUMN corrects_txn_id uuid REFERENCES inventory_transaction(id);

-- A bench correction may put used stock back (a positive Usage movement), only from the bench (internal) and only
-- against an earlier usage of the same lot. Everything else is as before (migration 005).
CREATE OR REPLACE FUNCTION inventory_txn_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l inventory_lot; o inventory_transaction;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Stock movements cannot be edited; record an Adjustment to correct one';
    END IF;
    SELECT * INTO l FROM inventory_lot WHERE id = NEW.lot_id;
    PERFORM assert_site_access(l.site_id);
    IF l.receipt_status <> 'Received' THEN RAISE EXCEPTION 'Lot % has not been received yet', l.lot_code; END IF;
    IF l.status IN ('Disposed','Cancelled') THEN RAISE EXCEPTION 'Lot % is %', l.lot_code, lower(l.status::text); END IF;
    NEW.reason := COALESCE(NEW.reason, current_reason());
    IF NEW.corrects_txn_id IS NOT NULL THEN
        SELECT * INTO o FROM inventory_transaction WHERE id = NEW.corrects_txn_id;
        IF NOT testing_internal() OR NEW.txn_type <> 'Usage' OR o.txn_type <> 'Usage' OR o.lot_id <> NEW.lot_id OR NEW.quantity_change <> -o.quantity_change THEN
            RAISE EXCEPTION 'Only a bench usage removed while its step is open puts stock back';
        END IF;
        RETURN NEW;   -- returning stock: no availability or date checks
    END IF;
    CASE NEW.txn_type
    WHEN 'Receipt' THEN IF NEW.quantity_change < 0 THEN RAISE EXCEPTION 'A receipt adds stock'; END IF;
    WHEN 'Usage', 'Transfer Out', 'Disposal' THEN
        IF NEW.quantity_change > 0 THEN NEW.quantity_change := -NEW.quantity_change; END IF;
        IF NEW.txn_type = 'Usage' THEN
            IF l.status <> 'Available' THEN RAISE EXCEPTION 'Lot % is % and cannot be used', l.lot_code, l.status; END IF;
            IF l.expiration_date < site_today(l.site_id) THEN RAISE EXCEPTION 'Lot % expired on % and cannot be used', l.lot_code, l.expiration_date; END IF;
            IF l.retest_date < site_today(l.site_id) THEN RAISE EXCEPTION 'Lot % was due for retest on % and cannot be used until it is re-qualified', l.lot_code, l.retest_date; END IF;
        END IF;
    WHEN 'Adjustment' THEN
        IF NEW.reason IS NULL THEN RAISE EXCEPTION 'An adjustment needs a reason (for example a stock count)'; END IF;
    END CASE;
    RETURN NEW;
END $$;

-- The amount used is required, and must convert to the lot's unit (checked before the row is saved)
CREATE OR REPLACE FUNCTION entry_material_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r step_run; b test_batch; l inventory_lot;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = NEW.step_run_id;
    SELECT * INTO b FROM test_batch WHERE id = r.batch_id;
    IF NEW.entry_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM batch_entry WHERE id = NEW.entry_id AND batch_id = b.id) THEN RAISE EXCEPTION 'The entry is not in this batch'; END IF;
    IF testing_internal() THEN RETURN NEW; END IF;
    PERFORM assert_can_perform(r.id);
    PERFORM assert_step_open(r.id);
    IF TG_OP = 'UPDATE' AND (NEW.lot_id <> OLD.lot_id OR NEW.entry_id IS DISTINCT FROM OLD.entry_id OR NEW.volume IS DISTINCT FROM OLD.volume
                             OR NEW.volume_unit IS DISTINCT FROM OLD.volume_unit OR NEW.status = 'Active' AND OLD.status <> 'Active') THEN
        RAISE EXCEPTION 'Remove the material and add the right one';
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.volume_unit := canonical_unit(NEW.volume_unit, '{Volume,Mass,Count}', 'Unit of the amount used');
        SELECT * INTO l FROM inventory_lot WHERE id = NEW.lot_id;
        IF l.site_id <> b.site_id THEN RAISE EXCEPTION 'Lot % belongs to another lab', l.lot_code; END IF;
        IF l.receipt_status <> 'Received' THEN RAISE EXCEPTION 'Lot % has not been received', l.lot_code; END IF;
        IF l.status <> 'Available' THEN RAISE EXCEPTION 'Lot % is % and cannot be used', l.lot_code, l.status; END IF;
        IF l.expiration_date < site_today(l.site_id) THEN RAISE EXCEPTION 'Lot % expired on % and cannot be used', l.lot_code, l.expiration_date; END IF;
        IF l.retest_date < site_today(l.site_id) THEN RAISE EXCEPTION 'Lot % was due for retest on % and cannot be used', l.lot_code, l.retest_date; END IF;
        IF NEW.volume IS NULL OR NEW.volume_unit IS NULL THEN
            RAISE EXCEPTION 'Enter the amount of % used (and its unit): it is taken off the lot''s stock', l.lot_code;
        END IF;
        IF unit_factor(NEW.volume_unit, l.unit, l.physical_form::text) IS NULL THEN
            RAISE EXCEPTION 'Lot % is counted in %; % cannot be converted to it', l.lot_code, l.unit, NEW.volume_unit;
        END IF;
        NEW.usage_txn_id := NULL; NEW.return_txn_id := NULL;
    END IF;
    RETURN NEW;
END $$;

-- After a material is recorded: take it off the lot's stock. After it is removed: put it back.
CREATE FUNCTION entry_material_stock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l inventory_lot; b test_batch; e batch_entry; ws workflow_step; q numeric; t uuid; ref text;
BEGIN
    IF testing_internal() THEN RETURN NULL; END IF;
    SELECT * INTO l FROM inventory_lot WHERE id = NEW.lot_id;
    SELECT tb.* INTO b FROM test_batch tb JOIN step_run r ON r.batch_id = tb.id WHERE r.id = NEW.step_run_id;
    SELECT w.* INTO ws FROM workflow_step w JOIN step_run r ON r.step_id = w.id WHERE r.id = NEW.step_run_id;
    SELECT * INTO e FROM batch_entry WHERE id = NEW.entry_id;
    ref := b.batch_code || ' ' || ws.step_name || ': ' || COALESCE(e.label, 'whole batch');
    IF TG_OP = 'INSERT' AND NEW.status = 'Active' THEN
        q := round(NEW.volume * unit_factor(NEW.volume_unit, l.unit, l.physical_form::text), 4);
        IF q IS NULL OR q = 0 THEN RAISE EXCEPTION 'The amount used is too small to record in the lot''s unit (%)', l.unit; END IF;
        INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reference, notes)
        VALUES (NEW.lot_id, 'Usage', -q, ref, NEW.purpose || ', ' || trim(trailing '.' from trim(trailing '0' from NEW.volume::text)) || ' ' || NEW.volume_unit) RETURNING id INTO t;
        PERFORM set_testing_internal(true);
        UPDATE entry_material SET usage_txn_id = t WHERE id = NEW.id;
        PERFORM set_testing_internal(false);
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Active' AND NEW.status <> 'Active' AND NEW.usage_txn_id IS NOT NULL AND NEW.return_txn_id IS NULL THEN
        PERFORM set_testing_internal(true);
        INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reference, notes, corrects_txn_id)
        SELECT lot_id, 'Usage', -quantity_change, ref, 'Returned: removed from the bench record', id FROM inventory_transaction WHERE id = NEW.usage_txn_id RETURNING id INTO t;
        UPDATE entry_material SET return_txn_id = t WHERE id = NEW.id;
        PERFORM set_testing_internal(false);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER z_stock AFTER INSERT OR UPDATE OF status ON entry_material FOR EACH ROW EXECUTE FUNCTION entry_material_stock();

COMMIT;
