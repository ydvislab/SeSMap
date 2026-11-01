#!/usr/bin/env python3
"""
把新论文加入已有 case：PDF -> Markdown -> MSU -> 嵌入 -> 固定投影器前向映射 -> 写回语义图。

投影器不重训，已有 MSU 的坐标和 HSU 都不变，新 MSU 只是追加到同一参照里。

用法:
  python3 code_for_data/ingest_paper.py --case case1 --pdf data/case1/pdf/new.pdf
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
from PIL import Image

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "code_for_data"))
import local_config as cfg
from build_corpus import build_one
from code_for_model.models import ResidualProjectionMapper
from extract_thumbnails import caption_text, find_content_list, find_fallback_image, pick_main_figure
from generate_hex import pixel_to_axial

HEX_SIZE = 0.15
# 案例 1、2 共用基础投影器，案例 3 用单独训练的基因组投影器
CASE_STAGES = {
    "case1": ("data/case1/stages", "data/merged13/stages/05_model/m13_final.pt"),
    "case2": ("data/case2/stages", "data/merged13/stages/05_model/m13_final.pt"),
    "case3": ("data/bio_eval/stages", "data/bio_eval/stages/05_model/genomics_final.pt"),
}
ROLE_ALIASES = {"experiment_setup": "experiment", "conclusion/implication": "conclusion"}


def stage(name: str) -> None:
    print(f"[stage] {name}", flush=True)


def load_mapper(path: Path) -> ResidualProjectionMapper:
    ck = torch.load(path, map_location="cpu", weights_only=False)
    m = ResidualProjectionMapper(embed_dim=ck["embed_dim"], width=ck["width"],
                                 num_blocks=ck["num_blocks"], dropout=ck["dropout"])
    m.load_state_dict(ck["mapper_state"])
    return m.eval()


def project(mapper: ResidualProjectionMapper, X: np.ndarray) -> np.ndarray:
    with torch.no_grad():
        return mapper(torch.tensor(X, dtype=torch.float32)).numpy().astype(np.float64)


def fit_map_transform(raw: np.ndarray, coords: np.ndarray) -> np.ndarray:
    """地图坐标是投影输出归一化后的结果；从已有 MSU 反推这个变换，新点沿用它。"""
    A = np.c_[raw, np.ones(len(raw))]
    B, *_ = np.linalg.lstsq(A, coords, rcond=None)
    return B


def run_mineru(pdf: Path, corpus: Path) -> Path:
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copy(pdf, Path(tmp) / pdf.name)
        subprocess.run([sys.executable, str(BACKEND / "code_for_data/mineru_pdf.py"),
                        "--pdf-dir", tmp, "--corpus", str(corpus), "--skip-existing"], check=True)
    return corpus / pdf.stem


def extract_records(paper_dir: Path) -> list[dict]:
    built = build_one(str(paper_dir), True, reuse_existing=True)
    if not built:
        raise RuntimeError(f"No Markdown produced for {paper_dir.name}")
    records = []
    for para_offset, para in enumerate(built[1]):
        for m in para.get("resultmsu") or []:
            records.append({"sentence": m.get("sentence", ""), "category": m.get("category", "Other"),
                            "rank": m.get("rank", -1), "type": "text", "para_offset": para_offset,
                            "paragraph_info": para.get("paragraph", "")})
    return filter_quality(records)


def filter_quality(records: list[dict]) -> list[dict]:
    with tempfile.TemporaryDirectory() as tmp:
        src, out, rep = Path(tmp) / "in.json", Path(tmp) / "out.json", Path(tmp) / "report.json"
        src.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
        subprocess.run([sys.executable, str(BACKEND / "code_for_data/filter_msu_quality.py"),
                        "--input", str(src), "--out", str(out), "--report", str(rep)], check=True)
        return json.loads(out.read_text(encoding="utf-8"))


def encode(sentences: list[str], normalize: bool) -> np.ndarray:
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(str(cfg.BGE_MODEL_PATH), device="cpu")
    return model.encode(sentences, batch_size=32, convert_to_numpy=True,
                        normalize_embeddings=normalize).astype(np.float32)


def panel_for(category: str, names: list[str]) -> int | None:
    text = ROLE_ALIASES.get(str(category).strip().lower(), str(category).strip().lower())
    for i, name in enumerate(names):
        if text.startswith(name.lower()):
            return i
    return names.index("other") if "other" in names else None


def make_thumbnail(paper_dir: Path, thumbs: Path, country: str) -> tuple[str | None, str | None]:
    cl_path = find_content_list(paper_dir)
    fig = pick_main_figure(json.loads(cl_path.read_text(encoding="utf-8"))) if cl_path else None
    src = cl_path.parent / fig["img_path"] if fig else find_fallback_image(paper_dir)
    if not src or not Path(src).exists():
        return None, None
    thumbs.mkdir(parents=True, exist_ok=True)
    out = thumbs / f"{country}.png"
    im = Image.open(src).convert("RGB")
    im.thumbnail((480, 480))
    im.save(out)
    return out.name, caption_text(fig)[:200] if fig else None


def add_to_map(data: dict, records: list[dict], coords: np.ndarray, paper_id: int) -> dict:
    index = data["msu_index"]
    names = [s.get("subspaceName", "") for s in data["subspaces"]]
    next_id = max(int(k) for k in index) + 1
    next_para = max(int(m.get("para_id", 0)) for m in index.values()) + 1
    country = f"c{paper_id}"
    indices = data.setdefault("indices", {})
    cells: dict[tuple[int, int, int], list[int]] = defaultdict(list)
    skipped = 0

    for rec, xy in zip(records, coords):
        panel = panel_for(rec["category"], names)
        if panel is None:
            skipped += 1
            continue
        q, r = pixel_to_axial(float(xy[0]), float(xy[1]), HEX_SIZE)
        msu_id = next_id
        next_id += 1
        index[str(msu_id)] = {
            "idx": msu_id, "MSU_id": msu_id, "sentence": rec["sentence"], "category": rec["category"],
            "rank": rec["rank"], "type": "text", "para_id": next_para + rec["para_offset"],
            "paper_id": paper_id, "2d_coord": [float(xy[0]), float(xy[1])],
            "paragraph_info": rec["paragraph_info"],
        }
        cells[(panel, q, r)].append(msu_id)
        indices.setdefault("msu_to_hex", {})[str(msu_id)] = {
            "panelIdx": panel, "q": q, "r": r, "country_id": country}
        indices.setdefault("category_to_cells", {}).setdefault(rec["category"], []).append(
            {"panelIdx": panel, "q": q, "r": r})

    for (panel, q, r), ids in sorted(cells.items()):
        space = data["subspaces"][panel]
        space["hexList"].append({
            "q": q, "r": r, "modality": "text", "country_id": country,
            "summary": " ".join(index[str(i)]["sentence"] for i in ids[:3]), "msu_ids": ids,
        })
        entry = next((c for c in space["countries"] if c.get("country_id") == country), None)
        if entry is None:
            entry = {"country_id": country, "hexes": []}
            space["countries"].append(entry)
        entry["hexes"].append({"q": q, "r": r})
        indices.setdefault("panel_country_to_hex", {}).setdefault(str(panel), {}).setdefault(country, []).append([q, r])

    stats = data.get("stats", {})
    added = sum(len(v) for v in cells.values())
    if "totals" in stats:
        stats["totals"]["msu_count"] = stats["totals"].get("msu_count", 0) + added
        stats["totals"]["cells"] = stats["totals"].get("cells", 0) + len(cells)
        stats["totals"]["countries"] = stats["totals"].get("countries", 0) + len({p for p, _, _ in cells})
    if "msu_refs_total" in stats:
        stats["msu_refs_total"] += added
    return {"added": added, "cells": len(cells), "skipped": skipped}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", required=True, choices=sorted(CASE_STAGES))
    ap.add_argument("--pdf", type=Path, required=True, nargs="+")
    args = ap.parse_args()

    stages, ckpt = (BACKEND / p for p in CASE_STAGES[args.case])
    case_dir = BACKEND / "data" / args.case
    if not cfg.BGE_MODEL_PATH.exists():
        raise SystemExit("BGE encoder missing: run python3 scripts/install_models.py")
    if not ckpt.exists():
        raise SystemExit(f"Projector missing: {ckpt}")

    map_path = case_dir / "semantic_map_data.json"
    gallery_path = case_dir / "gallery.json"
    data = json.loads(map_path.read_text(encoding="utf-8"))
    gallery = json.loads(gallery_path.read_text(encoding="utf-8")) if gallery_path.exists() else []
    known = {g.get("title") for g in gallery}

    emb = np.load(stages / "04_embeddings/emb_corpus.npy").astype(np.float32)
    ids = json.loads((stages / "04_embeddings/emb_corpus.npy.ids.json").read_text())
    mapper = load_mapper(ckpt)
    rows = [(i, data["msu_index"].get(str(m))) for i, m in enumerate(ids)]
    rows = [(i, m) for i, m in rows if m and m.get("2d_coord")]
    transform = fit_map_transform(project(mapper, emb[[i for i, _ in rows]]),
                                  np.array([m["2d_coord"] for _, m in rows], dtype=float))
    normalize = abs(float(np.linalg.norm(emb[0])) - 1.0) < 1e-3

    results = []
    for pdf in args.pdf:
        title = pdf.stem.replace("_", " ").strip()
        if title in known:
            print(f"[skip] already in {args.case}: {title}", flush=True)
            continue
        stage(f"Converting {pdf.name} to Markdown")
        paper_dir = run_mineru(pdf, stages / "01_corpus")
        stage(f"Constructing MSUs for {pdf.name}")
        records = [r for r in extract_records(paper_dir) if str(r.get("sentence", "")).strip()]
        if not records:
            raise RuntimeError(f"No MSUs extracted from {pdf.name}")
        stage(f"Mapping {len(records)} MSUs onto the map")
        X = encode([r["sentence"] for r in records], normalize)
        raw = project(mapper, X)
        coords = np.c_[raw, np.ones(len(raw))] @ transform

        paper_id = max([int(g.get("paper_id", -1)) for g in gallery]
                       + [int(m.get("paper_id", 0)) for m in data["msu_index"].values()]) + 1
        country = f"c{paper_id}"
        info = add_to_map(data, records, coords, paper_id)
        thumb, caption = make_thumbnail(paper_dir, case_dir / "thumbnails", country)
        gallery.append({"paper_id": paper_id, "title": title, "semanticCountryId": country,
                        "sourceId": country, "thumbnail": thumb, "caption": caption})
        results.append({"title": title, "paper_id": paper_id, **info})

    if results:
        stage("Updating the semantic map")
        tmp = map_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, map_path)
        gallery_path.write_text(json.dumps(gallery, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[result] " + json.dumps(results, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print(f"[failed] {e}", flush=True)
        raise
