# APOLLO backend

The LIMS3 backend: a Java (Spring Boot) program that answers every `/api/...` request the screens make. It holds the business rules, signs people in, makes the PDFs and Excel files, runs the hourly jobs and the sensor feed, and builds the database at start. The screens are in `../frontend`.

## What you need

- PostgreSQL 16 or later (the server the backend connects to)
- Java 21 and Maven
- npm is only a shortcut for the Maven commands below; the backend itself is Java only

## First time

1. **Create the empty databases**, once per server, as the `postgres` superuser:
   ```
   psql -h localhost -U postgres -v pw='<choose a password>' -f backend/db/create_database.sql
   ```
   This makes the `lims` account and two empty databases: `lims3` (the app's data) and `lims3_test` (emptied by every test run). It creates no tables.
2. **Write the settings file**: copy `backend/.env.example` to `backend/.env` and put the same password in `DATABASE_URL` and `LIMS_TEST_DATABASE_URL`. `.env` is never committed to Git.
3. **Start it** (from the project folder):
   ```
   npm run start:backend
   ```
   At its first start it applies every migration and the demo data, so the tables appear by themselves. Later starts apply only what is new. Then start the screens with `npm start` in a second terminal and open http://localhost:3000.

The first PDF downloads a headless Chromium (about 150 MB, internet needed once), unless `PLAYWRIGHT_PATH` points to one.

## Commands (run from the project folder)

| Command | What it does |
|---|---|
| `npm run start:backend` | Starts the API on `127.0.0.1:3001` (`LIMS_API_PORT`) |
| `npm test` | Empties `lims3_test`, applies every migration and runs the database rule tests in `db/tests` |
| `npm run reset` | Empties `lims3` (every record is lost) so the next start rebuilds it with demo data |
| `mvn -q test` (in `backend/`) | Runs the Java unit tests (no database needed) |

The npm commands are only shortcuts for `mvn -q -f backend/pom.xml spring-boot:run` (add `-Dspring-boot.run.arguments=test` or `reset`).

**Debugging on its own** (IntelliJ or any Java IDE): open `backend/` as a Maven project and run or debug `com.tentamus.lims.LimsApplication` with the working directory set to `backend/`, so it finds `.env` and `db/`. Program argument `test` or `reset` runs those commands instead of the server. The front end can be started and debugged separately (`npm start`).

## Folders

| Path | What |
|---|---|
| `src/main/java/com/tentamus/lims/<module>/` | One package per module (clients, orders, testing, reports, invoicing, ...), each split into `domain/` (the rules, as objects), `repo/` (the SQL), `service/` (the use cases) and `web/` (the routes) |
| `src/main/java/com/tentamus/lims/core/` | Shared pieces: database access and migrations (`db`), sign-in and sessions (`session`, `signature`), permissions (`access`), the headless browser for PDFs (`browser`), Excel (`excel`), background jobs (`jobs`) |
| `src/test/java/` | The Java unit tests |
| `db/migrations/` | The database structure, one numbered file per change, applied once and in order (tracked in `public.schema_migrations`) |
| `db/seed*.sql` | Fictional demo data, each file applied once |
| `db/tests/` | Database rule tests (`npm test`) |
| `db/create_database.sql` | Creates the empty databases (development) |
| `db/roles_setup.sql` | Creates separate owner and app accounts (a server holding GxP data; set `LIMS_MIGRATE_URL`) |
| `.env` | Your settings (not in Git); the program reads it at start |
| `.env.example` | Every setting, with its default |

## Rules for changing it

- Never edit a migration that may have been applied to a database you need to keep: add a new numbered one.
- Business rules go in the Java `domain/` classes, with a unit test. The database keeps the structure and the GxP backstop (audit trail, no deletes, signatures).
- Every write runs inside a transaction that records the user and the reason for change; signed actions check the person's password first.
- New tables get the GxP wiring (`CALL make_gxp('table')`) and a permission check.
