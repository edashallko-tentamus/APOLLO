-- Waste classifications on inventory items that have none (0.30.0, migration 052): each item takes its lab's default for
-- its type, else the shared default (Media and strains: biohazardous; solvents: non-halogenated flammable solvents;
-- consumables: non-hazardous solid waste; reagents, reference standards and mixtures: "classify from the SDS", which
-- lists them as needing review). Items disposed of or cancelled are left as they are.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Waste classification by item type (0.30.0)', true);
SELECT script_signature('Waste classification by item type (0.30.0)');
UPDATE inventory_lot l SET waste_classification_id = waste_default_for(l.site_id, l.chemical_types)
 WHERE l.waste_classification_id IS NULL AND l.status::text NOT IN ('Disposed','Cancelled') AND waste_default_for(l.site_id, l.chemical_types) IS NOT NULL;
COMMIT;
