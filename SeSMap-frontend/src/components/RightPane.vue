<template>
  <section class="rp-card one">
    <header class="card__title">Stepwise Analysis View</header>

    <div class="rp-card__body">
      <div class="steps-stack" ref="stackRef">
        <!-- 父卡片（一次保存） -->
        <article
          v-for="(step, i) in steps"
          :key="step.id"
          class="step-card"
        >
          <!-- 标题（一次保存一个） -->
          <div
            class="step__title"
            :data-index="i"
            @dblclick="beginEditTitle(i, $event)"
            @blur="finishEditTitle(i, $event)"
            @keydown="onTitleKey(i, $event)"
            :contenteditable="editingIdx === i ? 'plaintext-only' : 'false'"
            :title="editingIdx === i ? 'Enter to Save，Esc to Cancel' : 'Double click to Edit'"
          >
            {{ step.title || defaultTitle(step, i) }}
          </div>

          <!-- 子卡片列表：每条 link 一张（支持拖拽排序） -->
          <div class="subcards">
            <div
              v-for="(lk, j) in (step.links || [])"
              :key="lk.id || j"
              class="subcards__item"
              :style="{ height: `${lk.height || getInitialLinkHeight(lk, step.nodes || [])}px` }"
              draggable="true"
              @mousedown.capture="onCardMouseDown(i, j, $event)"
              @dragstart="onDragStart(i, j, $event)"
              @dragover="onDragOver(i, j, $event)"
              @drop="onDrop(i, j, $event)"
              @dragend="onDragEnd"
              :class="{ 'is-drag-over': dragging.to?.i === i && dragging.to?.j === j }"
            >
              <LinkCard
                :link="lk"
                :nodes="step.nodes || []"
                :panel-names-by-index="step.panelNamesByIndex || step.meta?.panelNamesByIndex || {}"
                :start-count-map="step.startCountMap"
                :colorByCountry="step.colorByCountry"
                :colorByPanelCountry="step.colorByPanelCountry"
                :normalizeCountryId="step.normalizeCountryId"
                :alpha-by-node="step.alphaByNode"
                :default-alpha="step.defaultAlpha"
                :borderColorByNode="step.borderColorByNode"  
                :borderWidthByNode="step.borderWidthByNode"  
                :fillByNode="step.fillByNode"                
                @resize-card-delta="resizeLinkByDelta(i, j, $event)"
                @close-link="closeLinkCard(i, j)"
              />
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, reactive } from 'vue'
import { onSelectionSaved, emitSummarizeSelected } from '../lib/selectionBus'
import LinkCard from './LinkCard.vue'
import { buildStartCountMap } from '@/lib/useLinkCard'

const steps = ref([])
const stackRef = ref(null)
const editingIdx = ref(-1)
const LINK_BASE_HEIGHT = 165
const LINK_PER_MSU_HEIGHT = 62
const LINK_INITIAL_VISIBLE_MSU_LIMIT = 4
const MIN_LINK_HEIGHT = 230
const MAX_LINK_HEIGHT = 900

const stepPrefix = (i) => `Step ${i + 1}`
const defaultTitle = (step, i) => {
  return `${stepPrefix(i)} · LLM synthesizing evidence...`
}

let offSaved = null
function applyPaletteToExistingSteps(palette = {}) {
  if (!steps.value.length) return
  steps.value = steps.value.map(step => ({
    ...step,
    colorByCountry: palette?.colorByCountry ?? step.colorByCountry ?? {},
    colorByPanelCountry: palette?.colorByPanelCountry ?? step.colorByPanelCountry ?? {},
    normalizeCountryId: palette?.normalizeCountryId ?? step.normalizeCountryId ?? ((x) => x),
    alphaByNode: palette?.alphaByNode ?? step.alphaByNode ?? {},
    borderColorByNode: palette?.borderColorByNode ?? step.borderColorByNode ?? {},
    borderWidthByNode: palette?.borderWidthByNode ?? step.borderWidthByNode ?? {},
    fillByNode: palette?.fillByNode ?? step.fillByNode ?? {}
  }))
}

function onSemanticColorsChange(event) {
  applyPaletteToExistingSteps(event?.detail || {})
}

onMounted(() => {
  window.addEventListener('semanticmap:colorschange', onSemanticColorsChange)
  offSaved = onSelectionSaved((payload) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const createdAt = payload.createdAt || Date.now()

    // ① 先拿 nodes / links
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : []
    const links = Array.isArray(payload.links)
      ? payload.links.map(link => ({ ...link, height: computeInitialLinkHeight(link, nodes) }))
      : []

    // ② 再分组（如果你有这一步）
    const hsus = groupHSUs(nodes, links)

    // ③ 取 mini 色板快照（多重兜底，保证拿到 fillByNode/alphaByNode）
    const palette =
      payload?.miniPalette
      || payload?.meta?.miniPalette
      || (window?.SemanticMapCtrl?.getMiniColorMaps?.() ?? null)
      || (window?.SemanticMap?.getMiniColorMaps?.() ?? null)
      || (window?.App?.getMiniColorMaps?.() ?? null)
      || (window?.App?.getSelectionSnapshot?.()?.meta?.miniPalette ?? null)

    // ④ push；优先用 palette，其次 payload，最后兜底
    const step = {
      id,
      title: defaultTitle({ createdAt }, steps.value.length),
      titleTouched: false,
      titleLoading: true,
      createdAt,
      nodes,
      links,
      panelNamesByIndex: payload.panelNamesByIndex || payload.meta?.panelNamesByIndex || {},
      startCountMap: buildStartCountMap(links),

      colorByCountry:      palette?.colorByCountry      ?? payload.colorByCountry      ?? {},
      colorByPanelCountry: palette?.colorByPanelCountry ?? payload.colorByPanelCountry ?? {},
      normalizeCountryId:  palette?.normalizeCountryId  ?? payload.normalizeCountryId  ?? ((x)=>x),

      // 这里直接吃 mini 色板里的 alphaByNode / fillByNode（它已经包含冲突区逐点覆盖）
      alphaByNode:         palette?.alphaByNode         ?? payload.alphaByNode         ?? {},
      borderColorByNode:   palette?.borderColorByNode   ?? payload.borderColorByNode   ?? {},
      borderWidthByNode:   palette?.borderWidthByNode   ?? payload.borderWidthByNode   ?? {},
      fillByNode:          palette?.fillByNode          ?? payload.fillByNode          ?? {},

      hsus,
      rawText: payload.rawText || '',
      summary: payload.summary || '',
      meta: payload.meta || {}
    }
    steps.value.push(step)
    generateStepTitle(step, steps.value.length - 1)
  })
})


onBeforeUnmount(() => {
  window.removeEventListener('semanticmap:colorschange', onSemanticColorsChange)
  offSaved?.()
})

function clampLinkHeight(v) {
  return Math.max(MIN_LINK_HEIGHT, Math.min(MAX_LINK_HEIGHT, Number(v) || MIN_LINK_HEIGHT))
}

function countLinkMsus(link, nodes) {
  if (!link || !Array.isArray(link.path) || !Array.isArray(nodes)) return 0
  const nodeMap = new Map()
  nodes.forEach(node => nodeMap.set(`${node.panelIdx}:${node.q},${node.r}`, node))

  const seen = new Set()
  const pathKeys = Array.from(new Set(
    link.path
      .filter(point => point && Number.isFinite(Number(point.panelIdx)))
      .map(point => `${Number(point.panelIdx)}:${point.q},${point.r}`)
  ))

  pathKeys.forEach(hsuKey => {
    const node = nodeMap.get(hsuKey)
    if (Array.isArray(node?.msu) && node.msu.length) {
      node.msu.forEach((m, idx) => {
        const id = m?.MSU_id ?? m?.id ?? idx
        seen.add(`${hsuKey}#${id}`)
      })
    } else if (Array.isArray(node?.msu_ids) && node.msu_ids.length) {
      node.msu_ids.forEach((id, idx) => seen.add(`${hsuKey}#${id ?? idx}`))
    }
  })
  return seen.size
}

function computeInitialLinkHeight(link, nodes) {
  const count = Math.max(1, Math.min(LINK_INITIAL_VISIBLE_MSU_LIMIT, countLinkMsus(link, nodes)))
  return clampLinkHeight(LINK_BASE_HEIGHT + count * LINK_PER_MSU_HEIGHT)
}

function getInitialLinkHeight(link, nodes) {
  return computeInitialLinkHeight(link, nodes)
}

function normalizePanelName(name, idx) {
  const raw = String(name ?? '').trim()
  if (!raw || /^subspace\s+\d+$/i.test(raw)) return `Subspace ${idx}`
  return raw
}

function textOfMsu(msu, fallback = '') {
  if (msu == null) return fallback
  if (typeof msu === 'string') return msu
  // `sentence` is the semantic unit shown in Stepwise.  Some data sources
  // also carry a longer raw `text`/`content` field, which must stay in the
  // detail view instead of replacing the MSU sentence after re-aggregation.
  return String(msu.sentence ?? msu.text ?? msu.summary ?? msu.content ?? fallback)
}

function msuIdOf(msu, idx) {
  if (msu == null || typeof msu !== 'object') return idx + 1
  return msu.MSU_id ?? msu.msuId ?? msu.id ?? idx + 1
}

function paperOfMsu(msu, node) {
  if (msu && typeof msu === 'object') {
    return msu.paper || msu.paperLabel || msu.source || msu.paperId || msu.paper_id || msu.title || null
  }
  return node?.paper || node?.paperLabel || node?.source || node?.paperId || node?.paper_id || null
}

function resolvePanelIdxForTitlePoint(point, link, pointIdx) {
  const direct = Number(point?.panelIdx)
  if (Number.isFinite(direct)) return direct

  const type = String(link?.type || '').toLowerCase()
  if (type === 'flight') {
    const lastIdx = Array.isArray(link?.path) ? link.path.length - 1 : 0
    const endpoint =
      pointIdx === 0 ? link?.from :
      pointIdx === lastIdx ? link?.to :
      null
    const endpointIdx = Number(endpoint?.panelIdx)
    if (Number.isFinite(endpointIdx)) return endpointIdx

    const namedIdx = Number(pointIdx === 0 ? link?.panelIdxFrom : link?.panelIdxTo)
    if (Number.isFinite(namedIdx)) return namedIdx
  }

  const linkIdx = Number(link?.panelIdx)
  return Number.isFinite(linkIdx) ? linkIdx : null
}

function buildStepTitleEvidence(step) {
  const nodeMap = new Map()
  ;(step.nodes || []).forEach(node => nodeMap.set(`${node.panelIdx}:${node.q},${node.r}`, node))
  const panelNames = step.panelNamesByIndex || step.meta?.panelNamesByIndex || {}
  const pathPoints = []
  ;(step.links || []).forEach(link => {
    if (Array.isArray(link.path) && link.path.length) {
      link.path.forEach((point, pointIdx) => {
        const panelIdx = resolvePanelIdxForTitlePoint(point, link, pointIdx)
        if (panelIdx == null) return
        pathPoints.push({ ...point, panelIdx })
      })
    }
  })
  const orderedKeys = []
  const seenKeys = new Set()
  const sourcePoints = pathPoints.length
    ? pathPoints
    : (step.nodes || []).map(node => ({ panelIdx: node.panelIdx, q: node.q, r: node.r }))

  sourcePoints.forEach(point => {
    const panelIdx = Number(point.panelIdx)
    if (!Number.isFinite(panelIdx)) return
    const key = `${panelIdx}:${point.q},${point.r}`
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      orderedKeys.push(key)
    }
  })

  const lines = []
  orderedKeys.forEach(key => {
    const node = nodeMap.get(key)
    if (!node) return
    const subspace = normalizePanelName(panelNames[node.panelIdx], node.panelIdx)
    const msus = Array.isArray(node.msu) && node.msu.length
      ? node.msu
      : (Array.isArray(node.msu_ids) ? node.msu_ids : [])
    msus.slice(0, 3).forEach((msu, idx) => {
      const text = textOfMsu(msu, String(msu)).trim()
      if (!text) return
      const paper = paperOfMsu(msu, node)
      const source = paper ? ` | Paper: ${paper}` : ''
      lines.push(`- ${subspace}${source} | MSU ${msuIdOf(msu, idx)}: ${text}`)
    })
  })
  return lines.slice(0, 14).join('\n')
}

function cleanGeneratedStepTitle(raw, stepIdx) {
  let text = String(raw || '').trim()
  text = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    const obj = JSON.parse(text)
    text = obj.title || obj.StepTitle || obj.stepTitle || obj.RouteSummary || obj.routeSummary || obj.summary || obj.text || text
  } catch {}
  text = String(text || '')
    .replace(/^\s*(title|stepTitle|RouteSummary|summary)\s*[:：]\s*/i, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/^\s*step\s*\d+\s*[·:：-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) text = 'Selected evidence synthesis'
  if (text.length > 90) text = `${text.slice(0, 87).trim()}...`
  return `${stepPrefix(stepIdx)} · ${text}`
}

async function generateStepTitle(step, stepIdx) {
  const evidence = buildStepTitleEvidence(step)
  if (!evidence) {
    step.title = `${stepPrefix(stepIdx)} · Selected semantic evidence`
    step.titleLoading = false
    return
  }

  const prompt = `
Create a concise editable title for a saved Stepwise Analysis step.

Rules:
- Use only the evidence below.
- Summarize the user's saved evidence selection, not the UI action or route type.
- Mention the main technical topic or evidence relationship.
- For cross-subspace selections, capture the conceptual transition instead of describing path geometry.
- Return one short English phrase, 6-14 words.
- Do not include "Step", "flight", "road", "river", HSU/MSU ids, coordinates, timestamps, markdown, bullets, JSON, or quotation marks.
- Output plain text only.

Evidence:
${evidence}
  `.trim()

  try {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: prompt, task: 'step_title' })
    })
    if (!res.ok) throw new Error(await res.text().catch(() => `API request failed (${res.status})`))
    const text = (await res.text()).trim()
    const idx = steps.value.findIndex(s => s.id === step.id)
    if (idx < 0) return
    const current = steps.value[idx]
    current.titleLoading = false
    if (!current.titleTouched) current.title = cleanGeneratedStepTitle(text, idx)
  } catch (err) {
    console.error('[Stepwise] title generation failed:', err)
    const idx = steps.value.findIndex(s => s.id === step.id)
    if (idx >= 0) {
      steps.value[idx].titleLoading = false
      if (!steps.value[idx].titleTouched) {
        steps.value[idx].title = `${stepPrefix(idx)} · Selected semantic evidence`
      }
    }
  }
}

function resizeLinkByDelta(stepIdx, linkIdx, delta) {
  const step = steps.value[stepIdx]
  const link = step?.links?.[linkIdx]
  const amount = Number(delta) || 0
  if (!link || !amount) return
  const base = link.height || getInitialLinkHeight(link, step.nodes || [])
  link.height = clampLinkHeight(base + amount)
}

function nodesForLink(link, nodes = []) {
  const wanted = new Set()
  ;(link?.path || []).forEach(point => {
    if (point && Number.isFinite(Number(point.panelIdx))) {
      wanted.add(`${Number(point.panelIdx)}:${point.q},${point.r}`)
    }
  })
  if (link?.from) wanted.add(`${Number(link.from.panelIdx)}:${link.from.q},${link.from.r}`)
  if (link?.to) wanted.add(`${Number(link.to.panelIdx)}:${link.to.q},${link.to.r}`)
  return (nodes || []).filter(node => wanted.has(`${Number(node.panelIdx)}:${node.q},${node.r}`))
}

function closeLinkCard(stepIdx, linkIdx) {
  const step = steps.value[stepIdx]
  const link = step?.links?.[linkIdx]
  if (!step || !link) return

  const nodes = nodesForLink(link, step.nodes || [])
  window.SemanticMapCtrl?.releaseSelectionSnapshot?.({ nodes, links: [link] })

  step.links.splice(linkIdx, 1)
  step.startCountMap = buildStartCountMap(step.links)
  if (!step.links.length) {
    steps.value.splice(stepIdx, 1)
  }
}

/**
 * 将上游 payload 里的透明度信息整理成  Map("panelIdx:q,r" -> alpha)
 * 兼容几种可能的来源：
 *  - payload.alphaByNode:        { "p:q,r": a, ... } 或 Map
 *  - payload.alphaByKey:         { "p|q,r": a, ... } 或 Map（来自 semanticMap 的 alphaByKey）
 *  - payload.colorOverridesByPanel: Map(panelIdx -> Map(countryId -> { alphaByKey: Map(...) }))
 */
function buildAlphaByNode(payload, nodes) {
  const out = new Map();
  const idOf = (p,q,r) => `${p}:${q},${r}`;

  // ① 直接给了 alphaByNode（最优先）
  const abn = payload?.alphaByNode;
  if (abn instanceof Map) {
    abn.forEach((a, k) => out.set(String(k), Number(a)));
    return out;
  }
  if (abn && typeof abn === 'object') {
    Object.keys(abn).forEach(k => out.set(String(k), Number(abn[k])));
    return out;
  }

  // ② 给了 alphaByKey（"p|q,r" -> alpha），把分隔符转换一下
  const abk = payload?.alphaByKey;
  if (abk instanceof Map) {
    abk.forEach((a, key) => {
      const [pStr, qr] = String(key).split('|');
      if (!qr) return;
      const [qStr, rStr] = qr.split(',');
      out.set(idOf(+pStr, +qStr, +rStr), Number(a));
    });
    return out;
  }
  if (abk && typeof abk === 'object') {
    Object.keys(abk).forEach(key => {
      const [pStr, qr] = String(key).split('|');
      if (!qr) return;
      const [qStr, rStr] = qr.split(',');
      out.set(idOf(+pStr, +qStr, +rStr), Number(abk[key]));
    });
    return out;
  }

  // ③ 从 colorOverridesByPanel 深挖（semanticMap 内部结构）
  const cop = payload?.colorOverridesByPanel; // 可能是 Map 或对象
  const forEachKV = (mapLike, fn) => {
    if (!mapLike) return;
    if (mapLike instanceof Map) { mapLike.forEach(fn); return; }
    if (typeof mapLike === 'object') { Object.keys(mapLike).forEach(k => fn(mapLike[k], k)); }
  };
  forEachKV(cop, (byCountry, panelIdxKey) => {
    const pIdx = Number(panelIdxKey);
    forEachKV(byCountry, (ov) => {
      const alphaByKey = ov?.alphaByKey;
      if (!alphaByKey) return;
      forEachKV(alphaByKey, (a, key) => {
        const [pStr, qr] = String(key).split('|'); // "p|q,r"
        if (!qr) return;
        const [qStr, rStr] = qr.split(',');
        if (+pStr !== pIdx) return;
        out.set(idOf(pIdx, +qStr, +rStr), Number(a));
      });
    });
  });

  // ④ 兜底：如果完全拿不到透明度，给已存在节点一个默认 1（可按需改）
  if (out.size === 0 && Array.isArray(nodes)) {
    nodes.forEach(n => out.set(idOf(n.panelIdx, n.q, n.r), 1));
  }
  return out;
}

/** ====== 标题编辑 ====== */
function beginEditTitle(i, evt) {
  editingIdx.value = i
  if (steps.value[i]) steps.value[i].titleTouched = true
  const el = evt.currentTarget
  if (!el) return
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()
  sel.removeAllRanges(); sel.addRange(range)
}
function finishEditTitle(i, evt) {
  if (editingIdx.value !== i) return
  const el = evt.currentTarget
  if (!el) { editingIdx.value = -1; return }
  const txt = (el.textContent || '').trim()
  steps.value[i].title = txt || ''
  steps.value[i].titleTouched = true
  editingIdx.value = -1
}
function onTitleKey(i, evt) {
  if (editingIdx.value !== i) return
  if (evt.key === 'Enter') {
    evt.preventDefault()
    evt.currentTarget?.blur()
  } else if (evt.key === 'Escape') {
    evt.preventDefault()
    const el = evt.currentTarget
    if (el) el.textContent = steps.value[i].title || defaultTitle(steps.value[i], i)
    editingIdx.value = -1
  }
}

/** ====== 子卡片拖拽换序（每个 Step 内） ====== */
const dragging = reactive({ from: null, to: null, selectionOrigin: null });

function isEvidenceSynthesisTarget(target) {
  return Boolean(target?.closest?.('.section-resize-handle, .subcard__llm'))
}

function onCardMouseDown(stepIdx, linkIdx, e) {
  // A draggable ancestor may become the dragstart target even when the user
  // began the gesture on its descendant. Remember the origin before that can
  // happen so selecting text in Evidence Synthesis never starts card sorting.
  dragging.selectionOrigin = isEvidenceSynthesisTarget(e.target)
    ? { i: stepIdx, j: linkIdx }
    : null
}

function hasEvidenceSynthesisSelection() {
  const selection = window.getSelection?.()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return false
  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer
  const element = container.nodeType === Node.ELEMENT_NODE
    ? container
    : container.parentElement
  return isEvidenceSynthesisTarget(element)
}

function onDragStart(stepIdx, linkIdx, e) {
  // The Evidence Synthesis area deliberately supports drag-to-select text.
  // Never turn that gesture into a native drag of the whole saved card.
  const startedInEvidence = dragging.selectionOrigin?.i === stepIdx
    && dragging.selectionOrigin?.j === linkIdx
  if (startedInEvidence || isEvidenceSynthesisTarget(e.target) || hasEvidenceSynthesisSelection()) {
    e.preventDefault()
    dragging.selectionOrigin = null
    return
  }
  dragging.from = { i: stepIdx, j: linkIdx };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', `${stepIdx}:${linkIdx}`);
}
function onDragOver(stepIdx, linkIdx, e) {
  e.preventDefault(); // 允许 drop
  if (!dragging.from) return;
  dragging.to = { i: stepIdx, j: linkIdx };
}
function onDrop(stepIdx, linkIdx, e) {
  e.preventDefault();
  const src = dragging.from; if (!src) return;
  // 仅支持“同一个 Step 内”换序
  if (src.i === stepIdx) {
    const arr = steps.value[stepIdx].links;
    const item = arr.splice(src.j, 1)[0];
    arr.splice(linkIdx, 0, item);
    // 顺带更新 startCountMap（起点次序不影响计数，但安全起见保持一致）
    steps.value[stepIdx].startCountMap = buildStartCountMap(arr);
  }
  dragging.from = dragging.to = null;
}
function onDragEnd() {
  dragging.from = dragging.to = dragging.selectionOrigin = null
}
 /** ========== NEW：按 HSU 分组   路径排序 ========== */
 function groupHSUs(nodes, links) {
   const keyOf = (n) => `${n.panelIdx}|${n.q},${n.r}`
   const map = new Map() // key -> { key, panelIdx,q,r,country_id, msus:[{id,text,checked}] }
   ;(nodes || []).forEach(n => {
     const k = keyOf(n)
     if (!map.has(k)) {
       map.set(k, { key: k, panelIdx: n.panelIdx, q: n.q, r: n.r, country_id: n.country_id ?? null, msus: [] })
     }
     const bucket = map.get(k)
     // 兼容两种：n.msu 或 n.msu_ids（无文本时用 id 兜底字符串）
     if (Array.isArray(n.msu) && n.msu.length) {
       n.msu.forEach((m, idx) => bucket.msus.push({
         id: m.MSU_id ?? m.msuId ?? m.id ?? `${k}#${idx}`,
         text: (m.sentence ?? m.text ?? m.summary ?? String(m.MSU_id ?? m.id ?? idx)).toString(),
         checked: false
       }))
     } else if (Array.isArray(n.msu_ids) && n.msu_ids.length) {
       n.msu_ids.forEach((mid, idx) => bucket.msus.push({
         id: mid ?? `${k}#${idx}`,
         text: String(mid ?? `${k}#${idx}`),
         checked: false
       }))
     }
   })
   // 路径顺序（取第一条 link 的 path 为序）
   const first = Array.isArray(links) && links[0]
   const pathOrder = []
   if (first && Array.isArray(first.path)) {
     first.path.forEach(p => pathOrder.push(`${p.panelIdx}|${p.q},${p.r}`))
   }
   const keys = Array.from(map.keys())
   keys.sort((a, b) => {
     const ia = pathOrder.indexOf(a), ib = pathOrder.indexOf(b)
     if (ia >= 0 && ib >= 0) return ia - ib
     if (ia >= 0) return -1
     if (ib >= 0) return 1
     // 无路径：按 panelIdx -> q -> r 稳定排序
     const [pa, qa, ra] = a.split(/[|,]/).map(Number)
     const [pb, qb, rb] = b.split(/[|,]/).map(Number)
     if (pa !== pb) return pa - pb
     if (qa !== qb) return qa - qb
     return ra - rb
   })
   return keys.map(k => map.get(k))
 }
 
 /** ========== NEW：收集勾选 MSU -> 发起“总结请求” ========== */
 function summarizeStep(stepIdx) {
   const s = steps.value[stepIdx]
   if (!s) return
   const selectedTexts = []
   ;(s.hsus || []).forEach(h => (h.msus || []).forEach(m => {
     if (m.checked && m.text) selectedTexts.push(m.text)
   }))
   // 右侧不直接调大模型；只发“总结请求”事件，交给上游处理
   emitSummarizeSelected({
     stepId: s.id,
     title: s.title,
     nodes: s.hsus,         // 携带结构，便于上游溯源
     selectedTexts
   })
 }


</script>

<style scoped>
.rp-card.one{ height:100%; background:#fff; border-radius:12px;
  display:flex; flex-direction:column; min-height:0; overflow:hidden; }
.rp-card__body{ padding:6px; min-height:0; overflow:auto; }

.steps-stack{ width:100%; height:100%; overflow:auto; min-height:0; scrollbar-width: none; }
.steps-stack::-webkit-scrollbar{ width:0; height:0; }

.step-card{
  border:1px solid #e5e7eb; border-radius:10px;
  padding:6px; margin-bottom:10px;
  position:relative;
  display:grid; gap:4px;
  grid-template-rows: auto auto;
  background:#fff;
  overflow:visible;
}
.step__title{
  font-weight:600; font-size:12px; line-height:1; padding:6px 6px; border-radius:8px;
  background:#f9fafb; user-select:text; cursor:text;
  outline:none; border:1px dashed transparent;
}
.step__title[contenteditable="plaintext-only"]{ border-color:#c7d2fe; background:#eef2ff; }

/* 子卡片区 + 拖拽态 */
.subcards{
  display:flex;
  flex-direction:column;
  gap:10px;
  min-height:0;
  overflow:visible;
  scrollbar-width:none;
}
.subcards::-webkit-scrollbar{ width:0; height:0; }
.subcards__item{
  border-radius:10px;
  display:grid;
  grid-template-rows:minmax(0, 1fr);
  min-height:230px;
  overflow:hidden;
}
.subcards__item > :deep(.subcard){
  height:100%;
  min-height:0;
}
.subcards__item.is-drag-over{ outline:2px dashed #93c5fd; outline-offset:2px; }
</style>
