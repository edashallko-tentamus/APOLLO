---
type: Business Rule
status: Approved
---

# List Price Snapshot Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Quoted Test Configuration]]
- [[Quote Rush Term]]
- [[Project Version]]
- [[Stability Study Version]]

## Required behavior
When a test is added to a quote, its current list price is copied onto the line and cannot be typed over. When a quote is issued, its rush schedules and tiers are copied onto it. Later catalogue or schedule changes never alter an issued or accepted quote; re-quoting creates a new version that refreshes list prices.

## Value ownership
- Inputs: Test Catalog Entry list price, Rush Fee Tier surcharges
- Outputs: Snapshot values on the quote

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
