#!/usr/bin/env python3
"""
把质量过滤规则应用到已发布的语义图：去掉参考文献条目和非科学语句。

坐标不重算；空出来的 HSU 记录被移除，其余 MSU 的位置不变。

用法:
  python3 code_for_data/clean_case_map.py --case case1 case3
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND / "code_for_data"))
from filter_msu_quality import clean_text, is_reference_paragraph, reject_reason


def removal_reason(msu: dict) -> str | None:
    text = clean_text(msu.get("sentence"))
    if is_reference_paragraph(clean_text(msu.get("paragraph_info"))):
        return "reference_entry"
    return reject_reason(text)


def clean_map(data: dict) -> Counter:
    index = data["msu_index"]
    reasons: Counter = Counter()
    removed = set()
    for key, msu in index.items():
        reason = removal_reason(msu)
        if reason:
            reasons[reason] += 1
            removed.add(int(key))
    for msu_id in removed:
        index.pop(str(msu_id))

    panel_country: dict = {}
    msu_to_hex: dict = {}
    category_cells: dict = {}
    for panel, space in enumerate(data["subspaces"]):
        kept = []
        for hex_item in space["hexList"]:
            ids = hex_item.get("msu_ids") or []
            left = [i for i in ids if int(i) not in removed]
            if not left:
                continue
            if len(left) != len(ids):
                hex_item["msu_ids"] = left
                hex_item["summary"] = " ".join(index[str(i)]["sentence"] for i in left[:3])
            kept.append(hex_item)
            country = hex_item.get("country_id")
            panel_country.setdefault(str(panel), {}).setdefault(country, []).append([hex_item["q"], hex_item["r"]])
            for i in left:
                msu_to_hex[str(i)] = {"panelIdx": panel, "q": hex_item["q"], "r": hex_item["r"], "country_id": country}
                category_cells.setdefault(index[str(i)].get("category"), []).append(
                    {"panelIdx": panel, "q": hex_item["q"], "r": hex_item["r"]})
        space["hexList"] = kept
        for country in space.get("countries", []):
            cells = panel_country.get(str(panel), {}).get(country.get("country_id"), [])
            country["hexes"] = [{"q": q, "r": r} for q, r in cells]
        space["countries"] = [c for c in space.get("countries", []) if c["hexes"]]

    data["indices"].update(msu_to_hex=msu_to_hex, panel_country_to_hex=panel_country, category_to_cells=category_cells)
    stats = data.get("stats", {})
    for panel, space in enumerate(data["subspaces"]):
        if panel < len(stats.get("subspaces", [])):
            stats["subspaces"][panel].update(cells=len(space["hexList"]), countries=len(space["countries"]))
    if "totals" in stats:
        stats["totals"].update(msu_count=len(index), cells=sum(len(s["hexList"]) for s in data["subspaces"]),
                               countries=sum(len(s["countries"]) for s in data["subspaces"]))
    if "msu_refs_total" in stats:
        stats["msu_refs_total"] = len(index)
    return reasons


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", nargs="+", required=True)
    args = ap.parse_args()
    for case in args.case:
        path = BACKEND / "data" / case / "semantic_map_data.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        before = len(data["msu_index"])
        reasons = clean_map(data)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print(f"[done] {case}: {before} -> {len(data['msu_index'])} MSUs {dict(reasons)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
