---
type: Business Rule
status: Approved
---

# Rush Fee Calculation Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Requested Test]]
- [[Quote Rush Term]]
- [[Rush Fee Tier]]
- [[Quoted Test Configuration]]

## Required behavior
Rush fee = tier surcharge (percent of the client's final test price, or a flat amount) x (1 - the quote's rush discount % for that tier). Each tier carries its own discount on the quote (for example Same Day 0%, 5 Day 100%), and a single line may override a tier. Dollar amounts are shown beside every percent on quotes and orders. Example: final price $188.00, Next Day +100% = $188.00, rush discount 25% = -$47.00, rush fee $141.00.

## Value ownership
- Inputs: Final price, tier surcharge, Quote Rush Term discount
- Outputs: Rush Fee (dollars)

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
