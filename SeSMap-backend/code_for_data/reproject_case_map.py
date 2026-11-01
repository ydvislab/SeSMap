#!/usr/bin/env python3
"""
用指定投影器重新生成案例语义图的坐标和 HSU，MSU 内容和角色不变。

用法:
  python3 code_for_data/reproject_case_map.py --case case1 \
    --stages data/case1/stages --ckpt data/merged13/stages/05_model/m13_final.pt
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "code_for_data"))
from code_for_model.models import ResidualProjectionMapper
from generate_hex import pixel_to_axial

HEX_SIZE = 0.15


def project(ckpt: Path, X: np.ndarray) -> np.ndarray:
    c = torch.load(ckpt, map_location="cpu", weights_only=False)
    m = ResidualProjectionMapper(embed_dim=c["embed_dim"], width=c["width"],
                                 num_blocks=c["num_blocks"], dropout=c["dropout"])
    m.load_state_dict(c["mapper_state"])
    m.eval()
    with torch.no_grad():
        return m(torch.tensor(X, dtype=torch.float32)).numpy().astype(np.float64)


def rebuild(data: dict, coords: dict[int, list[float]]) -> None:
    index = data["msu_index"]
    panel_of = {int(k): v["panelIdx"] for k, v in data["indices"]["msu_to_hex"].items()}
    cells: dict[tuple[int, int, int, int], list[int]] = defaultdict(list)
    for key, msu in index.items():
        msu_id = int(key)
        msu["2d_coord"] = coords[msu_id]
        q, r = pixel_to_axial(coords[msu_id][0], coords[msu_id][1], HEX_SIZE)
        cells[(panel_of[msu_id], q, r, int(msu["paper_id"]))].append(msu_id)

    msu_to_hex, panel_country, category_cells = {}, {}, {}
    for space in data["subspaces"]:
        space["hexList"], space["countries"] = [], []
    grouped: dict[tuple[int, str], list[dict]] = defaultdict(list)
    for (panel, q, r, paper), ids in sorted(cells.items()):
        country = f"c{paper}"
        ids = sorted(ids)
        data["subspaces"][panel]["hexList"].append({
            "q": q, "r": r, "modality": "text", "country_id": country,
            "summary": " ".join(index[str(i)]["sentence"] for i in ids[:3]), "msu_ids": ids,
        })
        grouped[(panel, country)].append({"q": q, "r": r})
        panel_country.setdefault(str(panel), {}).setdefault(country, []).append([q, r])
        for i in ids:
            msu_to_hex[str(i)] = {"panelIdx": panel, "q": q, "r": r, "country_id": country}
            category_cells.setdefault(index[str(i)].get("category"), []).append({"panelIdx": panel, "q": q, "r": r})
    for (panel, country), hexes in grouped.items():
        data["subspaces"][panel]["countries"].append({"country_id": country, "hexes": hexes})

    data["indices"].update(msu_to_hex=msu_to_hex, panel_country_to_hex=panel_country, category_to_cells=category_cells)
    stats = data.get("stats", {})
    for panel, space in enumerate(data["subspaces"]):
        if panel < len(stats.get("subspaces", [])):
            stats["subspaces"][panel].update(cells=len(space["hexList"]), countries=len(space["countries"]))
    if "totals" in stats:
        stats["totals"].update(cells=sum(len(s["hexList"]) for s in data["subspaces"]),
                               countries=sum(len(s["countries"]) for s in data["subspaces"]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", required=True)
    ap.add_argument("--stages", type=Path, required=True)
    ap.add_argument("--ckpt", type=Path, required=True)
    args = ap.parse_args()

    path = BACKEND / "data" / args.case / "semantic_map_data.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    X = np.load(BACKEND / args.stages / "04_embeddings/emb_corpus.npy").astype(np.float32)
    # Map MSU ids differ from stage ids in some cases, so rows are matched by sentence.
    form = json.loads((BACKEND / args.stages / "02_msu/formdatabase_v2.0.json").read_text(encoding="utf-8"))
    records = [r for r in form if r.get("sentence") and r.get("2d_coord") not in (None, "")]
    assert len(records) == len(X), "embedding rows follow the records that carry coordinates"
    row_of_text = {}
    for row, rec in enumerate(records):
        row_of_text.setdefault(rec["sentence"].strip(), row)
    wanted = sorted(int(k) for k in data["msu_index"])
    Z = project(BACKEND / args.ckpt, X[[row_of_text[data["msu_index"][str(m)]["sentence"].strip()] for m in wanted]])
    # Same normalization as the case builds: zero mean, scaled to the map's hex grid.
    Z = (Z - Z.mean(0)) / Z.std(0) * 1.8
    rebuild(data, {m: z.tolist() for m, z in zip(wanted, Z)})
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"[done] {args.case}: {len(wanted)} MSUs, {data['stats']['totals']['cells']} HSU records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
