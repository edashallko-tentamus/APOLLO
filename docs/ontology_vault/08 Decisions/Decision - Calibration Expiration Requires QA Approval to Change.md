---
type: Architecture Decision
status: Approved
---

# Decision - Calibration Expiration Requires QA Approval to Change

Only [[Calibration]]'s Expiration Date is change-controlled — not the Alert Threshold configuration on the governing [[Threshold Rule]], which remains freely lab-configurable. Once a Calibration record's Submission Status is Submitted, changing its Expiration Date requires QA approval [[Permission]] and a fresh [[Electronic Signature]] at the moment of change, from a different individual than whoever performed the calibration. An earlier version of this decision also locked the Threshold Rule's alert value — that was broader than intended and has been reverted.

See [[Ontology Principles]].
