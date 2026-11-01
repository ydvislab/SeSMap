#!/usr/bin/env python3
"""Conservative quality filtering for parsed Minimum Semantic Units (MSUs).

This is deliberately a *Markdown/parse-quality* filter, not a semantic
importance filter: valid scientific claims are retained regardless of category
or rank.  It only removes unmistakable publication metadata, isolated figure
labels, and exact duplicate statements repeated within the same paper.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path


SPACE = re.compile(r"\s+")
WORD = re.compile(r"\W+", re.UNICODE)
FIGURE_ONLY = re.compile(r"^(?:fig(?:ure)?\.?\s*\d+[a-z]?[.:]?|table\s*\d+[a-z]?[.:]?)$", re.I)
METADATA_PREFIX = re.compile(
    r"^(?:doi\s*:|editor\s*:|published\s*:|received\b|revised\b|accepted\b|"
    r"accessed\s*:|copyright\b|isbn\s*:|keywords?\s*:|conflicts?\s+of\s+interest\s*:|"
    r"funding\s+statement\s*:)",
    re.I,
)
METADATA_EXACT = {
    "review", "repository", "none declared", "no external funding",
}


def clean_text(value: object) -> str:
    return SPACE.sub(" ", str(value or "")).strip()


def normalized_key(text: str) -> str:
    return WORD.sub("", text.lower())


def reject_reason(text: str) -> str | None:
    if not text:
        return "empty"
    if FIGURE_ONLY.fullmatch(text):
        return "isolated_figure_label"
    if METADATA_PREFIX.match(text) or text.lower().rstrip(".") in METADATA_EXACT:
        return "publication_metadata"
    if NON_SCIENTIFIC.search(text) or GIBBERISH.match(text):
        return "non_scientific_statement"
    # A bare access-date/bibliography fragment is a parsing artifact, not an MSU.
    if re.fullmatch(r"(?:p\.?\s*\d+[,.;]?\s*)?(?:\d{4}|\d{4}-\d{1,2}-\d{1,2})[.]?", text, re.I):
        return "bibliography_fragment"
    return None


# A reference entry yields well-formed MSUs ("The study was published in ..."), so it
# can only be recognized from the source paragraph, not from the MSU sentence.
REF_PARAGRAPH = [
    re.compile(r"^\s*(<sup>\d+</sup>|\[[^\]]{1,12}\]\.?|\d{1,3}\.)\s*[A-Z]"),
    re.compile(r"[A-Z][a-z'-]+,\s+[A-Z]\.(\s*[A-Z]\.)*[,:;]"),
    re.compile(r"\b[A-Z]\.\s*(?:[A-Z]\.\s*)?[A-Z][a-z'-]+,\s+[A-Z]\."),
    re.compile(r"\b(vol\.|pp\.|doi:|proceedings of|journal of|ieee trans|arxiv:)", re.I),
]
REF_YEAR = re.compile(r"\((19|20)\d{2}[a-z]?\)|\b(19|20)\d{2}\.\s*$|,\s*(19|20)\d{2}[.;]?\s*$")


# Statements about the publication rather than its science.  Kept narrow on purpose:
# words such as "located in" or "supported by" also occur in valid findings.
NON_SCIENTIFIC = re.compile(
    r"^(?:keywords?|index terms)\b.*\b(?:include|are)\b"
    r"|^cite as\b|^available online\b|^https?://|\bdoi\b.*\bhttps?://"
    r"|\b(?:paper|article|manuscript)\s+(?:is|was)\s+(?:published|accepted|received|submitted)\b"
    r"|\bpublished (?:under|by)\b|\bpublished in\b.*\b(?:volume|vol\.)"
    r"|\b(?:project|work|research|study)\s+(?:was|is)\s+(?:partly\s+|partially\s+|financially\s+)?(?:supported|funded)\s+by\b"
    r"|\bgrant (?:no|number)\b"
    r"|\b(?:university|institute|laboratory|college|academy|ucas)\b.*\bis located (?:in|at)\b"
    r"|\b(?:university|institute|institutefor)\b.*,\s*\d{5,6},\s*[A-Z]"
    r"|^the data that support the findings\b"
    r"|^the (?:source )?(?:code|demonstration video|video) is available\b",
    re.I,
)
GIBBERISH = re.compile(r"^[a-z0-9.]{6,}\s*\(")


def is_reference_paragraph(text: str) -> bool:
    hits = sum(bool(p.search(text)) for p in REF_PARAGRAPH)
    return hits >= 2 or (hits == 1 and len(text) < 500 and bool(REF_YEAR.search(text)))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--report", type=Path, required=True)
    args = ap.parse_args()

    records = json.loads(args.input.read_text(encoding="utf-8"))
    out, removed, seen = [], [], set()
    counts = Counter()

    for rec in records:
        if rec.get("type") != "text":
            out.append(rec)
            continue
        text = clean_text(rec.get("sentence"))
        reason = reject_reason(text)
        if not reason and is_reference_paragraph(clean_text(rec.get("paragraph_info"))):
            reason = "reference_entry"
        if reason:
            counts[reason] += 1
            removed.append({"MSU_id": rec.get("MSU_id", rec.get("idx")), "reason": reason, "sentence": text})
            continue
        # Deduplicate only inside the originating paper.  Identical statements
        # in different papers are meaningful cross-paper correspondences.
        key = (rec.get("paper_id"), normalized_key(text))
        if key in seen:
            counts["same_paper_duplicate"] += 1
            removed.append({"MSU_id": rec.get("MSU_id", rec.get("idx")), "reason": "same_paper_duplicate", "sentence": text})
            continue
        seen.add(key)
        next_rec = dict(rec)
        next_rec["sentence"] = text
        out.append(next_rec)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    report = {
        "input_records": len(records),
        "input_text_msus": sum(r.get("type") == "text" for r in records),
        "kept_records": len(out),
        "kept_text_msus": sum(r.get("type") == "text" for r in out),
        "removed_count": len(removed),
        "removed_by_reason": dict(sorted(counts.items())),
        "removed": removed,
        "policy": "Only Markdown/parse artifacts and exact duplicates within the same paper are removed; no category or importance filtering is applied.",
    }
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("input_text_msus", "kept_text_msus", "removed_count", "removed_by_reason")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
