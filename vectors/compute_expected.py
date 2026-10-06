"""Independent re-implementation (Python Decimal) of the audit math, used to produce test vectors.

1. For every real quote in vectors/quotes-<date>.json, fetch mid-market rates for D-1 and D
   from the two public sources (currency-api on jsDelivr, Frankfurter/ECB) — written by hand here,
   not by the JS adapters, so the JS engine is checked against a second implementation.
2. Freeze the band and the expected markup range into vectors/receipts.json.

Run: python3 vectors/compute_expected.py  (all quote files; earlier observations are kept)
"""
import json
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta
from decimal import Decimal, getcontext
from pathlib import Path

getcontext().prec = 40
ECB = set("AUD BGN BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR".split())
_cache = {}


def get_json(url):
    if url in _cache:
        return _cache[url]
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "remit-xray-vectors/1.0 (+https://github.com/Ryugi62/remit-xray)"})
        with urllib.request.urlopen(req, timeout=30) as r:
            _cache[url] = json.load(r)
    except urllib.error.HTTPError:
        _cache[url] = None
    return _cache[url]


def currency_api(frm, to, d):
    url = f"https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{d}/v1/currencies/{frm.lower()}.min.json"
    j = get_json(url)
    if not j or to.lower() not in j.get(frm.lower(), {}):
        return None
    return {"source": "currency-api", "date": j["date"], "rate": j[frm.lower()][to.lower()], "url": url}


def frankfurter(frm, to, d):
    if frm not in ECB or to not in ECB:
        return None
    url = f"https://api.frankfurter.dev/v1/{d}?base={frm}&symbols={to}"
    j = get_json(url)
    if not j or to not in j.get("rates", {}):
        return None
    age = (date.fromisoformat(d) - date.fromisoformat(j["date"])).days
    if age < 0 or age > 4:
        return None
    return {"source": "ECB (Frankfurter)", "date": j["date"], "rate": j["rates"][to], "url": url}


def er_api(frm, to, d):
    url = f"https://open.er-api.com/v6/latest/{frm}"
    j = get_json(url)
    if not j or j.get("result") != "success" or to not in j.get("rates", {}):
        return None
    from datetime import datetime, timezone
    published = datetime.fromtimestamp(j["time_last_update_unix"], timezone.utc).date().isoformat()
    if published != d:
        return None
    return {"source": "ExchangeRate-API", "date": published, "rate": j["rates"][to], "url": url}


NRB = set("INR USD EUR GBP CHF AUD CAD SGD JPY CNY SAR QAR THB AED MYR KRW SEK DKK HKD KWD BHD OMR".split())
CBU = set("USD EUR GBP JPY KRW CNY RUB KZT KGS TJS TRY AED SAR CHF CAD AUD SGD MYR INR".split())


def nrb(frm, to, d):
    """Nepal Rastra Bank: NPR per unit = (buy + sell) / 2 / unit."""
    other = to if frm == "NPR" else frm
    if "NPR" not in (frm, to) or other not in NRB:
        return None
    url = f"https://www.nrb.org.np/api/forex/v1/rates?from={d}&to={d}&per_page=10&page=1"
    j = get_json(url)
    payload = (j or {}).get("data", {}).get("payload") or []
    if not payload:
        return None
    row = next((r for r in payload[0]["rates"] if r["currency"]["iso3"] == other), None)
    if not row:
        return None
    npr = (Decimal(row["buy"]) + Decimal(row["sell"])) / 2 / Decimal(row["currency"]["unit"])
    rate = 1 / npr if frm == "NPR" else npr
    return {"source": "Nepal Rastra Bank", "date": payload[0]["date"], "rate": float(rate), "url": url}


def cbu(frm, to, d):
    """Central Bank of Uzbekistan: UZS per unit = Rate / Nominal; Date is DD.MM.YYYY."""
    other = to if frm == "UZS" else frm
    if "UZS" not in (frm, to) or other not in CBU:
        return None
    url = f"https://cbu.uz/en/arkhiv-kursov-valyut/json/{other}/{d}/"
    j = get_json(url)
    row = next((r for r in (j or []) if r.get("Ccy") == other), None)
    if not row:
        return None
    uzs = Decimal(row["Rate"]) / Decimal(row.get("Nominal") or "1")
    rate = 1 / uzs if frm == "UZS" else uzs
    dd, mm, yy = row["Date"].split(".")
    when = f"{yy}-{mm}-{dd}"
    if (date.fromisoformat(d) - date.fromisoformat(when)).days > 4:
        return None
    return {"source": "Central Bank of Uzbekistan", "date": when, "rate": float(rate), "url": url}


def band_for(frm, to, d, previous=()):
    obs, seen = [], set()
    for o in previous:  # keep observations frozen by earlier runs ("latest"-only sources move on)
        if (o["source"], o["date"]) not in seen:
            seen.add((o["source"], o["date"]))
            obs.append(o)
    for day in [(date.fromisoformat(d) - timedelta(days=1)).isoformat(), d]:
        for fn in (currency_api, frankfurter, er_api, nrb, cbu):
            o = fn(frm, to, day)
            if o and (o["source"], o["date"]) not in seen:
                seen.add((o["source"], o["date"]))
                obs.append(o)
    return obs


def expected(sent, fee, received, lo, hi):
    sent, fee, received = Decimal(str(sent)), Decimal(str(fee)), Decimal(str(received))
    lo, hi = Decimal(str(lo)), Decimal(str(hi))
    eff = received / (sent - fee)
    m_lo, m_hi = 1 - eff / lo, 1 - eff / hi
    conv = sent - fee
    t_lo, t_hi = fee + conv * m_lo, fee + conv * m_hi
    # measured tolerance 0.30 pp (see src/domain/audit.js MEASUREMENT_TOLERANCE)
    tol = Decimal("0.003")
    cls = "better-than-mid" if m_hi < -tol else ("within-band" if m_lo <= tol else "markup")
    return {
        "effective_rate": float(eff),
        "markup_low_pct": float(m_lo * 100), "markup_high_pct": float(m_hi * 100),
        "total_cost_low": float(t_lo), "total_cost_high": float(t_hi),
        "total_pct_low": float(t_lo / sent * 100), "total_pct_high": float(t_hi / sent * 100),
        "classification": cls,
    }


def main(paths):
    out = Path(paths[0]).with_name("receipts.json")
    previous = {}
    if out.exists():
        previous = {v["id"]: [{**o, "source": "ECB (Frankfurter)" if o["source"] == "Frankfurter (ECB)" else o["source"]}
                              for o in v["band"]["observations"]] for v in json.loads(out.read_text())["vectors"]}
    vectors = []
    for path in paths:
        vectors += build(path, previous)
    out.write_text(json.dumps({"generated_by": "vectors/compute_expected.py", "quotes_files": [Path(p).name for p in paths],
                               "vectors": vectors}, indent=1, ensure_ascii=False))
    print(out, len(vectors), "vectors")


def build(path, previous):
    q = json.loads(Path(path).read_text())
    vectors = []
    for c in q["corridors"]:
        for quote in c["quotes"]:
            d = quote["date_collected"][:10]
            vid = f"{c['from']}-{c['to']}-{quote['provider']}"
            obs = band_for(c["from"], c["to"], d, previous.get(vid, ()))
            if not obs:
                continue
            rates = [o["rate"] for o in obs]
            vectors.append({
                "id": vid,
                "origin": f"{q['source']}, collected {quote['date_collected']}",
                "input": {"provider": quote["provider"], "sentAmount": quote["sent"], "sentCurrency": c["from"],
                          "fee": quote["fee"], "receivedAmount": quote["received"], "receivedCurrency": c["to"], "date": d},
                "band": {"min": min(rates), "max": max(rates), "observations": obs},
                "published_markup_pct": quote["published_markup_pct"],
                "expected": expected(quote["sent"], quote["fee"], quote["received"], min(rates), max(rates)),
            })
    return vectors


if __name__ == "__main__":
    main(sys.argv[1:] or ["vectors/quotes-2026-10-06.json", "vectors/quotes-kr-2026-10-06.json"])
