---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Removing Analytes Keeps the Negotiated Discount Percent

When analytes are removed on a quote or a lab order, the list price recalculates and the quoted discount percent is kept, always shown with the dollar difference. Holding the dollar price flat would charge the same for fewer analytes. Unquoted analytes cannot be added on an order. Removed analytes are not ordered, billed or reported, which is different from Hide Analyte in the test definition. See [[Analyte Removal Pricing Rule]].

See [[Ontology Principles]].
