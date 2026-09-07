#!/usr/bin/env python3
"""Restore MSU source paragraphs from a case's preserved paragraph index.

The stage-02 corpus keeps `paragraphs.json` indexed by `para_id`.  Earlier
exports omitted that value from database-*.json, which in turn made the
semantic-map msu_index lose the source context required by Stepwise details.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_json(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case-dir", type=Path, required=True)
    parser.add_argument(
        "--paragraphs",
        type=Path,
        help="Defaults to <case-dir>/stages/02_msu/paragraphs.json",
    )
    args = parser.parse_args()

    case_dir = args.case_dir.resolve()
    paragraphs_path = args.paragraphs or case_dir / "stages" / "02_msu" / "paragraphs.json"
    paragraphs = load_json(paragraphs_path)
    if not isinstance(paragraphs, list):
        raise ValueError(f"Expected a JSON list: {paragraphs_path}")

    changed = filled = missing = 0
    for database_path in sorted(case_dir.glob("database-*.json")):
        records = load_json(database_path)
        if not isinstance(records, list):
            raise ValueError(f"Expected a JSON list: {database_path}")
        file_changed = 0
        for record in records:
            para_id = record.get("para_id")
            try:
                paragraph = paragraphs[int(para_id)]
            except (IndexError, TypeError, ValueError):
                missing += 1
                continue
            if not isinstance(paragraph, str) or not paragraph.strip():
                missing += 1
                continue
            if record.get("paragraph_info") != paragraph:
                record["paragraph_info"] = paragraph
                changed += 1
                file_changed += 1
            filled += 1
        if file_changed:
            write_json(database_path, records)
        print(f"{database_path.name}: {file_changed} records updated")

    print(f"Completed: {changed} updated, {filled} mapped, {missing} without source paragraph")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
