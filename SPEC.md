# Remit X-ray — SPEC v1.0

United Hackathons V1 · Track: **Economic** ("Design tools that promote financial inclusion, support small businesses, or help people build economic stability and opportunity.")
Code written from 2026-10-06 17:20 KST (inside the hackathon window, Oct 5–11 PT). Plan draft v0.1 was written before the window; this file supersedes it.

## 0. One line
A migrant worker enters (or pastes / photographs) one money-transfer receipt — sent, fee, received, date — and sees the **hidden exchange-rate markup** in money and percent, against a sourced mid-market **reference band** for that day, plus what it adds up to over a year.

Not a quote-comparison site (those help *before* you send). Remit X-ray **audits the transfer you already made** — the cost hidden behind "zero fee".

## 1. Success criteria (numbers)
1. Test vectors: ≥ 9 real published quotes (≥ 3 providers × ≥ 3 corridors) with expected markup computed by an independent script (`vectors/compute_expected.py`, Python `Decimal`); the JS engine matches every one to ±0.01 percentage point.
2. Every result shows the reference band (min–max of mid-market rates on D−1..D from every source that has the pair), each source name and date, and the markup as a **range** — never a single fake-precise number.
3. Fields read from pasted text or a photo are never used until the user confirms them (0 silent OCR paths).
4. Phone (390 px): sample receipt → result in ≤ 2 taps.
5. Languages: en, ko, vi, ne, uz (UI + result sentence).
6. Tests ≥ 25, layer check green, no backend, $0 running cost.

## 2. Constraints
- Rule: "Projects must address a real-world economic or financial problem using technology."; "All work must be original and created during the hackathon period."
- Rate sources (no key, CORS open): fawazahmed0 currency-api on jsDelivr (daily, ~all currencies; fallback mirror currency-api.pages.dev) · Frankfurter (ECB reference rates, ~30 majors). Market quotes for "next time": Wise comparison API (public; Wise is itself a provider — labelled).
- Context numbers: World Bank API `SI.RMT.COST.OB.ZS` / `SI.RMT.COST.IB.ZS` (average cost of sending $200, incl. FX margin) and `BX.TRF.PWKR.DT.GD.ZS` (remittances % of GDP). SDG 10.c target: 3%.
- Privacy: receipts never leave the device. OCR runs in the browser (tesseract.js, loaded only when the user taps "photo").

## 3. Ubiquitous language
| Term | Meaning | Code |
|---|---|---|
| Transfer receipt | sent amount+currency, stated fee (sent currency), received amount+currency, date, provider | `createTransferReceipt` |
| Corridor | sending → receiving currency | `corridorOf` |
| Reference band | min–max mid-market rate (received per 1 sent) over D−1..D across sources | `createReferenceBand` |
| Effective rate | received ÷ (sent − fee) | `effectiveRate` |
| Hidden markup | 1 − effective ÷ reference, as a range over the band | `auditReceipt().markup` |
| Total cost | stated fee + hidden markup value, in sent currency and % of sent | `auditReceipt().cost` |
| Shortfall | what the family did not receive vs. mid-market, in received currency | `auditReceipt().shortfall` |
| Yearly impact | total cost % × monthly amount × 12 (estimate) | `yearlyImpact` |
| Draft field | a value + where it came from + confirmed? | `createDraft`, `confirmField` |

## 4. Acceptance criteria (→ tests)
- AC-1: Given sent 1,000,000 KRW, fee 0, received 18,600,000 VND, band 19.05–19.12 → hidden markup 2.36%–2.72%, total cost ≈ 23,600–27,200 KRW.
- AC-2: A stated fee is added to the hidden markup; a fee-only provider whose rate is inside the band shows "within band" (markup indistinguishable from 0).
- AC-3: Effective rate above the band → classification `better-than-mid` (promo label), never a negative cost without that label.
- AC-4: A source that has no rate for the pair/date is listed as missing; the band uses the remaining sources and says so. No source → no result (`NO_REFERENCE`), never a guess.
- AC-5: Yearly impact = total cost % × monthly amount × 12, flagged `estimate`.
- AC-6: Pasted/OCR fields start `confirmed: false`; audit is blocked until every one is confirmed.
- AC-7: Layer rule: `src/domain` and `src/application` import nothing from `src/adapters` or `src/ui`.
- AC-8: Receipt validation: amounts > 0, fee ≥ 0 and < sent, ISO currency codes, different currencies, date not in the future.
- AC-9: Text parser reads amounts in `1,000,000` / `1.000.000` / `500.00` / `1.234,56` forms, currency codes and symbols (₩ $ € £ ₫ ₱), labels in en/ko/vi, and dates `YYYY-MM-DD`, `YYYY.MM.DD`, `MM/DD/YYYY`, `Oct 5, 2026`, `2026년 10월 5일`.

## 5. Architecture
`src/domain` (receipt, band, audit math, parser, impact) ← `src/application` (audit use case with `RateSource` port, draft confirmation, ledger) ← `src/adapters` (currency-api, Frankfurter, Wise comparison, tesseract OCR, localStorage) ← `src/ui` (static page, GitHub Pages). No build step, no backend.

## 6. UI acceptance (Toss-style checklist)
1. 390 px: no horizontal scroll; 1280 px holds. 2. One question per step (send → arrive → result). 3. Title ≥ 22 px bold, body 15–16 px, caption 13 px. 4. Section gap ≥ 24 px, card radius ≥ 16 px, ≤ 1 shadow level. 5. One primary CTA, bottom-fixed, ≥ 52 px. 6. Result card starts with the big number (≥ 28 px), verdict line under it. 7. Sources & formula inside `<details>` (closed). 8. Short friendly copy, jargon explained in one line. 9. White + one blue (#3182F6) + ok/warn/no, contrast ≥ 4.5:1, dark mode. 10. System fonts; the only external requests are the rate APIs and (on demand) OCR.

## 7. Physical verification
Live rates for 3 corridors on 3 dates; real published quotes (Wise comparison, Korean provider calculators) recomputed; screenshots 390/1280 in en and vi; OCR on a rendered receipt image.

## 8. Non-goals
Sending money, recommending a provider as "best", storing anything server-side, intraday rate reconstruction.
