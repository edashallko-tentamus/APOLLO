---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Resource Consumption
object_classification: Event Object
status: Reviewed
---

# Material Usage Record

## Definition
Exact record of material lot and quantity used in testing. This is the point at which a resource is added to a workflow or batch — expiration status blocks this action outright; a resulting negative quantity does not block it, but is flagged.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Resource Consumption]]
- **Object classification:** [[Event Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Usage Type (Spike, or Consumable/General — a Spike carries analytical meaning: its amount feeds recovery at the Calculation step; Consumable is plain material consumption like pipette tips or matrix material)
- Quantity used
- Unit

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
- **belongs to** [[Analysis]]
- **consumes** [[Inventory Lot]]
- **creates** [[Consumption Transaction]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[Expired Inventory Blocking Rule]] (blocking)
- Governed by [[Resource Consumption Negative Flag Rule]] (non-blocking, flags)

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: assigning one lot to many entries.

## AI Questions
- What is the current status of this Material Usage Record?
- What is blocking or affecting this Material Usage Record?
- Which related records explain this Material Usage Record?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[In-House Material Preparation Workflow]]
- [[Inventory Receiving and Use Workflow]]
- Governed or affected by [[Expired Inventory Blocking Rule]]
- Governed or affected by [[Resource Consumption Negative Flag Rule]]
