---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Inventory List and Item Pages Follow Alex's Mock-ups

The inventory list is cut down to: Duplicate and Reorder buttons, ID, Name, Lot# (Resource ID for mixtures), Concentration, Date made, CAS, Vendor, Expiration date, Amount, Purchase status and a tick box (to export or print selected rows). Expiry and amount cells turn amber (Alert) or red (Deficient). Filters: Active (the default whenever the page is opened), Show wasted, Show expired, Show negative, On order. Buttons: Export XLSX, Upload XLSX, Print, and "+ New Inventory Item", which opens a full page (Identity and Quantitative sections) instead of adding a grid line; Duplicate opens the same page pre-filled, and Edit uses it with a Reason for Change. The lot page shows status cards for purchase status, expiration and quantity on hand (Conforms, Alert or Deficient), Identity and Quantitative sections, the analytes, every warning rule applied with its result, component lots for mixtures, and the Supplier COA. The in-house mixture page follows the same layout ([[Decision - Mixture Quantity and Concentration Are Calculated From Components]]). Storage location codes are links to a location page listing everything stored there ([[Decision - Every ID Is a Link to Its Record]]). Mock-ups by Alex Kiddle (made in Claude chat), 2026-10-12.

See [[Ontology Principles]].
