# Remit X-ray

**"Zero fee" — so what did the transfer really cost?**
Enter one money-transfer receipt you already have. Remit X-ray compares the rate you got with published mid-market rates for that day and shows the cost hidden in the exchange rate — in money, in percent, and in what your family did not receive.

**Live:** https://ryugi62.github.io/remit-xray/ · one-tap sample: https://ryugi62.github.io/remit-xray/?sample=0
United Hackathons V1 — track **Economic** ("Design tools that promote financial inclusion…").

![tests](https://github.com/Ryugi62/remit-xray/actions/workflows/test.yml/badge.svg)

## Why
A migrant worker sending money home usually sees one number on the receipt: the fee. Many apps advertise it as 0. The other cost — a worse exchange rate than the mid-market rate — is not printed anywhere, so it cannot be compared, complained about, or added up over a year.

World Bank data (cost of sending $200, including the exchange-rate margin): **4.19 %** average from South Korea, **3.51 %** from the United States (2023, `SI.RMT.COST.OB.ZS`). The UN target (SDG 10.c) is **under 3 %**.

Quote-comparison sites help *before* you send. Remit X-ray **audits the transfer you already made**, so the hidden part becomes a number you can keep as evidence.

## What we found in real published prices (collected 2026-10-06)
- 61 real published quotes · 25 providers · 9 corridors
- 15 of 19 "zero-fee" quotes still cost money through the rate: median 1.58 %, up to 6.08 %
- in 46 of 51 quotes with a margin, more than half of the total cost was not on the fee line (median 83 %)

(`python3 scripts/findings.py` prints these from `vectors/receipts.json`.)

## How it works
1. **Enter** what you paid, the fee shown, what arrived, and the date — or paste the receipt text, or read a photo. Values read by the machine are yellow and are not used until you confirm them.
2. **Reference band.** For the day before and the day of the transfer, the page fetches mid-market rates from every public source that has the pair: [currency-api](https://github.com/fawazahmed0/exchange-api) (jsDelivr), [ECB reference rates via Frankfurter](https://frankfurter.dev), [ExchangeRate-API open access](https://www.exchangerate-api.com). The band is the lowest–highest of those rates. We do not know the minute your provider priced the transfer, so the answer is a **range**, never a fake-precise single number. No source → no answer (we never guess).
3. **Audit.**
   `effective rate = received ÷ (paid − fee)`
   `hidden margin = 1 − effective ÷ reference` (computed at both ends of the band)
   `real cost = fee + (paid − fee) × hidden margin`
   A rate inside the band is "basically the fee you saw"; a rate above it is labelled as a likely promotion, never shown as a negative cost.
4. **Context.** World Bank averages for the sending and receiving country, the 3 % UN goal, a yearly estimate (cost % × monthly amount × 12, labelled as an estimate), and today's published quotes for the same route (Wise comparison API — Wise is itself a provider, and the page says so).

Everything runs in the browser. Receipts and photos never leave the device (OCR is tesseract.js, loaded only when you choose a photo); saved transfers stay in this browser's storage. No backend, $0 running cost.

Languages: English, 한국어, Tiếng Việt, नेपाली, O'zbekcha. Non-English strings were drafted with AI help and checked for meaning, not by native speakers — corrections welcome.

## Can you trust the numbers?
- **Test vectors from real prices.** `vectors/` holds 61 quotes that providers published on 2026-10-06 (Wise comparison API for 6 corridors; the Hanpass, GME Remit and E9pay public calculators for KRW→VND/NPR/UZS). `vectors/compute_expected.py` is an **independent Python `Decimal` re-implementation** that fetches the rates itself and freezes the band and the expected result. The JavaScript engine must match every vector to ±0.01 percentage point.
- **Tests:** `npm test` (Node ≥ 20, no dependencies) — domain math, parser, draft confirmation, adapters with fake fetch, i18n completeness, formatting, layer rules, and every vector. CI runs them on every push.
- **Clean architecture.** `src/domain` (receipt, band, audit math, parser, impact) knows nothing about the network or the page; `src/application` (audit use case with a `RateSource` port, draft confirmation, ledger) imports only the domain; `src/adapters` (rate APIs, Wise quotes, OCR, storage) and `src/ui` sit outside. A test fails if a layer imports the wrong way.
- Specification with numbered acceptance criteria: [SPEC.md](SPEC.md).

## Limits (said plainly)
- Mid-market rates are daily, not intraday; a provider that priced at a different hour can land slightly inside or outside the band — that is why we show a range.
- Some corridors (e.g. KRW→NPR) are not covered by the ECB; the band then uses fewer sources and the page lists which ones were missing.
- Photo reading works best on clear screenshots; that is why every machine-read field must be confirmed.
- This is information, not financial advice, and it does not recommend a "best" provider.

## Run locally
```
python3 -m http.server 8000   # then open http://localhost:8000
npm test
python3 vectors/compute_expected.py   # re-fetch rates and rebuild vectors/receipts.json
python3 scripts/build_data.py         # World Bank context + sample receipts
```

## Built during the hackathon
All code was written from 2026-10-06 (hackathon window: Oct 5–11, 2026 PT) by Taegeol Kim (solo), with AI coding assistance. MIT license.
