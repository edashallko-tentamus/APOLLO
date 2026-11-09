-- 055: training counts per department, the METRC ID on samples, client licenses (Claude Code, 2026-10-20; version 0.32.0).
-- Alex, 2026-10-20:
--  - "I want each department to set the amount of trained tests not for the whole lab." Every department now has its
--    own training rule (made from the lab's rule, which stays only for tests that belong to no department); a new
--    department gets one the same way.
--  - "on the lab order page we need to put a place for the METRC ID in cannabis samples." sample.metrc_id: optional,
--    a METRC package tag (24 characters, starting 1A), printed on the COA and the chain of custody when present.
--  - "the client profile contains a section that can add licenses with expiration dates. This should be additive and
--    able to be recalled within the system." client_license: type, number, issuing authority, issued and expiry
--    dates, an optional scanned copy; never deleted (a renewal is a new license; an old one is retired with a reason).
--    A lab order can name one of its client's licenses (an expired one is flagged, not refused); the COA prints it;
--    licenses expiring within 30 days or expired are listed (Intake > Client licenses) and shown on the client page.
-- Permissions: none new. Licenses are client master data (master.clients); the METRC ID and the order's license are
-- part of the order (orders.edit); department rules are training.configure.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.reason', 'Migration 055: training per department, METRC ID, client licenses', true);

-------------------------------------------------------------------------------
-- 1. A TRAINING RULE FOR EVERY DEPARTMENT
-------------------------------------------------------------------------------
CREATE FUNCTION training_rule_for_new_department(p_dept uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d department; l training_rule;
BEGIN
    SELECT * INTO d FROM department WHERE id = p_dept;
    IF d.id IS NULL OR EXISTS (SELECT 1 FROM training_rule WHERE department_id = p_dept AND status = 'Active') THEN RETURN; END IF;
    SELECT * INTO l FROM training_rule WHERE site_id = d.site_id AND department_id IS NULL AND status = 'Active';
    PERFORM set_config('lims.group_sync', '1', true);
    INSERT INTO training_rule (site_id, department_id, dept_trained_after, unlock_any_test, unlock_can_train, continuing_months, due_soon_days,
                               min_runs, min_runs_months, allow_training_samples, allow_records)
    VALUES (d.site_id, d.id, COALESCE(l.dept_trained_after, 4), COALESCE(l.unlock_any_test, true), COALESCE(l.unlock_can_train, true),
            CASE WHEN l.id IS NULL THEN 12 ELSE l.continuing_months END, COALESCE(l.due_soon_days, 30),
            l.min_runs, l.min_runs_months, COALESCE(l.allow_training_samples, true), COALESCE(l.allow_records, true));
    PERFORM set_config('lims.group_sync', '', true);
END $$;
SELECT training_rule_for_new_department(id) FROM department WHERE status = 'Active';

CREATE FUNCTION department_training_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM training_rule_for_new_department(NEW.id);
    RETURN NEW;
END $$;
CREATE TRIGGER zz_training_rule AFTER INSERT ON department FOR EACH ROW EXECUTE FUNCTION department_training_rule();

-------------------------------------------------------------------------------
-- 2. THE METRC ID ON A SAMPLE
-------------------------------------------------------------------------------
ALTER TABLE sample ADD COLUMN metrc_id text;
CREATE FUNCTION sample_metrc_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.metrc_id := NULLIF(upper(regexp_replace(COALESCE(NEW.metrc_id, ''), '\s', '', 'g')), '');
    IF NEW.metrc_id IS NOT NULL AND NEW.metrc_id !~ '^1A[0-9A-Z]{22}$' THEN
        RAISE EXCEPTION 'METRC ID % is not a METRC tag: 24 letters and digits, starting with 1A', NEW.metrc_id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_sample_metrc BEFORE INSERT OR UPDATE OF metrc_id ON sample FOR EACH ROW EXECUTE FUNCTION sample_metrc_rule();
CREATE INDEX sample_metrc_idx ON sample (metrc_id) WHERE metrc_id IS NOT NULL;

-------------------------------------------------------------------------------
-- 3. CLIENT LICENSES
-------------------------------------------------------------------------------
CREATE SEQUENCE client_license_seq;
CREATE TABLE client_license (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    license_code        text NOT NULL UNIQUE DEFAULT 'LIC-' || lpad(nextval('client_license_seq')::text, 5, '0'),
    client_id           uuid NOT NULL REFERENCES client(id),
    license_type        text NOT NULL CHECK (btrim(license_type) <> ''),     -- e.g. Cannabis distributor, FDA registration
    license_number      text NOT NULL CHECK (btrim(license_number) <> ''),
    issuing_authority   text,                                               -- e.g. California DCC, FDA
    issued_on           date,
    expires_on          date,                                               -- empty: does not expire
    document_id         uuid REFERENCES document_file(id),                 -- a scanned copy
    note                text,
    status              master_status NOT NULL DEFAULT 'Active',            -- Retired: kept, no longer offered
    retired_reason      text,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT client_license_dates CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);
CREATE UNIQUE INDEX client_license_uq ON client_license (client_id, lower(btrim(license_type)), lower(btrim(license_number)), COALESCE(expires_on, 'infinity'::date)) WHERE status = 'Active';
CALL make_gxp('client_license');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON client_license FOR EACH ROW EXECUTE FUNCTION require_list_permission('master.clients');
CREATE FUNCTION client_license_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.license_type := btrim(NEW.license_type); NEW.license_number := btrim(NEW.license_number);
    IF TG_OP = 'UPDATE' AND NEW.client_id <> OLD.client_id THEN RAISE EXCEPTION 'A license stays with its client'; END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'Retired' AND NEW.status = 'Retired' AND (NEW.license_number, NEW.expires_on, NEW.issued_on, NEW.license_type) IS DISTINCT FROM (OLD.license_number, OLD.expires_on, OLD.issued_on, OLD.license_type) THEN
        RAISE EXCEPTION 'A retired license is kept as it was';
    END IF;
    IF NEW.status = 'Retired' AND COALESCE(btrim(NEW.retired_reason), '') = '' THEN RAISE EXCEPTION 'Say why the license is retired (e.g. replaced by a renewal, entered in error)'; END IF;
    IF NEW.status = 'Active' THEN NEW.retired_reason := NULL; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_rules BEFORE INSERT OR UPDATE ON client_license FOR EACH ROW EXECUTE FUNCTION client_license_rules();

-- Current, Expiring soon (expires within 30 days), Expired, Retired
CREATE FUNCTION license_state(p_expires date, p_status text) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p_status = 'Retired' THEN 'Retired'
                WHEN p_expires IS NULL THEN 'Current'
                WHEN p_expires < current_date THEN 'Expired'
                WHEN p_expires <= current_date + 30 THEN 'Expiring soon'
                ELSE 'Current' END
$$;
CREATE VIEW client_license_view AS
SELECT l.*, l.status::text AS status_text, license_state(l.expires_on, l.status::text) AS state,
       CASE WHEN l.expires_on IS NULL THEN NULL ELSE l.expires_on - current_date END AS days_left,
       COALESCE(c.display_name, c.legal_name) AS client_name, c.client_code, c.account_status::text AS account_status,
       f.file_name AS document_name, u.full_name AS created_by_name
  FROM client_license l JOIN client c ON c.id = l.client_id LEFT JOIN document_file f ON f.id = l.document_id JOIN app_user u ON u.id = l.created_by;

-- the order names one of its client's licenses (optional; an expired one is shown as such, not refused)
ALTER TABLE lab_order ADD COLUMN client_license_id uuid REFERENCES client_license(id);
CREATE FUNCTION lab_order_license_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l client_license;
BEGIN
    IF NEW.client_license_id IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO l FROM client_license WHERE id = NEW.client_license_id;
    IF l.client_id <> NEW.client_id THEN RAISE EXCEPTION 'License % belongs to another client', l.license_code; END IF;
    IF l.status = 'Retired' AND (TG_OP = 'INSERT' OR NEW.client_license_id IS DISTINCT FROM OLD.client_license_id) THEN
        RAISE EXCEPTION 'License % is retired: choose a current one', l.license_code;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_order_license BEFORE INSERT OR UPDATE OF client_license_id, client_id ON lab_order FOR EACH ROW EXECUTE FUNCTION lab_order_license_rule();

-- audit labels: a license links to its client (the router of 054 sits under this layer)
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_055;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'client_license' THEN
        RETURN jsonb_build_object('label', 'License ' || COALESCE(r->>'license_code', '') || ': ' || COALESCE(r->>'license_type', '') || ' ' || COALESCE(r->>'license_number', ''),
                                  'link', '#/clients/' || COALESCE(r->>'client_id', ''));
    END IF;
    RETURN audit_record_ref_055(p_table, p_id, r);
END $$;

COMMIT;
