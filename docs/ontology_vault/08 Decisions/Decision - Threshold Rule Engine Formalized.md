---
type: Architecture Decision
status: Approved
---

# Decision - Threshold Rule Engine Formalized

[[Threshold Rule]] generalizes a pattern that had already been written three times by hand: a threshold on some numeric value, a non-blocking flag, an Alert/Notification. Rather than continue adding a bespoke rule object per field, any numerical or unit-bearing field in the system can now be configured against a three-tier Conforms/Alert/Deficient threshold (green/orange/red), typed as Percentage, Max-Min, or Days Until/Since.

[[Retained Sample Threshold Rule]] is left as its own approved decision rather than migrated — it predates the engine and its specific 20%-flat, non-blocking behavior is already settled. Going forward, new thresholds (Inventory Lot Quantity On Hand at 20%/negative, Expiration Status at 2 months/expired, Supply Purchase Order Line overdue at 1 month with no Deficient tier defined yet) are configured as [[Threshold Rule]] instances rather than new rule files.

See [[Ontology Principles]].
