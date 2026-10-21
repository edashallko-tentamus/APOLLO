---
type: Architecture Decision
status: Approved (Alex, 2026-10-15); built 2026-10-17 as 0.23.0 (see Decision - Stability Studies S-2)
decided: 2026-10-15
---

# Decision - Stability Studies S-2 Scope

**Built 2026-10-17** (migration 041, version 0.23.0): [[Decision - Stability Studies S-2]], with Alex's answers of 2026-10-17. Item 3's third outcome differs ("an extra pull" here, "Client to decide" on 2026-10-17): to settle with Alex.

Follows [[Decision - Stability Studies S-1]]. Alex, 2026-10-15, answering the S-2 questions:

1. **Amendments** to a running study are a new version of the stability quote, accepted by the client again. Pulls already made are never changed. Alex: "Yes".
2. **Cancellation:** the lab is asked each time whether the remaining stored material is disposed of or returned to the client; disposal is the default. Alex: "Agreed".
3. **Excursion assessments:** QA assesses each chamber excursion for each affected study, signed, with one of three outcomes: no impact; impact noted on the report; an extra pull. Alex: "Yes your suggestion makes sense".
4. **Billing:** "The client would be invoiced for each pull." **The LIMS does all the invoicing (Alex, 2026-10-15):** invoices are made in the LIMS and sent to the client from the LIMS, and pushed to accounting (QuickBooks) through an API still to be built. Accounting provides the POs for ordering (purchasing); invoicing stays in the LIMS. Each stability pull is invoiced at its study year's price. See [[Decision - Invoicing Is Done in the LIMS]].
5. **The cumulative report** is issued through Report Finalization, signed and versioned, with the same independence rules as a COA. Alex: "Yes".

**Also decided the same day**
- **The CFL verification gate goes off for now**, so USP <51> version 2 can be approved once its control fix is in (Alex). The gate is a lab setting that only a system administrator changes, and Alex sets it himself on his data.
- **USP <51> negative control (the WD-6 defect), agreed by Alex:** a control is judged on its calculated value when there is one (as Irvine does); when the calculation is undefined because the count is 0 (the log of zero), the control is judged on its count (0 = no growth) and the calculation does not block the step. Built in 0.24.0 (migration 042; [[Decision - Trending and Control Charts T-1]]): USP <51> version 2's verification passes.
- **The CFL gate:** Alex switches it off himself (Admin > Lab setup > Sites and holidays).

See [[Decision - Electronic Logbooks L-1 and L-2]], [[Decision - Workflow Verification]].
