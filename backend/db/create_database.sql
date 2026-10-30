-- LIMS3: create the external PostgreSQL database for development (one account, matching .env.example).
-- Run ONCE as a superuser (e.g. postgres), PostgreSQL 16:
--
--   psql -h localhost -U postgres -v pw='<choose one>' -f backend/db/create_database.sql
--
-- Then in .env: DATABASE_URL=postgres://lims:<same password>@localhost:5432/lims3?sslmode=disable
-- The tables, rules and demo data are not made here: the app applies every migration and seed at its first start.
-- For a server holding GxP data use roles_setup.sql instead (separate owner and app accounts).

\set ON_ERROR_STOP on
SET password_encryption = 'scram-sha-256';
-- CREATEDB: npm run test:pg drops and rebuilds its own lims3_test database
CREATE ROLE lims LOGIN PASSWORD :'pw' CREATEDB NOSUPERUSER NOCREATEROLE;
CREATE DATABASE lims3 OWNER lims ENCODING 'UTF8' TEMPLATE template0;
\connect lims3
ALTER SCHEMA public OWNER TO lims;
