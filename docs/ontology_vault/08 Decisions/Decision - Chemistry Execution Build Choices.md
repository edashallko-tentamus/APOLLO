---
type: Architecture Decision
status: Proposed
decided: 2026-10-13
---

# Decision - Chemistry Execution Build Choices

Choices Claude made while building WD-2 (migration 016) that Alex has not ruled on yet. Each can be changed.

**Who may witness:** decided by Alex (WD-2.1): see [[Decision - Chemistry Execution Scope and Rules]].

**Batches**
- Brackets ("every N" QC, such as CCVs) open and close the run, with one after every N samples. A batch of n samples gets ceil(n / N) + 1 of each.
- Matrix spikes are made from the first sample. The analyst can change that until Batching is completed.
- Daily QC (shared by a day's batches) was built in WD-4: see [[Decision - Micro Bench Build Choices]]. Cancelling a batch was built in WD-3: see [[Decision - QC Review Build Choices]].

**The bench**
- New values need no reason. Changing a recorded value is a correction and needs a reason.
- Data can change only while its step is open. A completed step is reopened with a signature and a reason, and only if the steps after it are still open.
- A spiked QC entry (one whose criteria judge a recovery) must have its spike recorded before the reading step can be completed.
- Each ICV and CCV must have its check standard recorded.
- Equipment must be available, in calibration and of a type the step names. A tagged-out unit is refused.
- Materials must be received, available, in date and not past retest.
- Using a lot at the bench reduces its stock (decided by Alex, WD-2.1).
- A weight outside the target range is flagged, not refused. This matches Alex's point that the analyst decides from their training.

**Calculations and QC**
- Results are calculated live and never stored. The reviewer stores what is reported in WD-3.
- Check standards are judged on their reading against the standard's concentration, in the reading's unit.
- A spike's recovery is (found minus the sample's result) divided by the amount spiked. The amount spiked is the lot's concentration in mg/L times the volume, divided by the sample weight, in the reporting unit.
- RPD is judged on the matrix spike duplicate against its spike.
- Limit types other than Recovery %, RPD and Blank threshold are recorded but shown as "Not judged" until a later slice.

**Since built**
- The lab order status, the reportable reading and cancelling a batch came with WD-3. Split-offs at the bench came with WD-4.

**Demo data**
- Acme Irvine accepts its own heavy metals quote and sends six supplements to CFL, one of them rush.
- The demo analyst has batched four of the six. The other two wait in the backlog.
- The demo adds a spiking solution and a check standard (both with their concentrations), plus ICP-MS 2 and a microwave digester.
- ICP-MS 1 is due for maintenance, so the hourly equipment job tags it out and the bench refuses it.

See [[Decision - Chemistry Execution Scope and Rules]].
