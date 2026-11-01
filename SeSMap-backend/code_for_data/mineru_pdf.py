#!/usr/bin/env python3
"""
Stage 1 (local): PDF -> Markdown via MinerU.

对 PDF_DIR 里的每个 PDF 跑 MinerU，把产出的 markdown 规范化到
corpus/<name>/<name>.md，供 build_corpus.py 直接消费。

安装（任选其一）:
  pip install "mineru[core]<4"         # MinerU 4 的命令行不兼容，命令: mineru
  pip install -U magic-pdf             # 旧版，命令: magic-pdf
或设环境变量 MINERU_CMD 为你的命令模板（用 {pdf} {out} 占位），例如:
  export MINERU_CMD='mineru -p {pdf} -o {out}'
"""
import sys, os, shutil, glob, subprocess, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)
import local_config as cfg


def run_mineru(pdf: str, out_dir: str):
    tmpl = os.getenv("MINERU_CMD")
    venv_mineru = os.path.join(BACKEND, ".venv-mineru", "bin", "mineru")  # 隔离 venv 里的 mineru
    backend = os.getenv("MINERU_BACKEND", "pipeline")  # pipeline: CPU 友好；无 GPU 的 Mac 别用默认的 hybrid/vlm
    if tmpl:
        cmd, shell = tmpl.format(pdf=pdf, out=out_dir), True
    elif os.path.isfile(venv_mineru):
        cmd, shell = [venv_mineru, "-p", pdf, "-o", out_dir, "-b", backend, "-m", "auto"], False
    elif shutil.which("mineru"):
        cmd, shell = ["mineru", "-p", pdf, "-o", out_dir, "-b", backend, "-m", "auto"], False
    elif shutil.which("magic-pdf"):
        cmd, shell = ["magic-pdf", "-p", pdf, "-o", out_dir, "-m", "auto"], False
    else:
        raise RuntimeError(
            "未找到 mineru / magic-pdf。请 `pip install \"mineru[core]<4\"`，"
            "或设置环境变量 MINERU_CMD 指定你的命令模板。")
    print("  $", cmd if shell else " ".join(cmd))
    subprocess.run(cmd, shell=shell, check=True)


def normalize(name: str, out_dir: str, paper_dir: str):
    """把 MinerU 产出的 markdown 复制成 corpus/<name>/<name>.md（取体积最大的 .md），
    并把 images/ 一并搬过去，供后续 figure MSU 使用。"""
    mds = glob.glob(os.path.join(out_dir, "**", "*.md"), recursive=True)
    if not mds:
        raise FileNotFoundError(f"{out_dir} 未找到 MinerU 输出的 .md")
    src = max(mds, key=os.path.getsize)
    os.makedirs(paper_dir, exist_ok=True)
    shutil.copy(src, os.path.join(paper_dir, f"{name}.md"))
    for img_dir in glob.glob(os.path.join(out_dir, "**", "images"), recursive=True):
        dst = os.path.join(paper_dir, "images")
        if not os.path.exists(dst):
            shutil.copytree(img_dir, dst)
    print(f"  -> {os.path.join(paper_dir, name + '.md')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", default=str(cfg.PDF_DIR))
    ap.add_argument("--corpus", default=str(cfg.CORPUS_DIR))
    ap.add_argument("--skip-existing", action="store_true",
                    help="保留已有 corpus/<paper>/<paper>.md；仅转换新增 PDF")
    args = ap.parse_args()

    cfg.ensure_dirs()
    pdfs = sorted(glob.glob(os.path.join(args.pdf_dir, "**", "*.pdf"), recursive=True))
    if not pdfs:
        print(f"没有 PDF: {args.pdf_dir}（把待复现的论文 PDF 放这里）")
        return
    print(f"[mineru] {len(pdfs)} PDFs -> {args.corpus}")
    for pdf in pdfs:
        name = os.path.splitext(os.path.basename(pdf))[0]
        paper_dir = os.path.join(args.corpus, name)
        normalized_md = os.path.join(paper_dir, f"{name}.md")
        if args.skip_existing and os.path.isfile(normalized_md):
            print(f"- {name} (skip: existing markdown)")
            continue
        out_dir = os.path.join(paper_dir, "_mineru")
        os.makedirs(out_dir, exist_ok=True)
        print(f"- {name}")
        try:
            run_mineru(pdf, out_dir)
            normalize(name, out_dir, paper_dir)
        except Exception as e:
            print(f"  !! {name} 失败: {e}")


if __name__ == "__main__":
    main()
