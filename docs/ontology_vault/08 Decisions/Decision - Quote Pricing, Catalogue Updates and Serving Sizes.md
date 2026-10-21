---
type: Architecture Decision
status: Alex's decisions Accepted; Claude's build choices Proposed (to confirm with Alex; serving limits with Jake Teller, QA)
decided: 2026-10-14
built: 2026-10-14 (migration 031, seed 024, version 0.16.1, Claude Code)
---

# Decision - Quote Pricing, Catalogue Updates and Serving Sizes

Alex's notes after the 0.15.0 and 0.16.0 demo, and his answers. These follow [[Decision - All Ordering Is Quoted]], [[Decision - Result Finalization and the Certificate of Analysis]] and [[Decision - Report Finalization Follow-up]].

**Alex's decisions**

- **No "Any lab" on quotes.** It confused sales and account managers. Every test belongs to a lab: the shared tests made before tests belonged to a lab were assigned a home lab (Alex: "Assign each to a lab").
- **The 20-30 rule (in-network subcontracting).**
  - Testing quoted from the lab the user is working in, but done by another lab of the network, is a subcontracted test and is labelled as such.
  - Its client price is the other lab's catalogue price less 20 %, plus 30 % (for example $650, then $520, then $676).
  - Both percentages are a lab setting (Alex: "Right, lab setting").
  - It is about the client's locality.
- **Quote lines:** a trash button on the right removes a line, which is easier than choosing Inactive.
- **Test catalogue:** an "Update prices" button changes all prices, or the selected ones, by a percentage. The percentage updates the total by updating the component prices.
- **Serving size.**
  - The serving unit is chosen from the Units list, which is pre-filled with serving units.
  - The serving is a count plus a weight (Alex: "Count + weight").
  - Specifications can use the serving as the limit's basis, e.g. 1 mg per serving or 10 mg per package. A package is servings per package (Alex: "Servings per package").
- **Sample grid:** "Unit" and "Units" side by side made no sense. Move them apart and say which unit is meant.
- **Still to design (Part B):**
  - A Serving size step in the workflow designer:
    - skippable, or applied only to the samples of a batch that need it;
    - with a configurable cost;
    - a liquid needs a density reading;
    - a solid needs a weight repeated over a configurable interval and averaged.
  - A separate density test and a separate serving weight test.

**Part B: Alex's answers (2026-10-14, evening; design still open)**
- **Which samples:** a tick on the order says the sample needs its serving worked out.
- **Cost:** in the catalogue and on quotes. Alex wants to see how it looks on a quote and how prices are updated.
- **Solids:** 10 measurements. If that is 10 capsules weighed out, so be it.
- **Liquids:** the density comes from the density test.
- **Shape (Alex's thought, Claude to advise):** a split-off, using the existing split-off step. The sample goes for density or serving weight testing, and the result is fed back to make the final calculation.
- **Unplanned cases:** Density and serving weight are ordered as part of the testing, but there must be a way to feed them back when nobody anticipated them. Many supplement clients do not know a density is needed, and the lab may only find out after an assay is done.
- **Options Alex raised:**
  - a skippable break-off step in the assay workflows, left to the technician;
  - a required question on the client portal and the sample submission, so the client knows the serving calculation costs extra and orders the test;
  - the serving maths in the report template (other LIMS do this; Alex would rather avoid it, but it stays an option).

**Part B: Alex's decisions (2026-10-14, later; built in 0.17.1, migration 033)**
- **Agreed with Claude's recommendation:**
  - Density and Serving weight are their own tests, ordered by the "Per serving" tick on the order.
  - Unplanned cases go through a request that waits for the client's consent.
  - The assay result itself never changes.
- **Liquids:** the serving volume from the label × the measured density = the serving weight. The density test is needed only when the units call for it.
- **A late measurement after the COA was issued:** the new COA version waits in Report Finalization as usual.
- **Alex:** "it should be a check and flag in the COA review that the system does". Results per serving cannot be released before the serving weight or density is measured and used: the release check blocks them.

**Confirmed by Alex (2026-10-15):**
- Choice 4: a serving test that is not on the quote is ordered at its catalogue price. Alex agreed.
- Choice 5: a label weight is never enough to release results per serving; the serving weight must be measured. Alex: "B, a label weight is never enough."

**Part B build choices (Proposed)**
1. **Replicate weighings on the Weighing step:**
   - 1 to 10 per sample; the step's weight is their average.
   - No average until all of them are in. The step cannot be completed before then.
   - A row of 10 weights pastes in from the balance printout.
2. **The Serving weight result is the average weight of one unit.** The serving weight is that × the label's count (2 capsules), and it follows a later change of the count.
3. **The tick orders the right test:** Serving weight for a serving by weight or count, Density for a serving by volume.
4. **Price and approval:**
   - A serving test not on the client's quote is ordered at its catalogue price: a named exception to quoted-only ordering, as the OOS retests are.
   - The tick and the client's consent are the client's agreement to that price.
5. **Measured values are never typed.**
   - They come only from the approved result, linked to it, and are audited.
   - A label weight alone does not release results per serving: the serving weight must be measured.
   - For a serving by volume, the density is needed only when a result is per weight.
6. **The Block covers:**
   - a serving test ordered and not approved;
   - no serving;
   - the serving weight not measured;
   - the density not measured when needed.

   The other tests of the sample can still be finalized.
7. **The unplanned request:**
   - It reuses the split-off requests (Awaiting consent, then Consent given or Declined, then Ordered).
   - It can be raised by orders.edit, reports.finalize or testing.review.
   - One open request per measurement.
8. **Demo prices:** $45 (serving weight) and $60 (density) are illustrative. The demo serving tests stay Drafts where the verification gate is on.

**Build choices (Proposed)**

1. **Home lab of the shared tests: CFL.** All seven had only ever been ordered at CFL. A shared test may be given a home lab once; a lab's test still never moves (copy it instead).
2. **The quoting lab is the lab the quote or project was made in.** It is recorded on the quote and never changes. Quotes made before 0.16.1 have none, and price as before.
3. **Both percentages are on the quoting lab.** The discount stands for the other lab's in-network price, the markup for the quoting lab's margin. Defaults are 20 and 30. Each step is rounded to the cent.
4. **A line keeps the rates of the day it was added.** Changing the lab's settings affects new lines only. Removing an analyte keeps the negotiated discount % against the client price.
5. **The in-network cost shows on the quote page only (internal).**
6. **The quotation tells the client.** It says "(subcontracted within Tentamus)" against the lab's name. ISO/IEC 17025 asks that the client be informed of subcontracted work. QA to confirm the wording.
7. **Subcontracted tests are quoted, not yet ordered.** At the quoting lab the order page lists them as subcontracted and "Apply project" skips them. Sending a sample's subcontracted tests to the other lab (its backlog, the COA, billing between labs) is a slice to design.
8. **The trash button replaces the Active/Removed column.** A confirmation is asked. The line is kept, as Removed, in the audit trail.
9. **Catalogue price updates.**
   - The percentage is from more than -90 % up to 500 %.
   - Each part (base, preparation fee, analyte prices) is rounded to the cent.
   - A Reason for Change is required, and catalog.edit.
   - Retired tests are left alone.
   - Quotes already made keep their prices; new quotes and new versions use the new ones.
10. **Serving units.** These are units of kind Count marked "Serving unit": 23 new ones plus vial, ampoule, bottle and pack. QA adjusts the list in Admin > Units.
11. **The sample's serving.**
    - The count (2) and its serving unit (capsule) are what the label says.
    - The weight or volume of one serving (1.2 g) is what per-serving amounts use. It must be a mass or volume unit.
    - The servings per package are recorded too.
    - Changing any of them on a logged sample needs a Reason for Change.
    - The amount received is now checked against the Units list (old free-text values stay until changed).
12. **Limits per serving or per package.**
    - The comparison uses the reported value × the serving weight (× the servings per package), rounded to 3 significant figures as printed, in the limit's unit (e.g. mg).
    - Missing serving data gives "Not compared" and a release-check Warning, not a Block.
    - A serving in mL with a result per kg cannot be converted until the density step exists (Part B).
13. **Sample grid order.** Containers (how many bottles or bags make up the sample) comes before condition. Amount received and its unit come next, then the serving columns.
