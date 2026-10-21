---
type: Architecture Decision
status: Proposed
decided: 2026-10-13
---

# Decision - Equipment Slice Build Choices

Claude, 2026-10-13, while building [[Decision - Equipment Slice Scope and Rules]] (migration 009). Alex has not confirmed these yet. Each is easy to change.

**Permissions (5 new) and the standard groups**
- equipment.edit (records, owners, schedules, documents, out of service, retire, transfer): Lab Supervisor, General Manager, and Analyst (Alex, 2026-10-12: [[Decision - Equipment Belongs to a Department and Analysts Edit It]]).
- equipment.tag (tag out, record maintenance and repairs, tag in after maintenance): Lab Supervisor, General Manager, Analyst.
- equipment.calibrate (record calibrations and qualifications): Lab Supervisor, General Manager, Analyst.
- equipment.release (release after repair, calibration or qualification; correct a calibration's expiry, date or result): QA.
- equipment.lists (each lab's Equipment types and Departments): Administrator, QA, Lab Supervisor, General Manager.
- QA cannot tag out or record work by default, which keeps QA independent of the work it releases.

**Tag-out and release**
- Every tag-in needs a record of the work (a log entry, calibration or qualification under that tag). After maintenance the same person may tag it back in ("Returned to service by").
- After repair, calibration or qualification, release is one signed action ("Released by") by someone holding equipment.release who did not tag it out and did not do or record any work under that tag. There is no separate approval record; the release signature is the [[Release Approval]].
- Calibration release also needs a passing calibration recorded under that tag, and the equipment no longer Deficient. Qualification release needs a passing qualification under that tag.
- One open tag per reason at a time (per schedule for maintenance). A tag cannot be edited; only its tag-in is added.

**Calibration**
- Calibrations are complete when saved and signed ("Recorded by"); there is no Draft step.
- Default expiry = date calibrated + the instrument's interval, minus one day. The calibration is valid through its expiry date and Deficient the day after.
- Correcting expiry, date or result, or withdrawing a calibration, needs equipment.release and someone other than whoever did or recorded it. Notes and certificate number can be corrected by the calibrator.
- Warning window defaults to 30 days on each instrument (still not confirmed by a lab).

**Automatic tag-outs** run when the server starts, every hour, and whenever the equipment list or due list is opened. They are recorded as made by "System".

**Maintenance schedules**: recording the scheduled work moves the next due date on from the date the work was done (not from the old due date). "Tag out when due" is per schedule (a weekly fridge check can warn without tagging out).

**Transfer**: needs equipment.edit at the sending lab and names a department and a responsible group at the receiving lab. Location and the sending lab's owners are cleared. The type is matched by name at the receiving lab (added to its list if missing). It arrives tagged out for Qualification.

**Other**
- Equipment whose owners all lose their membership is not blocked; it appears as "No owner" on the due list.
- Retired equipment keeps its history and cannot be tagged, calibrated or qualified; it can be put back in service.
- Daily balance checks and fridge temperature readings are "Check" entries (Alex agreed 2026-10-12) in the maintenance log for now; structured readings come with the [[Electronic Logbook]] slice.

See [[Ontology Principles]].
