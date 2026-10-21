-- LIMS3 schema, migration 001
-- Core GxP patterns (audit trail, versioning, no hard delete) + Client, Contact, Analyte
-- PostgreSQL 16

BEGIN;

CREATE SCHEMA IF NOT EXISTS lims;
SET search_path = lims, public;
-- gen_random_uuid() is built into PostgreSQL 13+ (no extension needed)

-------------------------------------------------------------------------------
-- 1. USERS (minimal; full Roles & Permissions module comes later)
-------------------------------------------------------------------------------
CREATE TABLE app_user (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username    text NOT NULL UNIQUE,
    full_name   text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- The application sets these per transaction:
--   SET LOCAL lims.user_id = '<uuid>';
--   SET LOCAL lims.reason  = 'Reason for change text';
CREATE FUNCTION current_app_user() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE v text := current_setting('lims.user_id', true);
BEGIN
    IF v IS NULL OR v = '' THEN
        RAISE EXCEPTION 'No user context: every change must be attributable (SET lims.user_id)';
    END IF;
    RETURN v::uuid;
END $$;

CREATE FUNCTION current_reason() RETURNS text LANGUAGE sql STABLE AS $$
    SELECT NULLIF(btrim(current_setting('lims.reason', true)), '')
$$;

-------------------------------------------------------------------------------
-- 2. AUDIT TRAIL (append-only, written by the database, not the app)
-------------------------------------------------------------------------------
CREATE TABLE audit_log (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name      text        NOT NULL,
    record_id       uuid        NOT NULL,
    action          text        NOT NULL CHECK (action IN ('CREATE','UPDATE')),
    record_version  integer     NOT NULL,
    changed_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
    changed_by      uuid        NOT NULL REFERENCES app_user(id),
    reason          text,
    changed_fields  jsonb       NOT NULL,   -- {"field": {"old": x, "new": y}}
    new_row         jsonb       NOT NULL
);
CREATE INDEX audit_log_record_idx ON audit_log (table_name, record_id, changed_at);

CREATE FUNCTION audit_log_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP;
END $$;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();

-------------------------------------------------------------------------------
-- 3. GENERIC GxP TRIGGERS, attached to every regulated table
-------------------------------------------------------------------------------
-- Every regulated table carries these columns:
--   id uuid, record_version int, created_at, created_by, modified_at, modified_by

CREATE FUNCTION gxp_stamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.record_version := 1;
        NEW.created_at     := clock_timestamp();
        NEW.created_by     := current_app_user();
        NEW.modified_at    := NEW.created_at;
        NEW.modified_by    := NEW.created_by;
    ELSE
        IF NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by THEN
            RAISE EXCEPTION 'Identity and creation fields are immutable on %', TG_TABLE_NAME;
        END IF;
        IF NEW IS NOT DISTINCT FROM OLD THEN
            RETURN NULL;  -- no-op update: nothing to version or audit
        END IF;
        -- TG_ARGV[0] = 'reason_optional' for commercial draft tables (still fully audited)
        IF current_reason() IS NULL AND COALESCE(TG_ARGV[0], '') <> 'reason_optional' THEN
            RAISE EXCEPTION 'A Reason for Change is required to modify % (SET lims.reason)', TG_TABLE_NAME;
        END IF;
        NEW.record_version := OLD.record_version + 1;
        NEW.modified_at    := clock_timestamp();
        NEW.modified_by    := current_app_user();
    END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION gxp_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
    n jsonb := to_jsonb(NEW);
    diff jsonb;
BEGIN
    SELECT COALESCE(jsonb_object_agg(k, jsonb_build_object('old', o->k, 'new', n->k)), '{}'::jsonb)
      INTO diff
      FROM jsonb_object_keys(n) AS k
     WHERE (o->k) IS DISTINCT FROM (n->k)
       AND k NOT IN ('record_version','modified_at','modified_by','created_at','created_by');

    INSERT INTO audit_log (table_name, record_id, action, record_version, changed_by, reason, changed_fields, new_row)
    VALUES (TG_TABLE_NAME, NEW.id,
            CASE TG_OP WHEN 'INSERT' THEN 'CREATE' ELSE 'UPDATE' END,
            NEW.record_version, current_app_user(), current_reason(), diff, n);
    RETURN NULL;
END $$;

CREATE FUNCTION gxp_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Records in % cannot be deleted; set the status to Inactive/Retired instead', TG_TABLE_NAME;
END $$;

-- One call wires a table into the GxP pattern
CREATE PROCEDURE make_gxp(tbl regclass, reason_required boolean DEFAULT true) LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION lims.gxp_stamp(%L)', 'gxp_stamp', tbl,
                   CASE WHEN reason_required THEN 'reason_required' ELSE 'reason_optional' END);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION lims.gxp_audit()', 'gxp_audit', tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %s FOR EACH ROW EXECUTE FUNCTION lims.gxp_no_delete()', 'gxp_no_delete', tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION lims.gxp_no_delete()', 'gxp_no_truncate', tbl);
END $$;

-------------------------------------------------------------------------------
-- 4. HUMAN-READABLE CODES (CL-00001, CT-00001, ANL-00001)
-------------------------------------------------------------------------------
CREATE SEQUENCE client_code_seq;
CREATE SEQUENCE contact_code_seq;
CREATE SEQUENCE analyte_code_seq;

-------------------------------------------------------------------------------
-- 5. ANALYTE (static master data, independent of Inventory)
-------------------------------------------------------------------------------
CREATE TYPE analyte_class  AS ENUM ('Chemical','Microbiological','Physical/General');
CREATE TYPE master_status  AS ENUM ('Active','Retired');

-- CAS Registry Number check-digit validation
CREATE FUNCTION is_valid_cas(cas text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE digits text; total int := 0; i int; n int;
BEGIN
    IF cas IS NULL THEN RETURN true; END IF;
    IF cas !~ '^\d{2,7}-\d{2}-\d$' THEN RETURN false; END IF;
    digits := replace(substring(cas from '^(\d+-\d{2})'), '-', '');
    n := length(digits);
    FOR i IN 1..n LOOP
        total := total + (substr(digits, n - i + 1, 1))::int * i;
    END LOOP;
    RETURN (total % 10) = right(cas, 1)::int;
END $$;

CREATE TABLE analyte (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    analyte_code    text NOT NULL UNIQUE DEFAULT 'ANL-' || lpad(nextval('analyte_code_seq')::text, 5, '0'),
    analyte_name    text NOT NULL CHECK (btrim(analyte_name) <> ''),
    report_name     text NOT NULL CHECK (btrim(report_name) <> ''),
    analyte_class   analyte_class NOT NULL,
    cas_number      text CHECK (is_valid_cas(cas_number)),
    synonyms        text[] NOT NULL DEFAULT '{}',
    status          master_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT cas_only_for_chemicals CHECK (cas_number IS NULL OR analyte_class = 'Chemical')
);
CREATE UNIQUE INDEX analyte_name_uq ON analyte (lower(analyte_name));
CALL make_gxp('analyte');

-- Report Name defaults to Analyte Name when not supplied
CREATE FUNCTION analyte_default_report_name() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.report_name IS NULL OR btrim(NEW.report_name) = '' THEN
        NEW.report_name := NEW.analyte_name;
    END IF;
    RETURN NEW;
END $$;
ALTER TABLE analyte ALTER COLUMN report_name DROP NOT NULL;
CREATE TRIGGER a_analyte_default_report_name BEFORE INSERT ON analyte
    FOR EACH ROW EXECUTE FUNCTION analyte_default_report_name();
ALTER TABLE analyte ADD CONSTRAINT report_name_present CHECK (report_name IS NOT NULL);

-------------------------------------------------------------------------------
-- 6. CLIENT
-------------------------------------------------------------------------------
-- Active: normal. On Hold: samples may be logged and tested, but reports cannot be released or sent.
-- Inactive: no new orders. Hold applies to that client only; it never cascades to child clients.
CREATE TYPE account_status  AS ENUM ('Active','On Hold','Inactive');
CREATE TYPE report_delivery AS ENUM ('Email','Portal');

CREATE TABLE client (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_code             text NOT NULL UNIQUE DEFAULT 'CL-' || lpad(nextval('client_code_seq')::text, 5, '0'),
    legal_name              text NOT NULL CHECK (btrim(legal_name) <> ''),
    display_name            text,
    parent_client_id        uuid REFERENCES client(id),
    account_status          account_status NOT NULL DEFAULT 'Active',
    is_gmp_client           boolean NOT NULL DEFAULT false,
    billing_address         text,
    site_address            text,
    default_report_delivery report_delivery,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT client_not_own_parent CHECK (parent_client_id IS NULL OR parent_client_id <> id)
);
CREATE UNIQUE INDEX client_legal_name_uq ON client (lower(legal_name));
CREATE INDEX client_parent_idx ON client (parent_client_id);
CALL make_gxp('client');

-- Prevent parent/child loops (A -> B -> A)
CREATE FUNCTION client_no_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.parent_client_id IS NOT NULL AND EXISTS (
        WITH RECURSIVE up AS (
            SELECT id, parent_client_id FROM client WHERE id = NEW.parent_client_id
            UNION ALL
            SELECT c.id, c.parent_client_id FROM client c JOIN up ON c.id = up.parent_client_id
        )
        SELECT 1 FROM up WHERE id = NEW.id
    ) THEN
        RAISE EXCEPTION 'Parent Client would create a loop in the client hierarchy';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER b_client_no_cycle BEFORE INSERT OR UPDATE OF parent_client_id ON client
    FOR EACH ROW EXECUTE FUNCTION client_no_cycle();

-- Decision: On Hold still allows orders, sample login and testing. Only Inactive blocks new orders.
-- Client Order (migration 002) will call this in its insert trigger.
CREATE FUNCTION client_can_order(p_client uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT account_status IN ('Active','On Hold') FROM client WHERE id = p_client
$$;

-- Decision: On Hold blocks release and sending of reports. Inactive clients can still receive
-- reports for work already in the lab. Report release (later migration) will call this.
CREATE FUNCTION client_can_release_report(p_client uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT account_status <> 'On Hold' FROM client WHERE id = p_client
$$;

-------------------------------------------------------------------------------
-- 7. CONTACT (one person, linked to one or many clients)
-------------------------------------------------------------------------------
CREATE TYPE record_status AS ENUM ('Active','Inactive');

CREATE TABLE contact (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_code    text NOT NULL UNIQUE DEFAULT 'CT-' || lpad(nextval('contact_code_seq')::text, 5, '0'),
    first_name      text NOT NULL CHECK (btrim(first_name) <> ''),
    last_name       text NOT NULL CHECK (btrim(last_name) <> ''),
    email           text NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    phone           text,
    job_title       text,
    portal_access   boolean NOT NULL DEFAULT false,   -- may log in to the portal at all
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
-- One person = one record: email is unique across the whole system
CREATE UNIQUE INDEX contact_email_uq ON contact (lower(email));
CALL make_gxp('contact');

-- Contact Role lookup: adding a new type is data, not a schema change
CREATE TABLE contact_role (
    role_code    text PRIMARY KEY,
    role_name    text NOT NULL UNIQUE,
    description  text NOT NULL,
    one_per_client boolean NOT NULL DEFAULT false,
    sort_order   integer NOT NULL
);
INSERT INTO contact_role VALUES
 ('PRIMARY',  'Primary Contact',   'Main point of contact for the account. One per client.', true, 1),
 ('SECONDARY','Secondary Contact', 'Backup point of contact; copied on account communications. Any number per client.', false, 2),
 ('ORDERING', 'Ordering Contact',  'May submit orders and samples on behalf of this client.', false, 3),
 ('REPORT',   'Receives Report',   'Receives Certificates of Analysis and reports.', false, 4),
 ('BILLING',  'Billing Contact',   'Receives quotes, invoices and statements.', false, 5),
 ('QUALITY',  'Quality Contact',   'Notified of out-of-specification results, sample discrepancies and deviations.', false, 6);

-- The link: which contact acts for which client, in which roles
CREATE TABLE client_contact (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       uuid NOT NULL REFERENCES client(id),
    contact_id      uuid NOT NULL REFERENCES contact(id),
    roles           text[] NOT NULL CHECK (cardinality(roles) > 0),
    portal_visible  boolean NOT NULL DEFAULT true,  -- may see this client's orders/reports in the portal
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (client_id, contact_id)
);
CREATE INDEX client_contact_contact_idx ON client_contact (contact_id);
CALL make_gxp('client_contact');

CREATE FUNCTION client_contact_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bad text; r text;
BEGIN
    SELECT x INTO bad FROM unnest(NEW.roles) x
     WHERE x NOT IN (SELECT role_code FROM contact_role) LIMIT 1;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'Unknown Contact Role: %', bad;
    END IF;
    NEW.roles := ARRAY(SELECT DISTINCT x FROM unnest(NEW.roles) x ORDER BY x);
    IF 'PRIMARY' = ANY(NEW.roles) AND 'SECONDARY' = ANY(NEW.roles) THEN
        RAISE EXCEPTION 'A contact cannot be both Primary and Secondary for the same client';
    END IF;
    IF NEW.status = 'Active' THEN
        FOR r IN SELECT role_code FROM contact_role WHERE one_per_client AND role_code = ANY(NEW.roles) LOOP
            IF EXISTS (SELECT 1 FROM client_contact cc
                        WHERE cc.client_id = NEW.client_id AND cc.id <> NEW.id
                          AND cc.status = 'Active' AND r = ANY(cc.roles)) THEN
                RAISE EXCEPTION 'Client already has an active % contact', r;
            END IF;
        END LOOP;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER b_client_contact_validate BEFORE INSERT OR UPDATE ON client_contact
    FOR EACH ROW EXECUTE FUNCTION client_contact_validate();

-- Used by Client Order and the portal
CREATE FUNCTION contact_can_order(p_contact uuid, p_client uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM client_contact cc
          JOIN contact ct ON ct.id = cc.contact_id
         WHERE cc.contact_id = p_contact AND cc.client_id = p_client
           AND cc.status = 'Active' AND ct.status = 'Active'
           AND 'ORDERING' = ANY(cc.roles)
    ) AND COALESCE(client_can_order(p_client), false)
$$;

-- Which clients a contact sees in the portal (explicit links only; no inheritance from Parent Client)
CREATE VIEW contact_portal_clients AS
SELECT cc.contact_id, c.id AS client_id, c.client_code, COALESCE(c.display_name, c.legal_name) AS client_name, cc.roles
  FROM client_contact cc
  JOIN contact ct ON ct.id = cc.contact_id
  JOIN client  c  ON c.id  = cc.client_id
 WHERE cc.status = 'Active' AND cc.portal_visible AND ct.status = 'Active' AND ct.portal_access;

COMMIT;
