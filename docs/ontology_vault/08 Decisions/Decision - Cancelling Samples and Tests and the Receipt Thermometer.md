---
type: Architecture Decision
status: Approved (Alex, 2026-10-20); build choices Proposed; potency units on hold
decided: 2026-10-20
built: 2026-10-20 (version 0.34.0, migration 057, seed 039)
---

# Decision - Cancelling Samples and Tests and the Receipt Thermometer

Relates to [[Decision - Chain of Custody, Receipt Photos and Photo Reports]] (the chain of custody and receipt) and [[Decision - Quote Pricing, Catalogue Updates and Serving Sizes]] (the serving size).

**Context.** Alex (2026-10-20) listed more information on the lab's COCs:
- "Reporting units for potency testing: mg/serving, mg/g, percentage, mg/mL (selected by client)";
- "Serving size (shared by client)";
- "Thermometer equipment ID (recorded by lab at receipt)".

He added: "I think I just realized that you can't remove tests or samples once they have been added."

Before this:
- A test could be cancelled only through its Status cell.
- A sample could be cancelled only before logging.
- The database did not stop a test being cancelled while it was in a batch or had results.

## Alex's decisions (2026-10-20)

1. **Cancel, never delete.** A clear "Cancel…" action (button and right-click), with a reason. A cancelled item stays on the order, greyed out.
2. **What can be cancelled:**
   - a logged sample, while none of its tests has results;
   - a test in a batch that has started, only once it is taken out of the batch (or the batch is cancelled).
3. **Thermometer at receipt:** from the equipment register, available and in calibration, whenever a temperature is recorded. It is printed on the chain of custody.
4. **Serving size:** already entered on the order; now printed on the chain of custody.
5. **Potency reporting units: on hold.** Alex, after the build: "let's wait on the potency unit. I think we might not need to make another field if we have the specifications and serving size units already in the system. I'll check with the lab first."
   - The build was taken out of 0.34.0 before anything was applied: a sample potency unit, a "Potency test" tick in the catalogue, and the COA converting potency results with a release block.
   - The full working version is kept outside the project in the folder `parked-potency-unit-2026-10-20` (next to it). It is tested (rule tests and its browser suite passed) and ready to bring back if the lab wants it.
   - Already in the system: specifications carry their unit and a basis (As reported, Per serving, Per package); the sample holds the serving size and density; the COA prints per-serving amounts when a test or a limit asks for them.

## What was built (0.34.0)

- **Cancelling:**
  - `requested_test_cancel_problem(rt)` gives the reason a test cannot be cancelled: it has results, or it is in a batch that is not cancelled.
  - Triggers refuse such a test, and a sample holding one. Cancelling a sample cancels its tests.
  - A logged sample needs a Reason for Change, as before.
  - Route `POST /api/orders/:id/cancel` always takes a reason.
  - On the order page:
    - "Cancel ticked samples…";
    - a Cancel… button on each sample and test row;
    - right-click on a selection;
    - a confirmation naming what goes, then the reason.
  - Stability studies and competency attempts keep cancelling their own tests.
- **Thermometer:**
  - `custody_event.thermometer_id`.
  - `receive_samples` takes a 10th argument. It is required with a temperature, and the thermometer must be this lab's, available and not out of calibration.
  - The receive dialog lists only usable equipment, with thermometers first. The custody card and PDF show it.
  - Seed 039 adds one fictional "Receiving thermometer (demo)" per lab that has none, calibrated.
- **Serving size on the chain of custody:** printed under each sample, e.g. "Serving 2 capsule = 1.2 g".
- **License dates:** a client license's state and days left are worked out on the lab's date (`license_state_on`). 055 used the server's date, a day ahead in the evening in California.

## Build choices (Proposed)

1. Cancelling takes a reason even before logging. The order's status is not recalculated by cancelling.
2. A thermometer that needs no calibration (as set in its equipment record) is accepted. Any equipment can be chosen, but thermometers are listed first.
3. The per-row Cancel… buttons sit at the end of the wide grids (older tests paste by column position). "Cancel ticked samples…" and right-click are the quick way.
