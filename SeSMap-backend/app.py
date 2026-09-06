# app.py
import os, json, sys, pathlib, hashlib, time
from typing import List, Dict, Any, Optional
import re
from flask import Flask, jsonify, request, abort, make_response, send_from_directory, url_for
from flask_cors import CORS
from dotenv import load_dotenv
from services.llm_config import LLM_CONFIG, get_openai_client, model_for

# Optional gzip
try:
    from flask_compress import Compress
    HAS_COMPRESS = True
except Exception:
    HAS_COMPRESS = False

# Make local prompts.py importable if you keep it
sys.path.append(str(pathlib.Path(__file__).parent.resolve()))
try:
    from prompts import SYSTEM_PROMPT as PROMPT_BASE_SYSTEM
    from prompts import PROMPT_LITERATURE_SEARCH, PROMPT_SUBSPACE_ANALYSIS
    HAS_PROMPTS = True
except Exception:
    PROMPT_BASE_SYSTEM = "You are a helpful assistant."
    PROMPT_LITERATURE_SEARCH = "You help with literature-related queries."
    PROMPT_SUBSPACE_ANALYSIS = "You help with subspace analysis."
    HAS_PROMPTS = False

PROMPT_MSU_SUMMARY = os.getenv("PROMPT_MSU_SUMMARY", """
You generate evidence-grounded summaries for selected MSUs in SeSMap.

Selection shape comes first:
- Every request states a SELECTION SHAPE. Obey it literally; never contradict it.
- A single HSU has no traversal. Do not write "path", "route", "flight", "trajectory", "journey", "steps", or "hops" for it.
- Only a user-drawn connection between HSUs may be called a Flight. Never call anything else a Flight, and never call a Flight a "path" or "route".
- Connected HSUs that are not a user-drawn Flight are just "the selected evidence".

Rules:
- Use only the user-provided MSU sentences, HSU labels, subspace names, and paper labels.
- Treat paper/source labels as first-class evidence boundaries when they are present.
- When the request supplies an order, preserve it, but synthesize instead of listing every hop.
- Use exact subspace names when they are provided; never output generic labels such as "Subspace 0".
- Explain how the focus changes across subspaces only when the selection actually spans more than one.
- If several papers are represented, compare them explicitly: what each source contributes, where they agree, and where their evidence differs.
- If only one paper is represented, do not compare papers and do not imply a second source.
- Do not merge claims across papers unless the selected MSUs support that comparison.
- No markdown, no code fences, no unsupported claims, no filler phrases.
- Output ONLY strict JSON: {"EvidenceSummary":"..."}.
""").strip()

PROMPT_STEP_TITLE = os.getenv("PROMPT_STEP_TITLE", """
You generate short editable titles for saved Stepwise Analysis steps in SeSMap.

Rules:
- Use only the evidence provided by the user.
- Produce a plain-language title for the selected evidence, not a route report.
- Focus on the shared technical topic, evidence relationship, or cross-subspace transition.
- If the selection crosses subspaces, name the conceptual transition only when it is supported by the evidence.
- Do not mention UI route types such as flight, road, or river unless those words appear in the evidence itself.
- Do not include HSU ids, MSU ids, panelIdx values, coordinates, timestamps, or the word "Step".
- Do not output JSON, dictionaries, arrays, key-value fields, markdown, bullets, quotation marks, or code fences.
- Output plain text only: one English phrase, 6-14 words.
""").strip()

PROMPT_HSU_HOVER_SUMMARY = os.getenv("PROMPT_HSU_HOVER_SUMMARY", """
You summarize the MSU sentences inside one currently aggregated HSU for a hover tooltip in SeSMap.

Rules:
- Use only the provided MSU sentences from the current HSU.
- Use original text context only to preserve detail, wording, and domain terms for those MSUs.
- Classify the MSU content into 2-5 semantic categories.
- Each category must be one bullet line in this exact style: "- Category: simple but detailed synthesis".
- Category names should be short content labels, not paper/source titles.
- Prefer simple sentences, but do not over-compress the source meaning.
- Preserve important proper nouns, named methods, datasets, metrics, measurements, technical components, and domain terms.
- Keep concrete relationships such as cause/effect, problem/solution, method/result, comparison, and limitation when present.
- Synthesize related MSUs together; do not list every MSU unless there are very few.
- Do not mention paper titles, source labels, HSU ids, MSU ids, panelIdx values, coordinates, or country ids.
- Do not use markdown emphasis, bold, italic, headings, tables, code fences, JSON, or intro/conclusion text.
- Output plain text only, usually 90-180 words total.
""").strip()

PROMPT_STEPWISE_MSU_FILTER = os.getenv("PROMPT_STEPWISE_MSU_FILTER", """
You filter MSU candidates in SeSMap's Stepwise Analysis View by semantic meaning.

Rules:
- Infer the user's core semantic filtering intent from the request.
- Select only candidate MSUs whose provided Text is directly relevant to that intent.
- Use semantic relevance, not only keyword overlap.
- Prefer precision over recall; exclude weak, adjacent, or title-only matches.
- Preserve important domain terms in the inferred intent and short answer.
- Return only strict JSON with exactly these keys: intent, answer, matches.
- The matches value must be an array of candidate uid strings copied exactly from the prompt.
- Do not output markdown, code fences, explanations outside JSON, or extra keys.
""").strip()

TASK_PROMPTS = {
    "literature": PROMPT_LITERATURE_SEARCH,
    "subspace":   PROMPT_SUBSPACE_ANALYSIS,
    "msu_summary": PROMPT_MSU_SUMMARY,  # ✨ 新增
    "step_title": PROMPT_STEP_TITLE,
    "hsu_hover_summary": PROMPT_HSU_HOVER_SUMMARY,
    "stepwise_msu_filter": PROMPT_STEPWISE_MSU_FILTER,
}


# ================= Env & OpenAI client =================
load_dotenv(pathlib.Path(__file__).resolve().parent / ".env")
OPENAI_API_KEY = LLM_CONFIG.api_key
OPENAI_BASE_URL = LLM_CONFIG.base_url
OPENAI_DEFAULT_MODEL = LLM_CONFIG.default_model

client = get_openai_client()

ENV_SYSTEM_PROMPT = (os.getenv("SYSTEM_PROMPT") or "").strip()
SYSTEM_PROMPT_ACTIVE = ENV_SYSTEM_PROMPT if ENV_SYSTEM_PROMPT else PROMPT_BASE_SYSTEM

# ================= Flask app & CORS =================
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": ["http://localhost:5173", "http://127.0.0.1:5173"]}})
if HAS_COMPRESS:
    Compress(app)

# ================= Paths =================
ROOT_DIR = pathlib.Path(__file__).parent.resolve()

# 语义图数据根目录 & 默认 case
CASE_DATA_ROOT = ROOT_DIR / "data"
_DEFAULT_CASE_RAW = (os.getenv("DEFAULT_CASE") or "case3").strip().lower()

def _normalize_case_id(pid: Optional[str]) -> str:
    """
    把各种大小写/空格形式统一成 'case1' / 'case2' / 'case3' / 'v7'，
    如果不认识就回退到默认 case。
    """
    if not pid:
        return "case3"
    t = str(pid).strip().lower()
    t = t.replace(" ", "")
    if t in ("case1", "1"):
        return "case1"
    if t in ("case2", "2"):
        return "case2"
    if t in ("case3", "3"):
        return "case3"
    if t in ("v7", "casev7", "case7", "7"):
        return "v7"
    # 兜底：环境变量里设的 DEFAULT_CASE
    dc = _DEFAULT_CASE_RAW.replace(" ", "")
    if dc in ("case1", "case2", "case3", "v7"):
        return dc
    return "case3"

def _match_case_id(text: str) -> Optional[str]:
    """
    在自然语言里模糊匹配 case 标识，如：
      - in case 1 / for case1 / on case 2
    """
    if not text:
        return None
    t = text.lower()
    for key in ("case 1", "case1", "case 2", "case2", "case 3", "case3", "case v7", "casev7", "v7"):
        if key in t:
            return _normalize_case_id(key)
    return None

def get_data_path(project_id: Optional[str] = None) -> pathlib.Path:
    """
    根据 project_id(case1/2/3/v7) 决定 semantic_map_data.json 的路径。
    """
    cid = _normalize_case_id(project_id or _DEFAULT_CASE_RAW)
    return CASE_DATA_ROOT / cid / "semantic_map_data.json"


PDF_ROOT = CASE_DATA_ROOT                      # e.g., data/case1/pdf/*.pdf
INDEX_ROOT = ROOT_DIR / "data" / "indexes"  # e.g., data/indexes/case1/<doc_stem>/

def _case_pdf_dir(project_id: str) -> pathlib.Path:
    """Canonical PDF location shared by every case."""
    return CASE_DATA_ROOT / project_id / "pdf"


def _paper_filename_key(value: Any) -> str:
    """Match corpus titles to source PDF stems despite spaces/underscores/punctuation."""
    return re.sub(r"[^a-z0-9]+", "", str(value or "").casefold())

# ================= Helpers for semantic map (kept minimal) =================
def _file_etag(path: pathlib.Path) -> str:
    if not path.exists(): return ""
    stat = path.stat()
    base = f"{path.name}:{stat.st_mtime_ns}:{stat.st_size}"
    return hashlib.sha1(base.encode("utf-8")).hexdigest()

def _json_load(path: pathlib.Path):
    if not path.exists():
        return {"title": "Semantic Map", "subspaces": [], "links": []}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

def _json_save(path: pathlib.Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def _ensure_full_package(data: dict) -> dict:
    data = data or {}
    data.setdefault("title", "Semantic Map")
    data.setdefault("subspaces", [])
    data.setdefault("links", [])
    data.setdefault("msu_index", {})
    data.setdefault("indices", {})
    data.setdefault("stats", {})
    data.setdefault("version", "1.0")
    data.setdefault("build_info", {"ts": int(time.time()), "tool": "app.py@runtime"})
    return data

def load_data(project_id: Optional[str] = None):
    return _ensure_full_package(_json_load(get_data_path(project_id)))

def save_data(data, project_id: Optional[str] = None):
    _json_save(get_data_path(project_id), data)


def parse_subspace_command(s: str) -> str:
    """
    将自然语言标准化为前端可路由的简单命令字符串。
    仅输出以下几类（与前端 commandRouter.js 完全对齐）：
      - "show all subspaces"
      - "hide all subspaces"
      - "show name1, name2"
      - "add name1, name2"
      - "delete name1, name2"
      - "list subspaces"
      - "subspace count"

    兼容的输入（示例）：
      英文：
        - show all / show all subspaces / reveal all panels
        - hide all / hide all subspaces / collapse all panels
        - show background and result (subspaces)
        - only show experiment subspace / show only methods and results
        - add subspace A, add A and B, new subspace A
        - delete/remove methods / delete A, B
        - list subspaces / show subspace list
        - how many subspaces / subspace count
      中文：
        - 显示所有子空间 / 展示全部子空间
        - 隐藏所有子空间 / 清空视图
        - 显示 背景 和 结果 子空间 / 只显示 实验 子空间 / 仅显示 方法 子空间
        - 新增 子空间 A / 新建 A / 新增 A 和 B
        - 删除 子空间 A / 删除 A、B
        - 列出子空间 / 子空间列表
        - 子空间数量 / 有多少个子空间
    """
    import re

    raw = (s or "").strip()
    if not raw:
        return "show all subspaces"

    # 原文 & 小写（英文处理用）
    t = raw.strip()
    tl = t.lower()

    # 统一空白
    tl = re.sub(r"\s+", " ", tl)

    # --- 礼貌/填充词清理（英文） ---
    tl = re.sub(r"^(please|pls|could you|can you|would you|i'?d like to|kindly)\s+", "", tl)

    # --- 动词与同义词标准化（英文） ---
    # only/just 显示
    tl = re.sub(r"^(only|just)\s+show\s+", "show ", tl)
    tl = re.sub(r"^show\s+only\s+", "show ", tl)
    # display/reveal/present/visualize -> show
    tl = re.sub(r"^(display|reveal|present|visuali[sz]e)\s+", "show ", tl)
    # collapse -> hide
    tl = re.sub(r"^collapse\s+", "hide ", tl)

    # --- 中文动词标准化 ---
    # 「只/仅 显示」→ show
    tl = re.sub(r"^(只显示|仅显示)\s*", "显示 ", tl)
    # 「显示/隐藏/新增/新建/删除/列出/列表」前缀统一
    tl = re.sub(r"^展示\s*", "显示 ", tl)
    tl = re.sub(r"^隐藏\s*", "hide ", tl)       # 直接转英文，便于统一处理
    tl = re.sub(r"^显示\s*", "show ", tl)
    tl = re.sub(r"^(新增|新建)\s*", "add ", tl)
    tl = re.sub(r"^删除\s*", "delete ", tl)
    tl = re.sub(r"^(列出|查看)\s*子空间", "list subspaces", tl)
    tl = re.sub(r"子空间列表", "list subspaces", tl)
    tl = re.sub(r"(子空间数量|有多少个子空间)", "subspace count", tl)
    tl = re.sub(r"(清空视图)", "hide all subspaces", tl)

    # --- 统一“全部/所有” ---
    tl = tl.replace("all panels", "all subspaces")
    tl = tl.replace("所有 子空间", "all subspaces")
    tl = tl.replace("全部 子空间", "all subspaces")

    # --- 快捷判断：list / count ---
    if re.search(r"\blist subspaces\b|\bshow subspace list\b", tl):
        return "list subspaces"
    if re.search(r"\bsubspace count\b|\bhow many subspaces\b", tl):
        return "subspace count"

    # --- 全部显隐（要在通用 show/hide 前） ---
    if re.search(r"\b(show|expand)\b.*\ball subspaces\b", tl):
        return "show all subspaces"
    if re.search(r"\b(hide|collapse)\b.*\ball subspaces\b", tl):
        return "hide all subspaces"

    # === 工具：抽取名字（兼顾英/中连接词） ===
    def _extract_names(segment: str):
        seg = segment.strip()

        # 去掉 “subspace(s)/panel(s)/子空间/面板/组/类别”等噪音
        seg = re.sub(r"\b(subspaces?|panels?|groups?|categories?)\b", " ", seg)
        seg = seg.replace("子空间", " ").replace("面板", " ").replace("类别", " ").replace("组", " ")

        # and/&/with/plus/和/及 ——> 逗号
        seg = re.sub(r"\s*(,|;|/|\||&|\+|\sand\s| with | plus | 和 | 及 )\s*", ",", seg, flags=re.I)

        # 连续逗号/空白规整
        seg = re.sub(r"\s*,\s*", ",", seg).strip(" ,.")

        # 中英混合空白也当分隔
        if "," in seg:
            parts = [p.strip() for p in seg.split(",") if p.strip()]
        else:
            parts = [p.strip() for p in seg.split() if p.strip()]
        return parts

    # === add / delete（必须在 show/hide 前判断） ===
    m = re.match(r"^(add|delete)\s+(.+)$", tl)
    if m:
        action, rest = m.group(1), m.group(2)
        names = _extract_names(rest)
        if names:
            return f"{action} " + ", ".join(names)
        # 没名字就忽略，落到后面的处理

    # === show / hide 子集 ===
    m = re.match(r"^(show|hide)\s+(.+)$", tl)
    if m:
        action, rest = m.group(1), m.group(2)

        # 去掉开头的 all（避免 "show all background" 误杀）
        rest = re.sub(r"^all\s+", "", rest)

        names = _extract_names(rest)

        # 如果没有给出具体名字：
        if not names:
            # "show" → 当成 show all
            if action == "show":
                return "show all subspaces"
            # "hide" → 当成 hide all
            if action == "hide":
                return "hide all subspaces"

        # 有名字：统一输出 "show name1, name2" / "delete name1, name2" 等
        # （前端 commandRouter 把 "show <list>" 解释为 showOnlySubspaces）
        if names:
            # 支持 "show all except A,B" / "hide except A,B" —— 这里先做弱化处理：
            # 如检测到 except，则仍返回 "show name1, name2"，由前端按名称做精确控制。
            # （如需“排除式”显示，需要前端知道全集，这里不做全集运算）
            rest_l = rest.lower()
            if "except " in rest_l or "除了" in rest or "除外" in rest:
                # 把 "show all except A,B" 标准化为 "hide A,B" 会需要前端支持 hide(list)；
                # 目前前端没有 hide(list)，所以保持 show 子集语义：
                # 约定：用户通常期望的是“只显示”某些名字，因此仍返回 show <names>。
                pass

            # "hide X,Y" 前端没有 hide(list)；保持现有能力：把 "hide ..." 映射为 "show ..." 之外的情况走 hide all。
            if action == "hide" and names:
                # 尽量不误导：如果用户明确 hide 某些名字，当前能力有限，退化为 hide all。
                return "hide all subspaces"

            return f"show " + ", ".join(names)

    # —— 中文常见写法（已在上面标准化；如果漏网，也补兜底）——
    if tl.startswith("显示"):
        # 比如 "显示 背景 和 结果 子空间"
        names = _extract_names(tl.replace("显示", "", 1))
        if names:
            return "show " + ", ".join(names)
        return "show all subspaces"
    if tl.startswith("hide"):
        rest = tl.replace("hide", "", 1).strip()
        if not rest or "all subspaces" in rest:
            return "hide all subspaces"

    # 兜底：避免界面卡死
    return "show all subspaces"

def is_subspace_command(s: str) -> bool:
    """
    判断一句自然语言是否是子空间显隐指令（高优先规则）。
    只在出现明确控制动词时判断为子空间显隐指令，避免把总结/分析 prompt
    里普通出现的 "subspace" 误判成 UI 控制。
    """
    if not s or not s.strip():
        return False
    t = re.sub(r"\s+", " ", s.lower().strip())

    # 中文显式控制
    if re.search(r"(显示|展示|隐藏|新增|新建|删除|列出|查看|清空视图|子空间列表|子空间数量|有多少个子空间)", t):
        return True

    # 英文显式控制
    if re.search(r"\b(show|hide|expand|collapse|add|delete|remove|list)\b", t):
        # 若句子里就明确出现 subspace(s)/panel(s)，直接认为是
        if re.search(r"\b(subspaces?|panels?)\b", t):
            return True
        # 没写 subspace/panel，但写了常见子空间名/模式（background/method/result/ablation/overview 等）
        if re.search(r"\b(background|method|methods|result|results|ablation|overview|introduction|discussion)\b", t):
            return True
        # "show X and Y" 这种也判定为 UI 控制（常见口语化）
        if re.match(r"^(show|hide)\s+\w+", t):
            return True
    # list/count 这类问法
    if re.search(r"\b(how many|count)\b.*\bsubspaces?\b", t):
        return True
    return False


# ================= Semantic map minimal routes (unchanged interface) =================
@app.get("/api/semantic-map")
def get_semantic_map():
    # 从 query 里拿 case：?project_id=case1 或 ?case=1
    raw_pid = request.args.get("project_id") or request.args.get("case")
    project_id = _normalize_case_id(raw_pid) if raw_pid else None

    # 加载对应 case 的语义图数据
    data = load_data(project_id)

    # 当前文件的路径 & ETag（用于版本控制）
    data_path = get_data_path(project_id)
    etag = _file_etag(data_path)

    inm = request.headers.get("If-None-Match")
    if inm and etag and inm == etag:
        resp = make_response("", 304)
        resp.headers["ETag"] = etag
        resp.headers["Cache-Control"] = "public, max-age=60"
        return resp

    resp = jsonify(data)
    if etag:
        resp.headers["ETag"] = etag
        resp.headers["Cache-Control"] = "public, max-age=60"
    return resp

@app.get("/api/semantic-map/indices")
def get_indices_only():
    raw_pid = request.args.get("project_id") or request.args.get("case")
    project_id = _normalize_case_id(raw_pid) if raw_pid else None
    data = load_data(project_id)
    return jsonify(data.get("indices", {}))

@app.get("/api/llm/config")
def get_llm_config():
    return jsonify({
        "base_url": LLM_CONFIG.base_url,
        "models": {
            "chat": model_for("chat"),
            "intent": model_for("intent"),
            "rag": model_for("rag"),
            "summary": model_for("summary"),
            "condense": model_for("condense"),
            "embedding": model_for("embedding"),
        }
    })

@app.get("/api/semantic-map/msu/<int:mid>")
def get_msu_detail(mid: int):
    raw_pid = request.args.get("project_id") or request.args.get("case")
    project_id = _normalize_case_id(raw_pid) if raw_pid else None
    data = load_data(project_id)
    msu = data.get("msu_index", {}).get(str(mid)) or data.get("msu_index", {}).get(mid)
    if msu is None:
        abort(404, f"MSU {mid} not found")
    return jsonify(msu)


@app.post("/api/subspaces")
def create_subspace():
    body = request.get_json(force=True) or {}
    raw_pid = body.get("project_id") or request.args.get("project_id") or request.args.get("case")
    project_id = _normalize_case_id(raw_pid) if raw_pid else None

    name = (body.get("subspaceName") or "").strip()
    data = load_data(project_id)
    new_idx = len(data.get("subspaces", []))
    subspace = {
        "panelIdx": new_idx,
        "subspaceName": name or f"Subspace {new_idx + 1}",
        "hexList": body.get("hexList", []),
        "countries": body.get("countries", [])
    }
    data.setdefault("subspaces", []).append(subspace)
    save_data(data, project_id)
    return jsonify({"index": new_idx, "subspace": subspace, "project_id": project_id}), 201

@app.patch("/api/subspaces/<int:idx>")
def rename_subspace(idx: int):
    body = request.get_json(force=True) or {}
    raw_pid = body.get("project_id") or request.args.get("project_id") or request.args.get("case")
    project_id = _normalize_case_id(raw_pid) if raw_pid else None

    new_name = (body.get("subspaceName") or "").strip()
    if not new_name:
        abort(400, "subspaceName required")
    data = load_data(project_id)
    subs = data.get("subspaces", [])
    if idx < 0 or idx >= len(subs):
        abort(404, "subspace not found")
    subs[idx]["subspaceName"] = new_name
    save_data(data, project_id)
    return jsonify({"index": idx, "subspace": subs[idx], "project_id": project_id})


# ================= RAG Service (per-PDF indexing & structured answering) =================
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_core.prompts import PromptTemplate

def _format_docs(docs) -> str:
    """Readable context with doc name and page."""
    lines = []
    for d in docs:
        page = d.metadata.get("page", "?")
        title = d.metadata.get("doc_id", d.metadata.get("source", ""))
        txt = (d.page_content or "").strip()
        if len(txt) > 1000:
            txt = txt[:1000] + " ..."
        lines.append(f"[{title} | p.{page}] {txt}")
    return "\n\n".join(lines)

def _is_stale_faiss_pickle_error(err: Exception) -> bool:
    return isinstance(err, KeyError) and str(err).strip("'\"") == "__fields_set__"

class RAGService:
    """
    - Per-PDF FAISS index under: data/indexes/<project>/<doc_stem>/
    - Structured per-paper answering + cross-paper comparison.
    """
    def __init__(self, pdf_root: pathlib.Path, index_root: pathlib.Path,
                 openai_api_key: str, openai_base_url: str,
                 model: str = OPENAI_DEFAULT_MODEL, temperature: float = 0.0):
        self.pdf_root = pathlib.Path(pdf_root)
        self.index_root = pathlib.Path(index_root)
        self.index_root.mkdir(parents=True, exist_ok=True)
        self.embeddings = OpenAIEmbeddings(
            api_key=openai_api_key,
            base_url=openai_base_url,
            model=model_for("embedding")
        )
        self.model_name = model
        self.temperature = temperature
        self.openai_api_key = openai_api_key
        self.openai_base_url = openai_base_url

    # ---- paths ----
    def _project_pdf_dir(self, project_id: str) -> pathlib.Path:
        return self.pdf_root / project_id / "pdf"

    def _project_index_dir(self, project_id: str) -> pathlib.Path:
        return self.index_root / project_id

    def _doc_index_dir(self, project_id: str, doc_stem: str) -> pathlib.Path:
        return self._project_index_dir(project_id) / doc_stem

    # ---- listing ----
    def list_projects(self) -> List[str]:
        if not self.pdf_root.exists(): return []
        out = []
        for p in sorted([p for p in self.pdf_root.iterdir() if p.is_dir()]):
            has_pdf = any(x.suffix.lower() == ".pdf" for x in (p / "pdf").glob("*.pdf"))
            if has_pdf: out.append(p.name)
        return out

    def _list_pdfs(self, project_id: str) -> List[pathlib.Path]:
        pdf_dir = self._project_pdf_dir(project_id)
        if not pdf_dir.exists():
            raise FileNotFoundError(f"project not found: {project_id}")
        pdfs = sorted([p for p in pdf_dir.glob("*.pdf") if p.is_file()])
        if not pdfs:
            raise FileNotFoundError(f"no pdf found in project: {project_id}")
        return pdfs

    # ---- per-doc indexing ----
    def _index_exists_doc(self, project_id: str, doc_stem: str) -> bool:
        return (self._doc_index_dir(project_id, doc_stem) / "index.faiss").exists()

    def _load_vectorstore_doc(self, project_id: str, doc_stem: str) -> FAISS:
        idx_dir = self._doc_index_dir(project_id, doc_stem)
        if not idx_dir.exists():
            raise FileNotFoundError(f"index not found for {project_id}/{doc_stem}")
        return FAISS.load_local(str(idx_dir), self.embeddings, allow_dangerous_deserialization=True)

    def _save_vectorstore_doc(self, project_id: str, doc_stem: str, vs: FAISS):
        idx_dir = self._doc_index_dir(project_id, doc_stem)
        idx_dir.mkdir(parents=True, exist_ok=True)
        vs.save_local(str(idx_dir))

    def _build_vectorstore_doc(self, project_id: str, pdf_path: pathlib.Path, splitter=None) -> tuple[FAISS, int]:
        splitter = splitter or RecursiveCharacterTextSplitter(
            chunk_size=1000, chunk_overlap=200,
            separators=["\n\n", "\n", " ", ""]
        )
        docs = PyPDFLoader(str(pdf_path)).load()
        splits = splitter.split_documents(docs)
        for d in splits:
            d.metadata["doc_id"] = pdf_path.name
            d.metadata["source"] = str(pdf_path)
        vs = FAISS.from_documents(splits, self.embeddings)
        self._save_vectorstore_doc(project_id, pdf_path.stem, vs)
        return vs, len(splits)

    def build_or_update_index(self, project_id: str, rebuild: bool = False) -> Dict[str, Any]:
        """
        Build/refresh per-PDF indexes under data/indexes/<project>/<doc_stem>/ .
        """
        pdfs = self._list_pdfs(project_id)
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000, chunk_overlap=200,
            separators=["\n\n", "\n", " ", ""]
        )

        built = 0
        reused = 0
        total_chunks = 0

        for p in pdfs:
            stem = p.stem
            if not rebuild and self._index_exists_doc(project_id, stem):
                try:
                    self._load_vectorstore_doc(project_id, stem)
                    reused += 1
                    continue
                except Exception as e:
                    if not _is_stale_faiss_pickle_error(e):
                        raise
                    print(f"[RAG] stale index detected, rebuilding: {project_id}/{stem}")

            _, chunk_count = self._build_vectorstore_doc(project_id, p, splitter)
            built += 1
            total_chunks += chunk_count

        return {
            "project_id": project_id,
            "built": built,
            "reused": reused,
            "total_docs": len(pdfs),
            "total_chunks": total_chunks if built else None,
            "message": "per-PDF indexes ready" if (built or reused) else "no PDFs found"
        }

    # ---- generation ----
    def _make_llm(self):
        return ChatOpenAI(
            api_key=self.openai_api_key,
            base_url=self.openai_base_url,
            model=self.model_name,
            temperature=self.temperature,
        )


    def query_structured(self, project_id: str, question: str, k: int = 5, mmr: bool = False) -> str:
        """
        Per-PDF retrieval, then produce a structured answer:
        - One section per paper (keep them separate)
        - Final cross-paper comparison (commonalities/differences)
        Returns plain text (already polished by LLM).
        """
        pdfs = self._list_pdfs(project_id)

        # ensure each doc has index; if not, build it lazily
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000, chunk_overlap=200,
            separators=["\n\n", "\n", " ", ""]
        )
        for p in pdfs:
            if not self._index_exists_doc(project_id, p.stem):
                self._build_vectorstore_doc(project_id, p, splitter)

        # fetch contexts per doc
        per_doc_context = []
        for p in pdfs:
            try:
                vs = self._load_vectorstore_doc(project_id, p.stem)
            except Exception as e:
                if not _is_stale_faiss_pickle_error(e):
                    raise
                print(f"[RAG] stale index detected, rebuilding: {project_id}/{p.stem}")
                vs, _ = self._build_vectorstore_doc(project_id, p, splitter)
            retriever = vs.as_retriever(
                search_type="mmr" if mmr else "similarity",
                search_kwargs={"k": k}
            )
            docs = getattr(retriever, "invoke", retriever.get_relevant_documents)(question)
            ctx = _format_docs(docs) if docs else "(no relevant context retrieved)"
            per_doc_context.append({
                "doc_id": p.name,
                "doc_stem": p.stem,
                "context": ctx
            })

        # build prompt enforcing per-paper separation + cross comparison
        llm = self._make_llm()
        template = (
            "You answer a user question using retrieved passages from multiple papers in CASE: {project_id}.\n"
            "Use ONLY the provided context. Keep papers separate, then synthesize across papers.\n\n"
            "Required structure:\n"
            "1. Direct answer: 1-2 sentences answering the user question.\n"
            "2. Evidence by paper: one short subsection per paper.\n"
            "   - Focus: one sentence.\n"
            "   - Relevant evidence: 2-4 bullets grounded in the retrieved context.\n"
            "   - Missing/unclear: include only if important and not stated.\n"
            "3. Cross-paper synthesis:\n"
            "   - Commonalities: up to 3 bullets.\n"
            "   - Differences: up to 3 bullets; name the paper when contrasting.\n"
            "   - Takeaway: one concise sentence.\n\n"
            "Style constraints:\n"
            "- Fluent English, compact, and useful for semantic-map exploration.\n"
            "- Preserve technical terms from the context.\n"
            "- Do not invent authors, years, results, limitations, or mechanisms.\n"
            "- If evidence is insufficient, say exactly what is missing.\n\n"
            "USER QUESTION:\n{question}\n\n"
            "CONTEXT BY PAPER:\n{contexts}\n\n"
            "Answer:"
        )

        contexts_text = "\n\n".join(
            [f"### {item['doc_id']}\n{item['context']}" for item in per_doc_context]
        )
        prompt = PromptTemplate.from_template(template)
        final = llm.invoke(prompt.format(
            project_id=project_id, question=question, contexts=contexts_text
        ))
        return final.content if hasattr(final, "content") else str(final)

# Instantiate RAG
try:
    _RAG = RAGService(
        pdf_root=PDF_ROOT,
        index_root=INDEX_ROOT,
        openai_api_key=OPENAI_API_KEY,
        openai_base_url=OPENAI_BASE_URL,
        model=model_for("rag"),
        temperature=float(os.getenv("RAG_TEMPERATURE", "0.0")),
    )
except Exception as _e:
    print("[RAG] init failed:", _e)
    _RAG = None

def _ensure_rag() -> RAGService:
    if _RAG is None:
        abort(503, "RAG not initialized. Check dependencies and .env.")
    return _RAG

# ================= Natural-language intent (English only) =================
# Rule set + LLM fallback. Users type in English.
_PROJECT_ALIASES = {
  "case1": ["case1", "case 1", "project one", "set1", "set 1", "first project", "first set"],
  "case2": ["case2", "case 2", "project two", "set2", "set 2", "second project", "second set"],
}
_VERB_PROJECTS = [
  "what projects", "list projects", "available projects", "show projects",
  "what corpora", "list corpora", "available corpora", "show corpora",
  "what datasets", "list datasets", "what papers", "list papers", "show papers"
]
_VERB_INDEX = [
  "build index", "create index", "rebuild index", "refresh index", "update index",
  "re-index", "construct index", "generate index"
]
_FLAG_REBUILD = ["rebuild", "from scratch", "force", "fresh", "reset", "full rebuild"]

def _match_project_id(text: str) -> Optional[str]:
    t = text.lower().strip()
    for pid, aliases in _PROJECT_ALIASES.items():
        for a in aliases:
            if a in t:
                return pid
    return None

def _is_projects_intent(text: str) -> bool:
    t = text.lower()
    return any(k in t for k in _VERB_PROJECTS)

def _is_index_intent(text: str) -> bool:
    t = text.lower()
    return any(k in t for k in _VERB_INDEX)

def _should_rebuild(text: str) -> bool:
    t = text.lower()
    return any(k in t for k in _FLAG_REBUILD)

def parse_intent_rules(text: str):
    if not text or not text.strip():
        return {"action":"none"}
    if _is_projects_intent(text):
        return {"action":"projects"}
    if _is_index_intent(text):
        pid = _match_project_id(text)
        return {"action":"index","project_id":pid,"rebuild":_should_rebuild(text)}
    pid = _match_project_id(text)
    if pid:
        return {"action":"ask","project_id":pid,"question":text}
    return {"action":"none"}

def parse_intent_llm(text: str) -> dict:
    """
    Fallback: ask an LLM to extract intent into strict JSON.
    """
    prompt = (
      "You are a strict intent parser for SeSMap's RAG system.\n"
      "The user may ask in English or Chinese. Output ONLY valid JSON with exactly these keys:\n"
      '{"action":"projects|index|ask|none","project_id":"case1|case2|null","question":"string|null","rebuild":false}\n'
      "Decision rules:\n"
      "- List available projects/corpora/papers => action=\"projects\".\n"
      "- Build, refresh, update, or rebuild an index => action=\"index\". Detect project_id and rebuild=true only for force/full/from-scratch wording.\n"
      "- Ask about paper content in a corpus => action=\"ask\" with project_id when stated.\n"
      "- If the target project is unclear and no project can be inferred, use project_id=null.\n"
      "- If the text is a UI visibility command, casual chat, or ambiguous, use action=\"none\".\n"
      "- Do not add explanations or markdown.\n\n"
      f"USER: {text}\n"
      "JSON:"
    )
    try:
        resp = client.chat.completions.create(
            model=model_for("intent"),
            messages=[{"role":"user","content":prompt}],
            temperature=0.0,
            max_tokens=120,
            timeout=15.0
        )
        s = resp.choices[0].message.content or "{}"
        data = json.loads(s)
        data.setdefault("action","none")
        data.setdefault("project_id", None)
        data.setdefault("question", None)
        data.setdefault("rebuild", False)
        if isinstance(data.get("project_id"), str):
            pid = _match_project_id(data["project_id"]) or data["project_id"].lower()
            if pid not in ("case1","case2"):
                pid = None
            data["project_id"] = pid
        return data
    except Exception:
        return {"action":"none"}

# ================= RAG REST API (optional for explicit buttons) =================
@app.get("/api/rag/projects")
def rag_list_projects():
    rag = _ensure_rag()
    return jsonify({"projects": rag.list_projects()})

# ================= Gallery (缩略图 + manifest；方案 B 泛化) =================
@app.get("/api/gallery")
def get_gallery():
    """返回某 case 的 gallery manifest（每篇论文的缩略图 URL + 地图国家/来源映射）。
    由 extract_thumbnails.py 生成 data/<case>/gallery.json + thumbnails/。"""
    raw_pid = request.args.get("project_id") or request.args.get("case")
    pid = _normalize_case_id(raw_pid)
    gpath = CASE_DATA_ROOT / pid / "gallery.json"
    if not gpath.exists():
        return jsonify({"project_id": pid, "items": []})
    try:
        items = json.loads(gpath.read_text(encoding="utf-8"))
    except Exception as e:
        abort(500, f"gallery manifest error: {e}")
    pdf_dir = _case_pdf_dir(pid)
    pdf_names = {
        _paper_filename_key(p.stem): p.name
        for p in pdf_dir.glob("*.pdf")
        if p.is_file()
    } if pdf_dir.exists() else {}
    for it in items:
        if it.get("thumbnail"):
            it["thumbnail_url"] = f"/api/gallery/thumb/{pid}/{it['thumbnail']}"
        # The gallery manifest identifies a paper by its corpus-folder title, which
        # is the original PDF stem.  Expose that source PDF through the backend so
        # gallery entries do not depend on separately bundled frontend filenames.
        pdf_name = pdf_names.get(_paper_filename_key(it.get("title")))
        if pdf_name:
            it["pdf_url"] = url_for("get_gallery_pdf", project=pid, fname=pdf_name)
    return jsonify({"project_id": pid, "items": items})

@app.get("/api/gallery/thumb/<project>/<path:fname>")
def get_gallery_thumb(project, fname):
    pid = _normalize_case_id(project)
    d = CASE_DATA_ROOT / pid / "thumbnails"
    if not (d / fname).exists():
        abort(404, "thumbnail not found")
    return send_from_directory(str(d), fname)

@app.get("/api/gallery/pdf/<project>/<path:fname>")
def get_gallery_pdf(project, fname):
    """Serve a case PDF selected by the generated gallery manifest."""
    pid = _normalize_case_id(project)
    d = _case_pdf_dir(pid)
    if not (d / fname).is_file():
        abort(404, "PDF not found")
    return send_from_directory(str(d), fname)

@app.post("/api/rag/index")
def rag_build_index():
    rag = _ensure_rag()
    body = request.get_json(force=True) or {}
    project_id = (body.get("project_id") or "").strip()
    rebuild = bool(body.get("rebuild") or False)
    if not project_id:
        abort(400, "project_id required")
    try:
        stats = rag.build_or_update_index(project_id, rebuild=rebuild)
        return jsonify({"project_id": project_id, "stats": stats})
    except FileNotFoundError as e:
        abort(404, str(e))
    except Exception as e:
        print("[RAG] build index error:", e)
        abort(500, f"RAG index error: {e}")

# ================= Unified /api/query =================
@app.post("/api/query")
def query_gpt():
    body = request.get_json(force=True) or {}
    user_query = (body.get("query") or "").strip()
    messages_from_client = body.get("messages")  # 可选：前端传近几轮对话
    if not user_query:
        return app.response_class("No query provided", mimetype="text/plain"), 400

    # 0) Subspace 控制（最高优先），LLM 严格 JSON → 前端 UI 路由
    task_type = (body.get("task") or "").lower()
    if task_type == "subspace" or (not task_type and is_subspace_command(user_query)):
        try:
            tool_prompt = (
                "You normalize user text into a SeSMap UI command for subspace visibility.\n"
                "Output ONLY strict JSON: "
                "{\"command\":\"<string>\",\"project_id\":\"case1|case2|case3|v7|null\"}\n"
                "Allowed command values:\n"
                "- \"show all subspaces\" / \"hide all subspaces\"\n"
                "- \"show <name1>, <name2>\" or \"hide <name1>, <name2>\"\n"
                "- Use canonical subspace names when obvious: Background, Method, Experiment, Result, Conclusion.\n"
                "Case selection rules:\n"
                "- If the user mentions case 1 / case1, set project_id=\"case1\".\n"
                "- If case 2 / case2, set project_id=\"case2\".\n"
                "- If case 3 / case3, set project_id=\"case3\".\n"
                "- If v7 / case v7, set project_id=\"v7\".\n"
                "- If not clearly specified, set project_id=\"null\".\n"
                "- Do not include paper-gallery requests here; only subspace visibility commands.\n"
                "Do not add extra keys or commentary.\n"
                f"USER: {user_query}\nJSON:"
            )
            resp = client.chat.completions.create(
                model=model_for("intent"),
                messages=[{"role":"user","content":tool_prompt}],
                temperature=0.0, max_tokens=50, timeout=10.0
            )
            js = json.loads(resp.choices[0].message.content or "{}")
            cmd_from_llm = (js.get("command") or "").strip()
            pid_from_llm = js.get("project_id")
            if isinstance(pid_from_llm, str):
                pid_from_llm = pid_from_llm.strip().lower()
                if pid_from_llm in ("case1", "case2", "case3", "v7"):
                    project_id = pid_from_llm
                else:
                    project_id = None
            else:
                project_id = None
        except Exception:
            cmd_from_llm = ""
            project_id = None

        # 规则兜底：如果 LLM 没认出 case，就从自然语言里模糊匹配一次
        if not project_id:
            project_id = _match_case_id(user_query)

        command = cmd_from_llm if cmd_from_llm else parse_subspace_command(user_query)

        return jsonify({
            "mode": "subspace/control",
            "payload": {
                "text": command,
                # 新增：告诉前端当前指令针对哪个 case
                "project_id": project_id  # e.g. "case1" / "case2" / "case3" / null
            },
            "meta": {}
        }), 200

    # 0.5) Stepwise Analysis View 的自动标题：必须与 RouteSummary JSON 摘要分流。
    if task_type == "step_title":
        try:
            resp = client.chat.completions.create(
                model=model_for("summary"),
                messages=[
                    {"role": "system", "content": PROMPT_STEP_TITLE},
                    {"role": "user", "content": user_query}
                ],
                temperature=0.15,
                max_tokens=80,
                timeout=20.0
            )
            answer = resp.choices[0].message.content
            return app.response_class(answer, mimetype="text/plain"), 200
        except Exception as e:
            print("[Step title] error:", e)
            return app.response_class(f"Step title error: {str(e)}", mimetype="text/plain"), 500

    # 0.6) MSU 摘要：Stepwise Analysis View / LinkCard 的 Summarize 按钮专用。
    # 这类 prompt 中会自然出现 subspace/case/MSU 等词，不应再走 RAG 意图识别。
    if task_type == "msu_summary":
        try:
            resp = client.chat.completions.create(
                model=model_for("summary"),
                messages=[
                    {"role": "system", "content": PROMPT_MSU_SUMMARY},
                    {"role": "user", "content": user_query}
                ],
                temperature=0.2,
                max_tokens=700,
                timeout=30.0
            )
            answer = resp.choices[0].message.content
            return app.response_class(answer, mimetype="text/plain"), 200
        except Exception as e:
            print("[MSU summary] error:", e)
            return app.response_class(f"MSU summary error: {str(e)}", mimetype="text/plain"), 500

    # 0.7) 动态聚合后的 HSU hover 摘要：按需调用，前端会缓存。
    if task_type == "hsu_hover_summary":
        try:
            resp = client.chat.completions.create(
                model=model_for("summary"),
                messages=[
                    {"role": "system", "content": PROMPT_HSU_HOVER_SUMMARY},
                    {"role": "user", "content": user_query}
                ],
                temperature=0.15,
                max_tokens=520,
                timeout=20.0
            )
            answer = resp.choices[0].message.content
            return app.response_class(answer, mimetype="text/plain"), 200
        except Exception as e:
            print("[HSU hover summary] error:", e)
            return app.response_class(f"HSU hover summary error: {str(e)}", mimetype="text/plain"), 500

    # 0.8) Chat with LLM 触发的 Stepwise MSU 语义筛选：仅判断候选 uid，不走 RAG。
    if task_type == "stepwise_msu_filter":
        try:
            resp = client.chat.completions.create(
                model=model_for("summary"),
                messages=[
                    {"role": "system", "content": PROMPT_STEPWISE_MSU_FILTER},
                    {"role": "user", "content": user_query}
                ],
                temperature=0.0,
                max_tokens=900,
                timeout=30.0
            )
            answer = resp.choices[0].message.content
            return app.response_class(answer, mimetype="text/plain"), 200
        except Exception as e:
            print("[Stepwise MSU filter] error:", e)
            return app.response_class(f"Stepwise MSU filter error: {str(e)}", mimetype="text/plain"), 500


    # 1) NL intent for RAG（规则优先，失败走 LLM）
    intent = parse_intent_rules(user_query)
    if intent.get("action") == "none":
        intent = parse_intent_llm(user_query)

    # 2) RAG 路由（projects/index/ask）
    if intent.get("action") in ("projects", "index", "ask"):
        rag = _ensure_rag()
        try:
            if intent["action"] == "projects":
                data = {"projects": rag.list_projects()}
                return jsonify({"mode":"rag/projects","payload":data,"meta":{}}), 200

            if intent["action"] == "index":
                pid = intent.get("project_id")
                if not pid:
                    return jsonify({"mode":"error","payload":{"message":"Please specify the project to index (case1 or case2)."}}, 200)
                stats = rag.build_or_update_index(pid, rebuild=bool(intent.get("rebuild", False)))
                return jsonify({"mode":"rag/index","payload":{"project_id":pid,"stats":stats},"meta":{}}), 200

            if intent["action"] == "ask":
                pid = intent.get("project_id")
                if not pid:
                    projects = rag.list_projects()
                    if "case1" in projects and len(projects) == 1:
                        pid = "case1"
                    else:
                        return app.response_class("Please specify which project to query (case1 or case2).", mimetype="text/plain"), 200

                # ✨ 上下文压缩 → 作为检索语义前缀
                ctx_summary = _condense_messages_to_summary(messages_from_client)
                condensed_q = (ctx_summary + "\n\n" if ctx_summary else "") + (intent.get("question") or user_query)

                answer_text = rag.query_structured(
                    pid, condensed_q,
                    k=int(body.get("k", 5)),
                    mmr=bool(body.get("mmr", False))
                )
                return app.response_class(answer_text, mimetype="text/plain"), 200

        except FileNotFoundError as e:
            return app.response_class(str(e), mimetype="text/plain"), 404
        except Exception as e:
            print("[RAG] NL intent error:", e)
            return app.response_class(f"RAG error: {e}", mimetype="text/plain"), 500

    # 3) Fallback: 普通 Chat（会话历史优先，否则用压缩提要）
    task_type = (task_type or "literature") or "literature"
    task_prompt = TASK_PROMPTS.get(task_type, "")
    try:
        openai_messages = [{"role": "system", "content": SYSTEM_PROMPT_ACTIVE}]

        if isinstance(messages_from_client, list) and messages_from_client:
            # 直接拼接最近 8 条
            for m in messages_from_client[-8:]:
                if isinstance(m, dict) and "role" in m and "content" in m:
                    openai_messages.append({"role": m["role"], "content": m["content"]})
        else:
            # 无历史 → 用 1–3 句的上下文提要
            ctx_summary = _condense_messages_to_summary(messages_from_client)
            if ctx_summary:
                openai_messages.append({"role": "system", "content": f"[Context summary]\n{ctx_summary}"})

        openai_messages.append({
            "role": "user",
            "content": f"{task_prompt}\n\nUser query:\n{user_query}"
        })

        resp = client.chat.completions.create(
            model=body.get("model") or model_for("chat"),
            messages=openai_messages,
            temperature=0.2,
            max_tokens=900,
            timeout=30.0
        )
        answer = resp.choices[0].message.content
        return app.response_class(answer, mimetype="text/plain"), 200
    except Exception as e:
        print("GPT error:", e)
        return app.response_class(f"Error: {str(e)}", mimetype="text/plain"), 500


# ===== 在文件顶部 imports 附近，添加一个极简的压缩器 =====
def _condense_messages_to_summary(messages: list[str] | list[dict] | None) -> str:
    """
    将多轮消息压缩为 1–3 句语义提要（不含私货）。
    输入 messages 可为 OpenAI messages 结构或简单字符串数组。
    """
    if not messages:
        return ""
    tail = messages[-6:]  # 取最近 N 条，避免爆 token
    lines = []
    for m in tail:
        if isinstance(m, dict):
            role = m.get("role", "user")
            content = (m.get("content") or "").strip()
        else:
            role, content = "user", str(m).strip()
        if content:
            lines.append(f"{role}: {content}")
    convo_text = "\n".join(lines[-1200:])  # 再限长度

    prompt = (
        "Compress the following SeSMap chat history into 1-3 concise sentences.\n"
        "Keep only durable context: user goal, selected case/project, paper/topic names, constraints, and unresolved tasks.\n"
        "Discard greetings, UI chatter, and redundant assistant wording. Do not invent facts.\n"
        "Conversation:\n" + convo_text + "\n\nSummary:"
    )
    try:
        resp = client.chat.completions.create(
            model=model_for("condense"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=120,
            timeout=12.0
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception:
        return ""

# ================= Main =================
if __name__ == "__main__":
    host = os.getenv("FLASK_HOST", "127.0.0.1")
    port = int(os.getenv("FLASK_PORT", "5000"))
    app.run(host=host, port=port, debug=True)
