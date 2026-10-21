-- LIMS3: database accounts for a server holding GxP data (0.32.0). Run ONCE, by the database administrator (IT),
-- as a superuser or an account allowed to create roles and databases. Not run by the app; not needed in the Sandbox.
--
--   psql -h <host> -U postgres -v owner_pw='...' -v app_pw='...' -v dbname=lims3 -f db/roles_setup.sql
--
-- Then start the app with two connection strings (passwords kept by IT, not in the project folder):
--   LIMS_MIGRATE_URL = postgres://lims_owner:<owner_pw>@<host>:5432/lims3?sslmode=verify-full&sslrootcert=<CA file>
--   DATABASE_URL     = postgres://lims_app:<app_pw>@<host>:5432/lims3?sslmode=verify-full&sslrootcert=<CA file>
-- At every start the app applies waiting migrations as lims_owner, then gives lims_app its rights
-- (read, add and change rows; no delete, no changes to tables, triggers or functions; the audit trail read only).
-- On the server, set password_encryption = 'scram-sha-256' (the default since PostgreSQL 14) and require TLS
-- (hostssl lines in pg_hba.conf). The app supports both (sslmode=require / verify-ca / verify-full).

\set ON_ERROR_STOP on
SET password_encryption = 'scram-sha-256';
CREATE ROLE lims_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE ROLE lims_app   LOGIN PASSWORD :'app_pw'   NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE DATABASE :"dbname" OWNER lims_owner;
REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"dbname" TO lims_app;   -- temporary tables are used inside some functions
\connect :"dbname"
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO lims_owner;
