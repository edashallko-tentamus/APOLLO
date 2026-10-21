---
type: Architecture Decision
status: Approved
---

# Decision - Return-to-Service Requirements Vary by Reason

Tag-In always requires an [[Electronic Signature]], per the [[Equipment Tag]] design. Beyond that, what else is required before Tag-In varies by the Tag's Reason, per [[Equipment Return-to-Service Rule]]:
- **Repair, Calibration, Qualification (IQ/OQ/PQ):** [[Release Approval]] is required from a User holding the relevant QA approval [[Permission]] — via a directly assigned Role or via [[Team]] membership, not a hardcoded "Role: QA" check — AND that User must be a different individual than whoever performed the Tag-Out or the underlying work. Both conditions are confirmed hard requirements, not proposals: segregation of duties is enforced by identity, not just by permission.
- **Maintenance:** only the Tag-In signature and the [[Maintenance Event]] summary — no QA Release Approval required.

See also [[Decision - Roles and Permissions Are Additive and Group-Assignable]] for why this checks a Permission rather than a named Role.

See [[Ontology Principles]].
