import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI


BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")
# Keep credentials and provider-specific local overrides out of the shared
# configuration.  `.env.local` is gitignored and intentionally wins over
# `.env` when both define the same setting.
load_dotenv(BACKEND_DIR / ".env.local", override=True)


@dataclass(frozen=True)
class LLMConfig:
    api_key: str
    base_url: str
    default_model: str
    chat_model: str
    intent_model: str
    rag_model: str
    summary_model: str
    condense_model: str
    embedding_model: str


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name, default) or "").strip()


def load_llm_config() -> LLMConfig:
    default_model = _env("LLM_DEFAULT_MODEL") or _env("OPENAI_DEFAULT_MODEL", "gpt-4o")
    chat_model = _env("LLM_CHAT_MODEL") or _env("OPENAI_MODEL") or default_model
    return LLMConfig(
        api_key=_env("LLM_API_KEY") or _env("OPENAI_API_KEY"),
        base_url=_env("LLM_BASE_URL") or _env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        default_model=default_model,
        chat_model=chat_model,
        intent_model=_env("LLM_INTENT_MODEL") or _env("INTENT_MODEL") or chat_model,
        rag_model=_env("LLM_RAG_MODEL") or _env("RAG_MODEL") or chat_model,
        summary_model=_env("LLM_SUMMARY_MODEL") or chat_model,
        condense_model=_env("LLM_CONDENSE_MODEL") or _env("CONDENSE_MODEL") or chat_model,
        embedding_model=_env("LLM_EMBEDDING_MODEL") or _env("EMBEDDING_MODEL", "text-embedding-3-small"),
    )


LLM_CONFIG = load_llm_config()


def model_for(role: str) -> str:
    role_map = {
        "default": LLM_CONFIG.default_model,
        "chat": LLM_CONFIG.chat_model,
        "intent": LLM_CONFIG.intent_model,
        "rag": LLM_CONFIG.rag_model,
        "summary": LLM_CONFIG.summary_model,
        "condense": LLM_CONFIG.condense_model,
        "embedding": LLM_CONFIG.embedding_model,
    }
    return role_map.get(role, LLM_CONFIG.default_model)


def get_openai_client() -> OpenAI:
    if not LLM_CONFIG.api_key:
        raise RuntimeError("Missing LLM_API_KEY or OPENAI_API_KEY in SeSMap-backend/.env")
    return OpenAI(api_key=LLM_CONFIG.api_key, base_url=LLM_CONFIG.base_url)
