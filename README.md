# SeSMap

SeSMap is a visual analytics system for cross-paper scientific knowledge
synthesis. It turns paper paragraphs into source-traceable **Minimum Semantic
Units (MSUs)**, projects them into a shared two-dimensional reference, and
supports the discovery, inspection, and synthesis of related evidence.

## What it provides

- **Semantic Subspace Map**: discourse-role subspaces shown as aligned hexagonal
  semantic units (HSUs), with adjustable aggregation scale.
- **Semantic Source Gallery**: paper thumbnails and colors; the selected papers
  define the active scope for map filtering and Area Select highlighting.
- **Flights and Area Select**: retain analyst-created connections across HSUs,
  inspect source-exclusive regions and boundary zones, and revise selections.
- **Stepwise Analysis**: keep selected MSUs, source paragraphs, and generated
  evidence syntheses together in resizable, revisable analysis cards.
- **LLM assistance**: natural-language map control, source-grounded summaries,
  semantic selection, and optional RAG over a case's PDFs.

## Project layout

```text
SeSMap/
├── SeSMap-backend/    Flask API, case-building pipeline, model code, and data
└── SeSMap-frontend/   Vue 3 + Vite interface
```

The development frontend proxies `/api/*` to `http://127.0.0.1:5000`.
See the component READMEs for backend-pipeline and frontend-specific details.

## Quick start

### 1. Configure and run the backend

Python 3.10 is recommended.

```bash
cd SeSMap-backend
python3 -m pip install -r requirements.txt
cp .env.example .env
# Set LLM_API_KEY, LLM_BASE_URL, and optional LLM_*_MODEL values in .env.
python3 app.py
```

The backend serves at `http://127.0.0.1:5000`. For a machine-specific provider
or key, place the same variables in `SeSMap-backend/.env.local`; it is ignored
by Git and overrides `.env`. Never put a key in the frontend environment file.

### 2. Run the frontend

```bash
cd SeSMap-frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Set `VITE_API_TARGET` in
`SeSMap-frontend/.env` only when the backend is not running on port 5000.

## Data and case pipeline

Each case is stored in `SeSMap-backend/data/<caseId>/` and provides its PDF
collection, gallery manifest, thumbnails, and `semantic_map_data.json`.

```text
PDF → Markdown → MSUs → embeddings → 2D projection → HSUs
    → summaries and gallery assets → semantic_map_data.json
```

For an existing case, the v11 rebuild script can regenerate its frontend data:

```bash
cd SeSMap-backend
bash build_case_v11.sh case3
python3 scripts/audit_source_mappings.py case3
```

The rebuild requires the local BGE encoder; install it beforehand with
`python3 scripts/install_models.py`. Building a new corpus also requires the
MinerU PDF-to-Markdown setup documented in
[the backend README](SeSMap-backend/README.md).

## Verification

```bash
cd SeSMap-frontend && npm run build
cd ../SeSMap-backend && python3 scripts/audit_source_mappings.py
```

The mapping audit checks that gallery papers, HSU country identifiers, and MSU
paper identifiers agree for every included case.
