---
type: Architecture Decision
status: Approved
---

# Decision - Calibration History Preserved as Events

Calibration Date and Calibration Expiration Date are not direct fields on [[Equipment]] — they are User Values on [[Calibration]], one record per calibration event. Equipment's Current Calibration Date and Current Calibration Expiration Date are Derived Values sourced from whichever Calibration record has Is Current = true. This preserves a full calibration history rather than overwriting a single field each time — the same pattern already used for [[Vendor Qualification]] on [[Supplier]]. Overwriting a single field would lose the record of prior calibrations, which a lab operating under ISO 17025 or GMP needs to retain.

See [[Ontology Principles]].
