---
type: Business Object
domain: Sample Management
capability: Stability Studies
object_classification: Definition Object
status: Reviewed
---

# Stability Condition

## Definition
A storage condition in a study, for example 25 C / 60% RH (real time) or 40 C / 75% RH (accelerated). Each condition has its own stored study sample and chamber.


## As built (migration 032, 2026-10-14)
- The six ICH conditions are preset for every lab; labs add their own. Chambers (equipment) are set to one condition and hold racks where each study's material is placed at a position.
- See [[Decision - Stability Studies S-1]].

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Stability Studies]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Condition Name
- Temperature
- Relative Humidity
- Type: Real Time, Accelerated, Intermediate, Other
- Chamber (Equipment)

## Derived Values
- Material on hand

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **belongs to** [[Stability Study Version]]
- **stored in** [[Equipment]]
- **holds** [[Sample]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- What is the current status of this Stability Condition?
- What is blocking or affecting this Stability Condition?
- Which related records explain this Stability Condition?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
