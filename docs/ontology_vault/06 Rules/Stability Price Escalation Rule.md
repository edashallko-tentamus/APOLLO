---
type: Business Rule
status: Approved
---

# Stability Price Escalation Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Stability Study Version]]
- [[Quoted Test Configuration]]
- [[Invoice Line Item]]

## Required behavior
A study quote may carry an annual escalation percent, compounded on each anniversary of acceptance. The quote shows a price table for each study year so the client sees what every pull will cost. Each pull is billed at the price for the study year it falls in.

## Value ownership
- Inputs: Escalation %, acceptance date, pull date
- Outputs: Price per pull

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
