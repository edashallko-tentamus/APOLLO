---
type: Business Rule
status: Approved
---

# Primary Contact Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Client Contact]]
- [[Contact Role]]

## Required behavior
Each client has at most one active Primary Contact and any number of Secondary Contacts. A contact cannot be both Primary and Secondary for the same client but may be Primary for one client and Secondary for another.

## Value ownership
- Inputs: Contact Roles on Client Contact
- Outputs: Validation on save

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
