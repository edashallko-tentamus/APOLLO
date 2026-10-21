---
type: Architecture Decision
status: Approved (Alex, 2026-10-15 and 2026-10-17); build choices Proposed
decided: 2026-10-17
built: 2026-10-17 (migration 041, seed 033, version 0.23.0)
---

# Decision - Stability Studies S-2

Builds on [[Decision - Stability Studies S-1]] and [[Decision - Stability Studies S-2 Scope]] (Alex's first answers, 2026-10-15). Alex, 2026-10-17: "go ahead and build it", answering four questions (all four recommended options):

1. **Amendments: an amended quote.** A new version of the stability quote, sent and accepted like the first; on acceptance the study switches to it. Pulls already done stay as they were; only future pulls change. (Same as 2026-10-15.)
2. **Cancellation: chosen per condition.** Cancel is signed with a reason; future pulls are cancelled (open pull orders too); for each condition's stored material the lab records Destroyed, Returned to the client or Kept as retain, which frees the rack. (2026-10-15: disposed of or returned, disposal the default; the retain was added.)
3. **Excursions: QA, per study.** No impact / Impact (results flagged) / Client to decide, signed with a justification; the issued report lists each excursion and its assessment. **Conflict to settle:** on 2026-10-15 the third outcome was "an extra pull"; on 2026-10-17 Alex chose "Client to decide". Built as 2026-10-17. An extra pull can be ordered today through an amendment (a new timepoint).
4. **The issued cumulative report: after each pull.** Interim reports (version 1, 2, 3...) once a pull's results are finalized; the one issued when every pull is done and finalized is Final. Signed like a COA and emailed to the client. 2026-10-15 added: issued through Report Finalization, with the same independence rules as a COA (built).

**Already done before S-2:** billing per pull ([[Decision - Invoicing I-1]]: each pull's tests are invoiced once their COA is issued, at the study year's price); excursions listed per study ([[Decision - Electronic Logbooks L-1 and L-2]]).

## What was built (migration 041)

- **Amendments.** "Amend the study…" (study page or the quote page; quotes.edit) makes a new version of the stability quote, copied from the version the study runs to; each timepoint remembers the one it was copied from (`carried_from_id`). An amendment cannot change T0 (ordered when the study started), the interval of a timepoint already ordered or pulled, or the tests at a timepoint already ordered or pulled for that condition. It can add timepoints, tests and conditions, or untick what stops. The design shows warnings: a new condition to place, a dropped condition's material, material left against what the remaining pulls need, a new timepoint whose date has passed. Issued, sent and accepted like any quote (online or by the lab). **On acceptance** (`apply_stability_amendment`): the study runs to the new version; pulls ordered or taken stay as they are (they follow their timepoint); scheduled pulls the new design drops are cancelled, those it keeps take its interval, window and material; new timepoints get their pulls; a new condition is placed from the study page (no T0; its pulls count from its own placement date). Each amendment is recorded (`stability_amendment`: from and to version, pulls added, cancelled, moved). One amendment at a time.
- **Cancellation** (`cancel_stability_study`, permission `stability.cancel`: Lab Supervisor, General Manager; signed "Cancelled by", with a reason): scheduled pulls cancelled; open pull orders (not yet pulled) cancelled with their samples and tests; the T0 order cancelled if the sample never arrived; pulls already taken stay in testing (reported and billed). Every stored material gets its fate (Destroyed, Returned, Retained) with an optional note; the rack is freed. A completed study's leftover material, or a condition an amendment dropped, is disposed of from the Stored material grid ("Dispose…", stability.manage, signed "Disposed by") once no pull needs it.
- **Excursion assessments** (`assess_stability_excursion`, permission `stability.assess`: QA; signed "Assessed by", justification required): one current assessment per excursion and study (a new one replaces it, the old one kept). It records the reading, and the pulls of the exposed material: those taken after the last good reading before the excursion, and those still to come. "Impact: results flagged" marks those pulls' results **E** on the summary and the issued report.
- **The issued report** (`issue_stability_report`, permission `reports.finalize`, signed "Issued by", the signer's handwritten signature and title on file): STB-00001-SR1, SR2... Blocked while: the material is not placed; no result is finalized; an excursion is not assessed; nothing is new since the last report (no result finalized, assessment or amendment); the signer performed, witnessed, reviewed or approved work it includes (as a COA); the client is Regulated and the signer lacks reports.finalize_gmp. Final when the study is completed (or cancelled) and every test it still has is finalized. The PDF shows only finalized results, per condition, one table per test, timepoints across (by interval, so amendments keep columns), the excursions with their assessments, the amendments, the cancellation, and the signature. Emailed ("Stability Report Issued") to the client's report contacts, else the study's contact, with the PDF. Frozen once issued. **Report Finalization > Stability reports** lists the lab's studies, ready or not and why; the study page has "Preview the next report" and "Issue report…".
- Canned reasons: a Stability module (seed_033).

## Build choices (Proposed: not yet confirmed by Alex)

1. **One amendment at a time**, copied from the version the study runs to (a rejected amendment is not built on).
2. **Amendment prices** carry over unchanged from the version the study runs to (new tests start at list price); study years still count from the first acceptance.
3. **A new condition's pulls count from its own placement**, not from the study's.
4. **An amendment cannot add T0 tests**; a new baseline for a new condition is not ordered (its T0 is the study's T0).
5. **Pulls of material with no units left** are not scheduled by an amendment (warned on the quote): adding material to a running study is not built.
6. **Cancelling is Lab Supervisor and General Manager** (`stability.cancel`); no client email is sent on cancellation.
7. **Affected pulls of an excursion** = pulls of that condition's material taken after the last passing reading before it, plus those still to come; only "Impact" flags results (E).
8. **The report is issued from the study page**, reached from Report Finalization > Stability reports (not claimed like COAs); the issuer needs reports.finalize (Project Manager, QA).
9. **Final** = study completed or cancelled and every remaining test finalized; a further report after a Final one is allowed when something changes (it replaces it).

## Questions for QA (Jake Teller)

- Who may cancel a study (built: Lab Supervisor, General Manager).
- Whether "Client to decide" needs a follow-up record of the client's answer.
- Whether an excursion assessment on a GMP study must be by QA only (built: anyone with stability.assess, standard group QA).

Related: [[Stability Study]], [[Stability Pull]], [[Open Items for QA Review]].
