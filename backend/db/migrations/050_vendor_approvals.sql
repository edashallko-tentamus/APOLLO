-- 050: vendor approvals, local and corporate (V-1; Alex, 2026-10-19). Builds on 011's supplier qualification.
-- Alex's decisions (vault: Decision - Vendor Approvals, Local and Corporate V-1):
--  1a. Corporate approvals are made by a new all-labs Corporate QA group (permission purchasing.qualify_corporate).
--      A lab's QA approves for its own lab only (before: any lab's QA could approve for all labs).
--  2a. A lab can be stricter than corporate (suspend or reject locally), never looser: while Corporate QA has a vendor
--      Suspended or Not Approved, no lab can use it or approve it.
--  3a. Corporate approvals use the shared risk classes, which Corporate QA now keeps (and can add to); labs keep their
--      own classes for local approvals.
--  4a. A lab proposes its local approval for corporate approval with at least one attached document and a shared risk
--      class. Corporate QA (not the proposer) approves it, making a corporate approval, or rejects the proposal.
--  5b. Approvals name what the vendor is approved for (supply scopes). Each purchase request line has its scopes
--      (from the item's type, Equipment, or the requester's choice for services and other purchases); a request is
--      requested, approved and ordered only from a vendor approved for its scopes. Existing approvals cover every scope.
-- QA approves vendors only; approving purchase requests stays purchasing.approve (Lab Supervisor, General Manager).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 050: vendor approvals, local and corporate', true);

-------------------------------------------------------------------------------
-- 1. CORPORATE QA: THE PERMISSION AND THE ALL-LABS GROUP
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('purchasing.qualify_corporate', 'Purchasing', 'Corporate vendor approval',
  'Approve, suspend or reject vendors for every lab (corporate approvals), decide the labs'' proposals, keep the shared risk classes and the supply scopes', true, 77);
UPDATE permission SET description = 'Approve, suspend or reject vendors for this lab (local approvals), attach their documents and propose them for corporate approval'
 WHERE code = 'purchasing.qualify';
INSERT INTO lab_group (site_id, group_name, description, is_standard)
VALUES (NULL, 'Corporate QA (all labs)', 'Corporate QA: approves vendors for every lab, decides the labs'' proposals for corporate approval, keeps the shared risk classes and the supply scopes, and can look at every lab (view only). Approves no purchase requests.', true);
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g, unnest('{purchasing.qualify_corporate,data.view_all}'::text[]) p WHERE g.site_id IS NULL AND g.group_name = 'Corporate QA (all labs)';

-- held through an all-labs group only (a lab's group holding it would make one lab's QA corporate)
CREATE FUNCTION has_corporate_permission(p_code text) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT current_user_is_admin()
        OR EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id JOIN group_permission gp ON gp.group_id = g.id
                    WHERE m.user_id = current_app_user() AND m.status = 'Active' AND g.status = 'Active' AND gp.status = 'Active'
                      AND g.site_id IS NULL AND gp.permission_code = p_code)
$$;
CREATE FUNCTION group_permission_corporate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.permission_code = 'purchasing.qualify_corporate' AND NEW.status = 'Active'
       AND (SELECT site_id FROM lab_group WHERE id = NEW.group_id) IS NOT NULL THEN
        RAISE EXCEPTION 'Corporate vendor approval belongs to the all-labs Corporate QA group, not to one lab''s group';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_corporate BEFORE INSERT OR UPDATE ON group_permission FOR EACH ROW EXECUTE FUNCTION group_permission_corporate();

CREATE FUNCTION vendor_internal() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.vendor_internal', true), '') = '1' OR in_group_sync()
$$;

-------------------------------------------------------------------------------
-- 2. SUPPLY SCOPES: WHAT A VENDOR IS APPROVED FOR (one shared list, kept by Corporate QA)
-------------------------------------------------------------------------------
CREATE TABLE supply_scope (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_name       text NOT NULL CHECK (btrim(scope_name) <> ''),
    description      text,
    chemical_types   chemical_type[] NOT NULL DEFAULT '{}',        -- inventory items of these types fall under it
    line_types       purchase_line_type[] NOT NULL DEFAULT '{}',   -- requests of these kinds may name it
    default_for      purchase_line_type,                           -- the scope a request of that kind gets unless one is chosen
    sort_order       integer NOT NULL DEFAULT 0,
    status           record_status NOT NULL DEFAULT 'Active',
    record_version   integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at      timestamptz NOT NULL DEFAULT now(),
    modified_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX supply_scope_name_uq ON supply_scope (lower(scope_name));
CREATE UNIQUE INDEX supply_scope_default_uq ON supply_scope (default_for) WHERE status = 'Active' AND default_for IS NOT NULL;
CALL make_gxp('supply_scope');
CREATE FUNCTION supply_scope_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t chemical_type; other text;
BEGIN
    NEW.scope_name := btrim(NEW.scope_name);
    IF NEW.default_for IS NOT NULL AND NOT (NEW.default_for = ANY (NEW.line_types)) THEN
        RAISE EXCEPTION 'Scope "%" is the default for % requests, so it must be offered for them', NEW.scope_name, lower(NEW.default_for::text);
    END IF;
    IF NEW.status = 'Active' THEN
        FOREACH t IN ARRAY NEW.chemical_types LOOP
            SELECT scope_name INTO other FROM supply_scope WHERE id <> NEW.id AND status = 'Active' AND t = ANY (chemical_types);
            IF other IS NOT NULL THEN
                RAISE EXCEPTION 'Items of type % already fall under the scope "%": an item type belongs to one scope', t, other;
            END IF;
        END LOOP;
    END IF;
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NOT has_corporate_permission('purchasing.qualify_corporate') THEN
        RAISE EXCEPTION 'The supply scopes are kept by Corporate QA (purchasing.qualify_corporate)';
    END IF;
    PERFORM assert_signed('change the supply scopes');
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON supply_scope FOR EACH ROW EXECUTE FUNCTION supply_scope_rules();
INSERT INTO supply_scope (scope_name, description, chemical_types, line_types, default_for, sort_order) VALUES
 ('Reference standards', 'Certified reference materials and reference standards', '{Reference Standard}', '{Inventory item}', NULL, 1),
 ('Reference strains', 'Microbiological reference strains (e.g. ATCC)', '{Microbiological Strain}', '{Inventory item}', NULL, 2),
 ('Culture media', 'Prepared and dehydrated culture media', '{Media}', '{Inventory item}', NULL, 3),
 ('Reagents and solvents', 'Reagents, solvents and chemicals', '{Reagent,Solvent}', '{Inventory item}', NULL, 4),
 ('Consumables', 'Laboratory consumables and general supplies', '{Consumable}', '{Inventory item,Other}', NULL, 5),
 ('Equipment', 'Instruments and equipment', '{}', '{Equipment}', 'Equipment', 6),
 ('Calibration services', 'Calibration of equipment', '{}', '{Service}', NULL, 7),
 ('Maintenance and repair', 'Maintenance, repair and qualification visits', '{}', '{Service}', NULL, 8),
 ('Subcontracted testing', 'Testing done for us by another laboratory', '{}', '{Service}', NULL, 9),
 ('Other services', 'Services not listed above', '{}', '{Service}', 'Service', 10),
 ('Other purchases', 'Anything not listed above', '{}', '{Other}', 'Other', 11);

CREATE FUNCTION scope_names(p_ids uuid[]) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p_ids IS NULL THEN 'Every scope'
                ELSE COALESCE((SELECT string_agg(scope_name, ', ' ORDER BY sort_order, scope_name) FROM supply_scope WHERE id = ANY (p_ids)), '') END
$$;
-- an approval covering NULL = every scope; a request's NULL scopes = nothing to check
CREATE FUNCTION scopes_cover(p_have uuid[], p_need uuid[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT p_have IS NULL OR p_need IS NULL OR cardinality(p_need) = 0 OR p_need <@ p_have
$$;

-------------------------------------------------------------------------------
-- 3. VENDOR APPROVALS: LOCAL (a lab) OR CORPORATE (every lab), WITH THEIR SCOPES
-------------------------------------------------------------------------------
ALTER TABLE vendor_qualification ADD COLUMN scope_ids uuid[],            -- NULL = every scope (approvals made before 050)
                                 ADD COLUMN promoted_from_id uuid REFERENCES vendor_qualification(id),
                                 ADD COLUMN promotion_id uuid;

CREATE FUNCTION vendor_corporate(p_supplier uuid) RETURNS vendor_qualification LANGUAGE sql STABLE AS $$
    SELECT * FROM vendor_qualification WHERE supplier_id = p_supplier AND site_id IS NULL AND status = 'Active'
     ORDER BY approval_date DESC, created_at DESC LIMIT 1
$$;
CREATE FUNCTION vendor_local(p_supplier uuid, p_site uuid) RETURNS vendor_qualification LANGUAGE sql STABLE AS $$
    SELECT * FROM vendor_qualification WHERE supplier_id = p_supplier AND site_id = p_site AND status = 'Active'
     ORDER BY approval_date DESC, created_at DESC LIMIT 1
$$;

-- The decision that applies to a vendor at a lab, for the scopes needed (NULL = anything):
--  a corporate Suspended / Not Approved blocks every lab; then a lab's own Suspended / Not Approved blocks that lab;
--  then a current approval covering the scopes (the lab's own first, else the corporate one).
CREATE FUNCTION vendor_decision(p_supplier uuid, p_site uuid, p_scopes uuid[] DEFAULT NULL)
RETURNS TABLE (status text, decided_at text, qualification_id uuid, expires date, missing text)
LANGUAGE plpgsql STABLE AS $$
DECLARE c vendor_qualification; l vendor_qualification; d date := site_today(p_site);
        l_ok boolean; c_ok boolean; l_cur boolean; c_cur boolean;
BEGIN
    c := vendor_corporate(p_supplier);
    l := vendor_local(p_supplier, p_site);
    IF c.id IS NOT NULL AND c.approval_status <> 'Approved' THEN
        RETURN QUERY SELECT c.approval_status::text, 'Corporate'::text, c.id, c.expiration_date, NULL::text; RETURN;
    END IF;
    IF l.id IS NOT NULL AND l.approval_status <> 'Approved' THEN
        RETURN QUERY SELECT l.approval_status::text, 'This lab'::text, l.id, l.expiration_date, NULL::text; RETURN;
    END IF;
    l_cur := l.id IS NOT NULL AND (l.expiration_date IS NULL OR l.expiration_date >= d);
    c_cur := c.id IS NOT NULL AND (c.expiration_date IS NULL OR c.expiration_date >= d);
    l_ok := l_cur AND scopes_cover(l.scope_ids, p_scopes);
    c_ok := c_cur AND scopes_cover(c.scope_ids, p_scopes);
    IF l_ok THEN RETURN QUERY SELECT 'Approved'::text, 'This lab'::text, l.id, l.expiration_date, NULL::text; RETURN; END IF;
    IF c_ok THEN RETURN QUERY SELECT 'Approved'::text, 'Corporate'::text, c.id, c.expiration_date, NULL::text; RETURN; END IF;
    IF l_cur OR c_cur THEN
        RETURN QUERY SELECT 'Not approved for this'::text, CASE WHEN l_cur THEN 'This lab' ELSE 'Corporate' END, COALESCE(CASE WHEN l_cur THEN l.id END, c.id),
            COALESCE(CASE WHEN l_cur THEN l.expiration_date END, c.expiration_date),
            (SELECT string_agg(s.scope_name, ', ' ORDER BY s.sort_order) FROM supply_scope s WHERE s.id = ANY (p_scopes)
                AND NOT (l_cur AND scopes_cover(l.scope_ids, ARRAY[s.id])) AND NOT (c_cur AND scopes_cover(c.scope_ids, ARRAY[s.id])));
        RETURN;
    END IF;
    IF l.id IS NOT NULL OR c.id IS NOT NULL THEN
        RETURN QUERY SELECT 'Expired'::text, CASE WHEN l.id IS NOT NULL THEN 'This lab' ELSE 'Corporate' END, COALESCE(l.id, c.id), COALESCE(l.expiration_date, c.expiration_date), NULL::text;
        RETURN;
    END IF;
    RETURN QUERY SELECT 'Not qualified'::text, NULL::text, NULL::uuid, NULL::date, NULL::text;
END $$;

-- 011's functions, now following the decision above (same names and arguments, so every caller keeps working)
CREATE OR REPLACE FUNCTION supplier_status_at(p_supplier uuid, p_site uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT status FROM vendor_decision(p_supplier, p_site, NULL)
$$;
CREATE OR REPLACE FUNCTION current_vendor_qualification(p_supplier uuid, p_site uuid) RETURNS vendor_qualification LANGUAGE sql STABLE AS $$
    SELECT q.* FROM vendor_qualification q WHERE q.id = COALESCE((SELECT qualification_id FROM vendor_decision(p_supplier, p_site, NULL)),
        (vendor_local(p_supplier, p_site)).id, (vendor_corporate(p_supplier)).id)
$$;
CREATE FUNCTION assert_supplier_scope(p_supplier uuid, p_site uuid, p_scopes uuid[], p_what text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d record;
BEGIN
    IF p_supplier IS NULL OR p_scopes IS NULL OR cardinality(p_scopes) = 0 THEN RETURN; END IF;
    SELECT * INTO d FROM vendor_decision(p_supplier, p_site, p_scopes);
    IF d.status = 'Not approved for this' THEN
        RAISE EXCEPTION 'Cannot % from %: it is not approved for % at this lab. Ask QA to approve the vendor for it.', p_what,
            (SELECT supplier_name FROM supplier WHERE id = p_supplier), lower(d.missing);
    ELSIF d.status <> 'Approved' THEN
        RAISE EXCEPTION 'Cannot % from %: the supplier is % %. Ask QA to qualify it first.', p_what,
            (SELECT supplier_name FROM supplier WHERE id = p_supplier), lower(d.status), CASE WHEN d.decided_at = 'Corporate' THEN 'by Corporate QA for every lab' ELSE 'for this lab' END;
    END IF;
END $$;

-- 011's rules, now with the two levels: a lab's QA approves for its lab; Corporate QA for every lab
CREATE OR REPLACE FUNCTION vendor_qualification_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rc supplier_risk_class; c vendor_qualification; bad text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - '{status,record_version,modified_at,modified_by}'::text[]) <> (to_jsonb(OLD) - '{status,record_version,modified_at,modified_by}'::text[]) THEN
            RAISE EXCEPTION 'A qualification cannot be changed; record a new qualification (or withdraw this one as entered in error)';
        END IF;
    ELSE
        SELECT * INTO rc FROM supplier_risk_class WHERE id = NEW.risk_class_id;
        IF rc.status <> 'Active' THEN RAISE EXCEPTION 'Risk class % is Inactive', rc.class_name; END IF;
        IF rc.site_id IS NOT NULL AND rc.site_id IS DISTINCT FROM NEW.site_id THEN
            RAISE EXCEPTION 'Risk class % belongs to one lab: use it only for that lab''s own qualifications (a corporate approval uses a shared class)', rc.class_name;
        END IF;
        IF NEW.approval_status <> 'Approved' THEN NEW.scope_ids := NULL; END IF;   -- a suspension or rejection is for the whole vendor
        IF NEW.scope_ids IS NOT NULL THEN
            IF cardinality(NEW.scope_ids) = 0 THEN RAISE EXCEPTION 'Name what the vendor is approved for (or every scope)'; END IF;
            SELECT string_agg(x::text, ', ') INTO bad FROM unnest(NEW.scope_ids) x WHERE NOT EXISTS (SELECT 1 FROM supply_scope s WHERE s.id = x AND s.status = 'Active');
            IF bad IS NOT NULL THEN RAISE EXCEPTION 'An approval names only active supply scopes'; END IF;
            NEW.scope_ids := ARRAY(SELECT DISTINCT x FROM unnest(NEW.scope_ids) x ORDER BY 1);
        END IF;
        IF NEW.approval_status = 'Approved' AND NEW.expiration_date IS NULL THEN
            NEW.expiration_date := (NEW.approval_date + make_interval(months => rc.requal_months))::date;
        END IF;
        IF NEW.approval_date > site_today(COALESCE(NEW.site_id, current_site())) + 1 THEN RAISE EXCEPTION 'The approval date cannot be in the future'; END IF;
        NEW.signature_id := NULLIF(current_setting('lims.signature_id', true), '')::uuid;
        IF NEW.promotion_id IS NOT NULL AND NOT vendor_internal() THEN RAISE EXCEPTION 'A promotion makes its corporate approval itself'; END IF;
        -- stricter, never looser: no lab approves a vendor Corporate QA has suspended or rejected
        IF NEW.site_id IS NOT NULL AND NEW.approval_status = 'Approved' THEN
            c := vendor_corporate(NEW.supplier_id);
            IF c.id IS NOT NULL AND c.approval_status <> 'Approved' THEN
                RAISE EXCEPTION 'Corporate QA has % % for every lab (%): a lab cannot approve it', CASE WHEN c.approval_status = 'Suspended' THEN 'suspended' ELSE 'rejected' END,
                    (SELECT supplier_name FROM supplier WHERE id = NEW.supplier_id), c.qualification_code;
            END IF;
        END IF;
    END IF;
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NEW.site_id IS NULL THEN
        IF NOT has_corporate_permission('purchasing.qualify_corporate') THEN
            RAISE EXCEPTION 'Corporate (all labs) vendor approvals are made by Corporate QA. Approve the vendor for this lab, then propose it for corporate approval.';
        END IF;
    ELSE
        PERFORM require_permission_at('purchasing.qualify', NEW.site_id);
    END IF;
    PERFORM assert_signed(CASE TG_OP WHEN 'INSERT' THEN 'qualify a supplier' ELSE 'withdraw a supplier qualification' END);
    RETURN NEW;
END $$;

-- the shared risk classes are now Corporate QA's (and system administrators')
CREATE OR REPLACE FUNCTION supplier_risk_class_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.site_id IS DISTINCT FROM OLD.site_id THEN RAISE EXCEPTION 'A risk class cannot move between labs'; END IF;
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NEW.site_id IS NULL AND NOT has_corporate_permission('purchasing.qualify_corporate') THEN
        RAISE EXCEPTION 'The shared risk classes are kept by Corporate QA; add a class for your own lab instead';
    END IF;
    IF NEW.site_id IS NOT NULL THEN PERFORM require_permission_at('purchasing.qualify', NEW.site_id); END IF;
    PERFORM assert_signed('change the supplier risk classes');
    RETURN NEW;
END $$;

-------------------------------------------------------------------------------
-- 4. DOCUMENTS (the evidence behind an approval or a proposal)
-------------------------------------------------------------------------------
CREATE SEQUENCE vendor_promotion_seq;
CREATE TABLE vendor_promotion (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_code           text NOT NULL UNIQUE DEFAULT 'VP-' || lpad(nextval('vendor_promotion_seq')::text, 5, '0'),
    supplier_id              uuid NOT NULL REFERENCES supplier(id),
    site_id                  uuid NOT NULL REFERENCES lab_site(id),          -- the proposing lab
    from_qualification_id    uuid NOT NULL REFERENCES vendor_qualification(id),
    risk_class_id            uuid NOT NULL REFERENCES supplier_risk_class(id),
    scope_ids                uuid[],                                         -- NULL = every scope
    note                     text,
    status                   text NOT NULL DEFAULT 'Proposed' CHECK (status IN ('Proposed','Approved','Rejected','Withdrawn')),
    decided_by               uuid REFERENCES app_user(id),
    decided_at               timestamptz,
    decision_note            text,
    decision_signature_id    uuid REFERENCES signature_event(id),
    corporate_qualification_id uuid REFERENCES vendor_qualification(id),
    proposal_signature_id    uuid REFERENCES signature_event(id),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX vendor_promotion_open_uq ON vendor_promotion (supplier_id) WHERE status = 'Proposed';
CALL make_gxp('vendor_promotion', false);   -- each step is signed; a withdrawal asks its reason itself
ALTER TABLE vendor_qualification ADD CONSTRAINT vendor_qualification_promotion_fk FOREIGN KEY (promotion_id) REFERENCES vendor_promotion(id);
CREATE FUNCTION vendor_promotion_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT vendor_internal() THEN RAISE EXCEPTION 'A proposal for corporate approval changes only through Propose, Withdraw, Approve or Reject'; END IF;
    IF TG_OP = 'UPDATE' AND (NEW.supplier_id, NEW.site_id, NEW.from_qualification_id) IS DISTINCT FROM (OLD.supplier_id, OLD.site_id, OLD.from_qualification_id) THEN
        RAISE EXCEPTION 'A proposal stays with its vendor, lab and approval';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status <> 'Proposed' AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Proposal % is already %', OLD.promotion_code, lower(OLD.status);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON vendor_promotion FOR EACH ROW EXECUTE FUNCTION vendor_promotion_rules();

CREATE TABLE vendor_document (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    qualification_id    uuid REFERENCES vendor_qualification(id),
    promotion_id        uuid REFERENCES vendor_promotion(id),
    document_id         uuid NOT NULL REFERENCES document_file(id),
    doc_kind            text NOT NULL CHECK (doc_kind IN ('Questionnaire','Certificate','Audit report','Quality agreement','Other')),
    title               text,
    certificate_expires date,
    status              record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT vendor_document_one_owner CHECK ((qualification_id IS NULL) <> (promotion_id IS NULL))
);
CREATE INDEX vendor_document_qual_idx ON vendor_document (qualification_id);
CALL make_gxp('vendor_document');
CREATE FUNCTION vendor_document_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid; v_corp boolean; v_status text;
BEGIN
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - '{status,record_version,modified_at,modified_by}'::text[]) <> (to_jsonb(OLD) - '{status,record_version,modified_at,modified_by}'::text[]) THEN
        RAISE EXCEPTION 'A vendor document is never changed; withdraw it (entered in error) and attach the right one';
    END IF;
    IF NEW.qualification_id IS NOT NULL THEN
        SELECT site_id, site_id IS NULL INTO v_site, v_corp FROM vendor_qualification WHERE id = NEW.qualification_id;
    ELSE
        SELECT site_id, false, status INTO v_site, v_corp, v_status FROM vendor_promotion WHERE id = NEW.promotion_id;
        IF TG_OP = 'INSERT' AND v_status <> 'Proposed' AND NOT vendor_internal() THEN RAISE EXCEPTION 'The proposal is decided: its documents are closed'; END IF;
    END IF;
    IF vendor_internal() THEN RETURN NEW; END IF;
    IF v_corp THEN
        IF NOT has_corporate_permission('purchasing.qualify_corporate') THEN RAISE EXCEPTION 'Documents of a corporate approval are kept by Corporate QA'; END IF;
    ELSE
        PERFORM require_permission_at('purchasing.qualify', v_site);
    END IF;
    IF TG_OP = 'UPDATE' AND current_reason() IS NULL THEN RAISE EXCEPTION 'A Reason for Change is required to withdraw a vendor document'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON vendor_document FOR EACH ROW EXECUTE FUNCTION vendor_document_rules();

-------------------------------------------------------------------------------
-- 5. NOTICES TO THE LABS (a corporate block, a decided proposal); no emails: users have no address in the LIMS
-------------------------------------------------------------------------------
CREATE TABLE vendor_notice (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id          uuid NOT NULL REFERENCES lab_site(id),
    supplier_id      uuid NOT NULL REFERENCES supplier(id),
    qualification_id uuid REFERENCES vendor_qualification(id),
    promotion_id     uuid REFERENCES vendor_promotion(id),
    notice           text NOT NULL,
    acknowledged_by  uuid REFERENCES app_user(id),
    acknowledged_at  timestamptz,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX vendor_notice_site_idx ON vendor_notice (site_id) WHERE acknowledged_at IS NULL;
CALL make_gxp('vendor_notice', false);
CREATE FUNCTION vendor_notice_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF vendor_internal() THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'Vendor notices are written by the approvals themselves'; END IF;
    IF (to_jsonb(NEW) - '{acknowledged_by,acknowledged_at,record_version,modified_at,modified_by}'::text[])
       <> (to_jsonb(OLD) - '{acknowledged_by,acknowledged_at,record_version,modified_at,modified_by}'::text[]) OR OLD.acknowledged_at IS NOT NULL THEN
        RAISE EXCEPTION 'A notice is only acknowledged, once';
    END IF;
    PERFORM require_permission_at('purchasing.qualify', NEW.site_id);
    NEW.acknowledged_by := current_app_user(); NEW.acknowledged_at := clock_timestamp();
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON vendor_notice FOR EACH ROW EXECUTE FUNCTION vendor_notice_rules();

-- a corporate suspension or rejection: every lab is told, with how many of its open requests it stops
CREATE FUNCTION vendor_qualification_notices() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s lab_site; n integer; v_name text;
BEGIN
    IF NEW.site_id IS NOT NULL OR NEW.approval_status = 'Approved' THEN RETURN NULL; END IF;
    SELECT supplier_name INTO v_name FROM supplier WHERE id = NEW.supplier_id;
    PERFORM set_config('lims.vendor_internal', '1', true);
    FOR s IN SELECT * FROM lab_site LOOP
        SELECT count(*) INTO n FROM purchase_line WHERE supplier_id = NEW.supplier_id AND site_id = s.id
           AND status IN ('Requested','Awaiting second approval','Approved','Ordered','Partly received');
        INSERT INTO vendor_notice (site_id, supplier_id, qualification_id, notice)
        VALUES (s.id, NEW.supplier_id, NEW.id, 'Corporate QA ' || CASE WHEN NEW.approval_status = 'Suspended' THEN 'suspended ' ELSE 'rejected ' END || v_name
            || ' for every lab (' || NEW.qualification_code || ')' || COALESCE(': ' || NULLIF(btrim(NEW.justification), ''), '') || '.'
            || CASE WHEN n > 0 THEN ' ' || n || ' open request' || CASE WHEN n = 1 THEN ' is' ELSE 's are' END || ' stopped until it is approved again.' ELSE '' END);
    END LOOP;
    PERFORM set_config('lims.vendor_internal', '', true);
    RETURN NULL;
END $$;
CREATE TRIGGER z_notices AFTER INSERT ON vendor_qualification FOR EACH ROW EXECUTE FUNCTION vendor_qualification_notices();

-------------------------------------------------------------------------------
-- 6. PROPOSING A LOCAL APPROVAL FOR CORPORATE APPROVAL, AND DECIDING IT
-------------------------------------------------------------------------------
CREATE FUNCTION propose_vendor_promotion(p_qual uuid, p_risk_class uuid, p_scopes uuid[], p_note text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE q vendor_qualification; rc supplier_risk_class; c vendor_qualification; v_id uuid;
BEGIN
    SELECT * INTO q FROM vendor_qualification WHERE id = p_qual;
    IF q.id IS NULL OR q.status <> 'Active' THEN RAISE EXCEPTION 'Approval not found'; END IF;
    IF q.site_id IS NULL THEN RAISE EXCEPTION '% is already a corporate approval', q.qualification_code; END IF;
    PERFORM require_permission_at('purchasing.qualify', q.site_id);
    PERFORM assert_signed('propose a vendor for corporate approval');
    IF q.approval_status <> 'Approved' OR (q.expiration_date IS NOT NULL AND q.expiration_date < site_today(q.site_id)) THEN
        RAISE EXCEPTION 'Only a current approval of this lab can be proposed for corporate approval';
    END IF;
    IF (vendor_local(q.supplier_id, q.site_id)).id IS DISTINCT FROM q.id THEN RAISE EXCEPTION 'Propose the lab''s latest decision on this vendor'; END IF;
    c := vendor_corporate(q.supplier_id);
    IF c.id IS NOT NULL AND c.approval_status <> 'Approved' THEN
        RAISE EXCEPTION 'Corporate QA has % this vendor (%): it cannot be proposed', CASE WHEN c.approval_status = 'Suspended' THEN 'suspended' ELSE 'rejected' END, c.qualification_code;
    END IF;
    SELECT * INTO rc FROM supplier_risk_class WHERE id = p_risk_class;
    IF rc.id IS NULL OR rc.status <> 'Active' OR rc.site_id IS NOT NULL THEN
        RAISE EXCEPTION 'Choose one of the shared risk classes: a corporate approval uses those';
    END IF;
    IF p_scopes IS NOT NULL AND cardinality(p_scopes) = 0 THEN RAISE EXCEPTION 'Name what the vendor should be approved for'; END IF;
    p_scopes := COALESCE(p_scopes, q.scope_ids);   -- nothing named: what the lab approved
    IF NOT scopes_cover(q.scope_ids, p_scopes) OR (p_scopes IS NULL AND q.scope_ids IS NOT NULL) THEN
        RAISE EXCEPTION 'Propose only what this lab approved the vendor for (%)', scope_names(q.scope_ids);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vendor_document d WHERE d.qualification_id = q.id AND d.status = 'Active') THEN
        RAISE EXCEPTION 'Attach at least one document to the approval first (a questionnaire, a certificate or an audit report): Corporate QA decides on the evidence';
    END IF;
    IF EXISTS (SELECT 1 FROM vendor_promotion WHERE supplier_id = q.supplier_id AND status = 'Proposed') THEN
        RAISE EXCEPTION 'This vendor is already waiting for corporate approval (%)', (SELECT promotion_code FROM vendor_promotion WHERE supplier_id = q.supplier_id AND status = 'Proposed');
    END IF;
    PERFORM set_config('lims.vendor_internal', '1', true);
    INSERT INTO vendor_promotion (supplier_id, site_id, from_qualification_id, risk_class_id, scope_ids, note, proposal_signature_id)
    VALUES (q.supplier_id, q.site_id, q.id, rc.id, p_scopes, NULLIF(btrim(p_note), ''), NULLIF(current_setting('lims.signature_id', true), '')::uuid)
    RETURNING id INTO v_id;
    PERFORM set_config('lims.vendor_internal', '', true);
    RETURN v_id;
END $$;

CREATE FUNCTION withdraw_vendor_promotion(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p vendor_promotion;
BEGIN
    SELECT * INTO p FROM vendor_promotion WHERE id = p_id;
    IF p.id IS NULL THEN RAISE EXCEPTION 'Proposal not found'; END IF;
    PERFORM require_permission_at('purchasing.qualify', p.site_id);
    IF p.status <> 'Proposed' THEN RAISE EXCEPTION 'Proposal % is already %', p.promotion_code, lower(p.status); END IF;
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'Give the reason for withdrawing the proposal'; END IF;
    PERFORM set_config('lims.vendor_internal', '1', true);
    UPDATE vendor_promotion SET status = 'Withdrawn', decided_by = current_app_user(), decided_at = clock_timestamp(), decision_note = current_reason() WHERE id = p_id;
    PERFORM set_config('lims.vendor_internal', '', true);
END $$;

-- Corporate QA decides (signed; never the person who proposed it). Approving makes the corporate approval, with the
-- risk class and scopes Corporate QA settles on (at most what the lab approved), and carries the lab's documents.
CREATE FUNCTION decide_vendor_promotion(p_id uuid, p_decision text, p_note text, p_risk_class uuid DEFAULT NULL, p_scopes uuid[] DEFAULT NULL, p_all_scopes boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE p vendor_promotion; q vendor_qualification; v_q uuid; v_scopes uuid[]; v_rc uuid; v_name text;
BEGIN
    SELECT * INTO p FROM vendor_promotion WHERE id = p_id FOR UPDATE;
    IF p.id IS NULL THEN RAISE EXCEPTION 'Proposal not found'; END IF;
    IF NOT has_corporate_permission('purchasing.qualify_corporate') THEN
        RAISE EXCEPTION 'Only Corporate QA (purchasing.qualify_corporate) decides proposals for corporate approval';
    END IF;
    PERFORM assert_signed(CASE WHEN p_decision = 'Approved' THEN 'approve a vendor for every lab' ELSE 'reject a proposal for corporate approval' END);
    IF p.status <> 'Proposed' THEN RAISE EXCEPTION 'Proposal % is already %', p.promotion_code, lower(p.status); END IF;
    IF p.created_by = current_app_user() THEN RAISE EXCEPTION 'You proposed %: someone else in Corporate QA decides it', p.promotion_code; END IF;
    IF p_decision NOT IN ('Approved','Rejected') THEN RAISE EXCEPTION 'Approve or reject the proposal'; END IF;
    IF p_decision = 'Rejected' AND COALESCE(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'Say why the proposal is rejected (the lab sees it)'; END IF;
    SELECT * INTO q FROM vendor_qualification WHERE id = p.from_qualification_id;
    SELECT supplier_name INTO v_name FROM supplier WHERE id = p.supplier_id;
    PERFORM set_config('lims.vendor_internal', '1', true);
    IF p_decision = 'Approved' THEN
        v_rc := COALESCE(p_risk_class, p.risk_class_id);
        v_scopes := CASE WHEN p_all_scopes THEN NULL ELSE COALESCE(p_scopes, p.scope_ids) END;
        IF v_scopes IS NOT NULL AND cardinality(v_scopes) = 0 THEN RAISE EXCEPTION 'Name what the vendor is approved for'; END IF;
        IF NOT scopes_cover(q.scope_ids, v_scopes) OR (v_scopes IS NULL AND q.scope_ids IS NOT NULL) THEN
            RAISE EXCEPTION 'A corporate approval covers at most what the lab approved (%)', scope_names(q.scope_ids);
        END IF;
        INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, accreditations, approval_date, justification, scope_ids, promoted_from_id, promotion_id)
        VALUES (p.supplier_id, NULL, v_rc, 'Approved', q.accreditations, site_today(p.site_id),
                'Corporate approval from ' || (SELECT site_code FROM lab_site WHERE id = p.site_id) || '''s ' || q.qualification_code || ' (' || p.promotion_code || ')'
                    || COALESCE(': ' || NULLIF(btrim(p_note), ''), ''), v_scopes, q.id, p.id)
        RETURNING id INTO v_q;
        INSERT INTO vendor_document (qualification_id, document_id, doc_kind, title, certificate_expires)
        SELECT v_q, d.document_id, d.doc_kind, d.title, d.certificate_expires FROM vendor_document d
         WHERE d.status = 'Active' AND (d.qualification_id = q.id OR d.promotion_id = p.id);
    END IF;
    UPDATE vendor_promotion SET status = p_decision, decided_by = current_app_user(), decided_at = clock_timestamp(), decision_note = NULLIF(btrim(p_note), ''),
           decision_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid, corporate_qualification_id = v_q
     WHERE id = p.id;
    INSERT INTO vendor_notice (site_id, supplier_id, qualification_id, promotion_id, notice)
    VALUES (p.site_id, p.supplier_id, v_q, p.id, CASE WHEN p_decision = 'Approved'
        THEN 'Corporate QA approved ' || v_name || ' for every lab (' || p.promotion_code || '; ' || scope_names(v_scopes) || ').'
        ELSE 'Corporate QA did not approve ' || v_name || ' for every lab (' || p.promotion_code || '): ' || btrim(p_note) || ' This lab''s own approval stands.' END);
    PERFORM set_config('lims.vendor_internal', '', true);
    RETURN COALESCE(v_q, p.id);
END $$;

CREATE FUNCTION acknowledge_vendor_notices(p_ids uuid[]) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
    UPDATE vendor_notice SET acknowledged_at = clock_timestamp() WHERE id = ANY (p_ids) AND acknowledged_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

-------------------------------------------------------------------------------
-- 7. PURCHASE REQUESTS NAME THEIR SCOPES; A VENDOR MUST BE APPROVED FOR THEM
-------------------------------------------------------------------------------
ALTER TABLE purchase_line ADD COLUMN scope_ids uuid[];
CREATE FUNCTION purchase_line_default_scopes(p_type purchase_line_type, p_lot uuid) RETURNS uuid[] LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p_type = 'Inventory item' THEN
                    NULLIF(ARRAY(SELECT DISTINCT s.id FROM inventory_lot l JOIN supply_scope s ON s.status = 'Active' AND s.chemical_types && l.chemical_types
                                  WHERE l.id = p_lot ORDER BY 1), '{}')
                ELSE (SELECT ARRAY[s.id] FROM supply_scope s WHERE s.status = 'Active' AND s.default_for = p_type) END
$$;
CREATE FUNCTION purchase_line_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bad text;
BEGIN
    IF NEW.line_type IN ('Inventory item', 'Equipment') THEN
        NEW.scope_ids := purchase_line_default_scopes(NEW.line_type, NEW.lot_id);   -- from the item, never chosen
    ELSIF NEW.scope_ids IS NULL OR cardinality(NEW.scope_ids) = 0 THEN
        NEW.scope_ids := purchase_line_default_scopes(NEW.line_type, NULL);
    ELSIF TG_OP = 'INSERT' OR NEW.scope_ids IS DISTINCT FROM OLD.scope_ids THEN
        SELECT string_agg(COALESCE(s.scope_name, x::text), ', ') INTO bad FROM unnest(NEW.scope_ids) x LEFT JOIN supply_scope s ON s.id = x
         WHERE s.id IS NULL OR s.status <> 'Active' OR NOT (NEW.line_type = ANY (s.line_types));
        IF bad IS NOT NULL THEN RAISE EXCEPTION 'A % request cannot be for %', lower(NEW.line_type::text), bad; END IF;
    END IF;
    -- the same moments as 011's supplier check: requesting, approving, ordering, or changing the supplier or the scopes
    IF NEW.status IN ('Requested','Awaiting second approval','Approved','Ordered') AND NOT in_group_sync()
       AND (TG_OP = 'INSERT' OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.status IS DISTINCT FROM OLD.status OR NEW.scope_ids IS DISTINCT FROM OLD.scope_ids) THEN
        PERFORM assert_supplier_scope(NEW.supplier_id, NEW.site_id, NEW.scope_ids,
            CASE WHEN NEW.status = 'Ordered' THEN 'order' WHEN NEW.status = 'Requested' THEN 'request' ELSE 'approve a purchase' END);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a00_scope BEFORE INSERT OR UPDATE ON purchase_line FOR EACH ROW EXECUTE FUNCTION purchase_line_scope();
-- open requests get their scopes now (closed ones keep none; nothing is checked for them)
UPDATE purchase_line SET scope_ids = purchase_line_default_scopes(line_type, lot_id)
 WHERE status IN ('Requested','Awaiting second approval','Approved','Ordered','Partly received');

-------------------------------------------------------------------------------
-- 8. VIEWS FOR THE VENDOR APPROVALS PAGE
-------------------------------------------------------------------------------
-- every vendor at every lab: its local and corporate decision, what applies here, and what waits
CREATE VIEW vendor_approval_view AS
SELECT s.id AS supplier_id, ls.id AS site_id, s.supplier_code, s.supplier_name, s.supplier_type, s.status AS supplier_record_status,
       d.status AS approval_status, d.decided_at, d.expires AS approved_until,
       lq.id AS local_id, lq.qualification_code AS local_code, lq.approval_status::text AS local_status, lq.expiration_date AS local_until,
       CASE WHEN lq.approval_status = 'Approved' THEN scope_names(lq.scope_ids) END AS local_scopes, lrc.class_name AS local_class,
       cq.id AS corporate_id, cq.qualification_code AS corporate_code, cq.approval_status::text AS corporate_status, cq.expiration_date AS corporate_until,
       CASE WHEN cq.approval_status = 'Approved' THEN scope_names(cq.scope_ids) END AS corporate_scopes, crc.class_name AS corporate_class,
       vp.id AS promotion_id, vp.promotion_code, vp.site_id AS promotion_site_id,
       (SELECT count(*) FROM vendor_document vd WHERE vd.status = 'Active' AND vd.qualification_id IN (lq.id, cq.id))::int AS document_count,
       (SELECT min(vd.certificate_expires) FROM vendor_document vd WHERE vd.status = 'Active' AND vd.qualification_id IN (lq.id, cq.id) AND vd.certificate_expires IS NOT NULL) AS next_certificate_expiry,
       (SELECT count(*) FROM purchase_line pl WHERE pl.supplier_id = s.id AND pl.site_id = ls.id
           AND pl.status IN ('Requested','Awaiting second approval','Approved','Ordered')
           AND (SELECT x.status FROM vendor_decision(pl.supplier_id, pl.site_id, pl.scope_ids) x) <> 'Approved')::int AS stopped_requests
  FROM supplier s CROSS JOIN lab_site ls
  CROSS JOIN LATERAL vendor_decision(s.id, ls.id, NULL) d
  LEFT JOIN LATERAL (SELECT * FROM vendor_qualification q WHERE q.supplier_id = s.id AND q.site_id = ls.id AND q.status = 'Active' ORDER BY q.approval_date DESC, q.created_at DESC LIMIT 1) lq ON true
  LEFT JOIN supplier_risk_class lrc ON lrc.id = lq.risk_class_id
  LEFT JOIN LATERAL (SELECT * FROM vendor_qualification q WHERE q.supplier_id = s.id AND q.site_id IS NULL AND q.status = 'Active' ORDER BY q.approval_date DESC, q.created_at DESC LIMIT 1) cq ON true
  LEFT JOIN supplier_risk_class crc ON crc.id = cq.risk_class_id
  LEFT JOIN vendor_promotion vp ON vp.supplier_id = s.id AND vp.status = 'Proposed';

CREATE VIEW vendor_promotion_view AS
SELECT p.*, s.supplier_code, s.supplier_name, ls.site_code, q.qualification_code AS from_code, q.expiration_date AS from_until,
       scope_names(p.scope_ids) AS scope_text, scope_names(q.scope_ids) AS from_scope_text, rc.class_name,
       u.full_name AS proposed_by_name, du.full_name AS decided_by_name, cq.qualification_code AS corporate_code,
       (SELECT count(*) FROM vendor_document d WHERE d.status = 'Active' AND (d.qualification_id = q.id OR d.promotion_id = p.id))::int AS document_count
  FROM vendor_promotion p JOIN supplier s ON s.id = p.supplier_id JOIN lab_site ls ON ls.id = p.site_id
  JOIN vendor_qualification q ON q.id = p.from_qualification_id JOIN supplier_risk_class rc ON rc.id = p.risk_class_id
  JOIN app_user u ON u.id = p.created_by LEFT JOIN app_user du ON du.id = p.decided_by
  LEFT JOIN vendor_qualification cq ON cq.id = p.corporate_qualification_id;

-------------------------------------------------------------------------------
-- 9. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_050;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'supply_scope' THEN
        RETURN jsonb_build_object('label', 'Supply scope ' || COALESCE(r->>'scope_name', ''), 'link', '#/purchasing/risk-classes');
    ELSIF p_table = 'vendor_promotion' THEN
        RETURN jsonb_build_object('label', 'Proposal ' || COALESCE(r->>'promotion_code', '') || ' for corporate approval: ' || COALESCE((SELECT supplier_name FROM supplier WHERE id = (r->>'supplier_id')::uuid), ''),
            'link', '#/purchasing/suppliers/' || COALESCE(r->>'supplier_id', ''));
    ELSIF p_table = 'vendor_document' THEN
        RETURN jsonb_build_object('label', 'Vendor document ' || COALESCE(r->>'doc_kind', '') || COALESCE(' ' || (r->>'title'), ''),
            'link', '#/purchasing/suppliers/' || COALESCE((SELECT supplier_id::text FROM vendor_qualification WHERE id = (r->>'qualification_id')::uuid),
                                                          (SELECT supplier_id::text FROM vendor_promotion WHERE id = (r->>'promotion_id')::uuid), ''));
    ELSIF p_table = 'vendor_notice' THEN
        RETURN jsonb_build_object('label', 'Vendor notice: ' || left(COALESCE(r->>'notice', ''), 80), 'link', '#/purchasing/vendors');
    END IF;
    RETURN audit_record_ref_050(p_table, p_id, r);
END $$;

COMMIT;
