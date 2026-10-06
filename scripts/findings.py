"""Prints the headline numbers quoted in README.md from vectors/receipts.json (no network).

Run: python3 scripts/findings.py
"""
import json
import statistics as st
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOL = 0.30  # percentage points, src/domain/audit.js MEASUREMENT_TOLERANCE


def mid(e):
    return (e["total_pct_low"] + e["total_pct_high"]) / 2


def main():
    v = json.loads((ROOT / "vectors/receipts.json").read_text())["vectors"]
    corridors = {x["input"]["sentCurrency"] + "-" + x["input"]["receivedCurrency"] for x in v}
    providers = {x["input"]["provider"] for x in v}
    days = Counter(x["input"]["date"] for x in v)
    wise_cmp = [x for x in v if x["origin"].startswith("Wise comparison")]
    print(f"- {len(v)} real quotes · {len(providers)} provider names · {len(corridors)} corridors · "
          + ", ".join(f"{n} priced on {d}" for d, n in sorted(days.items())))
    print(f"  ({len(wise_cmp)} collected by Wise's public comparison API — Wise is itself a provider; "
          f"{len(v) - len(wise_cmp)} read from the Hanpass, GME Remit and E9pay public calculators. "
          "NatWest and RBS belong to one banking group and quote the same price.)")
    zero = [x for x in v if x["input"]["fee"] == 0]
    zero_markup = [x for x in zero if x["expected"]["classification"] == "markup"]
    print(f"- {len(zero_markup)} of {len(zero)} \"zero-fee\" quotes still cost money through the rate: "
          f"median {st.median(mid(x['expected']) for x in zero_markup):.2f}%, "
          f"up to {max(x['expected']['total_pct_high'] for x in zero_markup):.2f}%")
    for x in sorted(zero_markup, key=lambda x: -mid(x["expected"]))[:3]:
        e = x["expected"]
        print(f"    {x['id']}: {e['total_pct_low']:.2f}–{e['total_pct_high']:.2f}%")
    paid = [x for x in v if x["input"]["fee"] > 0 and x["expected"]["classification"] == "markup"]
    share = []
    for x in paid:
        e = x["expected"]
        total = (e["total_cost_low"] + e["total_cost_high"]) / 2
        share.append((total - x["input"]["fee"]) / total)
    print(f"- quotes that DO show a fee and also take a margin: in {sum(h > 0.5 for h in share)} of {len(paid)}, "
          f"the margin was the bigger part of the cost (median {st.median(share) * 100:.0f}% of the total)")
    pub = [x for x in v if isinstance(x.get("published_markup_pct"), (int, float))]
    inside = [x for x in pub if x["expected"]["markup_low_pct"] <= x["published_markup_pct"] <= x["expected"]["markup_high_pct"]]
    miss = [max(x["expected"]["markup_low_pct"] - x["published_markup_pct"], x["published_markup_pct"] - x["expected"]["markup_high_pct"], 0) for x in pub]
    print(f"- calibration vs Wise's own published markups ({len(pub)} quotes): {len(inside)} inside our range, "
          f"{sum(m <= TOL for m in miss)} within ±{TOL:.2f} pp (largest miss {max(miss):.2f} pp)")


if __name__ == "__main__":
    main()
