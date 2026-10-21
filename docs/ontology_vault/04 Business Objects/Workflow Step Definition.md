---
type: Business Object
domain: Laboratory Operations
capability: Test Method and Workflow Management
object_classification: Definition Object
status: Reviewed
---

# Workflow Step Definition

## Definition
Controlled definition of one workflow step. One object for all steps — the Step Type field determines which type-specific configuration fields cascade underneath it, both in the data model and in the step builder UI. Separate objects per step type were considered and rejected in favor of this. See [[Decision - Workflow Step Types Cascade Under One Definition Object]] for every type and its fields.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Method and Workflow Management]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Step Name (creator-named — e.g. a Preparation step might be called "Digestion")
- Step Type (Batching, Weighing, Preparation, Plating/Inoculation, Incubation, Dilution, Split off Test, Hold Point, Calculation, Data Entry, QC Review)
- Type-specific configuration (cascades based on Step Type — see [[Decision - Workflow Step Types Cascade Under One Definition Object]])

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
- **belongs to** [[Workflow Version]]
- **has dependency** [[Step Dependency]]
- **may use** [[Decision Rule]]
- **may use** [[Acceptance Rule]]
- **requires** [[Step Authorization]]
- **may require** [[Electronic Logbook]] (integration deferred to a later session — see [[Decision - Workflow Step Types Cascade Under One Definition Object]])
- **may require** [[Equipment]]
- **may require** [[Inventory Lot]]
- **may create** [[Requested Test]] (Split off Test step type — spawns an existing Test from the catalog as a new Requested Test, available for batching)
- **may wait on** [[Requested Test]] (Hold Point step type — external completion condition, e.g. a split-off test finishing)
- **may record** [[Material Usage Record]] (Preparation, Dilution, and Plating/Inoculation step types — items tagged to the batch with quantity)

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: step configuration across a workflow.

## AI Questions
- What is the current status of this Workflow Step Definition?
- What is blocking or affecting this Workflow Step Definition?
- Which related records explain this Workflow Step Definition?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Electronic Logbook Calculation Workflow]]
- Governed or affected by [[Workflow Step Authorization Rule]]
