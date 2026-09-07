#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""为 case3 / bio_eval 的 MSU 补写 paragraph_info（来自 paragraphs.json[para_id]）。
构建 case3 时该字段被遗漏，导致源段落不可回溯；语料 A/B 均 100% 填充。"""
import json, shutil, sys
from pathlib import Path
BK = Path(__file__).resolve().parents[1]
PARA = BK/'data/bio_eval/stages/02_msu/paragraphs.json'
TARGETS = [
    BK/'data/bio_eval/stages/02_msu/formdatabase_v2.0.json',
    BK/'data/bio_eval/stages/02_msu/formdatabase.json',
    BK/'data/bio_eval/stages/02_msu/formdatabase_raw.json',
] + sorted((BK/'data/case3').glob('database-*.json'))

P = json.load(open(PARA))
print(f"paragraphs.json: {len(P)} 段\n")
for f in TARGETS:
    if not f.exists(): print(f"  跳过(不存在) {f.name}"); continue
    d = json.load(open(f, encoding='utf-8'))
    bak = f.with_suffix(f.suffix + '.bak')
    if not bak.exists(): shutil.copy2(f, bak)
    filled = skipped = already = 0
    for r in d:
        if r.get('paragraph_info'): already += 1; continue
        pid = r.get('para_id')
        try: pid = int(pid)
        except (TypeError, ValueError): skipped += 1; continue
        if 0 <= pid < len(P):
            r['paragraph_info'] = P[pid]; filled += 1
        else: skipped += 1
    json.dump(d, open(f, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    rel = str(f).replace(str(BK)+'/', '')
    print(f"  {rel:52} {len(d):>5} 条  填充 {filled:>5}  已有 {already:>4}  跳过 {skipped:>3}")
print("\n备份为同名 .bak")
