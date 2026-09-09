<!-- src/components/LeftPane.vue -->
<script setup>
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import ChatDock from './ChatDock.vue'
import PaperList from './PaperList.vue'
import MarkdownView from './MarkdownView.vue'
import { sendQueryToLLM, interpretLLMResponse, getActiveProjectId } from '../lib/api'
import { collectStepwiseMsuCandidates, emitApplyStepwiseMsuFilter } from '../lib/selectionBus'

// ====== Emits ==========================================================
const emit = defineEmits(['updateHexRadius','updateSystemPrompt','uploadPdfs','updateMarkdownModel'])

// ====== LLM 选择（保留） ==============================================
const selectedLLM = ref('ChatGPT')

// ====== Global System Prompt ==========================================
const systemPrompt = ref(`You are a semantic copilot inside a subspace-driven visual analytics framework.
Your responsibilities:
1) Help users retrieve, inspect, compare, and summarize scientific papers through MSUs, HSUs, links, and semantic subspaces.
2) Preserve evidence fidelity: use only available paper text, MSU sentences, retrieved context, and visible project metadata.
3) Explain how evidence changes across Background, Method, Experiment, Result, and Conclusion when users traverse subspaces.
4) Cite traceable details when available, such as paper names, subspace names, HSU coordinates, or MSU ids.
5) Distinguish confirmed evidence from hypotheses, gaps, or UI actions.
6) Keep responses compact and UI-ready: short paragraphs, bullets, or strict JSON when requested.
7) Ask for missing context only when the task cannot be completed from the visible project data.`)

// ====== Markdown Parser 选择（保留字段） ==============================
const markdownModel = ref('PyMuPDF+LLM')

// ====== HSU Aggregation Scale ==========================================
const hexRadius = ref(32)
const hexMin = 4, hexMax = 120, hexStep = 1

// ====== PDF 上传 =======================================================
const uploadedFiles = ref([])
function handlePdfUpload(e) {
  const files = Array.from(e.target.files || [])
  uploadedFiles.value = files.map(f => ({ name: f.name, size: f.size }))
  emit('uploadPdfs', files)
}

// ====== Semantic Source Gallery（改为“多分组”渲染） ============================
const paperListRef = ref(null)
// 旧的 v-model:selected-ids 仅适用于单列表，分组模式下先移除使用
// const selectedPaperIds = ref([])
const paperQuery = ref('')      // 仍保留为外层标题（可和最新一次的分组合并）
// const papers = ref([])       // 单列表已废弃
const paperGroups = ref([])     // [{ key, title, items }]
const galleryColorMaps = ref({})
const galleryProjectColorCache = ref({})

function mergeGalleryProjectColors(projectId, snap = {}) {
  if (!projectId) return
  const next = { ...galleryProjectColorCache.value }
  const add = (cid, color) => {
    if (!cid || !color) return
    next[makeSourceKey(projectId, cid)] = color
  }
  // colorByCountry is the source-wide color. Do not overwrite it with an
  // arbitrary panel's old override below: doing so made one Gallery card show
  // the color of another panel while its hovered HSU showed a different one.
  const sourceWideColors = snap.colorByCountry || {}
  Object.entries(sourceWideColors).forEach(([cid, color]) => add(cid, color))
  Object.entries(snap.colorByPanelCountry || {}).forEach(([key, color]) => {
    const cid = String(key).split('|').pop()
    if (!(cid in sourceWideColors)) add(cid, color)
  })
  galleryProjectColorCache.value = next
}

function setGalleryColorMaps(snap = {}) {
  const projectId = snap.projectId || snap.project_id || getActiveProjectId?.() || null
  mergeGalleryProjectColors(projectId, snap)
  galleryColorMaps.value = {
    ...snap,
    activeProjectId: projectId,
    sourceColorByKey: { ...galleryProjectColorCache.value }
  }
}

function refreshGalleryColorsFromSemanticMap() {
  const snap =
    window?.SemanticMapCtrl?.getMiniColorMaps?.()
    || window?.SemanticMap?.getMiniColorMaps?.()
    || window?.App?.getMiniColorMaps?.()
    || window?.App?.getSelectionSnapshot?.()?.meta?.miniPalette
    || {}
  setGalleryColorMaps(snap)
}

function onSemanticColorsChange(event) {
  setGalleryColorMaps(event?.detail || {})
}

onMounted(() => {
  window.addEventListener('semanticmap:colorschange', onSemanticColorsChange)
  window.addEventListener('semanticMap:ready', refreshGalleryColorsFromSemanticMap)
  // 语料或子空间变化后，邻域规模随之改变，需要重新读取
  window.addEventListener('semanticMap:ready', refreshNeighborhoodSize)
  window.addEventListener('semantic-map:project-changed', refreshNeighborhoodSize)
  refreshGalleryColorsFromSemanticMap()
  refreshNeighborhoodSize()
})
onBeforeUnmount(() => {
  window.removeEventListener('semanticmap:colorschange', onSemanticColorsChange)
  window.removeEventListener('semanticMap:ready', refreshGalleryColorsFromSemanticMap)
  window.removeEventListener('semanticMap:ready', refreshNeighborhoodSize)
  window.removeEventListener('semantic-map:project-changed', refreshNeighborhoodSize)
})

function openPdfModal(pdfUrl, name){ console.log('[openPdfModal]', pdfUrl, name) }
function onClearPaper(){
  paperGroups.value = [] // 分组模式
  paperQuery.value = ''  // ★ 清掉标题
}
function updatePaperGroups(nextGroups) {
  paperGroups.value = Array.isArray(nextGroups) ? nextGroups : []
  if (!paperGroups.value.length) paperQuery.value = ''
}

// ====== Chat（这里是你实际页面的聊天区） ==============================
const messages = ref([{ role: 'system', type:'text', text: 'You are chatting with SeSMap agents.' }])
const msgBoxRef = ref(null)
const atBottom = ref(true)
let pinChatBottomAfterDockResize = false
function isNearBottom(el, threshold = 80) { return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold }
function scrollToBottom(behavior = 'smooth') {
  const el = msgBoxRef.value; if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior })
}
function onMsgsScroll(e){ atBottom.value = isNearBottom(e.target) }
function onChatDockResize({ phase } = {}) {
  if (phase === 'start') {
    // Respect a reader who intentionally scrolled up.  Otherwise remember the
    // bottom-pinned state before the expanding quick-input dock shrinks the
    // available message viewport.
    pinChatBottomAfterDockResize = !!atBottom.value
    if (pinChatBottomAfterDockResize) nextTick(() => scrollToBottom('auto'))
    return
  }
  if (phase === 'end' && pinChatBottomAfterDockResize) {
    pinChatBottomAfterDockResize = false
    nextTick(() => scrollToBottom('auto'))
  }
}
onMounted(() => nextTick(() => scrollToBottom('instant')))
watch(() => messages.value.length, async () => { await nextTick(); if (atBottom.value) scrollToBottom('smooth') })

// ====== Left-pane vertical resizers ======================================
// The first two heights are explicit; the Chat panel receives the remaining
// space.  This makes both separators independently useful while keeping every
// panel readable on smaller screens.
const leftPaneShellRef = ref(null)
const leftPaneHeights = ref([null, null])
const LEFT_PANE_MIN_HEIGHT = 118
const LEFT_PANE_HANDLE_HEIGHT = 10
let activeLeftPaneResize = null

const leftPaneShellStyle = computed(() => {
  const [controlHeight, galleryHeight] = leftPaneHeights.value
  if (!Number.isFinite(controlHeight) || !Number.isFinite(galleryHeight)) return {}
  return {
    gridTemplateRows: `${controlHeight}px ${LEFT_PANE_HANDLE_HEIGHT}px ${galleryHeight}px ${LEFT_PANE_HANDLE_HEIGHT}px minmax(${LEFT_PANE_MIN_HEIGHT}px, 1fr)`
  }
})

function clampLeftPaneHeight(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function initializeLeftPaneHeights() {
  const shell = leftPaneShellRef.value
  const panels = shell?.querySelectorAll?.('.lp-card')
  if (!panels || panels.length < 3 || leftPaneHeights.value[0] != null) return
  leftPaneHeights.value = [
    Math.round(panels[0].getBoundingClientRect().height),
    Math.round(panels[1].getBoundingClientRect().height)
  ]
}

function onLeftPaneResizeMove(event) {
  const state = activeLeftPaneResize
  const shell = leftPaneShellRef.value
  if (!state || !shell) return
  const delta = event.clientY - state.startY
  const available = shell.clientHeight - LEFT_PANE_HANDLE_HEIGHT * 2
  const maxPair = Math.max(LEFT_PANE_MIN_HEIGHT * 2, available - LEFT_PANE_MIN_HEIGHT)

  let [controlHeight, galleryHeight] = state.initialHeights
  if (state.index === 0) {
    // The upper divider only exchanges height between the first two panels.
    const sum = controlHeight + galleryHeight
    controlHeight = clampLeftPaneHeight(controlHeight + delta, LEFT_PANE_MIN_HEIGHT, sum - LEFT_PANE_MIN_HEIGHT)
    galleryHeight = sum - controlHeight
  } else {
    // The lower divider exchanges height between Gallery and Chat; Chat is the
    // flexible final grid track, so cap Gallery by the space left for Chat.
    galleryHeight = clampLeftPaneHeight(galleryHeight + delta, LEFT_PANE_MIN_HEIGHT, maxPair - controlHeight)
  }
  leftPaneHeights.value = [Math.round(controlHeight), Math.round(galleryHeight)]
}

function stopLeftPaneResize() {
  if (!activeLeftPaneResize) return
  activeLeftPaneResize = null
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  document.removeEventListener('pointermove', onLeftPaneResizeMove)
  document.removeEventListener('pointerup', stopLeftPaneResize)
  document.removeEventListener('pointercancel', stopLeftPaneResize)
}

function startLeftPaneResize(index, event) {
  if (event.button !== 0) return
  initializeLeftPaneHeights()
  const [controlHeight, galleryHeight] = leftPaneHeights.value
  if (!Number.isFinite(controlHeight) || !Number.isFinite(galleryHeight)) return
  activeLeftPaneResize = {
    index,
    startY: event.clientY,
    initialHeights: [controlHeight, galleryHeight]
  }
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'row-resize'
  document.addEventListener('pointermove', onLeftPaneResizeMove)
  document.addEventListener('pointerup', stopLeftPaneResize)
  document.addEventListener('pointercancel', stopLeftPaneResize)
}

onMounted(() => nextTick(initializeLeftPaneHeights))
onBeforeUnmount(stopLeftPaneResize)

function handleUploadFiles(files){ /* 占位 */ }

// ====== Watchers（向父抛出） ==========================================
const neighborhoodSize = ref(null)

function refreshNeighborhoodSize() {
  const ctrl = window?.SemanticMapCtrl
  const stat = ctrl?.getNeighborhoodSize?.()
  neighborhoodSize.value = (stat && Number.isFinite(stat.neighborhood) && stat.neighborhood > 0)
    ? stat.neighborhood
    : null
}

// 重聚合在 setAggregationRange 内同步完成，下一帧读取即为新尺度下的结果
watch(hexRadius, v => {
  emit('updateHexRadius', v)
  requestAnimationFrame(refreshNeighborhoodSize)
})
watch(systemPrompt, v => emit('updateSystemPrompt', v))
watch(markdownModel, v => emit('updateMarkdownModel', v))

// ======================================================================
// ========== Pictures ➜ 注入到 Semantic Source Gallery 的 items ==================
// ======================================================================

/**
 * 目录约定：
 *   src/assets/pictures/<folder>/<anything>.(png|jpg|jpeg|gif|webp|svg)
 * <folder> 即“主题/项目 id”，如 air / case1 / case2 / combust 等。
 * 初始为空；聊天文本命中主题 -> 显示该 folder 下所有图片，按自然序。
 */
const rawPicModules = import.meta.glob(
  '../assets/pictures/**/*.{png,jpg,jpeg,gif,webp,svg}',
  { eager: true, import: 'default' }
)
const rawPdfModules = import.meta.glob(
  '../assets/pdf/**/*.pdf',
  { eager: true, import: 'default' }
)

// 建索引：{ folderId: Array<{ name, url, path }> }，并按自然序排序
const galleryByFolder = ref({})
function naturalCompare(a, b) {
  const ax = a.match(/\d+|\D+/g) || [a]
  const bx = b.match(/\d+|\D+/g) || [b]
  const len = Math.max(ax.length, bx.length)
  for (let i = 0; i < len; i++) {
    const as = ax[i] || ''
    const bs = bx[i] || ''
    const an = Number(as), bn = Number(bs)
    const aNum = !Number.isNaN(an), bNum = !Number.isNaN(bn)
    if (aNum && bNum && an !== bn) return an - bn
    if (as !== bs) return as.localeCompare(bs)
  }
  return 0
}
function buildGalleryIndex() {
  const g = {}
  const seen = new Set() // 去重用
  for (const abs in rawPicModules) {
    const url = rawPicModules[abs]
    // abs 类似 "../assets/pictures/<folder>/.../xx.png"
    const rel = abs.replace('../assets/pictures/', '')
    const [folder, ...rest] = rel.split('/')
    if (!folder) continue
    const name = rest.join('/') // 相对 folder 的路径（用于展示/排序）
    // ★ 依据 URL 去重（同一资源不重复加入）
    if (seen.has(url)) continue
    seen.add(url)
    ;(g[folder] ||= []).push({ name, url, path: rel })
  }
  for (const k of Object.keys(g)) {
    g[k].sort((x, y) => naturalCompare(x.name, y.name))
  }
  galleryByFolder.value = g
  console.log('[Gallery] folders → counts:', Object.fromEntries(Object.entries(g).map(([k,v]) => [k, v.length])))
 
}
onMounted(buildGalleryIndex)

// 别名映射：按你的需求补/改
const FOLDER_ALIASES = {
  air: [
    'air', 'air pollution', 'pm2.5', 'pm25', 'particulate', 'aerosol',
    '空气', '空气污染', '雾霾', '颗粒物', '细颗粒物'
  ],
  combust: [
    // 英文
    'combust', 'combustion', 'engine combustion', 'combustor',
    'reacting flow', 'reactive flow', 'turbulent combustion',
    'premixed', 'non-premixed', 'diffusion flame', 'flamelet', 'fpv',
    'mixture fraction', 'progress variable', 'g-equation',
    'ignition', 'autoignition', 'detonation', 'deflagration',
    'les', 'dns', 'rans', 'cfd', 'navier-stokes',
    'shock', 'shock-induced', 'supersonic', 'hypersonic',
    'ramjet', 'scramjet', 'nozzle', 'inlet isolator',
    'combustion instability', 'thermoacoustic',
    'emissions', 'nox', 'soot', 'swirl',
    'spray', 'atomization', 'evaporation',
    'chemkin', 'cantera',
    // 中文
    '发动机燃烧', '湍流燃烧', '反应流', '反应性流动',
    '预混', '非预混', '扩散火焰', '火焰片', '火焰面',
    '混合分数', '进度变量', '点火', '自燃',
    '爆轰', '爆燃', '超声速', '高超声速',
    '冲压发动机', '超燃冲压', '燃烧不稳定', '热声不稳定',
    '排放', '氮氧化物', '烟炱', '旋流',
    '喷雾', '雾化', '蒸发', '等当量比', '化学计量比'
  ],
  case1: ['case1', 'project one', 'set1', '背景', 'background'],
  case2: ['case2', 'project two', 'set2', '方法', 'methods', 'method'],
  case3: ['case3', 'case 3', 'project three', 'set3', 'genome', 'genomic', 'genomics', 'circos', 'gosling', 'bioinformatics', '基因组', '生信', '环形基因组']
}
const FOLDER_TITLES = {
  air: 'Air',
  combust: 'Scramjet Combustion',
  case1: 'Case 1',
  case2: 'Case 2',
  case3: 'Genomics'
}
const FOLDER_PROJECT = {
  air: 'case2',
  combust: 'case1',
  case1: 'case1',
  case2: 'case2',
  case3: 'case3'
}
const FOLDER_PDF_DIR = {
  air: 'case2',
  combust: 'case1',
  case1: 'case1',
  case2: 'case2',
  case3: 'case3'
}
const FOLDER_SOURCE_OFFSETS = {
  combust: 1,
  case1: 1,
  air: 3,
  case2: 3,
  case3: 8
}
const GALLERY_PAPER_SOURCE_REGISTRY = {
  largeeddy: { projectId: 'case1', semanticCountryId: 'c1', sourceId: 'c1' },
  largeeddymsu: { projectId: 'case1', semanticCountryId: 'c1', sourceId: 'c1' },
  temporalflowviz: { projectId: 'case1', semanticCountryId: 'c2', sourceId: 'c2' },
  temporalflowvizmsu: { projectId: 'case1', semanticCountryId: 'c2', sourceId: 'c2' },
  compasstowardsbettercausalanalysisofurbantimeseries: { projectId: 'case2', semanticCountryId: 'c0', sourceId: 'c3' },
  improvingwrfchempm25predictionsbycombiningdataassimilationanddeeplearningbasedbiascorrection: { projectId: 'case2', semanticCountryId: 'c1', sourceId: 'c4' },
  threefoldreductionofmodeleduncertaintyindirectradiativeeffectsoverbiomassburningregionsbyconstrainingabsorbingaerosols: { projectId: 'case2', semanticCountryId: 'c2', sourceId: 'c5' },
  visualizinglargescalespatialtimeserieswithgeochron: { projectId: 'case2', semanticCountryId: 'c3', sourceId: 'c6' },
  volumebasedspacetimecubeforlargescalecontinuousspatialtimeseries: { projectId: 'case2', semanticCountryId: 'c4', sourceId: 'c7' },
  // case3 = 生信/基因组可视化 5 篇（semanticCountryId=c{paper_id} 对齐 data/case3 的 c0-c4）
  auragenome: { projectId: 'case3', semanticCountryId: 'c0', sourceId: 'c8' },
  circos: { projectId: 'case3', semanticCountryId: 'c1', sourceId: 'c9' },
  genorec: { projectId: 'case3', semanticCountryId: 'c2', sourceId: 'c10' },
  gosling: { projectId: 'case3', semanticCountryId: 'c3', sourceId: 'c11' },
  intellicircos: { projectId: 'case3', semanticCountryId: 'c4', sourceId: 'c12' }
}
function makeSourceKey(projectId, semanticCountryId) {
  return `${projectId || 'unknown'}|${semanticCountryId || 'unknown'}`
}
function normalizeAssetBase(name) {
  return (name.split('/').pop() || name)
    .replace(/\.(png|jpe?g|gif|webp|svg)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}
function fallbackSemanticCountryId(projectId, index) {
  if (projectId === 'case1') return `c${index + 1}`
  if (projectId === 'case2') return `c${index}`
  if (projectId === 'case3') return `c${index}`   // case3 国家为 c0-c4
  return `c${index + 1}`
}
function fallbackGlobalSourceId(folder, index) {
  const offset = FOLDER_SOURCE_OFFSETS[folder] ?? 1
  return `c${offset + index}`
}
function paperSourceInfoForImage(folder, img, index) {
  const base = normalizeAssetBase(img.name)
  const defaultProjectId = FOLDER_PROJECT[folder] || folder
  const registered = GALLERY_PAPER_SOURCE_REGISTRY[base]
  // Generated gallery manifests are the source of truth.  A few case3 paper
  // titles happen to match legacy short-name entries in the static registry;
  // preferring that registry remapped them to another paper's country id, so
  // coloring one gallery card also colored its incorrectly aliased neighbour.
  const projectId = img.projectId ?? img.project_id ?? registered?.projectId ?? defaultProjectId
  const semanticCountryId = img.semanticCountryId
    ?? img.countryId
    ?? img.paperCountryId
    ?? img.paper_id
    ?? registered?.semanticCountryId
    ?? fallbackSemanticCountryId(projectId, index)
  const sourceId = img.sourceId ?? registered?.sourceId ?? fallbackGlobalSourceId(folder, index)
  return {
    projectId,
    semanticCountryId,
    sourceId,
    sourceKey: makeSourceKey(projectId, semanticCountryId)
  }
}

function enrichLocalGalleryFromManifest(folder, manifestItems) {
  const localItems = galleryByFolder.value[folder] || []
  if (!localItems.length || !Array.isArray(manifestItems) || !manifestItems.length) return false

  // The manifest is the authoritative Gallery order as well as the
  // paper→country mapping.  Local filenames are only thumbnail assets.
  const localByTitle = new Map()
  localItems.forEach((img) => {
    const key = normalizeAssetBase(img.name)
    if (key && !localByTitle.has(key)) localByTitle.set(key, img)
  })

  const used = new Set()
  const enriched = []
  manifestItems.forEach((record) => {
    if (!record?.semanticCountryId) return
    const key = normalizeAssetBase(String(record.title || ''))
    const img = localByTitle.get(key)
    if (!img) return
    used.add(img)
    enriched.push({
      ...img,
      projectId: FOLDER_PROJECT[folder] || folder,
      semanticCountryId: record.semanticCountryId,
      sourceId: record.sourceId ?? record.semanticCountryId,
      paperId: record.paper_id
    })
  })
  if (!enriched.length) return false
  // Keep any non-manifest local assets visible, after the ordered papers.
  localItems.forEach((img) => {
    if (!used.has(img)) enriched.push(img)
  })
  galleryByFolder.value = { ...galleryByFolder.value, [folder]: enriched }
  return true
}
function folderTitle(folder) {
  // 优先用映射；没有映射就把下划线转空格并首字母大写
  if (FOLDER_TITLES[folder]) return FOLDER_TITLES[folder]
  return folder
    .split('/')
    .pop()
    .replace(/_/g, ' ')
    .replace(/^\w/, s => s.toUpperCase())
}

// 解析聊天文本 -> 目标 folder
function resolveFolderFromText(text) {
  const t = (text || '').toLowerCase()
  if (!t.trim()) return null

  // 先看是否直接包含现有文件夹名
  for (const folder of Object.keys(galleryByFolder.value || {})) {
    if (t.includes(folder.toLowerCase())) return folder
  }
  // 再走别名
  for (const [folder, aliases] of Object.entries(FOLDER_ALIASES)) {
    for (const a of aliases) {
      if (t.includes(a.toLowerCase())) return folder
    }
  }
  // “show <folder>” / “显示 <folder>”
  const m1 = t.match(/\bshow\s+([a-z0-9_\-]+)/)
  if (m1 && galleryByFolder.value[m1[1]]) return m1[1]
  const m2 = text.match(/显示\s*([a-zA-Z0-9_\-]+)/)
  if (m2 && galleryByFolder.value[m2[1]]) return m2[1]

  return null
}

// 清空命令
function isClearCommand(text) {
  const t = (text || '').toLowerCase()
  return (
    t.includes('hide all') ||
    t.includes('clear') ||
    t.includes('clear all') ||
    t.includes('empty') ||
    /清空|隐藏全部|全部隐藏|清除/.test(text || '')
  )
}

function isClearSubspaceCommand(text) {
  const raw = String(text || '')
  const t = raw.toLowerCase()
  if (!raw.trim()) return false
  return /\b(clear|hide)\s+all\s+subspaces?\b/.test(t)
    || (/清空|隐藏/.test(raw) && /所有|全部/.test(raw) && /子空间|subspace/i.test(raw))
}

 // 仅当明确出现“gallery / Semantic Source gallery / 图片库 / 图集 / collect”时，才走图片展示通道
function isGalleryCommand(text){
  const t = (text || '').toLowerCase()
  return (
    /\b(semantic\s*source\s*gallery|semantic\s*gallery|gallery)\b/.test(t) ||   // gallery / Semantic Source gallery
    /图片库|图集/.test(text || '') ||            // 中文触发词
    /^\s*collect\b/i.test(text || '')            // 你之前用的“collectxxxx”
  )
}

function isAutoGalleryTopic(text) {
  const t = (text || '').toLowerCase()
  return /\b(scramjet|ramjet|combustion|combustor|reacting\s+flow|reactive\s+flow|turbulent\s+combustion|supersonic|hypersonic)\b/.test(t)
    || /超燃冲压|冲压发动机|燃烧|反应流|湍流燃烧|超声速|高超声速/.test(text || '')
}

function pdfUrlForImage(folder, img) {
  if (img?.pdfUrl) return img.pdfUrl
  const pdfDir = FOLDER_PDF_DIR[folder] || folder
  const base = (img.name.split('/').pop() || img.name)
    .replace(/\.(png|jpe?g|gif|webp|svg)$/i, '')
    .toLowerCase()
  const candidates = Object.entries(rawPdfModules).map(([path, url]) => ({ path, url }))
  const inFolder = candidates.filter(x => x.path.includes(`/pdf/${pdfDir}/`))
  const exact = inFolder.find(x => {
    const pdfBase = (x.path.split('/').pop() || '').replace(/\.pdf$/i, '').toLowerCase()
    return pdfBase === base
  })
  if (exact) return exact.url
  const partial = inFolder.find(x => {
    const pdfBase = (x.path.split('/').pop() || '').replace(/\.pdf$/i, '').toLowerCase()
    return pdfBase.includes(base) || base.includes(pdfBase)
  })
  return partial?.url || img.url
}

// 将图片集合映射为 PaperList 的 items
function toPaperItems(folder, items) {
  // PaperList 未提供具体类型；给出常用字段：id/title/thumbUrl/meta
     return items.map((img, i) => {
     const base = img.name.split('/').pop() || img.name
     const pretty = base.replace(/\.(png|jpe?g|gif|webp|svg)$/i, '')
     const sourceInfo = paperSourceInfoForImage(folder, img, i)
     return {
       id: `${folder}::${img.path}`,
       globalIndex: i,
       // 提醒：PaperList 分组模式内部已按组维护选择，不强制全局唯一
       name: pretty,           // PaperList 优先显示 name
       title: pretty,          // 兜底
       content: img.url,       // ★ PaperList 用它当缩略图
       thumbUrl: img.url,      // 兼容
       pdfUrl: pdfUrlForImage(folder, img),        // 让“眼睛”优先打开对应论文 PDF
       projectId: sourceInfo.projectId,
       countryId: sourceInfo.semanticCountryId,
       semanticCountryId: sourceInfo.semanticCountryId,
       sourceId: sourceInfo.sourceId,
       sourceKey: sourceInfo.sourceKey,
       meta: { folder, ...sourceInfo }
     }
   })

}

// 方案 B：从后端 manifest 拉某 case 的 gallery（缩略图 + 国家/来源映射），灌进 galleryByFolder，
// 之后完全复用现有 toPaperItems / paperSourceInfoForImage 渲染链路（后者会自动读 item 自带的 semanticCountryId）。
const backendGalleryLoaded = ref({})
async function ensureBackendGallery(folder) {
  // Prefer the generated manifest when present: it is the only source that
  // stays in sync after a case is rebuilt with newly added papers.  Bundled
  // images remain a fallback for cases that have no generated manifest.
  // Always re-read the manifest when a gallery is shown. Apart from picking up
  // rebuilt case data, this repairs cards that were kept in memory before a
  // corrected paper→country mapping arrived.
  const projectId = FOLDER_PROJECT[folder] || folder
  try {
    // Do not cache a fallback result.  A case can finish building while this
    // page is open, and the next gallery command must then pick up its newly
    // generated manifest instead of retaining bundled demo images.
    const res = await fetch(`/api/gallery?project_id=${encodeURIComponent(projectId)}`, { cache: 'no-store' })
    if (!res.ok) return Boolean(galleryByFolder.value[folder]?.length)
    const data = await res.json()
    const manifestItems = Array.isArray(data.items) ? data.items : []
    const items = manifestItems.filter(it => it.thumbnail_url)
    if (!items.length) {
      // case2 ships its thumbnails with the frontend, but its paper identity
      // still comes from the backend manifest.  Merge the authoritative IDs
      // into those local image records instead of falling back to index order.
      const matchedLocalItems = enrichLocalGalleryFromManifest(folder, manifestItems)
      if (matchedLocalItems) {
        backendGalleryLoaded.value = { ...backendGalleryLoaded.value, [folder]: true }
        return true
      }
      return Boolean(galleryByFolder.value[folder]?.length)
    }
    backendGalleryLoaded.value = { ...backendGalleryLoaded.value, [folder]: true }
    galleryByFolder.value = {
      ...galleryByFolder.value,
      [folder]: items.map(it => ({
        name: it.title || `paper ${it.paper_id}`,
        url: it.thumbnail_url,
        path: `${folder}/${it.thumbnail || it.paper_id}`,
        projectId,
        semanticCountryId: it.semanticCountryId,
        sourceId: it.sourceId,
        pdfUrl: it.pdf_url || null,
      }))
    }
    return true
  } catch (e) {
    console.warn('[gallery] backend manifest fetch failed:', e)
    return Boolean(galleryByFolder.value[folder]?.length)
  }
}

// gallery 选论文 → 只显示选中论文(country)的子空间内容，冲突区随选择重算；未选=全部
function onGallerySelection(countryIds, selectedSources) {
  const activeProjectId = getActiveProjectId?.() || null
  const hasSourceIdentity = Array.isArray(selectedSources)
  const activeSources = hasSourceIdentity
    ? selectedSources.filter(source => !source?.projectId || source.projectId === activeProjectId)
    : []
  // Full source identities are emitted by PaperList. Fall back to the old
  // country-id-only event shape for callers outside this component.
  const activeCountryIds = hasSourceIdentity
    ? activeSources.map(source => source.countryId)
    : (Array.isArray(countryIds) ? countryIds : [])
  const ctrl = window?.SemanticMapCtrl
  if (ctrl && typeof ctrl.setVisibleCountries === 'function') {
    ctrl.setVisibleCountries(activeCountryIds)
  } else {
    // 控制器未就绪时排队，地图初始化后再应用
    window.__pendingVisibleCountries = activeCountryIds
  }
}

// 展示某个 folder：把图片灌进 Semantic Source Gallery
async function showFolder(folder) {
  await ensureBackendGallery(folder)      // 后端 manifest（case3+）；case1/2 走 bundled 资产、此处 no-op
  const imgs = (galleryByFolder.value[folder] || []).slice()
  // 外层标题也更新为最近一次加载的分组名（可选）
  paperQuery.value = folderTitle(folder)
  // 同一主题再次执行时刷新原分组，避免保留构建前的静态两篇图片。
  paperGroups.value = paperGroups.value.filter(g =>
    g?.folder !== folder && !String(g?.key || '').startsWith(`${folder}-`)
  )
  paperGroups.value.push({
     key: `${folder}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
     folder,
     title: folderTitle(folder),
     items: toPaperItems(folder, imgs)
  })
  messages.value.push({
    role:'assistant',
    type:'markdown',
    text:`Showing \`${folderTitle(folder)}\` — ${imgs.length} paper(s) in Semantic Source Gallery.`
  })
}

// ====== Chat ➜ Stepwise MSU semantic filter ==========================
const MSU_FILTER_CHUNK_SIZE = 80

function isMsuSemanticFilterCommand(text) {
  const raw = String(text || '')
  const t = raw.toLowerCase()
  if (!raw.trim()) return false
  const hasMsu = /\bmsus?\b/i.test(t) || /微语义单元|语义单元/.test(raw)
  const hasAction = /\b(filter|select|tick|check|choose|find|mark|pick)\b/i.test(t)
    || /筛选|过滤|勾选|选择|选中|查找|挑选/.test(raw)
  const hasSemantic = /\b(meanings?|means|semantic|semantics|related|relevant|about|topic|theme)\b/i.test(t)
    || /语义|含义|意思|相关|主题|关于/.test(raw)
  return hasMsu && hasAction && hasSemantic
}

function cleanMsuFilterIntentText(value) {
  return String(value || '')
    .replace(/\bplease\b/ig, ' ')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s.,;:，。；：!?！？]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractMsuFilterMeaning(text) {
  const raw = String(text || '').trim()
  const patterns = [
    /(?:with\s+the\s+meanings?\s+of|with\s+meanings?\s+of|semantic\s+meanings?\s+of|meanings?\s+of)\s+(.+)$/i,
    /(?:with|for)\s+(.+?)\s+meanings?$/i,
    /(?:meanings?|semantics?|theme|topic)\s*[:：]\s*(.+)$/i,
    /(?:about|related\s+to|relevant\s+to|on\s+the\s+topic\s+of)\s+(.+)$/i,
    /(?:语义|含义|意思|主题)(?:为|是|关于|相关|[:：])?\s*(.+)$/i,
    /(?:关于|有关|相关(?:于)?)[“"']?(.+?)[”"']?(?:的)?\s*(?:MSU|MSUs|语义单元)?$/i
  ]
  for (const pattern of patterns) {
    const m = raw.match(pattern)
    const cleaned = cleanMsuFilterIntentText(m?.[1])
    if (cleaned) return cleaned
  }

  const fallback = raw
    .replace(/\b(help\s+me\s+to|please|can\s+you|could\s+you)\b/ig, ' ')
    .replace(/\b(filter|select|tick|check|choose|find|mark|pick)\b/ig, ' ')
    .replace(/\bmsus?\b/ig, ' ')
    .replace(/\b(with|the|meanings?|means|semantic|semantics|of|related|relevant|about|to|topic|theme)\b/ig, ' ')
    .replace(/帮我|请|筛选|过滤|勾选|选择|选中|查找|挑选|语义|含义|意思|相关|关于|主题|的|为|是/g, ' ')
    .replace(/\s+/g, ' ')
  return cleanMsuFilterIntentText(fallback) || raw
}

function truncateForPrompt(text, limit = 320) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (s.length <= limit) return s
  return `${s.slice(0, limit - 1)}…`
}

function dedupeMsuCandidates(items) {
  const map = new Map()
  ;(items || []).forEach((item, index) => {
    if (!item?.uid) return
    const uid = String(item.uid)
    const existing = map.get(uid)
    if (existing) {
      existing.checked = existing.checked || Boolean(item.checked)
      existing.occurrences += 1
      return
    }
    map.set(uid, {
      ...item,
      uid,
      text: item.text || item.sentence || '',
      sourceIndex: index,
      occurrences: 1,
      checked: Boolean(item.checked)
    })
  })
  return Array.from(map.values()).filter(item => String(item.text || '').trim())
}

function formatMsuCandidateForPrompt(item, index) {
  const subspaces = Array.isArray(item.subspaces) && item.subspaces.length
    ? ` | subspaces=${item.subspaces.join(' -> ')}`
    : ''
  const paper = item.paperLabel ? ` | paper=${truncateForPrompt(item.paperLabel, 90)}` : ''
  const state = item.checked ? 'already_checked' : 'unchecked'
  return [
    `[${index + 1}] uid=${item.uid} | ${state} | hsu=${item.hsuKey || 'unknown'} | msu=${item.msuId ?? '?'}${subspaces}${paper}`,
    `Text: ${truncateForPrompt(item.text || item.sentence, 360)}`
  ].join('\n')
}

function buildMsuFilterPrompt(userText, intentSeed, chunk, chunkIndex, totalChunks) {
  const candidateLines = chunk.map((item, index) => formatMsuCandidateForPrompt(item, index)).join('\n\n')
  return `You are helping filter MSUs in the Stepwise Analysis View of a semantic map.

User request:
"""${userText}"""

Initial meaning phrase extracted from the request:
"""${intentSeed || userText}"""

This is batch ${chunkIndex + 1} of ${totalChunks}. Analyze only the candidate MSUs in this batch.

Task:
1. Infer the user's core semantic filtering intent in a short phrase.
2. Select candidate MSUs whose Text is directly semantically relevant to that intent.
3. Write one short user-facing answer explaining what you are filtering for.

Rules:
- Use the MSU Text as the main evidence. Do not select by paper title alone.
- Preserve specific domain terms in the inferred intent when they matter.
- Prefer precision over recall; exclude weak or merely adjacent matches.
- Already checked MSUs can appear in matches only if they are relevant.
- Return only valid JSON. Do not use markdown fences or extra prose.

JSON schema:
{"intent":"short semantic intent","answer":"one short sentence","matches":["uid-1","uid-2"]}

Candidate MSUs:
${candidateLines}`
}

function llmResultToText(res) {
  if (typeof res === 'string') return res
  return res?.payload?.text
    || res?.payload?.answer
    || res?.text
    || res?.answer
    || res?.summary
    || JSON.stringify(res)
}

function parseJsonObjectFromText(raw) {
  const text = String(raw || '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const braceStart = text.indexOf('{')
  const braceEnd = text.lastIndexOf('}')
  const braceText = braceStart >= 0 && braceEnd > braceStart ? text.slice(braceStart, braceEnd + 1) : ''
  const attempts = [fenced, text, braceText].filter(Boolean)
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // try next candidate
    }
  }
  return null
}

function normalizeMsuFilterMatches(parsed, chunk) {
  const raw = parsed?.matches || parsed?.uids || parsed?.matchedUids || parsed?.matched_uids || []
  const arr = Array.isArray(raw) ? raw : []
  const valid = new Set(chunk.map(item => String(item.uid)))
  const out = []

  arr.forEach(item => {
    let uid = null
    if (typeof item === 'number') {
      uid = chunk[item - 1]?.uid
    } else if (item && typeof item === 'object') {
      uid = item.uid ?? item.msu_uid ?? item.id
    } else if (typeof item === 'string') {
      const s = item.trim()
      uid = valid.has(s) ? s : (/^\d+$/.test(s) ? chunk[Number(s) - 1]?.uid : null)
    }
    if (uid != null && valid.has(String(uid))) out.push(String(uid))
  })

  return Array.from(new Set(out))
}

const MSU_FILTER_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'using', 'used',
  'about', 'related', 'meaning', 'semantic', 'semantics', 'msu', 'msus', 'filter'
])

function tokenizeForFallback(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 2 && !MSU_FILTER_STOP_WORDS.has(t))
}

function keywordFallbackMsuMatches(chunk, intent) {
  const terms = tokenizeForFallback(intent)
  if (!terms.length) return []
  const needed = terms.length === 1 ? 1 : Math.min(2, terms.length)
  return chunk
    .filter(item => {
      const text = `${item.text || ''} ${item.category || ''}`.toLowerCase()
      const hits = terms.filter(term => text.includes(term)).length
      return hits >= needed
    })
    .map(item => String(item.uid))
}

function chunkArray(items, size) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

async function runMsuSemanticFilter(msg) {
  const candidates = dedupeMsuCandidates(collectStepwiseMsuCandidates())
  if (!candidates.length) {
    messages.value.push({
      role: 'assistant',
      type: 'markdown',
      text: 'I could not find any MSUs in the current Stepwise Analysis View. Save or open a stepwise selection first, then try the filter again.'
    })
    return
  }

  const intentSeed = extractMsuFilterMeaning(msg)
  const chunks = chunkArray(candidates, MSU_FILTER_CHUNK_SIZE)
  const matchedUids = new Set()
  let inferredIntent = intentSeed
  let answer = ''
  let usedFallback = false

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]
    const prompt = buildMsuFilterPrompt(msg, intentSeed, chunk, i, chunks.length)
    try {
      const res = await sendQueryToLLM(prompt, selectedLLM.value, { task: 'stepwise_msu_filter' })
      const parsed = parseJsonObjectFromText(llmResultToText(res))
      if (!parsed) throw new Error('The LLM did not return valid JSON.')
      if (parsed.intent && (!inferredIntent || inferredIntent === intentSeed)) {
        inferredIntent = String(parsed.intent).trim()
      }
      if (parsed.answer && !answer) answer = String(parsed.answer).trim()
      normalizeMsuFilterMatches(parsed, chunk).forEach(uid => matchedUids.add(uid))
    } catch (err) {
      console.warn('[LeftPane] semantic MSU filter fell back to keywords:', err)
      usedFallback = true
      keywordFallbackMsuMatches(chunk, intentSeed || msg).forEach(uid => matchedUids.add(uid))
    }
  }

  const uids = Array.from(matchedUids)
  const applied = emitApplyStepwiseMsuFilter({
    uids,
    query: msg,
    intent: inferredIntent || intentSeed
  })

  const intentText = cleanMsuFilterIntentText(inferredIntent || intentSeed || msg)
  const baseAnswer = answer || `I interpreted the filter as: ${intentText}.`
  const status = uids.length
    ? `Checked ${applied.newlyChecked} new MSU checkbox(es); ${applied.alreadyChecked} matched checkbox(es) were already selected.`
    : 'I did not find MSUs that were semantically close enough to check.'
  const fallbackNote = usedFallback
    ? '\n\nNote: One or more LLM batches did not return valid JSON, so I used a conservative keyword fallback for those batches.'
    : ''

  messages.value.push({
    role: 'assistant',
    type: 'markdown',
    text: `${baseAnswer}\n\nIntent: \`${intentText}\`\n\n${status}${fallbackNote}`
  })
}

// ====== 发送消息：本地解析优先（命中 -> 更新 Semantic Source  Gallery），否则后端 ======
async function handleSend(msg) {
  messages.value.push({ role: 'user', type:'text', text: msg })

  // A0) 只拦截一个窄命令：clear/hide all subspaces，避免误清 Gallery。
  // 其他 show/case/gallery 逻辑保持原链路。
  if (isClearSubspaceCommand(msg)) {
    try {
      const ctrl = window?.SemanticMapCtrl
      const router = window?.CommandRouter
      const cmd = 'hide all subspaces'
      if (ctrl && router) {
        const ret = router.routeCommand(ctrl, cmd)
        messages.value.push({ role:'assistant', type:'markdown', text: ret?.message || 'Done.' })
      } else {
        window.__pendingSubspaceCmds = window.__pendingSubspaceCmds || []
        window.__pendingSubspaceCmds.push(cmd)
        messages.value.push({ role:'assistant', type:'markdown', text:'Subspace command queued.' })
      }
    } catch (e) {
      console.warn('[LeftPane] UI route error:', e)
      messages.value.push({ role:'assistant', type:'error', text:`Subspace command failed: ${e.message || e}` })
    }
    return
  }

  // A) 清空命令（恢复原先 gallery 清理逻辑；上面的 clear subspace 已提前处理）
  if (isClearCommand(msg)) {
    onClearPaper()
    messages.value.push({ role:'assistant', type:'markdown', text:'Cleared Semantic Source Gallery.' })
    return
  }

  // B0) Stepwise MSU 语义筛选：LLM 解析意图并自动勾选右侧相关 MSU
  if (isMsuSemanticFilterCommand(msg)) {
    await runMsuSemanticFilter(msg)
    return
  }

  // B) Gallery 命令（必须带有 'gallery' / 'Semantic Source gallery' / '图集' / 'collect' 等关键词）
   if (isGalleryCommand(msg) || isAutoGalleryTopic(msg)) {
     const folder = resolveFolderFromText(msg)
     if (folder) { await showFolder(folder); return }
     messages.value.push({
       role:'assistant', type:'error',
       text:'No matching gallery folder. Try: “gallery air” or “Scramjet Combustion”.'
     })
     return
   }
 
  // D) 走后端 LLM（保留你的原逻辑）
  try {
    const res = await sendQueryToLLM(msg, selectedLLM.value, {
      messages: messages.value
      // 如果你将来想显式标记子空间命令，也可以在这里按需加上：
      // task: /subspace/i.test(msg) ? 'subspace' : undefined
    })
    if (typeof res === 'string') {
      messages.value.push({ role: 'assistant', type:'markdown', text: res })
    } else {
      const view = interpretLLMResponse(res)
      if (view.type === 'rag-projects') {
        messages.value.push({ role:'assistant', type:'markdown', text: `**Available projects:** ${view.projects.join(', ')}` })
      } else if (view.type === 'rag-index') {
        const reused = view.stats?.reused ? ' (reused)' : ''
        const chunks = view.stats?.total_chunks ?? view.stats?.built ?? '—'
        messages.value.push({ role:'assistant', type:'markdown', text: `**Index for \`${view.projectId}\` ready.** Chunks/Built: ${chunks}${reused}` })
      } else if (view.type === 'rag-answer') {
        messages.value.push({ role:'assistant', type:'markdown', text: view.text || 'Done.' })
      } else if (view.type === 'error') {
        messages.value.push({ role:'assistant', type:'error', text: view.text || 'Unknown error' })
      } else {
        messages.value.push({ role:'assistant', type:'markdown', text: 'Done.' })
        console.log('RAW JSON:', res)
      }
    }
  } catch (err) {
    messages.value.push({ role: 'assistant', type:'error', text: `调用失败：${err.message}` })
  }
}
</script>

<template>
  <div ref="leftPaneShellRef" class="lp-shell" :style="leftPaneShellStyle">
    <!-- 1) Control Panel -->
    <section class="lp-card">
      <header class="card__title">Control Panel</header>
      <div class="lp-card__body cp-stack">
        <div class="cp-block">
          <div class="cp-label-top">Global System Prompt</div>
          <textarea class="cp-input cp-textarea" v-model="systemPrompt" />
        </div>

        <div class="cp-divider"></div>

        <div class="cp-block">
          <div class="cp-label-top">Upload PDFs to Markdown</div>
          <input type="file" accept=".pdf" multiple class="cp-input cp-file-input" @change="handlePdfUpload" />
          <div v-if="uploadedFiles.length" class="cp-files">
            <span class="cp-file" v-for="(f, i) in uploadedFiles" :key="i">{{ f.name }}</span>
          </div>
        </div>

        <div class="cp-divider"></div>

        <div class="cp-block">
          <div class="cp-label-top">
            HSU Aggregation Scale
            <span class="cp-note" v-if="neighborhoodSize">~{{ neighborhoodSize }} MSUs / neighborhood</span>
          </div>
          <div class="cp-slider">
            <input type="range" :min="hexMin" :max="hexMax" :step="hexStep" v-model="hexRadius" aria-label="HSU aggregation scale" />
            <input class="cp-number" type="number" :min="hexMin" :max="hexMax" :step="hexStep" v-model.number="hexRadius" aria-label="HSU aggregation scale value" />
            <span class="cp-unit">scale</span>
          </div>
        </div>
      </div>
    </section>

    <div
      class="lp-pane-resizer"
      role="separator"
      aria-label="Resize Control Panel and Semantic Source Gallery"
      @pointerdown.prevent="startLeftPaneResize(0, $event)"
    ></div>

    <!-- 2) Semantic Source Gallery（用图片列表直接填充） -->
    <section class="lp-card">
      <header class="card__title">
        Semantic Source Gallery
      </header>
      <div class="lp-card__body scroll-auto-hide">
          <PaperList
           v-if="paperGroups.length"
           :key="paperQuery  + '::' +  paperGroups.length"
           ref="paperListRef"
           :title="paperQuery || 'Paper Query'"
           @update:title="val => (paperQuery = val)"
           :groups="paperGroups"
           :color-maps="galleryColorMaps"
           :use-demo="false"
           :dim-opacity="0.15"
           :tileMin="80"
           :thumbRatio="0.55"
           @open-pdf="({pdfUrl, name}) => openPdfModal(pdfUrl, name)"
           @update:groups="updatePaperGroups"
           @update:selectedCountries="onGallerySelection"
         />

        <!-- <div v-if="!papers.length" class="empty-hint" style="margin-top:8px;">
          <em>Empty.</em> Try:
          <div class="hint-code">show air</div>
          <div class="hint-code">show combust</div>
          <div class="hint-code">帮我看看发动机燃烧数值模拟的资料</div>
          <div class="hint-code">清空图片 / hide all</div>
        </div> -->
      </div>
    </section>

    <div
      class="lp-pane-resizer"
      role="separator"
      aria-label="Resize Semantic Source Gallery and Chat with LLM"
      @pointerdown.prevent="startLeftPaneResize(1, $event)"
    ></div>

    <!-- 3) Chat -->
    <section class="lp-card lp-chat">
      <header class="card__title">Chat with LLM</header>
      <div ref="msgBoxRef" class="lp-msgs" @scroll="onMsgsScroll">
        <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
          <MarkdownView v-if="m.role==='assistant' && m.type!=='error'" :source="m.text" />
          <div v-else-if="m.type==='error'" class="msg-bubble err">{{ m.text }}</div>
          <div v-else class="msg-bubble">{{ m.text }}</div>
        </div>
      </div>
      <ChatDock @send="handleSend" @upload-files="handleUploadFiles" @dock-resize="onChatDockResize" />
    </section>
  </div>
</template>

<style scoped>
/* 布局 */
.lp-shell{ height:100%; display:grid; grid-template-rows:1.55fr 10px 1.3fr 10px 1.5fr; gap:0; background:#f3f4f6; overflow:hidden; }
.lp-card{ --r:12px; background:#fff; border-radius:var(--r); display:flex; flex-direction:column; min-height:0; overflow:hidden; }
.lp-pane-resizer{
  position:relative;
  min-height:10px;
  cursor:row-resize;
  touch-action:none;
  user-select:none;
  z-index:2;
}
.lp-pane-resizer::before{
  content:'';
  position:absolute;
  left:50%;
  top:50%;
  width:44px;
  height:3px;
  border-radius:999px;
  background:#cbd5e1;
  box-shadow:0 0 0 2px #f3f4f6;
  transform:translate(-50%,-50%);
  opacity:.65;
  transition:width .15s ease, background .15s ease, opacity .15s ease;
}
.lp-pane-resizer:hover::before{
  width:62px;
  background:#64748b;
  opacity:1;
}
.card__title{ font-size:var(--panel-title-size); font-weight:var(--panel-title-weight); color:#333; border-bottom:1px solid #eee; padding:8px 10px; }
.lp-card__body{ padding:6px 8px; overflow:auto; min-height:0; border-bottom-left-radius:var(--r); border-bottom-right-radius:var(--r); background-clip:padding-box; scrollbar-width:none; }
.lp-card__body::-webkit-scrollbar{ width:0; height:0; }

/* Chat */
.lp-chat{ display:grid; grid-template-rows:auto 1fr auto; overflow:hidden; }
.lp-msgs{ gap:8px; padding:12px 0; overflow:auto; min-height:0; display:flex; flex-direction:column; scrollbar-gutter:stable both-edges; scrollbar-width:thin; scrollbar-color:transparent transparent; }
.lp-msgs::-webkit-scrollbar{ width:8px; height:8px; }
.lp-msgs::-webkit-scrollbar-thumb{ background:transparent; border-radius:4px; }
.lp-msgs::-webkit-scrollbar-track{ background:transparent; }
.lp-msgs:hover{ scrollbar-color:rgba(0,0,0,.25) transparent; }
.lp-msgs:hover::-webkit-scrollbar-thumb{ background:rgba(0,0,0,.25); }

.msg{ display:flex; min-width:0; }
.msg.user{ justify-content:flex-end; }
.msg .msg-bubble{ max-width:90%; padding:8px 10px; border-radius:10px; font-size:11px; background:#f3f4f6; }
.msg.user .msg-bubble{ background:#111; color:#fff; margin-right:11px; }
.msg .err{ background:#fee2e2; color:#b91c1c; }

/* 让 Markdown 泡泡与纯文本泡泡风格一致 */
.msg.assistant :deep(.markdown-body){
  max-width:90%; background:#f3f4f6; padding:8px 10px; border-radius:10px; font-size:11px;
}

/* Control Panel — Gray Theme (colors only) */
.cp-stack{ display:flex; flex-direction:column; gap:7px; }
.cp-block{ display:flex; flex-direction:column; gap:5px; }

.cp-label-top{ font-size:11px; color:#374151; font-weight:650;
  display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
.cp-note{ font-size:10px; color:#8a8a8a; font-weight:400; white-space:nowrap; }

.cp-input{
  width:100%; box-sizing:border-box; font-size:12px;
  color:#111; background:#fff; border:1px solid #d1d5db; border-radius:6px;
}
.cp-input::placeholder{ color:#9ca3af; }
.cp-input:focus{ outline:none; border-color:#cbd5e1; box-shadow:0 0 0 3px #e5e7eb; }

.cp-select{
  padding:6px 8px; font-size:11px; background:#fff; color:#111;
  border:1px solid #d1d5db; border-radius:6px;
}
.cp-select:focus{ outline:none; border-color:#cbd5e1; box-shadow:0 0 0 3px #e5e7eb; }

.cp-textarea{
  min-height:108px; font-size:11px; line-height:1.45; padding:8px 9px; resize:vertical;
  color:#111; background:#fff; border:1px solid #d1d5db; border-radius:6px;
}
.cp-textarea::placeholder{ color:#9ca3af; }
.cp-textarea:focus{ outline:none; border-color:#cbd5e1; box-shadow:0 0 0 3px #e5e7eb; }

.cp-file-input{
  font-size:11px; padding:7px 8px; color:#111;
  border:1px dashed #d1d5db; border-radius:6px; background:#f7f7f7;
}
.cp-file-input:hover{ background:#f3f4f6; }

.cp-file{
  font-size:10px; padding:2px 6px; color:#111;
  background:#f3f4f6; border:1px solid #e5e7eb; border-radius:5px;
}

.cp-slider{ display:inline-flex; align-items:center; gap:6px; width:100%; }
.cp-slider input[type="range"]{ flex:1 1 auto; accent-color:#111; }
.cp-number{ width:60px; font-size:11px; padding:4px 6px; text-align:right; color:#111;
  background:#fff; border:1px solid #d1d5db; border-radius:6px; }
.cp-unit{ font-size:11px; color:#666; min-width:16px; }
.cp-hint{ font-size:10px; color:#777; margin-top:2px; }
.cp-divider{ width:100%; border-bottom:1px dashed #ddd; margin:5px 0; }

/* 为空提示的样式复用 */
.empty-hint{ font-size:11px; color:#666; line-height:1.5; }
.empty-hint .hint-code{
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  background:#f3f4f6; border:1px solid #e5e7eb; border-radius:6px; padding:4px 6px; display:inline-block; margin:3px 0;
}

/* 可选：原生控件统一灰主题，避免系统蓝 */
input[type="checkbox"], input[type="radio"], progress, meter { accent-color:#111; }
</style>
