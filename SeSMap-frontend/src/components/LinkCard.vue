<!-- src/components/LinkCard.vue -->
<template>
  <section class="subcard" :class="{ 'expanded': showOriginal }">
    <!-- ⓪ Subspace(s) 标签 -->
    <div class="subcard__meta" v-if="subspaceTrail.length > 0">
      <div class="subcard__meta-main">
        <span class="meta-label">{{ subspaceTrail.length > 1 ? 'Subspaces' : 'Subspace' }}:</span>
        <span class="meta-names">
          <template v-for="(name, idx) in subspaceTrail" :key="`${name}-${idx}`">
            <span class="meta-name">{{ name }}</span>
            <span
              v-if="idx < subspaceTrail.length - 1"
              class="meta-arrow"
              aria-hidden="true"
            ></span>
          </template>
        </span>
      </div>
      <button
        class="subcard-close"
        type="button"
        title="Close this saved selection"
        aria-label="Close this saved selection"
        @click.stop="emit('close-link')"
      >
        ×
      </button>
    </div>

    <!-- ① Hex 概览 + Summarize 按钮（新增） -->
    <!-- ① Hex 概览（按钮与 hex 同层，绝对定位到右侧，垂直居中） -->
     <div class="subcard__hex">
       <div class="hex-scroll" ref="hexScrollRef">
         <svg ref="svgRef" class="mini" />
       </div>
       <button
         class="show-original-btn summarize-btn hex-action"
         type="button"
         :disabled="selectedCount === 0 || llmLoading"
         @click="summarizeSelected"
        title="Synthesize checked MSUs in this link"
      >
        Synthesize<span v-if="selectedCount"> ({{ selectedCount }})</span>
       </button>
     </div>


    <!-- ② 原文句子 - 显示当前link关联的MSU句子（含勾选） -->
    <div
      class="subcard__source"
      :class="{ 'is-sized': sourceHeight != null }"
      ref="sourceRef"
      :style="sourcePanelStyle"
    >
       <div v-if="displayMsuSentences.length > 0" class="msu-sentences">
         <!-- ★ 点击 HSU 后只显示该 HSU 的 MSU；聚合后默认折叠过长的证据列表 -->
         <div v-for="(msu, index) in visibleMsuSentences" :key="msu.uid" class="msu-sentence">
          <!-- 点击这一行（勾选框/Details 按钮除外）折叠或展开该 MSU 的正文 -->
          <div class="msu-meta" @click="toggleMsuCollapse(msu.uid)">
            <label class="msu-checkwrap" @click.stop>
              <input
                type="checkbox"
                class="msu-check"
                :aria-label="`Select MSU ${msu.id}`"
                :checked="selectedMsus.has(msu.uid)"
                @change="toggleMsu(msu.uid)"
              />
            </label>
            <span
              class="paper-dot"
              :class="{ 'is-collapsed': isMsuCollapsed(msu.uid) }"
              :style="{ backgroundColor: msu.paperColor }"
              :title="msu.paperLabel"
            ></span>
            <button
              class="msu-id"
              type="button"
              :aria-expanded="String(!isMsuCollapsed(msu.uid))"
              :title="isMsuCollapsed(msu.uid) ? 'Click to expand this MSU' : 'Click to collapse this MSU'"
            >
              MSU {{ msu.id }}
            </button>

            <button class="show-original-btn" @click.stop="toggleOriginal">
              {{ showOriginal ? 'Hide Details' : 'Show Details' }}
            </button>
          </div>

          <template v-if="!isMsuCollapsed(msu.uid)">
            <div class="msu-text">{{ msu.sentence }}</div>

            <!-- 展开显示的原文/上下文（字段兼容 + 调试兜底） -->
            <div v-if="showOriginal" class="para-info">
              <div v-if="msu.para_info && String(msu.para_info).trim().length" class="para-info-content">
                {{ msu.para_info }}
              </div>
              <pre v-else class="para-info-content para-info-raw">{{ formatRawForDebug(msu.raw) }}</pre>
            </div>
          </template>
        </div>
        <button
          v-if="hasCollapsedMsus"
          class="msu-list-toggle"
          type="button"
          @click="msuListExpanded = !msuListExpanded"
        >
          {{ msuListExpanded ? 'Show fewer MSUs' : `Show all ${displayMsuSentences.length} MSUs` }}
        </button>
      </div>
      <div v-else class="placeholder">No MSU sentences for this link</div>
    </div>
    <div
      class="section-resize-handle"
      title="Drag to resize MSU area"
      @mousedown="startSectionResize('source', $event)"
    />

    <!-- ③ 大模型总结（展示点击按钮后的结果） -->
    <div
      class="subcard__llm"
      :class="{ 'is-sized': llmHeight != null }"
      ref="llmRef"
      :style="llmPanelStyle"
    >
      <div v-if="llmSummary" class="llm-content">
        <span class="llm-label">Evidence Synthesis:</span>
        <span class="llm-text">{{ llmSummary }}</span>
      </div>
      <div v-else-if="llmLoading" class="llm-loading">
        LLM is summarizing...
      </div>
      <div v-else-if="llmError" class="llm-error">
        {{ llmError }}
      </div>
      <div v-else class="placeholder">LLM summary</div>
    </div>
    <div
      class="section-resize-handle"
      title="Drag to resize LLM summary area"
      @mousedown="startSectionResize('llm', $event)"
    />
  </section>
</template>

<script setup>
import { onMounted, watch, ref, onBeforeUnmount, computed, nextTick } from 'vue'
import { mountMiniLink } from '@/lib/useLinkCard'
import { summarizeMsuSentences } from '@/lib/api'
import { onStepwiseMsuCandidates, onApplyStepwiseMsuFilter } from '@/lib/selectionBus'

const props = defineProps({
  link:  { type: Object, required: true },
  nodes: { type: Array,  default: () => [] },
  panelNamesByIndex: { type: Object, default: () => ({}) },
  startCountMap: { type: Object, default: () => new Map() },

  colorByCountry: { type: [Object, Map], default: () => ({}) },
  colorByPanelCountry: { type: [Object, Map], default: () => ({}) },
  normalizeCountryId: { type: Function, default: (x) => x },

  // 透明度映射
  alphaByNode: { type: [Object, Map], default: () => ({}) },
  defaultAlpha: { type: Number, default: 1 },

  // 逐节点边框 & 逐节点填充（Alt 覆盖）
  borderColorByNode: { type: [Object, Map], default: () => ({}) },
  borderWidthByNode: { type: [Object, Map], default: () => ({}) },
  fillByNode: { type: [Object, Map], default: () => ({}) },
})
const emit = defineEmits(['resize-card-delta', 'close-link'])

const svgRef = ref(null)
const hexScrollRef = ref(null)
const sourceRef = ref(null)
const llmRef = ref(null)
let mini = null
let miniResizeObserver = null
let offStepwiseMsuCandidates = null
let offApplyStepwiseMsuFilter = null

const showOriginal = ref(false)
const llmSummary = ref('')
const llmLoading = ref(false)
const llmError = ref('')
let miniHeight = null
const sourceHeight = ref(null)
const llmHeight = ref(null)
const sectionResize = {
  active: false,
  target: null,
  startY: 0,
  startHeight: 0
}

const SECTION_MIN_HEIGHT = {
  source: 48,
  llm: 48
}
const SECTION_MAX_HEIGHT = {
  source: 800,
  llm: 800
}
// 生成总结后自动为 Evidence Synthesis 争取的最大高度（超出部分自行滚动）
const LLM_AUTOFIT_MAX = 200
// 用户手动拖过 LLM 分隔条后就不再自动调整，尊重用户的设定
const llmSizedByUser = ref(false)

const subspaceTrail = computed(() => {
  const raw = Array.isArray(props.link?.panelNames) ? props.link.panelNames : [];
  return raw
    .flatMap(name => String(name ?? '').split(/\s*(?:->|→|➜|➔|➝)\s*/g))
    .map(name => name.trim())
    .filter(Boolean);
})

const sourcePanelStyle = computed(() => (
  sourceHeight.value == null ? {} : { height: `${sourceHeight.value}px` }
))
const llmPanelStyle = computed(() => (
  llmHeight.value == null ? {} : { height: `${llmHeight.value}px` }
))

const clampSectionHeight = (target, value) => {
  const min = SECTION_MIN_HEIGHT[target] ?? 48
  const max = SECTION_MAX_HEIGHT[target] ?? 500
  return Math.max(min, Math.min(max, Number(value) || min))
}

function sectionEl(target) {
  return target === 'llm' ? llmRef.value : sourceRef.value
}

function setSectionHeight(target, value) {
  if (target === 'llm') llmHeight.value = value
  else sourceHeight.value = value
}

// 把“请求高度”对齐到实际渲染高度：卡片被上下限夹住时，两者会不一致，
// 若不对齐，下一次拖拽会以错误的基准起步，累积成越拖越偏的错位。
function syncSectionHeightsToDom() {
  const src = sourceRef.value
  const llm = llmRef.value
  if (src && sourceHeight.value != null) {
    sourceHeight.value = Math.round(src.getBoundingClientRect().height)
  }
  if (llm && llmHeight.value != null) {
    llmHeight.value = Math.round(llm.getBoundingClientRect().height)
  }
}

function startSectionResize(target, event) {
  event.preventDefault()
  event.stopPropagation()

  const el = sectionEl(target)
  if (!el) return

  // 起点用真实渲染高度，不做 max 夹取，避免按下瞬间跳一下
  const current = Math.max(SECTION_MIN_HEIGHT[target] ?? 48, el.getBoundingClientRect().height)
  setSectionHeight(target, current)

  if (target === 'llm') llmSizedByUser.value = true

  sectionResize.active = true
  sectionResize.target = target
  sectionResize.startY = event.clientY
  sectionResize.startHeight = current

  document.body.classList.add('is-section-resizing')
  window.addEventListener('mousemove', onSectionResizeMove)
  window.addEventListener('mouseup', stopSectionResize)
}

function onSectionResizeMove(event) {
  if (!sectionResize.active || !sectionResize.target) return
  const target = sectionResize.target
  const el = sectionEl(target)
  const next = clampSectionHeight(target, sectionResize.startHeight + (event.clientY - sectionResize.startY))

  // 卡片高度按“想要多高 - 现在实际多高”补差，每帧都以真实布局为准，
  // 这样在夹取边界上也不会和外层卡片高度失配。
  const rendered = el ? el.getBoundingClientRect().height : next
  setSectionHeight(target, next)

  const delta = next - rendered
  if (Math.abs(delta) < 1) return
  emit('resize-card-delta', delta)
}

// 总结返回后按内容为 LLM 区申请一点额外高度，避免它被挤成一条缝
async function autoFitLlmSection() {
  if (llmSizedByUser.value) return
  await nextTick()
  const el = llmRef.value
  if (!el) return
  const current = el.getBoundingClientRect().height
  const needed = el.scrollHeight
  if (needed <= current + 2) return
  const target = clampSectionHeight('llm', Math.min(needed, LLM_AUTOFIT_MAX))
  const delta = target - current
  if (delta <= 0) return

  // 先把 MSU 区固定在当前高度，让卡片新增的高度全部给到总结区
  const srcEl = sourceRef.value
  if (srcEl && sourceHeight.value == null) {
    sourceHeight.value = clampSectionHeight('source', srcEl.getBoundingClientRect().height)
  }

  llmHeight.value = target
  emit('resize-card-delta', delta)
}

watch(llmSummary, (value) => { if (value) autoFitLlmSection() })

function stopSectionResize() {
  if (!sectionResize.active) return
  sectionResize.active = false
  sectionResize.target = null
  document.body.classList.remove('is-section-resizing')
  window.removeEventListener('mousemove', onSectionResizeMove)
  window.removeEventListener('mouseup', stopSectionResize)
  nextTick(syncSectionHeightsToDom)
}

function onMiniSize(size) {
  const next = Number(size?.height) || 30
  const baseline = miniHeight == null ? 30 : miniHeight
  miniHeight = next
  const delta = next - baseline
  if (delta > 0) emit('resize-card-delta', delta)
}

// 勾选状态：存 uid（= HSU key + '#' + MSU id），确保同一 MSU 出现在不同 HSU 时不混淆
const selectedMsus = ref(new Set())

// ★ 新增：当前点击选中的 HSU 键（"panelIdx:q,r"），null 表示不筛选
const pickedNodeKey = ref(null)
const msuListExpanded = ref(false)
const MSU_PREVIEW_LIMIT = 8

// 切换显示/隐藏原文
const toggleOriginal = () => { showOriginal.value = !showOriginal.value }

// 折叠状态：同样按 uid 记录，折叠后只保留标题行
const collapsedMsus = ref(new Set())

const isMsuCollapsed = (uid) => collapsedMsus.value.has(uid)

const toggleMsuCollapse = (uid) => {
  const set = new Set(collapsedMsus.value)
  if (set.has(uid)) set.delete(uid)
  else set.add(uid)
  collapsedMsus.value = set
}

// 切换某个 MSU 的选择状态
const toggleMsu = (uid) => {
  const set = new Set(selectedMsus.value)
  if (set.has(uid)) set.delete(uid)
  else set.add(uid)
  selectedMsus.value = set
}

// —— 原文/上下文提取（兼容字段演进）——
const _asText = (v) => {
 if (v == null) return null
 if (typeof v === 'string') return v
 if (Array.isArray(v)) return v.map(x => (x == null ? '' : String(x))).join('\n')
 // 常见结构：{ text: '...' }
 if (typeof v === 'object' && typeof v.text === 'string') return v.text
 return null
}

const extractParaInfo = (rawMsu) => {
 if (!rawMsu) return null

 // 1) 优先：历史字段 para_info
 const direct = [
 rawMsu.para_info,
 rawMsu.paraInfo,
 rawMsu.parainfo,
 rawMsu.paragraph_info,

 // 2) 常见替代字段：paragraph/context/original
 rawMsu.paragraph,
 rawMsu.paragraph_text,
 rawMsu.paragraphText,
 rawMsu.context,
 rawMsu.context_text,
 rawMsu.contextText,
 rawMsu.original,
 rawMsu.original_text,
 rawMsu.originalText,
 rawMsu.source,
 rawMsu.source_text,
 rawMsu.sourceText,
 ].map(_asText).find(s => typeof s === 'string' && s.trim().length > 0)

 if (direct) return direct

 // 3) 退化：把可用的元信息拼接出来（至少不至于空）
 const title = _asText(rawMsu.paper_title ?? rawMsu.paperTitle ?? rawMsu.title ?? rawMsu.doc_title ?? rawMsu.docTitle)
 const section = _asText(rawMsu.section_title ?? rawMsu.sectionTitle ?? rawMsu.section)
 const sent = _asText(rawMsu.sentence ?? rawMsu.text)

 const meta = [
 title ? `Title: ${title}` : null,
 section ? `Section: ${section}` : null
 ].filter(Boolean).join('\n')

 const combined = [meta, sent].filter(s => typeof s === 'string' && s.trim().length > 0).join('\n\n')
 return combined.trim() || null
}

const DEFAULT_PAPER_DOT = '#DCDCDC'

function pickMapValue(mapLike, key) {
 if (!mapLike || key == null) return null
 const keys = [key, String(key)]
 if (mapLike instanceof Map) {
   for (const k of keys) if (mapLike.has(k)) return mapLike.get(k)
   return null
 }
 if (typeof mapLike === 'object') {
   for (const k of keys) if (Object.prototype.hasOwnProperty.call(mapLike, k)) return mapLike[k]
 }
 return null
}

function normalizePaperId(rawMsu, node) {
 const direct =
   rawMsu?.country_id ??
   rawMsu?.countryId ??
   rawMsu?.paper_country_id ??
   rawMsu?.paperCountryId ??
   node?.country_id
 if (direct != null && String(direct).trim()) return String(direct).trim()
 const pid = rawMsu?.paper_id ?? rawMsu?.paperId ?? rawMsu?.paper
 if (pid != null && String(pid).trim()) {
   const s = String(pid).trim()
   return /^c/i.test(s) ? s : `c${s}`
 }
 const label = extractPaperLabel(rawMsu)
 return label || 'unknown'
}

function extractPaperLabel(rawMsu) {
 const value =
   rawMsu?.paper_info ??
   rawMsu?.paper_title ??
   rawMsu?.paperTitle ??
   rawMsu?.doc_title ??
   rawMsu?.docTitle ??
   rawMsu?.source_title ??
   rawMsu?.sourceTitle ??
   rawMsu?.title ??
   rawMsu?.subtitle ??
   rawMsu?.source
 const text = _asText(value)
 if (text && text.trim()) {
   const cleaned = text.trim()
   const parts = cleaned.split(/[\\/]/).filter(Boolean)
   return parts[parts.length - 1] || cleaned
 }
 const pid = rawMsu?.paper_id ?? rawMsu?.paperId
 return pid != null ? `Paper ${pid}` : 'Unknown paper'
}

function colorForPaper(countryId, panelIdx) {
 const normalized = props.normalizeCountryId ? props.normalizeCountryId(countryId) : countryId
 const panelColor = pickMapValue(props.colorByPanelCountry, `${panelIdx}|${normalized}`)
 if (panelColor) return panelColor
 const globalColor = pickMapValue(props.colorByCountry, normalized)
 if (globalColor) return globalColor
 return DEFAULT_PAPER_DOT
}

const formatRawForDebug = (obj, limit = 2000) => {
 try {
 const s = JSON.stringify(obj, null, 2)
 return s.length > limit ? (s.slice(0, limit)  + '\n…') : s
 } catch {
 return String(obj)
 }
}


// 已选择的数量
const selectedCount = computed(() => selectedMsus.value.size)

// 计算当前 link 关联的 MSU，**带 HSU key**（panelIdx:q,r）用于分组
const linkMsuSentences = computed(() => {
  if (!props.link?.path || !Array.isArray(props.nodes)) return []
  // (1) 把 nodes 建立索引： "panelIdx:q,r" -> node
  const nodeMap = new Map()
  props.nodes.forEach(node => {
    const key = `${node.panelIdx}:${node.q},${node.r}`
    nodeMap.set(key, node)
  })

  // (2) 沿 path 收集 MSU，并附上它来自哪个 HSU（hsuKey）
  const out = []
  const seen = new Set() // 去重同一 HSU 中重复的 MSU id（可按需求调整是否全局去重）
  const path = Array.isArray(props.link.path) ? props.link.path : []
  path.forEach(point => {
    const hsuKey = `${point.panelIdx}:${point.q},${point.r}`
    const node = nodeMap.get(hsuKey)
    if (node?.msu && Array.isArray(node.msu)) {
      node.msu.forEach(msu => {
        const id = msu?.MSU_id ?? msu?.id
        if (id == null) return
        const uid = `${hsuKey}#${id}` // 唯一 uid = HSU + MSU
        if (seen.has(uid)) return
        seen.add(uid)
        const paperId = normalizePaperId(msu, node)
        const paperLabel = extractPaperLabel(msu)
        out.push({
          uid,
          hsuKey,
          id,
          sentence: msu.sentence || msu.text || 'No sentence available',
          category: msu.category || 'Unknown',
          paperId,
          paperLabel,
          paperColor: colorForPaper(paperId, point.panelIdx),
          para_info: extractParaInfo(msu),
          raw: msu
        })
      })
    }
  })
  return out
})

/** 点击按钮：仅对已勾选的 MSU 做总结，并按 HSU 分组发给后端 */
/** 点击按钮：仅对已勾选的 MSU 做总结，并按“路径顺序”组织为 hops */
const summarizeSelected = async () => {
  llmError.value = '';
  llmSummary.value = '';

  // 1) 建 index： "panelIdx:q,r" -> node
  const nodeMap = new Map();
  (props.nodes || []).forEach(node => {
    const key = `${node.panelIdx}:${node.q},${node.r}`;
    nodeMap.set(key, node);
  });

  // 2) panelIdx → 子空间名（尽力获取；不存在就回退）
  //   - 如果后端/数据层有 link.panelNamesByIndex 之类映射，可优先使用
  const panelNameByIdx = {
    ...((props.link && props.link.panelNamesByIndex) || {}),
    ...(props.panelNamesByIndex || {})
  };
  const getDomNameMap = () => {
    try {
      const els = document.querySelectorAll('.subspace-title');
      const m = {};
      els.forEach((el, i) => {
        const idxAttr = el.dataset?.panelIdx ?? el.getAttribute('data-panel-idx') ?? i;
        const idx = Number.isFinite(Number(idxAttr)) ? Number(idxAttr) : i;
        const raw =
          (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el.value :
          el.isContentEditable ? el.innerText :
          el.textContent;
        const name = (raw || '').trim() || `Subspace ${idx}`;
        m[idx] = name;
      });
      return m;
    } catch { return {}; }
  };

  const fallbackName = (idx) => {
    const p = panelNameByIdx[idx];
    const dm = getDomNameMap();
    if (p && !/^subspace\s+\d+$/i.test(String(p).trim())) return p;
    if (dm[idx] && !/^subspace\s+\d+$/i.test(String(dm[idx]).trim())) return dm[idx];
    if (p) return p;
    return dm[idx] || `Subspace ${idx}`;
  };
  // 3) 仅依据“用户勾选”的 MSU 构建 hops（保持 path 顺序；未选中的节点直接跳过）
  const hops = [];
  const sel = selectedMsus.value; // Set("<panelIdx:q,r>#<MSU_id>")
  const path = Array.isArray(props.link?.path) ? props.link.path : [];

  // 预先提取出被选中的 HSU 键集合，避免在每个节点上无意义遍历
  const selectedHsuKeys = new Set(
    Array.from(sel).map(uid => uid.split('#')[0]) // -> "<panelIdx:q,r>"
  );

  path.forEach((pt, i) => {
    const hsuKey = `${pt.panelIdx}:${pt.q},${pt.r}`;
    if (!selectedHsuKeys.has(hsuKey)) return; // 该节点无任何被选中的 MSU，直接跳过

    const node = nodeMap.get(hsuKey);
    if (!node?.msu || !Array.isArray(node.msu)) return;

    const evidence = [];
    for (const msu of node.msu) {
      const id = msu?.MSU_id ?? msu?.id;
      if (id == null) continue;
      const uid = `${hsuKey}#${id}`;
      if (!sel.has(uid)) continue; // 只要“勾选”的
      const sent = (msu.sentence || msu.text || '').trim();
      if (sent) {
        const paperId = normalizePaperId(msu, node)
        evidence.push({
          msuId: id,
          text: sent,
          paperId,
          paper: extractPaperLabel(msu),
          category: msu.category || 'Unknown'
        });
      }
    }

    if (evidence.length) {
      hops.push({
        step: i + 1,
        hsu: hsuKey,                             // "panelIdx:q,r"
        panelIdx: pt.panelIdx,
        subspace: fallbackName(pt.panelIdx),     // 最佳可得的子空间名
        evidence,
        sentences: evidence.map(item => item.text)
      });
    }
  });

  if (hops.length === 0) {
    llmError.value = 'Please select at least one MSU.';
    return;
  }

  try {
    llmLoading.value = true;
    // 把“有序 hops”传给 API
    // 把当前卡片的形状告诉 api：single / flight / road / river 决定总结怎么写
    const answer = await summarizeMsuSentences(hops, {
      linkType: props.link?.type || '',
      pathLength: Array.isArray(props.link?.path) ? props.link.path.length : 0
    });
    llmSummary.value =
      typeof answer === 'string' ? answer :
      answer?.text ?? answer?.summary ?? answer?.payload?.text ?? answer?.payload?.summary ??
      JSON.stringify(answer);
  } catch (err) {
    console.error(err);
    llmError.value = 'Failed to generate summary.';
  } finally {
    llmLoading.value = false;
  }
};

// ★ 新增：根据是否点击选中某个 HSU 来决定显示的 MSU 清单
const displayMsuSentences = computed(() => {
  const all = linkMsuSentences.value || []
  if (!pickedNodeKey.value) return all
  return all.filter(m => m.hsuKey === pickedNodeKey.value)
})

const hasCollapsedMsus = computed(() => displayMsuSentences.value.length > MSU_PREVIEW_LIMIT)
const visibleMsuSentences = computed(() => (
  msuListExpanded.value
    ? displayMsuSentences.value
    : displayMsuSentences.value.slice(0, MSU_PREVIEW_LIMIT)
))

watch(pickedNodeKey, () => { msuListExpanded.value = false })
watch(() => props.link, () => { msuListExpanded.value = false })

function getSemanticMsuCandidates() {
  return (linkMsuSentences.value || []).map(msu => ({
    uid: msu.uid,
    text: msu.sentence,
    sentence: msu.sentence,
    hsuKey: msu.hsuKey,
    msuId: msu.id,
    category: msu.category,
    paperId: msu.paperId,
    paperLabel: msu.paperLabel,
    subspaces: subspaceTrail.value,
    checked: selectedMsus.value.has(msu.uid),
    source: 'stepwise-link-card'
  }))
}

function applySemanticMsuFilter(payload = {}) {
  const rawUids = payload.uids || payload.matchedUids || []
  const wanted = new Set(rawUids.map(uid => String(uid)))
  if (!wanted.size) {
    return { matched: 0, newlyChecked: 0, alreadyChecked: 0 }
  }

  const next = new Set(selectedMsus.value)
  let matched = 0
  let newlyChecked = 0
  let alreadyChecked = 0

  ;(linkMsuSentences.value || []).forEach(msu => {
    if (!wanted.has(String(msu.uid))) return
    matched += 1
    if (next.has(msu.uid)) {
      alreadyChecked += 1
    } else {
      next.add(msu.uid)
      newlyChecked += 1
    }
  })

  if (newlyChecked > 0) selectedMsus.value = next
  return { matched, newlyChecked, alreadyChecked }
}

onMounted(() => {
  offStepwiseMsuCandidates = onStepwiseMsuCandidates(getSemanticMsuCandidates)
  offApplyStepwiseMsuFilter = onApplyStepwiseMsuFilter(applySemanticMsuFilter)

  mini = mountMiniLink(svgRef.value, {
    link: props.link,
    nodes: props.nodes,
    startCountMap: props.startCountMap,
    colorByCountry: props.colorByCountry,
    colorByPanelCountry: props.colorByPanelCountry,
    normalizeCountryId: props.normalizeCountryId,
    alphaByNode: props.alphaByNode,
    defaultAlpha: props.defaultAlpha,
    borderColorByNode: props.borderColorByNode,
    borderWidthByNode: props.borderWidthByNode,
    fillByNode: props.fillByNode,
    onSize: onMiniSize,
    pickedId: pickedNodeKey.value,          // ★ 同步当前选中（初始为空）
    onPick: (key /* "panelIdx:q,r" or null */) => {
      pickedNodeKey.value = key
    }

  })
  if (typeof ResizeObserver !== 'undefined' && hexScrollRef.value) {
    miniResizeObserver = new ResizeObserver(() => {
      mini?.update({
        link: props.link,
        nodes: props.nodes,
        startCountMap: props.startCountMap,
        colorByCountry: props.colorByCountry,
        colorByPanelCountry: props.colorByPanelCountry,
        normalizeCountryId: props.normalizeCountryId,
        alphaByNode: props.alphaByNode,
        defaultAlpha: props.defaultAlpha,
        borderColorByNode: props.borderColorByNode,
        borderWidthByNode: props.borderWidthByNode,
        fillByNode: props.fillByNode,
        onSize: onMiniSize,
        pickedId: pickedNodeKey.value,
        onPick: (key) => { pickedNodeKey.value = key }
      })
    })
    miniResizeObserver.observe(hexScrollRef.value)
  }
})

// 数据更新时刷新小卡
watch(
  () => [
    props.link,
    props.nodes,
    props.startCountMap,
    props.colorByCountry,
    props.colorByPanelCountry,
    props.normalizeCountryId,
    props.alphaByNode,
    props.defaultAlpha,
    props.borderColorByNode,
    props.borderWidthByNode,
    props.fillByNode
  ],
  () => {
    mini?.update({
      link: props.link,
      nodes: props.nodes,
      startCountMap: props.startCountMap,
      colorByCountry: props.colorByCountry,
      colorByPanelCountry: props.colorByPanelCountry,
      normalizeCountryId: props.normalizeCountryId,
      alphaByNode: props.alphaByNode,
      defaultAlpha: props.defaultAlpha,
      borderColorByNode: props.borderColorByNode,
      borderWidthByNode: props.borderWidthByNode,
      fillByNode: props.fillByNode,
      onSize: onMiniSize,
      pickedId: pickedNodeKey.value,        // ★ 每次更新保持选中样式
      onPick: (key) => { pickedNodeKey.value = key }
    })
  },
  { deep: true }
)

onBeforeUnmount(() => {
  stopSectionResize()
  offStepwiseMsuCandidates?.()
  offApplyStepwiseMsuFilter?.()
  miniResizeObserver?.disconnect?.()
  mini?.destroy()
})

// ⚠️ 重要：移除“自动生成总结”的 watch，改为用户点击按钮才总结
// （所以不再 watch(linkMsuSentences) 自动调用 generateSummary）
</script>

<style scoped>
/* 原样保留你的样式（仅补极少量按钮容器样式） */

/* —— 新增：hex 内按钮容器 —— */
.hex-action{
  position: absolute;
  right: 8px;                /* 与“Show Details”右边距保持一致，如需改：6/10/12 */
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
}

/* —— 新增：tickbox 相关 —— */
.msu-checkwrap{
  display:inline-flex;
  align-items:center;
  gap:6px;
  min-width:0;
}
.msu-check{
  width: 0.95em;
  height: 0.95em;
  flex: none;
  margin: 0;
  vertical-align: middle;
  accent-color: #e5e7eb;
}

/* 原有样式（未改动） */
.subcard{
  border:1px dashed #e5e7eb; border-radius:10px;
  display:flex; flex-direction:column; gap:2px;
  padding:4px; background:#fff;
  /* 只过渡不影响布局的属性：height 参与拖拽，动画会让拖动手感发飘 */
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
  height:100%;
  min-height:0;
  overflow:hidden;      /* 任何一段都不允许溢出到相邻段上方 */
  font-family:var(--app-font);
  color:#374151;
}
.subcard__meta{
  position:relative;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  padding:0 28px 0 2px;
  line-height:1;
  font-size:11px;
  color:#6b7280;
  min-height:22px;
}
.subcard__meta-main{
  display:flex;
  align-items:center;
  min-width:0;
  flex-wrap:nowrap;
  line-height:1.2;
  width:100%;
}
.meta-label{ font-weight:650; margin-right:4px; white-space:nowrap; flex:none; }
.meta-names{
  display:inline-flex;
  align-items:center;
  flex-wrap:wrap;
  gap:3px;
  font-weight:600;
  min-width:0;
  flex:1 1 auto;
}
.meta-name{ display:inline-flex; align-items:center; }
.meta-arrow{
  position:relative;
  display:inline-flex;
  align-items:center;
  width:16px;
  height:8px;
  opacity:.78;
  transform:translateY(.5px);
}
.meta-arrow::before{
  content:'';
  width:10px;
  border-top:2px solid currentColor;
}
.meta-arrow::after{
  content:'';
  width:0;
  height:0;
  border-top:4px solid transparent;
  border-bottom:4px solid transparent;
  border-left:7px solid currentColor;
  margin-left:-1px;
}
.subcard-close{
  position:absolute;
  top:50%;
  right:2px;
  transform:translateY(-50%);
  width:18px;
  height:18px;
  min-width:18px;
  max-width:18px;
  min-height:18px;
  max-height:18px;
  padding:0;
  margin:0;
  appearance:none;
  -webkit-appearance:none;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border:1px solid #ddd;
  border-radius:999px;
  background:#fff;
  color:#333;
  cursor:pointer;
  font-size:0;
  line-height:1;
  box-sizing:border-box;
}
.subcard-close::before,
.subcard-close::after{
  content:'';
  position:absolute;
  left:50%;
  top:50%;
  width:8px;
  height:1.45px;
  border-radius:999px;
  background:currentColor;
  transform-origin:center;
}
.subcard-close::before{ transform:translate(-50%, -50%) rotate(45deg); }
.subcard-close::after{ transform:translate(-50%, -50%) rotate(-45deg); }
.subcard-close:hover{
  background:darkred;
  color:#fff;
}

.subcard__hex, .subcard__source, .subcard__llm{
  border:1px dashed #e5e7eb; border-radius:8px; padding:6px; min-height:40px;
}
.subcard__hex{
  /* 同一行：svg 在左，按钮在右；垂直居中 */
  position: relative;        /* 让右侧按钮以本容器为定位参照 */
  display: flex;
  align-items: center;       /* 按钮与 hex 垂直对齐 */
  flex: 0 0 auto;
  min-height: 40px;
  height: auto;
}
.hex-row{
  display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%;
}
.hex-scroll{
  width:calc(100% - 150px);
  max-width:calc(100% - 150px);
  flex:0 0 calc(100% - 150px);
  height:auto;
  display:flex; justify-content:flex-start; align-items:center;
  overflow:visible; scrollbar-width:none;
}

.hex-scroll::-webkit-scrollbar{ height:0; }

/* MSU 列表：默认吃掉剩余空间；被拖拽定高后按定高显示（仍可在空间不足时收缩） */
.subcard__source{
  flex: 1 1 auto;
  min-height: 48px;
  overflow-y: auto;
}
.subcard__source.is-sized{ flex: 0 1 auto; }
.msu-sentences { font-size: 11px; line-height: 1.4; }
.msu-sentence { margin-bottom: 8px; padding: 6px; background: #f9fafb; border-radius: 4px; border-left: 3px solid #e5e7eb; }
.msu-sentence:last-child { margin-bottom: 0; }
.msu-list-toggle{
  display:block;
  width:100%;
  margin-top:8px;
  padding:5px 8px;
  border:1px solid #d1d5db;
  border-radius:5px;
  background:#fff;
  color:#374151;
  font-size:11px;
  cursor:pointer;
}
.msu-list-toggle:hover{ background:#f3f4f6; }

.msu-meta { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; cursor: pointer; }
/* 折叠后标题行是唯一内容，去掉多余的下边距 */
.msu-meta:only-child { margin-bottom: 0; }
.paper-dot{ margin-left:6px; }
.msu-id{
  appearance:none;
  -webkit-appearance:none;
  border:none;
  background:transparent;
  padding:0;
  margin:0 auto 0 6px;
  font-family:inherit;
  font-weight: 600;
  color: #374151;
  font-size: 10px;
  line-height:1;
  cursor:pointer;
}
.paper-dot{
  display:inline-block;
  width:10px;
  height:10px;
  border-radius:50%;
  border:1px solid rgba(255,255,255,0.25);
  flex:none;
  transition: box-shadow .15s ease;
}
/* 折叠状态：圆点外加一圈系统黑描边，展开时消失 */
.paper-dot.is-collapsed{
  box-shadow: 0 0 0 1px #f9fafb, 0 0 0 2.5px #111;
}
.show-original-btn{
  font-size: 10px;
  padding: 4px 10px;
  border-radius: 9999px;
  background: #111;      /* 默认可点击：深色 */
  color: #fff;           /* 白字 */
  border: none;
  cursor: pointer;
  transition: background-color 0.2s;
  line-height: 1;
}
.show-original-btn:hover:not(:disabled){
  background: #000;      /* hover 更深 */
}
.show-original-btn:disabled{
  background: #e5e7eb;   /* 禁用：变灰 */
  color: #9ca3af;        /* 文字也变淡 */
  cursor: not-allowed;
  opacity: 1;            /* 避免额外变淡 */
}

/* —— Summarize 专属覆盖（只需定义禁用态，启用时用通用黑底白字） —— */
.summarize-btn:disabled{
  background: #e5e7eb;
  color: #9ca3af;
}

.msu-text { color: #374151; font-size: 11px; line-height: 1.5; }
.para-info { margin-top: 8px; padding: 8px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 4px; }
.para-info-content { color: #4b5563; font-size: 10px; line-height: 1.5; white-space: pre-wrap; }
.para-info-raw { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 10px; }

/* Evidence Synthesis：始终排在 MSU 拖动条之下，吸收剩余空间，内容超长时自己滚动 */
.subcard__llm{
  flex: 1 1 auto;
  min-height: 48px;
  max-height: 50%;
  overflow-y: auto;
}
.subcard__llm.is-sized{ max-height: none; }
.llm-content { font-size: 11px; line-height: 1.45; color: #374151; padding: 7px 8px; background: #ffffff; border-radius: 5px; border-left: 3px solid #d8dee8; }
.llm-label{ font-weight:700; color:#1f2937; margin-right:4px; }
.llm-text{ color:#374151; }
.llm-loading { font-size: 11px; color: #6b7280; padding: 7px 8px; }
.llm-error { font-size: 11px; color: #ef4444; padding: 6px; }

.placeholder{ color:#9ca3af; font-size:11px; }
.mini{ height:auto; display:block; overflow:visible; }

.section-resize-handle{
  position:relative;
  flex:0 0 7px;
  height:7px;
  cursor:ns-resize;
  touch-action:none;
  background:transparent;
  border-radius:999px;
}
.section-resize-handle::before{
  content:'';
  position:absolute;
  left:50%;
  top:50%;
  width:36px;
  height:2px;
  transform:translate(-50%, -50%);
  border-radius:999px;
  background:#cfd6df;
  opacity:.72;
  transition:opacity .12s ease, width .12s ease, background-color .12s ease;
}
.section-resize-handle:hover::before{
  width:44px;
  opacity:1;
  background:#aeb7c2;
}
:global(body.is-section-resizing){
  cursor:ns-resize;
  user-select:none;
}
:global(body.is-section-resizing) .section-resize-handle::before{
  opacity:1;
}

/* 选中节点更醒目（可按需调整颜色/粗细） */
.mini :deep(.nodes-layer .node.hovered .hex) {
  stroke: #111;
  stroke-width: 1;
}
.mini :deep(.nodes-layer .node.picked .hex) {
  stroke: #111;
  stroke-width: 1;
}
</style>
