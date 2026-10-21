---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Client Hierarchy Does Not Cascade

[[Client]] keeps a Parent Client for corporate groups. Nothing inherits through it: a hold on a parent does not hold its sites, and a contact linked to a parent does not see child clients. The only cross-client sharing is explicit: a parent's [[Project]] marked Available to Child Clients. See [[Client Hierarchy Rule]].

See [[Ontology Principles]].
