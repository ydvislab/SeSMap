import './commandRouter.js';

// === 当前激活的语义图 case（后端的 case1/case2/case3/v7） ===
export function getActiveProjectId() {
  return window.__activeProjectId || null;   // 可能是 "case1" / "case2" / "case3" / "v7" / null
}

export function setActiveProjectId(pid) {
  if (pid === 'case1' || pid === 'case2' || pid === 'case3' || pid === 'v7') {
    window.__activeProjectId = pid;
  } else if (!pid) {
    window.__activeProjectId = null;
  }
}

export async function fetchSemanticMap(projectId) {
  // 如果调用方没传，就用当前激活的 projectId（case1/2/3/v7）
  const pid = projectId || getActiveProjectId();
  const qs = pid ? `?project_id=${encodeURIComponent(pid)}` : '';
  const res = await fetch(`/api/semantic-map${qs}`);
  if (!res.ok) throw new Error('Failed to load semantic map');
  return res.json();
}

export async function createSubspace(payload) {
  const pid = (payload && payload.project_id) || getActiveProjectId();
  const body = { ...(payload || {}) };
  if (pid) body.project_id = pid;   // ★ 自动带当前 case

  const res = await fetch('/api/subspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Failed to create subspace');
  return res.json();
}


export async function renameSubspace(idx, name) {
  const pid = getActiveProjectId();
  const body = { subspaceName: name };
  if (pid) body.project_id = pid;   // ★ 带上当前 case

  const res = await fetch(`/api/subspaces/${idx}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Failed to rename subspace');
  return res.json();
}


export async function renameMapTitle(newTitle){
  // 按你的真实 API 调整 URL / method / body
  await fetch('/api/semantic-map/title', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ title: newTitle })
  })
}

export async function sendQueryToLLM(query, llm = 'ChatGPT', opts = {}) {
  const body = {
    query,
    // 允许前端把最近几轮 messages 直接传给后端
    messages: Array.isArray(opts.messages) ? opts.messages : undefined,
    task: opts.task || undefined
  };
  if (opts.model) body.model = opts.model;

  const res = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  const ct = res.headers.get('content-type') || '';

  // --- JSON 返回：可能是 RAG / subspace-control / error 等 ---
  if (ct.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.payload?.message || data?.error || 'Request failed';
      throw new Error(msg);
    }

    // ⭐ 新增：若是“子空间显隐”模式，直接路由并返回一个轻量结果
    if (data?.mode === 'subspace/control') {
      const cmd = data?.payload?.text || data?.payload?.command || '';
      let projectId = data?.payload?.project_id || null;

      // ========= ① 如果后端没给 project_id，就从用户原始 query 里解析 =========
      if (!projectId && typeof query === 'string') {
        if (/\b(?:case\s*)?v7\b/i.test(query)) {
          projectId = 'v7';
        }
        // 支持 "case 1" / "Case1" / "case 2" 等写法
        const m = query.match(/case\s*([123])/i);
        if (!projectId && m) {
          projectId = `case${m[1]}`;
        }
      }

      // ========= ② 解析到了 case，就更新全局状态 + 通知 MainView =========
      if (projectId) {
        console.log('[sendQueryToLLM] detected projectId from query:', projectId);
        setActiveProjectId(projectId);
        if (cmd) {
          window.__pendingSubspaceCmds = window.__pendingSubspaceCmds || [];
          window.__pendingSubspaceCmds.push(cmd);
        }

        try {
          window.dispatchEvent(new CustomEvent('semantic-map:project-changed', {
            detail: { projectId }
          }));
        } catch (e) {
          console.warn('[sendQueryToLLM] dispatch project-changed failed:', e);
        }
      } else {
        console.log('[sendQueryToLLM] no projectId detected, keep current case.');
      }

      if (projectId) {
        return { mode: 'subspace/control', ok: true, command: cmd, projectId };
      }

      // ⭐ 如果路由器还没在 window 上，先动态导入一遍（副作用执行）
      if (!window.CommandRouter) {
        try {
          await import('./commandRouter.js');  // 路径同上
        } catch (e) {
          console.warn('[sendQueryToLLM] lazy-load commandRouter failed:', e);
        }
      }

      if (window.CommandRouter && window.SemanticMapCtrl && cmd) {
        try {
          window.CommandRouter.routeCommand(window.SemanticMapCtrl, cmd);
        } catch (err) {
          console.error('[sendQueryToLLM] subspace/control route error:', err);
        }
      } else {
        // 地图或路由器还没就绪：排队，commandRouter 会在 semanticMap:ready 时冲掉
        window.__pendingSubspaceCmds = window.__pendingSubspaceCmds || [];
        window.__pendingSubspaceCmds.push(cmd);
        console.warn('[sendQueryToLLM] subspace/control missing router/ctrl/cmd', {
          cmd,
          hasCtrl: !!window.SemanticMapCtrl,
          hasRouter: !!window.CommandRouter
        });
      }

      return { mode: 'subspace/control', ok: true, command: cmd, projectId };
    }

    // 其他 JSON：直接返回给上层 interpretLLMResponse 使用
    return data;
  }

  // --- 纯文本返回（plain chat） ---
  const text = await res.text();
  if (!res.ok) throw new Error(text || 'Request failed');
  return text; // ✅ 直接返回纯文本答案
}


const cleanSubspaceName = (name, idx) => {
  const raw = String(name || '').trim();
  if (!raw || /^subspace\s+\d+$/i.test(raw)) return `Unnamed Subspace ${idx}`;
  return raw;
};

const paperLabelOf = (item) =>
  item?.paper || item?.paperLabel || item?.source || item?.paperId || 'Unknown paper';

// 保存到 Stepwise 的 link.type 决定这次选择到底是什么形状：
//   single      -> 单个 HSU，没有任何走向可言
//   flight      -> 用户自己连出来的跨子空间航线（论文里提出的 Flight）
//   road/river  -> 数据自带的连线，被选中的是其中一段，不能叫 Flight
const TRAVERSAL_TERMS = { flight: 'Flight' };

function describeSelectionShape(hops, context = {}) {
  const linkType = String(context.linkType || '').toLowerCase();

  const hsuKeys = [];
  const subspaces = [];
  const papers = [];
  let msuCount = 0;

  hops.forEach(hop => {
    if (hop.hsu && !hsuKeys.includes(hop.hsu)) hsuKeys.push(hop.hsu);
    const name = cleanSubspaceName(hop.subspace, hop.panelIdx);
    if (!subspaces.includes(name)) subspaces.push(name);
    const evidence = Array.isArray(hop.evidence) && hop.evidence.length
      ? hop.evidence
      : (hop.sentences || []).map(text => ({ text }));
    msuCount += evidence.length;
    evidence.forEach(item => {
      const paper = paperLabelOf(item);
      if (!papers.includes(paper)) papers.push(paper);
    });
  });

  const hsuCount = hsuKeys.length || hops.length;
  // 只有真正跨了 2 个以上 HSU 才算“走过一段”，link.type 为 single 时永远不算
  const isTraversal = hsuCount > 1 && linkType !== 'single';

  return {
    linkType,
    hsuCount,
    msuCount,
    subspaces,
    papers,
    isTraversal,
    // 只有用户连出来的航线才配叫 Flight，其余一律用中性说法
    traversalTerm: isTraversal ? (TRAVERSAL_TERMS[linkType] || null) : null,
    crossSubspace: subspaces.length > 1,
    multiPaper: papers.length > 1
  };
}

// 根据选择形状给出“这次到底该写什么”的指令，避免单点也被写成一条路径
function buildShapeInstructions(shape) {
  const lines = [];
  const subject = shape.traversalTerm ? `the selected ${shape.traversalTerm}` : 'the selected evidence';

  if (!shape.isTraversal) {
    const where = shape.subspaces[0] ? `the "${shape.subspaces[0]}" subspace` : 'one subspace';
    lines.push(`- TOPOLOGY: the user selected ONE HSU in ${where}. There is no Flight, no traversal, no ordering, and no direction.`);
    lines.push('- Describe what this single semantic neighborhood actually contains: its topic plus the specific methods, configurations, measurements, or findings carried by the selected MSUs.');
    lines.push('- Explain how the selected MSUs relate to one another inside this HSU (elaboration, precondition, cause and effect, method and result, or contrast).');
    lines.push('- Never describe the selection as a "path", "route", "flight", "trajectory", "journey", "steps", "hops", "moves", "traverses", "starts from", or "leads to". Nothing was traversed.');
  } else if (shape.traversalTerm) {
    lines.push(`- TOPOLOGY: the user drew a ${shape.traversalTerm} over ${shape.hsuCount} HSUs. The hops below are in the order the user connected them.`);
    lines.push(`- Call it "the selected ${shape.traversalTerm}". Never call it a path, route, trajectory, chain, or line.`);
    lines.push(`- Follow the ${shape.traversalTerm} order to show how the focus develops, but synthesize; do not narrate every hop one by one.`);
  } else {
    lines.push(`- TOPOLOGY: the user selected ${shape.hsuCount} connected HSUs. This is an existing connection in the map, not a user-drawn Flight.`);
    lines.push('- Call it "the selected evidence". Never call it a path, route, flight, trajectory, or journey.');
    lines.push('- Describe what the connected HSUs jointly cover and how their content differs, without narrating movement between them.');
  }

  if (shape.isTraversal) {
    lines.push(shape.crossSubspace
      ? `- The selection crosses ${shape.subspaces.length} subspaces (${shape.subspaces.map(n => `"${n}"`).join(' -> ')}). Say what each named subspace contributes and how the focus shifts between them.`
      : `- The selection stays inside one subspace ("${shape.subspaces[0]}"). Do not claim any cross-subspace transition; compare the HSUs within that one subspace instead.`);
  } else if (shape.crossSubspace) {
    lines.push(`- The selected MSUs carry more than one subspace label (${shape.subspaces.map(n => `"${n}"`).join(', ')}). Name them, but do not turn that into a transition story.`);
  }

  if (shape.multiPaper) {
    lines.push(`- PROVENANCE: ${shape.papers.length} papers are represented (${shape.papers.map(n => `"${n}"`).join(', ')}). State what each paper contributes and whether their evidence is similar, complementary, or divergent.`);
    lines.push('- Preserve source boundaries: never merge claims from different papers into one statement, and never attribute one paper\'s finding to another.');
    if (!shape.isTraversal) {
      lines.push('- Because several papers land in the same HSU, explain what makes them semantically adjacent here.');
    }
  } else {
    lines.push(`- PROVENANCE: all selected MSUs come from a single paper ("${shape.papers[0] || 'Unknown paper'}"). Do not compare papers, do not imply a second source, and do not mention that only one paper is present.`);
    lines.push('- Instead, show how that paper\'s own evidence develops across the selected MSUs.');
  }

  return lines.join('\n');
}

function targetWordRange(shape) {
  if (!shape.isTraversal) return shape.msuCount <= 2 ? '45-75 words' : '60-100 words';
  return shape.crossSubspace || shape.multiPaper ? '90-140 words' : '70-110 words';
}

// 新增：总结MSU句子的函数（修正版：不再用 task:'subspace'）
// context: { linkType: 'single'|'flight'|'road'|'river', ... } 由 LinkCard 按当前卡片的 link 传入
export async function summarizeMsuSentences(hopsOrGroups, context = {}) {
  // ---------- 规范化 hops ----------
  const normalize = (arr) => {
    const hasHopShape = arr?.some(x => 'step' in x || 'panelIdx' in x || 'subspace' in x);
    if (hasHopShape) {
      return [...arr]
        .filter(x => Array.isArray(x.sentences) && x.sentences.length > 0)
        .sort((a, b) => (a.step || 1) - (b.step || 1))
        .map(x => ({
          step: x.step ?? 0,
          hsu: x.hsu,
          panelIdx: x.panelIdx,
          subspace: x.subspace || `Subspace ${x.panelIdx}`,
          evidence: Array.isArray(x.evidence) ? x.evidence : null,
          sentences: x.sentences
        }));
    }
    return (arr || []).map((g, i) => ({
      step: i + 1,
      hsu: g.hsu,
      panelIdx: Number(String(g.hsu).split(':')[0] || 0),
      subspace: `Subspace ${Number(String(g.hsu).split(':')[0] || 0)}`,
      evidence: Array.isArray(g.evidence) ? g.evidence : null,
      sentences: g.sentences || []
    }));
  };
  const hops = normalize(hopsOrGroups);
  const shape = describeSelectionShape(hops, context);

  // ---------- Legend & Ordered Hops ----------
  const legendMap = new Map();
  hops.forEach(h => {
    const name = cleanSubspaceName(h.subspace, h.panelIdx);
    if (!legendMap.has(h.panelIdx)) legendMap.set(h.panelIdx, name);
  });
  const legendLines = Array.from(legendMap.entries())
    .sort((a,b) => a[0]-b[0])
    .map(([idx, name]) => `- panelIdx ${idx} → "${name}"`)
    .join('\n');

  const formatEvidence = (h) => {
    const evidence = Array.isArray(h.evidence) && h.evidence.length
      ? h.evidence
      : (h.sentences || []).map((text, i) => ({ msuId: i + 1, text, paper: 'Unknown paper', paperId: 'unknown' }));
    return evidence.map(item => {
      const paper = item.paper || item.paperLabel || item.source || item.paperId || 'Unknown paper';
      const msuId = item.msuId ?? item.id ?? '?';
      const category = item.category ? ` | Category ${item.category}` : '';
      return `- Paper "${paper}" | MSU ${msuId}${category}: ${item.text || item.sentence || item}`;
    });
  };

  const paperMap = new Map();
  hops.forEach(h => {
    const evidence = Array.isArray(h.evidence) && h.evidence.length
      ? h.evidence
      : (h.sentences || []).map(text => ({ text, paper: 'Unknown paper' }));
    evidence.forEach(item => {
      const paper = item.paper || item.paperLabel || item.source || item.paperId || 'Unknown paper';
      if (!paperMap.has(paper)) paperMap.set(paper, []);
      paperMap.get(paper).push({
        subspace: cleanSubspaceName(h.subspace, h.panelIdx),
        hsu: h.hsu,
        msuId: item.msuId ?? item.id ?? '?',
        text: item.text || item.sentence || String(item)
      });
    });
  });
  const paperBlock = Array.from(paperMap.entries()).map(([paper, items]) => {
    const lines = items.map(item => `  - ${item.subspace} / HSU ${item.hsu} / MSU ${item.msuId}: ${item.text}`);
    return `Paper "${paper}":\n${lines.join('\n')}`;
  }).join('\n\n');

  const hopsBlock = hops
    .sort((a,b) => (a.step||0) - (b.step||0))
    .map(h => [
      // 单点选择没有先后可言，标题里就不要出现 Step，免得模型编出一段行程
      `${shape.isTraversal ? `Hop ${h.step} | ` : ''}HSU ${h.hsu} | Subspace "${cleanSubspaceName(h.subspace, h.panelIdx)}" (panelIdx ${h.panelIdx}):`,
      ...formatEvidence(h)
    ].join('\n'))
    .join('\n\n');

  const shapeBlock = [
    `- selection_kind: ${shape.isTraversal ? (shape.traversalTerm ? 'user-drawn Flight' : 'connected HSUs') : 'single HSU'}`,
    `- hsu_count: ${shape.hsuCount}`,
    `- selected_msu_count: ${shape.msuCount}`,
    `- subspaces: ${shape.subspaces.map(n => `"${n}"`).join(', ') || '(none)'}`,
    `- papers: ${shape.papers.map(n => `"${n}"`).join(', ') || '(none)'}`
  ].join('\n');

  // ---------- 提示词：按选择形状分支 + 只返回 EvidenceSummary ----------
  const shapeInstructions = buildShapeInstructions(shape);
  const wordRange = targetWordRange(shape);

  const prompt = `
You are summarizing a saved selection from a SeSMap semantic subspace map.
Papers are laid out as regions, MSUs are minimal semantic units, and an HSU is one aggregated cell of MSUs.
A Flight is a connection the user draws between HSUs; it is the only thing that may be called a Flight.

SELECTION SHAPE (ground truth - never contradict this)
${shapeBlock}

WHAT THIS SELECTION IS, AND WHAT TO WRITE
${shapeInstructions}

CONTENT RULES (Strict)
1) Evidence-only: use ONLY facts, terms, and subspace names from the MSUs or LEGEND. Never add outside knowledge.
2) Use the exact subspace display names from LEGEND, such as "Background", "Method", "Experiment", "Result", or "Conclusion" when present.
3) Never name the internal containers or ids: no "HSU", "MSU", "cell", "node", "neighborhood", "Subspace 0", "panelIdx", coordinates, or numeric ids. Write about the evidence, not the structure that holds it.
   Incorrect: "The selected HSU in the 'method' subspace combines evidence from two papers."
   Correct:   "Within the method subspace, two papers converge on fuel injection strategies."
4) Never describe the UI, the selection gesture, the map, or the act of selecting. Describe the evidence.
5) Preserve domain terms, named methods, datasets, metrics, and measurements exactly as written in the MSUs. A banned word inside a domain term stays (for example "trajectory-based visualization" is a method name, not a description of the selection).
6) No meta or filler: avoid "overall", "in summary", "the text says", "this suggests", "it highlights", "it indicates", "the selection shows".
7) One paragraph, coherent and neutral. No bullets, no markdown, no code fences.

LEGEND (panel index -> subspace name):
${legendLines || '(none)'}

EVIDENCE GROUPED BY PAPER/SOURCE:
${paperBlock || '(none)'}

${shape.isTraversal ? 'ORDERED HOPS (do not reorder; source of truth):' : 'SELECTED EVIDENCE (source of truth):'}
${hopsBlock || '(none)'}

OUTPUT FORMAT (Very Important)
- Return a SINGLE JSON object with EXACTLY ONE key: "EvidenceSummary".
- The value must be a compact paragraph of ${wordRange} (no bullets, no markdown, no code fences, no extra text).

REQUIRED OUTPUT:
{"EvidenceSummary": "<${wordRange}; evidence-based paragraph that matches the SELECTION SHAPE above>"}
  `.trim();

  // ---------- 请求（改动点：task 用 'literature'；按内容类型分流） ----------
  try {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        query: prompt,
        task: 'msu_summary'     // 后端会使用 .env 里的 OPENAI_DEFAULT_MODEL
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(errText || `API request failed (${res.status})`);
    }

    const ct = res.headers.get('content-type') || '';

    // 如果后端万一返回了 JSON（例如其它模式），先判断是否 UI 控制
    if (ct.includes('application/json')) {
      const data = await res.json();

      // 若意外返回了 subspace/control（比如你把 prompt 改成了显隐语句）
      if (data?.mode === 'subspace/control') {
        const cmd = data?.payload?.text || data?.payload?.command || '';
        if (window.CommandRouter && window.SemanticMapCtrl && cmd) {
          window.CommandRouter.routeCommand(window.SemanticMapCtrl, cmd);
        }
        return ''; // 不把控制指令当摘要展示
      }

      // 其它 JSON（如 rag/index 等）——这里不是本函数关注点，直接字符串化返回或丢空
      return typeof data === 'string' ? data : JSON.stringify(data);
    }

    // ---------- 纯文本：解析 RouteSummary ----------
    const text = (await res.text()).trim();

    const stripCodeFences = (s) =>
      s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    const tryParseRouteSummary = (raw) => {
      // 1) 去掉三引号
      let s = stripCodeFences(raw);
      // 2) 去掉常见前缀
      s = s.replace(/^\s*summary\s*:\s*/i, '').trim();
      // 3) 尝试 JSON.parse
      try {
        const obj = JSON.parse(s);
        const summaryKey = ['EvidenceSummary', 'RouteSummary'].find(
          k => typeof obj?.[k] === 'string' && obj[k].trim()
        );
        if (summaryKey) return obj[summaryKey].trim();
        if (Array.isArray(obj) && obj.length) {
          const units = obj.map(x => (typeof x?.unit === 'string' ? x.unit.trim() : '')).filter(Boolean);
          if (units.length) return units.join('; ');
        }
        const candidate = obj.summary || obj.Summary || obj.evidenceSummary || obj.routeSummary || obj.abstract || obj.text;
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        return JSON.stringify(obj);
      } catch {
        return s; // 不是 JSON，就当纯文本返回
      }
    };

    return tryParseRouteSummary(text);

  } catch (e) {
    console.error('Summary generation error:', e);
    return '';
  }
}

// === 子空间显隐：独立调用 ===
// 说明：这是“高优先级 UI 控制”专用的 API 封装。
// naturalText 例如： "show background and result subspaces"
export async function runSubspaceCommand(naturalText) {
  const res = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({
      query: naturalText,
      task: 'subspace'      // 关键：命中后端最高优先级 UI 控制分支
    })
  });

  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const msg = ct.includes('application/json') ? (await res.json())?.error : await res.text();
    throw new Error(msg || 'Subspace command failed');
  }

  if (!ct.includes('application/json')) {
    console.warn('[subspace/control] Expect JSON but got text; ignoring.');
    return false;
  }

  const data = await res.json();
  if (data?.mode === 'subspace/control') {
    const cmd = data?.payload?.text || data?.payload?.command || '';
    const projectId = data?.payload?.project_id || null;

    if (projectId) {
      // 1) 记录当前激活的 case
      setActiveProjectId(projectId);
      if (cmd) {
        window.__pendingSubspaceCmds = window.__pendingSubspaceCmds || [];
        window.__pendingSubspaceCmds.push(cmd);
      }

      // 2) 通知 MainView 重新拉对应 case 的语义图
      try {
        window.dispatchEvent(new CustomEvent('semantic-map:project-changed', {
          detail: { projectId }
        }));
      } catch (e) {
        console.warn('[runSubspaceCommand] dispatch project-changed failed:', e);
      }
      return true;
    }

    if (window.CommandRouter && window.SemanticMapCtrl && cmd) {
      try {
        window.CommandRouter.routeCommand(window.SemanticMapCtrl, cmd);
      } catch (err) {
        console.error('[subspace/control] route error:', err);
        return false;
      }
      return true;
    } else {
      console.warn('[subspace/control] Missing router/ctrl/cmd', {
        hasRouter: !!window.CommandRouter,
        hasCtrl: !!window.SemanticMapCtrl,
        cmd
      });
      return false;
    }
  }

  console.warn('[subspace/control] Unexpected response:', data);
  return false;
}


// === RAG：列项目 ===
export async function listRagProjects() {
  const res = await fetch('/api/rag/projects');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to list RAG projects');
  return data.projects; // e.g. ["case1","case2"]
}

// === RAG：为某项目构建/更新索引 ===
// rebuild=true 时强制重建；默认做增量（仅当PDF变化时重建）
export async function buildRagIndex(projectId, rebuild = false) {
  const res = await fetch('/api/rag/index', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ project_id: projectId, rebuild })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to build RAG index');
  return data; // { project_id, stats: {...} }
}

// === RAG：提问 ===
export async function askRag(projectId, question, { k = 5, mmr = false } = {}) {
  const res = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ project_id: projectId, question, k, mmr })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to query RAG');
  // data = { answer, citations: [{doc_id,page,score}], used_k }
  return data;
}

// 把 /api/query 的统一响应转成 UI 该怎么显示
export function interpretLLMResponse(envelope) {
  const { mode, payload } = envelope || {};
  switch (mode) {
    case 'chat':
      return { type: 'text', text: payload?.answer || '' };

    case 'subspace/control':
      // 已在 sendQueryToLLM 中做过实际路由，这里只回个占位结果给 UI（可选）
      return { type: 'subspace-control', text: '', command: payload?.text || payload?.command || '' };

    case 'rag/projects':
      // 展示项目列表
      return { type: 'rag-projects', projects: payload?.projects || [] };

    case 'rag/index':
      // 展示索引构建结果
      return { type: 'rag-index', projectId: payload?.project_id, stats: payload?.stats };

    case 'rag/answer':
      // 展示RAG答案 + 引用
      return {
        type: 'rag-answer',
        text: payload?.answer || '',
        citations: payload?.citations || [] // [{doc_id,page,score}]
      };

    case 'error':
      return { type: 'error', text: payload?.message || 'Unknown error' };

    default:
      // 兜底：当后端给了未知 mode
      return { type: 'raw', data: envelope };
  }
}
