#!/usr/bin/env python3
"""Dump every LLM prompt used at runtime by SeSMap, verbatim, as JSON.

docs/PROMPTS.md quotes these bodies. Re-run this after touching any prompt and
diff the output against the doc so the two cannot drift apart:

    python3 docs/extract_prompts.py > /tmp/prompts.json
"""
import ast
import io
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def read(rel):
    return io.open(ROOT / rel, encoding='utf-8').read()


def extract_static(out):
    """Prompts that are plain string literals."""
    pp = read('SeSMap-backend/prompts.py')
    for m in re.finditer(r'^([A-Z_]+)\s*=\s*"""(.*?)"""', pp, re.S | re.M):
        out['prompts.py:' + m.group(1)] = m.group(2).strip()

    ap = read('SeSMap-backend/app.py')
    pattern = r'^([A-Z_]+)\s*=\s*os\.getenv\(\s*"[A-Z_]+"\s*,\s*"""(.*?)"""\s*\)\.strip\(\)'
    for m in re.finditer(pattern, ap, re.S | re.M):
        out['app.py:' + m.group(1)] = m.group(2).strip()

    m = re.search(r'template = """(.*?)"""', read('SeSMap-backend/rag.py'), re.S)
    out['rag.py:RAG_TEMPLATE'] = m.group(1).strip()

    lp = read('SeSMap-frontend/src/components/LeftPane.vue')
    m = re.search(r'const systemPrompt = ref\(`(.*?)`\)', lp, re.S)
    out['LeftPane.vue:GLOBAL_SYSTEM_PROMPT'] = m.group(1).strip()
    m = re.search(r'function buildMsuFilterPrompt\([^)]*\) \{.*?return `(.*?)`\n\}', lp, re.S)
    out['LeftPane.vue:MSU_FILTER'] = m.group(1).strip()

    rp = read('SeSMap-frontend/src/components/RightPane.vue')
    m = re.search(r'const prompt = `\n(.*?)\n  `\.trim\(\)', rp, re.S)
    out['RightPane.vue:STEP_TITLE'] = m.group(1).strip()

    aj = read('SeSMap-frontend/src/lib/api.js')
    m = re.search(r'const prompt = `\n(.*?)\n  `\.trim\(\);', aj, re.S)
    out['api.js:EVIDENCE_SUMMARY'] = m.group(1).strip()
    m = re.search(r'function buildShapeInstructions\(shape\) \{(.*?)\n\}', aj, re.S)
    out['api.js:SHAPE_INSTRUCTIONS_SRC'] = m.group(1).strip()

    sm = read('SeSMap-frontend/src/lib/semanticMap.js')
    m = re.search(r'function buildHsuHoverPrompt.*?return `\n(.*?)\n  `\.trim\(\);', sm, re.S)
    out['semanticMap.js:HSU_HOVER'] = m.group(1).strip()
    return out


def extract_inline(out):
    """Prompts built inline from concatenated / f-string literals in app.py."""
    src = read('SeSMap-backend/app.py')
    tree = ast.parse(src)

    def render(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.JoinedStr):
            parts = []
            for v in node.values:
                if isinstance(v, ast.Constant):
                    parts.append(v.value)
                else:
                    parts.append('{' + ast.get_source_segment(src, v.value) + '}')
            return ''.join(parts)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            return render(node.left) + render(node.right)
        if isinstance(node, ast.Name):
            return '{' + node.id + '}'
        return '{' + (ast.get_source_segment(src, node) or '?') + '}'

    by_function = {
        'parse_intent_llm': 'app.py:RAG_INTENT_PARSER',
        '_condense_messages_to_summary': 'app.py:CONDENSE',
        'query_gpt': 'app.py:SUBSPACE_UI_COMMAND',
        'query_structured': 'app.py:MULTI_PAPER_RAG_TEMPLATE',
    }
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        key = by_function.get(fn.name)
        if not key:
            continue
        for node in ast.walk(fn):
            if not isinstance(node, ast.Assign):
                continue
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id in ('prompt', 'tool_prompt', 'template'):
                    text = render(node.value)
                    if isinstance(text, str) and len(text) > 200:
                        out.setdefault(key, text.strip())
    return out


def main():
    out = {}
    extract_static(out)
    extract_inline(out)

    expected = 20
    if len(out) != expected:
        print(f'warning: extracted {len(out)} prompts, expected {expected}', file=sys.stderr)
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
