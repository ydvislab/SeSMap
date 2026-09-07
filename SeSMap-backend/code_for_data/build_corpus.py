#!/usr/bin/env python3
"""
Stages 2-4 (local, orchestrated): MinerU markdown -> sections -> MSU(LLM) -> flat MSU database.
把原来散在 resubtitle.py / llm_rewrite.py(被注释掉的批处理) / generate_dict.py 里的逻辑
串成一条本地流水线。

对 corpus/<name>/<name>.md（mineru_pdf.py 的产物）:
  ② 修正标题层级 + 解析为 sections           -> corpus/<name>/<name>.json
  ③ 每个正文段落 -> extract_msu(LLM)          -> corpus/<name>/<name>_rewrite.json
  ④ 汇总所有论文, 分配 para_id/paper_id/idx    -> outputs/formdatabase.json (+ paragraphs/papers.json)

用法:
  python build_corpus.py                # 全流程（③需要 .env 里的 LLM key）
  python build_corpus.py --no-llm       # 仅解析(②④)，不调 LLM，用来先跑通管线
"""
import sys, os, json, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)
sys.path.insert(0, HERE)
import local_config as cfg
from resubtitle import correct_markdown_header_levels, parse_markdown_to_json


def md_to_sections(md_path: str, abstract_summary: str = ""):
    md = open(md_path, encoding="utf-8").read()
    return parse_markdown_to_json(correct_markdown_header_levels(md), abstract_summary)


def paper_msus(sections, use_llm: bool):
    """展平 sections -> [{paragraph, type, resultmsu?}]"""
    out = []
    for sec in sections:
        for para in sec.get("paragraphs", []):
            t = para.get("type", "text")
            txt = (para.get("origin_text", "") or "").strip()
            if not txt:
                continue
            if t == "figure":
                out.append({"paragraph": txt, "type": "figure"})
            elif use_llm:
                from llm_rewrite import extract_msu  # 惰性导入：--no-llm 不触发 LLM 客户端
                res = extract_msu(txt) or []
                out.append({"paragraph": txt, "type": "text", "resultmsu": res})
            else:
                out.append({"paragraph": txt, "type": "text", "resultmsu": []})
    return out


def build_one(paper_dir: str, use_llm: bool, reuse_existing: bool = False):
    name = os.path.basename(paper_dir.rstrip("/"))
    rewrite_path = os.path.join(paper_dir, f"{name}_rewrite.json")
    if reuse_existing and os.path.isfile(rewrite_path):
        rewrite = json.load(open(rewrite_path, encoding="utf-8"))
        n_msu = sum(len(p.get("resultmsu") or []) for p in rewrite)
        print(f"  {name}: reuse {len(rewrite)} paragraphs, {n_msu} MSUs")
        return name, rewrite
    md = os.path.join(paper_dir, f"{name}.md")
    if not os.path.isfile(md):
        cands = [f for f in os.listdir(paper_dir) if f.endswith(".md")]
        if not cands:
            print(f"  跳过 {name}: 无 .md")
            return None
        md = os.path.join(paper_dir, cands[0])
    sections = md_to_sections(md)
    json.dump(sections, open(os.path.join(paper_dir, f"{name}.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    rewrite = paper_msus(sections, use_llm)
    json.dump(rewrite, open(rewrite_path, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    n_msu = sum(len(p.get("resultmsu", [])) for p in rewrite)
    print(f"  {name}: {len(sections)} sections, {len(rewrite)} paragraphs, {n_msu} MSUs")
    return name, rewrite


def aggregate(papers):
    ALLDATA, PARA_LIST, PAPER_LIST = [], [], []
    para_id = paper_id = idx = 0
    for name, rewrite in papers:
        PAPER_LIST.append(name)
        for p in rewrite:
            PARA_LIST.append(p.get("paragraph", ""))
            if p.get("type") == "figure":
                ALLDATA.append({"type": "figure", "para_id": para_id, "paper_id": paper_id})
            else:
                for m in p.get("resultmsu", []):
                    ALLDATA.append({
                        "idx": idx, "MSU_id": idx,
                        "sentence": m.get("sentence", ""),
                        "category": m.get("category", "missing"),
                        "rank": m.get("rank", -1),
                        "type": "text", "para_id": para_id, "paper_id": paper_id,
                        # Keep the original paragraph on every MSU.  The
                        # Stepwise detail view resolves a MSU from this
                        # database, so para_id alone is not enough once the
                        # data is exported into the semantic-map package.
                        "paragraph_info": p.get("paragraph", ""),
                    })
                    idx += 1
            para_id += 1
        paper_id += 1
    cfg.FORMDB.parent.mkdir(parents=True, exist_ok=True)
    json.dump(ALLDATA, open(cfg.FORMDB, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(PARA_LIST, open(cfg.FORMDB.parent / "paragraphs.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(PAPER_LIST, open(cfg.FORMDB.parent / "papers.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"[aggregate] {idx} MSUs / {paper_id} papers -> {cfg.FORMDB}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default=str(cfg.CORPUS_DIR))
    ap.add_argument("--no-llm", action="store_true", help="跳过 MSU 抽取(仅解析, 无需 API key)")
    ap.add_argument("--reuse-existing", action="store_true",
                    help="复用已有 <paper>_rewrite.json；仅为新增论文调用 LLM")
    args = ap.parse_args()

    corpus = args.corpus
    dirs = ([os.path.join(corpus, d) for d in sorted(os.listdir(corpus))
             if os.path.isdir(os.path.join(corpus, d))] if os.path.isdir(corpus) else [])
    if not dirs:
        print(f"没有论文目录: {corpus}（需要 corpus/<name>/<name>.md，先跑 mineru_pdf.py）")
        return
    print(f"[build_corpus] {len(dirs)} papers, use_llm={not args.no_llm}")
    papers = []
    for d in dirs:
        r = build_one(d, not args.no_llm, args.reuse_existing)
        if r:
            papers.append(r)
    aggregate(papers)


if __name__ == "__main__":
    main()
