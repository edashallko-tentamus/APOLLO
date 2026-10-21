---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Purchasing and Dynamic Receiving
object_classification: Definition Object
status: Draft
---

# Supplier COA

## Definition
Certificate of Analysis provided BY a supplier or manufacturer FOR a specific received lot — not to be confused with [[Certificate of Analysis]], which is this lab's own outgoing report to its customers. A Supplier COA is the source document backing an Inventory Lot's Purity/Potency and Concentration values, attached at receipt.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Purchasing and Dynamic Receiving]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Attached File
- Certified Purity/Potency (as stated on the document)
- Certified Concentration (as stated on the document)
- Supplier's Own Lot Reference (may differ from this lab's internal lot number or Resource ID)
- Issued Date

## Derived Values
- To be refined

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **attached to** [[Inventory Lot]]
- **attached by** [[Received Item]]
- **backs** Purity/Potency and Concentration values on [[Inventory Lot]]
- **read by** an AI agent that proposes lot values for human confirmation (see [[Decision - AI Reads Uploaded Supplier COAs and Proposes Values]])

## Governing Rules
- Governed by [[Ontology Principles]]
- See [[Decision - Receive Action and Supplier COA Added]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Supplier COA?
- Does this Inventory Lot have a Supplier COA on file?
- What is blocking or affecting this Supplier COA?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
