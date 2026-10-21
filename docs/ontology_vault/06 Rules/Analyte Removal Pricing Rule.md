---
type: Business Rule
status: Approved
---

# Analyte Removal Pricing Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Quoted Test Configuration]]
- [[Quoted Analyte Selection]]
- [[Requested Test]]
- [[Requested Analyte]]

## Required behavior
For analyte-priced tests, list price = base price (if set) + preparation fee (if set) + sum of selected analyte prices.
- On a quote, removing analytes recalculates the list price; the negotiated discount percent is kept and the final price follows it.
- On a lab order, analytes may be removed per sample; price = new list price x (1 - quoted discount %).
- Analytes not selected on the quote can never be added on an order (re-quote or accept list price).
- The dollar difference is always shown next to the percent so the client and account manager can see it.
- Removed analytes are not ordered, billed or reported (distinct from Hide Analyte).

## Value ownership
- Inputs: Analyte prices, quoted discount %
- Outputs: Line list price, final price, dollar difference

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
