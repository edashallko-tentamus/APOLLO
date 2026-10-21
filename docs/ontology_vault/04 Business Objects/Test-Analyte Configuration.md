---
type: Business Object
domain: Laboratory Operations
capability: Test Method and Workflow Management
object_classification: Definition Object
status: Reviewed
---

# Test-Analyte Configuration

## Definition
Defines an analyte's formulas, units, limits, and reporting behavior within a Test. References [[Analyte]] directly — a microbiological strain is not modeled separately here, since [[Analyte]] already equivalates Reference Standard-derived analytes and Microbiological Strains for reporting purposes (see [[Decision - Analyte Table Extends Existing Analyte Object]]). Created in the test creation wizard's first step, one per reported Analyte selected.

Analyzed and reported are two separate questions. An analyte can be fully analyzed — the method genuinely tests for it, a Result is produced and retained — while still being excluded from what the client sees on the Certificate of Analysis. This is what makes one Test definition reusable across client-specific variants: a Heavy Metals method might genuinely analyze 100 analytes, and a given client's Test only needs to show 5 of them. See [[Decision - Analyte and Limit Visibility Are Independently Controllable]].

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Method and Workflow Management]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Reporting Unit (link to [[Unit of Measure]] — the final unit this analyte is reported in for this Test)
- Hide Analyte (boolean — excludes this analyte's Result from the Certificate of Analysis entirely; the analyte is still analyzed and its Result retained. When true, this analyte's own Reporting Limit "Hide on Report" flags become moot — nothing about it shows regardless.)

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
- **belongs to** [[Test]]
- **references** [[Analyte]]
- **uses** [[Calculation Formula]]
- **uses** [[Unit of Measure]]
- **uses** [[Reporting Limit]]
- **may use** [[Specification]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: reporting units, hide flags and formulas across all analytes of a test.

## AI Questions
- What is the current status of this Test-Analyte Configuration?
- What is blocking or affecting this Test-Analyte Configuration?
- Which related records explain this Test-Analyte Configuration?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
