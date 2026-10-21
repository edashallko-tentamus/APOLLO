---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Reasons for Change Are Picked From Canned Reasons per Module

The Reason for Change dialog offers canned reasons for the module the person is working in, plus General reasons offered everywhere (for example "Typing error", "Correction after review"). The person picks one and may add a comment (stored as "Reason: comment"), or chooses Other, where typing the reason is required. The lists are kept under Admin > Canned reasons, maintained by QA and administrators, with modules General, Clients, Orders, Quotes, Catalog, Inventory and Admin. A reason already used stays in the audit trail as written; retire it by setting it Inactive rather than rewording it. Chosen by Alex Kiddle on 2026-10-12 ("pick, optional comment; Other always available and typing required"). Built in migration 007; demo lists in `seed_006`.

See [[GMP Record Change Control Rule]], [[Audit Trail Management]].