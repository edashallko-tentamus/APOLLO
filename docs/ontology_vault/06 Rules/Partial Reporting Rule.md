---
type: Business Rule
status: Approved
---

# Partial Reporting Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Certificate of Analysis]]
- [[Report Release]]
- [[OOS Investigation]]
- [[Client]]

## Required behavior
- An open OOS investigation holds only its own result. Other completed tests may be released on a partial CoA when the client's Allow Partial Reports is Yes; when No, the whole sample report waits.
- The final CoA lists every test, including the OOS result.
- A client retest is reported on a new CoA (not an amendment) that shows the original OOS result, the retest result, and all other tests on the sample order with their final results, so everything is together.
- Client On Hold overrides everything: nothing is released, including partial reports and OOS emails.

## Value ownership
- Inputs: OOS status, Allow Partial Reports, client Account Status
- Outputs: Releasable results, CoA content

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
