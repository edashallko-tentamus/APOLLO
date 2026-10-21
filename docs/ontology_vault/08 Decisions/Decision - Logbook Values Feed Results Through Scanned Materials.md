---
type: Architecture Decision
status: Approved
decided: 2026-10-13
---

# Decision - Logbook Values Feed Results Through Scanned Materials

Alex Kiddle, 2026-10-13, with Claude. Direction for the [[Electronic Logbook]] design (built after the Workflow Designer, on its calculation engine: [[Decision - Logbooks Wait for the Workflow Designer]]).

**The mechanism**
- A logbook entry can belong to an [[Inventory Lot]] or an [[Aliquot]] with its own barcode. A template can publish a field as a property of that lot or aliquot. For example, an inoculum suspension's CFU/mL, or a pre-weighed aliquot's weight.
- When the barcode is scanned at a workflow step, the scan is recorded as material usage. A Calculation formula can then use the published value of the material scanned at that step, for example the inoculum count of the lot scanned at Inoculate.
- Every result keeps the chain: result, batch, scanned lot or aliquot, logbook entry, raw data and people.

**Examples**
- **USP <51> PET:** the inoculum count gives the initial count in the product and the log reductions.
- **Suitability:** recovery against the positive control average.
- **Daily Quality Control Samples:** recovery against the running true value.
- **Positive controls:** traced to the strain generation they came from.

**Rules**
- Only approved (reviewed) entries can feed a result. A result waits for its source entry, but the bench work does not.
- The result stores the value it used as well as the link. If the logbook entry is corrected later, every result that used it is flagged for review, never changed silently.
- If a lot has several entries, the approved one inside its validity window is used, or the analyst picks one at the scan. The system never guesses.
- A material past its validity window (e.g. an inoculum suspension past its use-by time) is refused at the scan, like an out-of-calibration balance.
- **QA review gates release (Alex):** if a logbook entry is involved in a final result, it must be reviewed by QA. That review is part of the final result check before the result can be released.
- **Where the review happens (Alex agreed, 2026-10-13):**
  - **Used once** (e.g. a sample weight): the entry is reviewed inside the batch that uses it. QA approves the batch, not the logbook.
  - **Used many times** (e.g. an inoculum count for a whole PET batch, or a daily positive control): the entry is reviewed once in its own logbook.
  - **Release check:** every entry behind a result must have been reviewed by one route or the other before release.
- **Conditions for review inside the batch:**
  - The QC Review step shows each value with its source: who, when, which balance and its calibration status.
  - The reviewer did not do any of the work, including the weighing.
  - Repeat weighings and discarded or replaced aliquots of the same sample are shown in the batch review, never hidden.
  - Basis: 21 CFR 211.194(a) second-person review of original records (similar expectations in 21 CFR 111 and ISO 17025) and Part 11 signatures. **To be confirmed by QA (Jake Teller).**

**Kinds of logbook (Alex)**
- **Advanced logbooks feed results:** inoculum counts, culture generations, control counts.
- **Equipment verifications:** pipette and balance checks. These keep the equipment usable and do not feed results directly.
- **Simpler logbooks** carry no result link.
- **Sample weights logbook (pre-analytical):** a lab with an intake or weighing team weighs test aliquots all day and distributes them to the lab. Each aliquot gets a barcode and its weight, recorded with the balance used, which must be in calibration. Scanning the aliquot at a test's Weighing step fills in the weight from the logbook. The QA review rule applies because the weight feeds the final result.

**Open for the logbook design**
- Validity windows per template.
- The formula syntax for material values.

See [[Decision - Workflow Designer Slice Scope and Rules]], [[Context - AAL Irvine Micro SOP Review]].
