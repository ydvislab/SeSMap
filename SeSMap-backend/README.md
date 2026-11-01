# SeSMap Backend

Flask backend + data/model pipeline: turns scientific PDFs into MSU semantic units, trains a parametric 2D projection, builds discourse-role subspaces, and serves the semantic-map / subspace / RAG APIs for the frontend.

## 1. Setup (one-time)

```bash
python3 -m pip install -r requirements.txt          # Python 3.10 (pyenv, pinned in .python-version)
cp .env.example .env                                # set LLM_API_KEY (and LLM_BASE_URL if needed)
python3 scripts/install_models.py                   # bge-large-en-v1.5 encoder → models/
# MinerU (PDF → Markdown) lives in its own venv:
/opt/homebrew/bin/python3.12 -m venv .venv-mineru && .venv-mineru/bin/pip install "mineru[core]<4"
```

## Environment variables

`.env` is local and ignored by Git. Start from `.env.example`; do not add API
keys to source files, shell scripts, or frontend variables.

- `LLM_API_KEY` is required for chat, RAG, HSU summaries, and LLM-based data-pipeline steps.
- `LLM_BASE_URL` is optional when using the template's configured
  OpenAI-compatible endpoint; change it for another provider.
- `LLM_*_MODEL` variables are optional per-feature model overrides. The
  template contains the current defaults.
- `DEFAULT_CASE`, `FLASK_HOST`, `FLASK_PORT`, and `RAG_TEMPERATURE` are optional runtime settings.
- `BGE_MODEL_PATH`, `SESMAP_DATA_ROOT`, `SESMAP_MAPPER_CKPT`, and `MINERU_*`
  are optional local pipeline overrides. `SESMAP_MAPPER_CKPT_URL` and
  `SESMAP_MAPPER_CKPT_SHA256` enable private checkpoint download/verification.

Legacy `OPENAI_*`, `RAG_MODEL`, `INTENT_MODEL`, `CONDENSE_MODEL`, and
`EMBEDDING_MODEL` names remain supported for compatibility, but new setups
should configure the `LLM_*` names.

All paths are centralized in `local_config.py` (overridable via env vars). Data layout:

```text
data/
├── pdf/            input PDFs
├── stages/         staged pipeline outputs (01_corpus … 08_semantic_map)
├── case1..3/       per-case frontend data
└── outputs/        evaluation results
```

## 2. Pipeline: PDF → Semantic Map

Put a case's PDFs into `data/caseN/pdf/`, then pass that directory to the
case pipeline (for example, `run_bio_eval.sh` uses `data/case3/pdf/`).

```bash
python3 code_for_data/mineru_pdf.py               # ① PDF → Markdown
python3 code_for_data/build_corpus.py             # ② Markdown → MSU corpus (LLM)
python3 code_for_model/precompute_embeddings.py   # ③ sentence embeddings (bge)
python3 code_for_model/train_all_v10.py           # ④ train the v10 projection
python3 code_for_data/formdatabase.py             # ⑤ 2D coordinates for every MSU
python3 code_for_data/generate_hex.py             # ⑥ hex binning → HSUs
python3 code_for_data/summarize_hex.py            # ⑦ HSU summaries (LLM)
python3 code_for_data/build_case_files.py --out-dir data/caseN     # ⑧ case files
python3 build_semantic_map_from_db_summary.py --case-dir data/caseN --out data/caseN/semantic_map_data.json
python3 code_for_data/extract_thumbnails.py --case caseN ...       # ⑨ gallery thumbnails
```

`bash build_case3.sh` runs the whole case3 build in one command.

### Adding papers to an existing case

The Control Panel upload calls `POST /api/papers/upload` and runs the same step
from the command line:

```bash
python3 code_for_data/ingest_paper.py --case case1 --pdf data/case1/pdf/new.pdf
```

Each PDF goes through MinerU, LLM MSU construction, quality filtering, BGE
encoding, and a forward pass of the case's fixed projector. New MSUs and the
gallery entry are appended to `data/<case>/semantic_map_data.json` and
`gallery.json`; existing coordinates and HSUs are not recomputed.

This needs the BGE encoder (`python3 scripts/install_models.py`), the
`.venv-mineru` environment, and `LLM_API_KEY`. `models/` and `.venv-mineru/` are
local downloads and are ignored by git. MinerU fetches its own layout models on
first use.

## 3. Evaluation

```bash
python3 code_for_model/eval_faithfulness.py       # in-sample vs PCA / t-SNE / UMAP
python3 code_for_model/eval_oos_v10.py            # leak-free out-of-sample
python3 code_for_model/detect_boundary_pairs.py   # boundary-zone detection (high-D)
```

## 4. Run the Server

```bash
python3 app.py        # Flask, http://127.0.0.1:5000
```

Main APIs: `GET /api/semantic-map` · `POST /api/subspaces` · `POST /api/query` · `GET /api/gallery`.

## 5. Verify paper mappings

Before shipping a rebuilt case, verify that every gallery item, HSU
`country_id`, and MSU `paper_id` identifies the same paper:

```bash
python3 scripts/audit_source_mappings.py        # all cases
python3 scripts/audit_source_mappings.py case2  # one case
```

The command fails on missing gallery items, duplicate country mappings, orphan
MSU references, or any cross-paper HSU.
