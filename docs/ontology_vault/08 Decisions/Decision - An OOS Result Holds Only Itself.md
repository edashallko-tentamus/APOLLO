---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - An OOS Result Holds Only Itself

An open OOS holds only its own result; other completed tests can be released on a partial CoA unless the client's Allow Partial Reports is No. The OOS email goes out on release, not detection, so clients never hear about an OOS the lab later invalidates. A client retest is reported on a new CoA, not an amendment, showing the original OOS, the retest result and all other tests on the sample order with final results so everything is together. Client On Hold overrides all release.

**Changed 2026-10-13 (Alex):** a retest is reported as the next version of the sample's COA, not a new COA, and the COA does not say it is a retest (see [[Decision - Result Finalization and the Certificate of Analysis]]). The original OOS stays in the earlier version and in the OOS record.

See [[Ontology Principles]].
