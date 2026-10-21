---
type: Architecture Decision
status: Approved (Alex, 2026-10-20: "okay do as you suggested"); build choices Proposed
decided: 2026-10-20
built: 2026-10-20 (migration 056, version 0.33.0)
---

# Decision - Security Hardening SEC-1

The first of two hardening slices Claude proposed after Alex asked for the weak points and security concerns of the build (2026-10-20). This one closes the security gaps; the second (scale: connection pool, paging and finished-record tabs, sessions in the database, a load test against Alex's volumes) follows. CAPAs and non-conformances were set aside by Alex the same day.

## Why

Found in the code, before this slice:
- Uploaded files were shown in the browser with whatever type the uploader claimed, so an HTML or SVG file could run script inside the LIMS (stored cross-site scripting).
- The app connected to the database as the account that owns every table: whoever held it could switch the audit triggers off.
- The database connection had no encryption and no modern password scheme (SCRAM), which managed PostgreSQL services require.
- No security headers; the session cookie was not marked for HTTPS only.
- Nothing slowed password guessing beyond the 5-try account lock.
- Reads were lab-scoped only by the server's routes; an audit of every route found the audit trail pages and a few routes returning other labs' records.

## What was built

- **Encrypted database connection:** TLS with certificate checking, and SCRAM-SHA-256 sign-in, in the app's own connector (no added package: the cloud build cannot install packages, and the zero-dependency setup is kept for locked-down laptops). This reverses Claude's earlier suggestion to switch to the standard `pg` package.
- **Two database accounts for a GxP server:** an owner account applies the updates; the app's account may only read, add and change rows. It cannot delete, change or switch off tables, triggers or functions, or write the audit trail (only the audit triggers can). Set up once by IT with `db/roles_setup.sql`. The Sandbox keeps one account.
- **Safe files:** files are judged by their content when shown; only real PDFs and pictures open in the browser (SVG logos sandboxed); everything else downloads with a neutral type. Stored records are not changed.
- **Security headers:** a Content-Security-Policy on every page (no inline scripts), no type sniffing, framing only by the LIMS itself; behind HTTPS the cookie is Secure and HSTS is sent.
- **Rate limits per computer:** 20 wrong passwords in 15 minutes, then a 15-minute pause; 120 requests a minute to the client-facing pages (COA verification, quote and OOS answers).
- **Lab separation on reads:** the audit trail pages show a lab's people their own lab's entries and shared records; every record's audit view checks the record; the remaining routes found by the audit check the lab.
- **Escaping:** the seven places found by an audit of the screens now escape what people typed.

## Build choices (Proposed)

1. The account lock is unchanged (5 wrong passwords, unlocked by an administrator). It lets someone who knows user IDs lock people out; single sign-on is the lasting answer (QA item 81).
2. Limits of 20 wrong passwords per 15 minutes and 120 public requests a minute per computer, kept in memory (a restart clears them) (QA item 82).
3. The owner account's password is held by IT; setting up the two accounts is part of the server's installation (QA item 83).
4. The internal switches the app uses for its own steps stay trusted to the app account (QA item 84).
5. Audit trail pages lab-scoped; all-labs groups and system administrators see every lab (QA item 85).
6. Files keep the type they were uploaded with; the check is made when they are shown (QA item 86).

## Not done

- Git for the project: Claude Code sets it up on the laptop.
- Single sign-on (Microsoft Entra ID), the lasting answer to passwords and lockouts.
- A full review by a security specialist (penetration test) before production.
