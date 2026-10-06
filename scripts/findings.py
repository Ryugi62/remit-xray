"""Prints the headline numbers quoted in README.md from vectors/receipts.json (no network).

Run: python3 scripts/findings.py
"""
import json
import statistics as st
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    v = json.loads((ROOT / "vectors/receipts.json").read_text())["vectors"]
    corridors = {x["input"]["sentCurrency"] + "-" + x["input"]["receivedCurrency"] for x in v}
    providers = {x["input"]["provider"] for x in v}
    mid = lambda e: (e["total_pct_low"] + e["total_pct_high"]) / 2
    zero = [x for x in v if x["input"]["fee"] == 0]
    zero_markup = [x for x in zero if x["expected"]["classification"] == "markup"]
    markup = [x for x in v if x["expected"]["classification"] == "markup"]
    hidden_share = []
    for x in markup:
        e = x["expected"]
        total = (e["total_cost_low"] + e["total_cost_high"]) / 2
        hidden_share.append((total - x["input"]["fee"]) / total)
    print(f"- {len(v)} real published quotes · {len(providers)} providers · {len(corridors)} corridors")
    print(f"- {len(zero_markup)} of {len(zero)} \"zero-fee\" quotes still cost money through the rate: "
          f"median {st.median(mid(x['expected']) for x in zero_markup):.2f}%, "
          f"up to {max(x['expected']['total_pct_high'] for x in zero_markup):.2f}%")
    print(f"- in {sum(h > 0.5 for h in hidden_share)} of {len(markup)} quotes with a margin, "
          f"more than half of the total cost was not on the fee line (median {st.median(hidden_share) * 100:.0f}%)")


if __name__ == "__main__":
    main()
