# Assumptions register and route verification

Written before coding, as the requirements ask. Every item here is **unverified** until the owner column is signed off at gate G0. The code enforces these assumptions as defaults: every route ships disabled, every provider capability ships unverified, and the production build refuses mock adapters.

## A. Technical assumptions baked into the code

| # | Assumption | Where it lives in code | If wrong |
| --- | --- | --- | --- |
| A1 | All amounts are whole FCFA (XAF, no minor unit). | `packages/pricing` (BigInt intermediates, `Number.isSafeInteger` guards), Prisma `Int` columns | Switch to minor units in `@amico/contracts` money helpers |
| A2 | Percentages are stored in basis points (1% = 100 bps). | `PricingRule.percentageBps` | — |
| A3 | Conversion rates are stored in parts-per-million (1.0 = 1,000,000 ppm) so `floor(A × r)` stays integer. | `PricingRule.conversionRatePpm` | — |
| A4 | Fees round **up** to the whole franc; delivered amounts round **down**. Configurable per rule. | `RoundingMode` in `packages/pricing` | Change rule's rounding fields |
| A5 | Collection and disbursement are distinct provider capabilities. | `ProviderCapability` enum | — |
| A6 | Normal SIMs have no integration; receipt is confirmed only by a staff member checking the SIM itself. | `ProcessingMethod.MANUAL`, manual-verification module | — |
| A7 | A customer reference or screenshot is never proof of receipt; staff must record the received amount and an evidence note. | `ManualVerificationService.decide` | — |
| A8 | Default quote validity is 10 minutes; per-service override. | `Service.quoteTtlSeconds` | Change per service |
| A9 | Simulated (mock) transactions post to a separate simulated ledger book and carry `isSimulated=true`. | `LedgerBook.SIMULATED`, `Transaction.isSimulated` | — |

## B. Business, commercial and legal assumptions (need verification)

| # | Question | Blocks | Owner | Status |
| --- | --- | --- | --- | --- |
| B1 | Which provider (MTN/Orange direct or a licensed aggregator) grants collection, disbursement, airtime and data vending — on what fees and settlement cycle? | All API routes | Business | Open |
| B2 | Do MTN and Orange subscriber terms allow received airtime transfers to be used commercially? What per-transfer and daily caps apply? | All 6 airtime-source routes | Business + counsel | Open |
| B3 | Is a payment-services licence or a partnership with a licensed institution required (CEMAC rules)? KYC tiers and limits? | Go-live | Counsel | Open |
| B4 | Float needed per operator wallet; who funds and rebalances it? | Cross-network routes | Finance | Open |
| B5 | Can staff reliably see sender number and amount for each incoming airtime transfer on the normal SIMs? | Manual routes | Operations | Open |
| B6 | Verified airtime → cash conversion rate per operator. | Airtime-source routes | Business | Open |
| B7 | Verified provider fee schedules (fixed / % / deducted at settlement?). | Accurate quotes | Finance | Open |
| B8 | Production hosting, data residency and personal-data obligations. | Go-live | IT + counsel | Open |

## C. Route feasibility (seeded state = DISABLED for all)

| Route code | Route | Method | Required capabilities | Verification needed | Risk |
| --- | --- | --- | --- | --- | --- |
| `MTN_MOMO__ORANGE_MONEY` | MTN MoMo → Orange Money | API | MTN COLLECT, ORANGE DISBURSE | B1, B4, B7 | Medium |
| `ORANGE_MONEY__MTN_MOMO` | Orange Money → MTN MoMo | API | ORANGE COLLECT, MTN DISBURSE | B1, B4, B7 | Medium |
| `MTN_MOMO__MTN_AIRTIME` | MTN MoMo → MTN airtime | API | MTN COLLECT, MTN AIRTIME_TOPUP | B1, B7 | Low–medium |
| `MTN_MOMO__ORANGE_AIRTIME` | MTN MoMo → Orange airtime | API | MTN COLLECT, ORANGE AIRTIME_TOPUP | B1, B7 | Medium |
| `ORANGE_MONEY__ORANGE_AIRTIME` | Orange Money → Orange airtime | API | ORANGE COLLECT, ORANGE AIRTIME_TOPUP | B1, B7 | Low–medium |
| `ORANGE_MONEY__MTN_AIRTIME` | Orange Money → MTN airtime | API | ORANGE COLLECT, MTN AIRTIME_TOPUP | B1, B7 | Medium |
| `MTN_AIRTIME__MTN_MOMO` | MTN airtime → MTN MoMo | Manual source | MTN DISBURSE | B2, B3, B5, B6 | High |
| `MTN_AIRTIME__ORANGE_MONEY` | MTN airtime → Orange Money | Manual source | ORANGE DISBURSE | B2, B3, B4, B5, B6 | High |
| `ORANGE_AIRTIME__ORANGE_MONEY` | Orange airtime → Orange Money | Manual source | ORANGE DISBURSE | B2, B3, B5, B6 | High |
| `ORANGE_AIRTIME__MTN_MOMO` | Orange airtime → MTN MoMo | Manual source | MTN DISBURSE | B2, B3, B4, B5, B6 | High |
| `MTN_AIRTIME__ORANGE_AIRTIME` | MTN airtime → Orange airtime | Manual source | ORANGE AIRTIME_TOPUP | B2, B5, B6 | High |
| `ORANGE_AIRTIME__MTN_AIRTIME` | Orange airtime → MTN airtime | Manual source | MTN AIRTIME_TOPUP | B2, B5, B6 | High |
| `MTN_MOMO__MTN_DATA` | MTN MoMo → MTN data bundle | API | MTN COLLECT, MTN DATA_BUNDLE | B1, B7 | Low–medium |
| `ORANGE_MONEY__ORANGE_DATA` | Orange Money → Orange data bundle | API | ORANGE COLLECT, ORANGE DATA_BUNDLE | B1, B7 | Low–medium |

Airtime purchases for oneself or others are covered by the four `…_MOMO/MONEY__…_AIRTIME` routes. In total 14 routes are seeded, all `DISABLED`.

A route can be enabled only when (1) every required capability is `enabled` **and** `verifiedAt` is set, (2) it has an `ACTIVE` pricing rule approved by a second user, and (3) for manual routes, the receiving normal SIM is active. The API enforces this in `CatalogueService.assertActivatable`.
