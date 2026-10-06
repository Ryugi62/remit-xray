"""Builds the two static data files the page reads.

data/context.json — World Bank averages (cost of sending/receiving $200, remittances % of GDP)
data/samples.json — one-tap sample receipts, copied from the real published quotes in vectors/
Run: python3 scripts/build_data.py
"""
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEND = {"KRW": "KOR", "USD": "USA", "GBP": "GBR", "JPY": "JPN", "AUD": "AUS", "SGD": "SGP", "CAD": "CAN",
        "SAR": "SAU", "AED": "ARE"}
RECV = {"VND": "VNM", "NPR": "NPL", "UZS": "UZB", "PHP": "PHL", "IDR": "IDN", "KHR": "KHM", "MMK": "MMR",
        "LKR": "LKA", "BDT": "BGD", "THB": "THA", "INR": "IND", "MXN": "MEX", "NGN": "NGA", "PKR": "PAK",
        "KGS": "KGZ", "TJS": "TJK", "MNT": "MNG", "CNY": "CHN"}


def latest(indicator, iso3s):
    url = (f"https://api.worldbank.org/v2/country/{';'.join(iso3s)}/indicator/{indicator}"
           f"?format=json&date=2018:2025&per_page=500")
    req = urllib.request.Request(url, headers={"User-Agent": "remit-xray-data/1.0"})
    rows = json.load(urllib.request.urlopen(req, timeout=30))[1] or []
    out = {}
    for r in rows:
        if r["value"] is None:
            continue
        c = r["countryiso3code"]
        if c not in out or r["date"] > out[c]["year"]:
            out[c] = {"value": round(r["value"], 3), "year": r["date"], "name": r["country"]["value"]}
    return url, out


def main():
    ctx = {"sdg_target_pct": 3.0, "sdg_source": "UN SDG target 10.c — reduce remittance transaction costs to less than 3%",
           "send": {}, "receive": {}, "gdp_share": {}, "sources": {}}
    u1, send = latest("SI.RMT.COST.OB.ZS", list(SEND.values()))
    u2, recv = latest("SI.RMT.COST.IB.ZS", list(RECV.values()))
    u3, gdp = latest("BX.TRF.PWKR.DT.GD.ZS", list(RECV.values()))
    ctx["sources"] = {"send": u1, "receive": u2, "gdp_share": u3}
    for cur, iso in SEND.items():
        if iso in send:
            ctx["send"][cur] = send[iso]
    for cur, iso in RECV.items():
        if iso in recv:
            ctx["receive"][cur] = recv[iso]
        if iso in gdp:
            ctx["gdp_share"][cur] = gdp[iso]
    (ROOT / "data/context.json").write_text(json.dumps(ctx, indent=1, ensure_ascii=False))

    receipts = json.loads((ROOT / "vectors/receipts.json").read_text())["vectors"]
    pick = ["KRW-NPR-GME Remit", "KRW-VND-E9pay", "AUD-VND-Commonwealth Bank of Australia", "USD-PHP-Western Union"]
    by_id = {v["id"]: v for v in receipts}
    samples = []
    for vid in pick:
        v = by_id[vid]
        samples.append({"id": vid, "input": v["input"], "origin": v["origin"]})
    (ROOT / "data/samples.json").write_text(json.dumps(samples, indent=1, ensure_ascii=False))
    print("context:", len(ctx["send"]), "send,", len(ctx["receive"]), "receive · samples:", len(samples))


if __name__ == "__main__":
    main()
