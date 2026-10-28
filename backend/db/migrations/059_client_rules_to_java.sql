-- 059: the client, contact and license rules move to the Java backend (Edashall Konah, 2026-10-28; the database keeps
-- structures only). Java now checks them before every write (clients/domain: Client, Contact, ContactRoles,
-- ClientLicense; clients/service), with JUnit tests in ClientRulesTest. What stays here:
--   * keys and references: the unique legal name, the unique contact email, one link per client and contact, NOT NULL;
--   * the GxP backstop on every table (stamp, audit trail, no hard delete) and the permission triggers;
--   * client_can_order, client_can_release_report and contact_can_order, which database rules elsewhere still call
--     (orders, report release); they go when those rules move.
-- Sandbox only: other writers of these tables (data load scripts, the internal clients made by migrations 023, 024,
-- 040 and 053) are no longer checked by the database.

-- client: the hierarchy loop, the own-parent check and the legal name check
DROP TRIGGER IF EXISTS b_client_no_cycle ON client;
DROP FUNCTION IF EXISTS client_no_cycle();
ALTER TABLE client DROP CONSTRAINT IF EXISTS client_not_own_parent;
ALTER TABLE client DROP CONSTRAINT IF EXISTS client_legal_name_check;

-- contact: the name and email checks (the unique email stays)
ALTER TABLE contact DROP CONSTRAINT IF EXISTS contact_first_name_check;
ALTER TABLE contact DROP CONSTRAINT IF EXISTS contact_last_name_check;
ALTER TABLE contact DROP CONSTRAINT IF EXISTS contact_email_check;

-- client_contact: known roles, sorted, Primary or Secondary, one Primary per client, at least one role
DROP TRIGGER IF EXISTS b_client_contact_validate ON client_contact;
DROP FUNCTION IF EXISTS client_contact_validate();
ALTER TABLE client_contact DROP CONSTRAINT IF EXISTS client_contact_roles_check;

-- client_license: stays with its client, a retired one is frozen, retiring needs why, type and number, the dates
DROP TRIGGER IF EXISTS a02_rules ON client_license;
DROP FUNCTION IF EXISTS client_license_rules();
ALTER TABLE client_license DROP CONSTRAINT IF EXISTS client_license_license_type_check;
ALTER TABLE client_license DROP CONSTRAINT IF EXISTS client_license_license_number_check;
ALTER TABLE client_license DROP CONSTRAINT IF EXISTS client_license_dates;
