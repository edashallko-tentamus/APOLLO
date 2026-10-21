---
type: Architecture Decision
status: Approved (Alex, 2026-10-19); build choices 1, 3 and 4 answered (2026-10-19), the rest Proposed
decided: 2026-10-19
built: 2026-10-19 (migration 047, version 0.26.0); pricing by test price: migration 049, version 0.27.1
---

# Decision - Test Packages and Dated Price Changes P-1

Relates to [[Decision - Quote Pricing, Catalogue Updates and Serving Sizes]] (the first "Update prices…", 0.16.1), [[Decision - Standalone Quotes]] and [[Decision - Invoicing I-1]]. Deals and the Customer Portal hub are separate and not built.

**Context.** Alex (2026-10-19): labs sell tests together ("a supplement release package") and raise prices once a year. Today a package has to be rebuilt by hand on every quote, and "Update prices…" changes prices at once, with no start date or rounding.

## Alex's decisions (2026-10-19)

1. **Packages live in the Test catalogue** and are put on quotes without being rebuilt.
2. **Two ways to price a package:** a fixed price, or the sum of its tests less a discount. Analyte-priced tests can have analytes left out or repriced inside a package.
3. **One price for the package on the quote**, which can be negotiated like any line.
4. **Each test carries its share of the package price** (its component price), so each test is invoiced when its own report is issued.
5. **Cancelling a test of an ordered package: option B** (Alex, 16:28, changing his first choice of option A): only that test's share comes off. The package is not broken, the other tests keep their shares, and the client keeps the rest of the discount. The person cancelling sees the amount before confirming ("if possible to build, then yes").
   - Option A, built first and then replaced the same afternoon, broke the package and repriced the tests left to the client's quoted price, else the catalogue price. It is not in the code.
6. **Price increases:** one test, a selection or the whole catalogue; by a percentage; from an effective date; rounded; quotes already made keep their prices.
7. **Deals** (time-limited special prices; the lower price wins) come later, with the Customer Portal hub. Not built.

## What was built (migration 047)

- **Catalogue (Test catalogue > Packages tab):** `test_package` (PKG-0001: lab, name, description, pricing mode, fixed price or discount %, public flag, status), `test_package_item` (its tests, optional typed share), `test_package_analyte` (only the exceptions: an analyte left out, or its package price). The package page lists the tests with their catalogue price, their value in the package and their share, the analytes of analyte-priced tests, the problems to fix, and the quotes that carry it. Saved with a Reason for Change; Retire keeps it on existing quotes and orders.
- **Shares:** typed shares when every test has one (they must add up to the price), else in proportion to each test's value, the last test taking the rounding.
- **Problems** (Errors stop quoting): no tests; partly typed shares; typed shares that do not add up; every analyte of a test left out; a fixed price without its price. Warnings: one test only; dearer than its tests; a test with no approved workflow (quotable, not orderable).
- **Quotes:** "Packages on this quote" with the tests and their shares, quantity, the package price (editable while the quote is), discount %, total, Specs per test, trash. The quote total and the quotation PDF include packages (one line each, its tests listed under it). A new version copies packages with their negotiated price and shares.
- **Orders:** "Add a package to ticked samples" and "+ Add a package" per sample: every test of the package, each at its share. A package's test cannot be ordered on its own from the quote. Applying a project orders its packages as packages first. A Package column names each test's package and its status (Intact, Partly cancelled, Cancelled).
- **Cancelling a test of a package (option B):** the confirmation shows the share that comes off and what the tests left still cost; the package becomes Partly cancelled (Cancelled when nothing is left); no other price changes. Cancelled tests are never invoiced, so the client pays only the shares of the tests done. The invoice line says "Part of package PKG-x name ($ per sample): this test's share", noting when tests were cancelled from it.
- **Dated price changes (Tests tab, "Update prices…"):** the selected tests or every active test of this lab, a percentage, a start date (today applies at once; a later date is applied by the hourly job that morning), rounding to the cent or the dollar, and whether fixed package prices and typed shares change too. Each is a record (PC-0001) with its reason; the Price changes tab lists them, and a scheduled one can be cancelled with a reason. The catalogue list shows each test's lab.

## 0.27.1: each test priced in the package (Alex, 2026-10-19; migration 049)

Alex: "Let's instead of using a %discount approach and instead enter the price for the component test and calculate the discount. This should make it more simpler. You always make a package price by re-pricing the component tests." This replaces decision 2's two pricing modes and the analyte repricing.

- **Each test has a price in the package** (it starts at its catalogue price). **The package price is their sum.** The discount is worked out: the tests at their catalogue prices (the analytes in the package) less the package price, in dollars and %, for the package and each test. There is no fixed price, no discount % and no per-analyte package price; analytes can still be left out.
- A test priced above its catalogue price is a Warning (for example after analytes were left out: lower its price too).
- **Dated price changes (Claude's choice, Proposed):** with "Packages" ticked, each test in the change has its price in every package changed by the same % and rounding, so the package's discount stays about the same.
- **Existing packages kept their price:** each test got the share it had. Alex's PKG-0001 "USP <61> <62> Bundle" (10 % off, $688.50) had 10 and 90 typed as shares, which did not add up, so it could not be quoted; it kept $688.50, shared by value (USP <61> $321.30, USP <62> $367.20).
- **Unchanged:** quotes, orders and invoices (they use each test's share, now its typed price). On a quote the package price is still negotiated as one figure and shared out in proportion. **To ask Alex:** should the quote also be repriced test by test?

## Build choices

**Alex's answers (2026-10-19, 17:31):** 1. a package with another lab's (subcontracted) tests "is a great idea" as an option: to build (see Not built); 3. a price change covers its own lab only: correct; 4. no new permission: understood.


1. A package belongs to one lab and holds that lab's tests only; it is quoted by its own lab. **Alex: add subcontracted tests as an option** (not built yet).
2. No packages on stability quotes or on a list-price acceptance.
3. A price change covers the lab it is scheduled in (another lab's tests are refused); system administrators schedule per lab. **Confirmed by Alex.**
4. No new permission: packages and price changes are `catalog.edit`, packages on quotes `quotes.edit`, on orders `orders.edit`. **Accepted by Alex.**
5. Changing a package changes new quotes only; quotes and orders keep the price and shares they were given.
6. A price change does not touch quotes, orders or invoices already made.
7. A scheduled change cannot be edited, only cancelled and made again.
8. The package's tests are shown, not its specifications per package (Specs are per test).
9. Option B's cancellation needs no extra reason beyond the one the order already asks for logged samples.

## Not built

Deals and their time limits; packages in the Customer Portal (with the public catalogue flag); subcontracted tests in a package (Alex wants it as an option: priced by the 20-30 rule like a subcontracted quote line, and ordered at the performing lab once sending samples between labs is built); cancelling a whole package in one click on the order page (the database function `cancel_ordered_package` exists).
