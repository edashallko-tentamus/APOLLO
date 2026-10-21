---
type: Architecture Decision
status: Proposed
decided: 2026-10-13
---

# Decision - Micro Bench Build Choices

Built by Claude in migration 019 (WD-4) while Alex was away, on his instruction to make the decisions and list the questions. Irvine practice comes from [[Context - AAL Irvine Micro SOP Review]]. Each choice can be changed.

**Daily controls**
- A QC with frequency Daily is one set per test per lab per day.
- The day's first batch of that test holds the controls and records their data.
- Later batches that day get linked entries. They show the same verdicts and take no data of their own.
- "Per method" was read as per test (any version). A test version change during the day keeps the same set.

**Plating/Inoculation**
- Each plated entry records its plates (whole numbers; 0 means not plated) and the levels plated, as free text.
- A media lot is required for every plated entry, for that entry or the whole batch. The amount used comes off the lot's stock, so ready-to-use plates are best counted "each".
- A positive control "made from strains" needs a Microbiological Strain lot recorded (purpose Strain). When the strain lot names its organism, it must be one of the test's organisms.
- Generation or passage tracking of strains is not built.

**Incubation**
- Plates go into incubators as loads.
- Each load has its incubator (available, in calibration, of a type the step names), the entries it holds (selected rows or the whole batch), time in, time out, and the temperature read.
- A load outside the duration window or the temperature target does not stop the step. It needs a note explaining why it is acceptable before the step can be completed, and the reviewer sees it.
- Changing a recorded time or temperature is a correction and needs a reason.
- Incubation duration is available to formulas as {step.duration}, in the step's unit.

**Readings and controls**
- Qualitative results are the reading itself, using the analyte's own values (e.g. ND / ND* / D* / D).
- Presence passes on a "found" value, or on a count above 0. Absence is the opposite. Identified passes when an identification is recorded.

**Split-offs**
- Completing a Split off Test step raises a split-off request for each sample with a "found" reading in the named steps, or for every sample when the step says Always.
- The customer's consent (Consent given or Declined, with a note) is recorded by someone with orders.edit, from the backlog or the sample page. Irvine sends identification out with the customer's consent.
- The test is then ordered on the sample as usual (it must be on an accepted quote). Ordering closes the request as Ordered. If the test is already on the sample, the request is Ordered at once.
- A manual split-off by the analyst (no rule) is not built.
- Subcontracting to an outside lab is not built either: the request names a catalogue test.

**Not built yet**
- QC values as formula tokens (suitability recovery against the positive control).
- The PET prescreen gate and timepoint dates.
- Control charts for daily QC samples.
- TNTC and estimated counts.
- Photos are attached as raw data files; there is no image viewer.

**Alex's answers (2026-10-13)**
- Daily controls become a logbook, as decided in [[Decision - Logbook Values Feed Results Through Scanned Materials]]: the day's control is a logbook entry, reviewed once in its logbook, and scanned into each batch. The shared "first batch holds it" set is the stand-in until logbooks are built.
- Subcontracted tests (e.g. identification sent to an outside lab) are a simple single entry: the outside lab's result is entered on the requested test. Ordering a test from another networked lab through the LIMS is not planned for now.
- The customer's consent applies where the split-off costs the customer money or goes outside the lab (Irvine sends identification out). To confirm per lab.
- A load outside its window: the reviewer accepts it with a justification, as well as the analyst's note (Alex; built in WD-5.1).
- Consent is a setting of the Split off step (Alex): built in WD-5, see [[Decision - Analytical Runs, Preliminary Results and Order Statuses]].

See [[Decision - QC Review Build Choices]], [[Decision - Workflow Designer Micro Definitions]].
