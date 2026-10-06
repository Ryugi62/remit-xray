"""Snapshot real published provider quotes (Wise comparison API) into vectors/quotes-<date>.json.

Each quote is a real price a provider showed for a given send amount:
received = (send - fee) * rate. These are the inputs our engine audits.
Run: python3 vectors/snapshot_quotes.py
"""
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

CORRIDORS = [("USD", "PHP", 500), ("USD", "MXN", 500), ("GBP", "INR", 500),
             ("USD", "VND", 500), ("USD", "NPR", 500), ("AUD", "VND", 1000)]
API = "https://api.wise.com/v4/comparisons/?sourceCurrency={s}&targetCurrency={t}&sendAmount={a}"


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def main():
    now = datetime.now(timezone.utc)
    out = {"source": "Wise comparison API (public)", "collected_utc": now.isoformat(timespec="seconds"), "corridors": []}
    for s, t, a in CORRIDORS:
        url = API.format(s=s, t=t, a=a)
        d = fetch(url)
        quotes = []
        for p in d.get("providers", []):
            for q in p.get("quotes", [])[:1]:
                if q.get("receivedAmount") is None:
                    continue
                quotes.append({
                    "provider": p["name"],
                    "type": p.get("type"),
                    "sent": a,
                    "fee": q["fee"],
                    "rate": q["rate"],
                    "received": q["receivedAmount"],
                    "published_markup_pct": q.get("markup"),
                    "date_collected": q.get("dateCollected"),
                })
        out["corridors"].append({"from": s, "to": t, "url": url, "quotes": quotes})
    path = Path(__file__).with_name(f"quotes-{now.date().isoformat()}.json")
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(path, sum(len(c["quotes"]) for c in out["corridors"]), "quotes")


if __name__ == "__main__":
    main()
