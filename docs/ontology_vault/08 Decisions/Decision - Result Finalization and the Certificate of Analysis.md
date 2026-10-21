---
type: Architecture Decision
status: Approved in principle (Alex, 2026-10-13); build choices Proposed (to confirm with Jake Teller, QA)
decided: 2026-10-13
built: 2026-10-14 (R-1, migration 026)
---

# Decision - Result Finalization and the Certificate of Analysis

Alex Kiddle, 2026-10-13 (evening), designing the reporting slices with Claude in the cloud. R-1 (Result Finalization and the COA) is built first; R-2 (OOS) next; the client portal after.

**The two reviews**
- QC Review is the review of the data (the second-person review of 21 CFR 211.194(a)(8)). Result Finalization is the authorization of the report (ISO 17025 7.8 "authorized for release"; QA release for GMP work).
- Result Finalization is never skipped for now (Alex: "let's not skip the step for now"). Project Managers finalize at CFL; Lab Supervisors do QC Review. For GMP work, finalization is done by the quality team.

**The COA**
- One COA per sample. Every COA is versioned; versions are added, never scrapped or deleted. Any finished test can be sent as it is completed: each version holds every result finalized so far, and the tests still in the lab are listed as in progress.
- Each version is tamper-evident (Alex asked for "block chain encrypted"; Claude recommended, and Alex agreed, a hash chain instead): the PDF of each version is fingerprinted (SHA-256), each version records the previous version's fingerprint, and the COA carries a verification code and link so anyone holding the PDF can check it matches what the lab issued. A digitally signed PDF (the lab's certificate) comes when the lab has a certificate.
- A new version after a change (a corrected result, a retest, a changed note) is just the next version. **No "amended report" and no "retest" wording on the COA** (Alex: the optics are bad for the client's own customers; versioning is enough). The version line names the version it supersedes.
- A result can be changed at any time after release, with a justification and sign-off (QC Review reopened as built), and the COA gets a new version.
- Notes: an internal note (never printed) and COA notes on the sample or on any result, typed or chosen from canned COA comments kept by QA in Canned reasons.
- Each COA is reviewed as the final PDF.
- Specifications: the COA shows the specification the client provided ("Client provided specification") and the conformance against it, by simple acceptance (the measured value against the limit). Labs that want measurement uncertainty in the decision rule get it later through the Workflow Designer.
- A sample with no specification is reported as a result with no evaluation.

**Result Finalization queue**
- A queue of every sample test whose results QC Review approved and that is not yet finalized.
- The user selects several and reviews them as a group, one COA at a time, without opening and closing windows; one signature at the end applies to each COA separately (Alex: "Great idea, make it happen").
- When the last test of a sample is finalized, that version is the sample's final COA and the sample is complete on the order.
- Everything on the sample (its submission details, attachments, comments and notes) is shown beside the COA, without digging.

**Release check (before signing)**
Alex agreed to all of Claude's checks: the values re-rendered and compared, specification integrity (and not changed after the result was approved), conformance recomputed, the history check (results far from the same client's earlier results, and especially from the same project's recurring samples), identity edited after login, completeness, holds (open OOS, client On Hold), independence of the finalizer, dates, and the difference from the last version. Alex added: a raw data check for chromatography (area counts and internal standard responses consistent); it needs those readings recorded first (R-1.1).

**Sample compliance category**
- The sample submission forms already ask what the sample is. LIMS3 records it per sample from a static list kept by administrators: Food, Beverage, Cosmetic, Drug product, Dietary supplement, cGMP, Internal use, Non-FDA work, Research, and Claude's suggestions (Animal food and pet food, Hemp and cannabinoid products, Medical device, OTC drug, Infant formula, Water, Stability study, Raw material or ingredient).

**Automated emails**
- Every automated email lives in the Outbox module as a template that QA can edit (Alex: "all automated emails need to live in the outbox module as templates").

**OOS (R-2)**
- An OOS record is not opened automatically. QC Review flags the result and has a button to generate the OOS record, because sometimes the sample's details or data entry need fixing first, often after talking with the client.
- The OOS email asks whether the client wants Phase II re-testing (clients use "Phase II" for re-testing and expect the lab to work in parallel with them), with links to request a retest, a retest in duplicate, testing of a new sample, a call with QA, to hold or return the retained sample, and to acknowledge receipt. For GMP clients the signed Phase I report is attached. Alex agreed to all of the OOS section.

**Built (R-1, migration 026, version 0.13.0, Claude in the cloud, 2026-10-14)**
- Result Finalization queue and group review; one signing act records a "Finalized by" signature on each COA; Project Manager standard group in every lab; GMP work (Regulated client or a GMP category) only by QA.
- Versioned COA PDFs (headless Chromium), SHA-256 chained to the previous version, verification code and a public verification page that shows no client or result details and checks a dropped PDF in the browser.
- The release check as agreed, plus the history check by project first, then client. The raw data check (internal standard and area counts) is R-1.1.
- Notes (COA and internal; canned "COA comments"), compliance categories, sample attachments, the client's "Partial reports" setting, the order Reported, emails as Outbox templates (Rush Not Accepted moved from code; COA Issued; the OOS Result wording for R-2).

**Build choices (Claude, to confirm)**
- The version line reads "Version 2, supersedes version 1 issued <date>" (no "amended", no "retest"). ISO 17025 7.8.8 asks for a replacement report to be identified and to refer to the one it replaces; Claude is about 85% sure this neutral line meets it.
- The finalizer may not be anyone who performed, witnessed or reviewed the work (QC Review) on that test.
- An out-of-specification result is held (cannot be finalized) until R-2 builds the OOS record. *(Built in R-2, 2026-10-14: held until its investigation is concluded; see [[Decision - OOS Investigation Build Choices]].)*
- A new version without a new result ("Issue a new version", for a corrected note or client detail) needs a reason and passes the same release check.
- History check: a Warning when a result is 5 times above or below the median of at least 3 earlier finalized results (same project first, else same client), same test and analyte.
- Lab Supervisors (and Project Managers, QA) may add COA and internal notes (reports.notes).
- Every client takes partial reports unless the setting is turned off; with it off, tests are finalized and held until the last test.
- The COA email goes to the client's contacts with the Receives Report role, else the ordering contact.
- The preview's footer says "PREVIEW, NOT ISSUED"; the issued PDF is made again when signing.
- A digitally signed PDF (the lab's certificate) and a QR code are later additions.

See [[Decision - An OOS Result Holds Only Itself]], [[Decision - OOS Investigations Use a Procedure Matched to the Work]], [[Decision - Order Status Waits for the Report]], [[Open Items for QA Review]].
