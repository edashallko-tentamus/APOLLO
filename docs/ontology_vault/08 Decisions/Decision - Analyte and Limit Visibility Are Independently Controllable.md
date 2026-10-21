---
type: Architecture Decision
status: Approved
---

# Decision - Analyte and Limit Visibility Are Independently Controllable

Three separate visibility flags, not one: [[Test-Analyte Configuration]] gets a Hide Analyte flag (excludes the whole analyte from the Certificate of Analysis), and [[Reporting Limit]] gets its own Hide on Report flag per Limit Type (so LOQ and LOD on the same analyte can be shown or hidden independently of each other and of the analyte itself).

In every case, the underlying value is still calculated and retained — analyzed and reported are different questions. A method that genuinely tests 100 analytes (e.g. a Heavy Metals suite) can have one Test definition covering the full panel, with individual client-facing Tests each hiding whichever analytes that client didn't order. This is what makes "copy an existing test as a starting point" a real, fast workflow rather than rebuilding Test-Analyte Configuration from scratch each time — the same reasoning behind the Duplicate action already present on every other module's list screen (Inventory, Purchasing, Equipment). The Test list screen isn't built yet, but a Duplicate Test action following that same pattern is the natural fit once it is.

See [[Ontology Principles]].
