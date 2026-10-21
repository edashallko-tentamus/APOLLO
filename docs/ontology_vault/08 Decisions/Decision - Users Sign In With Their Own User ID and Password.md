---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Users Sign In With Their Own User ID and Password

Everyone signs in with their own user ID and password; the "Working as" switcher is gone. Who did something always comes from the signed-in session, never from the screen. Passwords are stored only as salted one-way hashes (scrypt); nobody, including administrators, can see one. Rules in the Sandbox (QA to confirm for production): at least 10 characters with a letter and a number, not containing the user ID. A session ends after 30 minutes without activity (setting `LIMS_IDLE_MINUTES`), on sign out, or when the server restarts. Five wrong passwords (at sign-in or when signing) lock the account until an administrator sets a temporary password, which also unlocks it; a temporary password must be changed at the next sign-in. Every sign-in, failure, lockout, sign-out, password change and failed signature is kept in an append-only sign-in log (Admin > Users and lab access > Sign-in history). On first run the administrator sets their own password on a setup screen. Chosen by Alex Kiddle ("real login now") on 2026-10-12; built in migration 007 and `server/auth.js`.

Open for production: password expiry and history, single sign-on with the company directory, and separate database roles so administrators cannot bypass the audit triggers.

See [[Authentication and Session Control]], [[User]], [[21 CFR Part 11 Controls]].