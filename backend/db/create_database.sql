-- LIMS3: create the PostgreSQL databases the app connects to (one account, matching .env.example).
-- Run ONCE as a superuser (e.g. postgres), PostgreSQL 16:
--
--   psql -h localhost -U postgres -v pw='<choose one>' -f backend/db/create_database.sql
--
-- Then in .env: DATABASE_URL=postgres://lims:<same password>@localhost:5432/lims3?sslmode=disable
--               LIMS_TEST_DATABASE_URL=postgres://lims:<same password>@localhost:5432/lims3_test?sslmode=disable
-- Only the empty databases are made here: the app's migrations make every table, rule and the demo data
-- at its first start (npm test does the same in lims3_test, emptying it first).
-- For a server holding GxP data use roles_setup.sql instead (separate owner and app accounts).

\set ON_ERROR_STOP on
SET password_encryption = 'scram-sha-256';
CREATE ROLE lims LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEROLE NOCREATEDB;
CREATE DATABASE lims3 OWNER lims ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE lims3_test OWNER lims ENCODING 'UTF8' TEMPLATE template0;
-- the account owns public so the migrations can create in it and npm run reset / npm test can empty it
\connect lims3
ALTER SCHEMA public OWNER TO lims;
\connect lims3_test
ALTER SCHEMA public OWNER TO lims;
