---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Mixture Components Can Be Entered in Any Convertible Unit

On the in-house mixture page each component's Amount used has its own Unit, offered from the units the Unit conversions table links to the unit the lot is kept in (for example methanol kept in L is used in mL). A lot kept in L defaults to mL and one kept in kg defaults to g. The system converts the amount to the lot's own unit to draw the stock, and keeps both: the lot page shows "2.5 mL (= 0.0025 L)". An amount that cannot be converted to the lot's unit is refused with the reason. Requested by Alex Kiddle on 2026-10-12. Built in migration 007.

Also confirmed then: unit conversions work in both directions and chain, so no inverse lines are needed; a barcode scanner that types the INV code into the Lot cell fills it and moves to the next row (no labels printed yet).

See [[Decision - Units and Unit Conversions Are Controlled Tables]].