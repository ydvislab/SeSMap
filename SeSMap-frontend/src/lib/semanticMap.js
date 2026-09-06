
/* === Random color helpers (top-level, guaranteed) === */
// var COLOR_PALETTE = (typeof COLOR_PALETTE !== 'undefined' && COLOR_PALETTE) ? COLOR_PALETTE : [
//   '#A9D08D', '#FFD966', '#9DC3E6', '#F4B183', '#C9B5F4',
//   '#F8CBAD', '#B7DEE8', '#C6E0B4', '#FFE699', '#BDD7EE',
//   '#C5E0B3', '#D9E1F2', '#E2F0D9', '#FCE4D6', '#EAD1DC'
// ];
var COLOR_PALETTE = (typeof COLOR_PALETTE !== 'undefined' && COLOR_PALETTE) ? COLOR_PALETTE : [
  '#4C78A8',
  '#72B7B2',
  '#54A24B',
  '#B279A2',
  '#E45756',
  '#F58518',
  '#EECA3B',
  '#9D755D',
  '#7F7F7F',
  '#A0CBE8'
];

let semanticMapInstanceSeq = 0;

function collectUsedPaletteColors(extraColors = []) {
  var used = new Set();
  try {
    if (typeof App !== 'undefined' && App) {
      App.globalCountryColors?.forEach?.(function(color){ if (color) used.add(String(color).toUpperCase()); });
      App.panelCountryColors?.forEach?.(function(countryMap){
        countryMap?.forEach?.(function(rec){ if (rec?.color) used.add(String(rec.color).toUpperCase()); });
      });
      App.panelConflictColors?.forEach?.(function(rec){ if (rec?.color) used.add(String(rec.color).toUpperCase()); });
      if (App._pendingColorEdit?.color) used.add(String(App._pendingColorEdit.color).toUpperCase());
      if (App._pendingConflictEdit?.color) used.add(String(App._pendingConflictEdit.color).toUpperCase());
    }
  } catch (_) {}
  (extraColors || []).forEach(function(color) {
    if (color) used.add(String(color).toUpperCase());
  });
  return used;
}

var pickRandomColor = (typeof pickRandomColor === 'function') ? pickRandomColor : function(seedStr, extraUsedColors){
  var arr = COLOR_PALETTE; if (!arr || !arr.length) return '#4C78A8';
  var used = collectUsedPaletteColors(extraUsedColors);
  var h = 0;
  if (seedStr) {
    for (var i = 0; i < seedStr.length; i++) h = (h * 33 + seedStr.charCodeAt(i)) | 0;
  }
  var seedIndex = Math.abs(h) % arr.length;
  var ordered = arr.map(function(color, i) {
    return { color: color, idx: i, seedDistance: Math.abs(i - seedIndex) };
  });

  var unused = ordered.filter(function(it){ return !used.has(String(it.color).toUpperCase()); });
  var candidates = unused.length ? unused : ordered;
  if (!used.size) return candidates[seedIndex % candidates.length].color;

  function rgb(hex) {
    var s = String(hex || '').replace('#', '');
    if (s.length !== 6) return [0, 0, 0];
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }
  function luminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function distance(a, b) {
    var x = rgb(a), y = rgb(b);
    var dr = x[0] - y[0], dg = x[1] - y[1], db = x[2] - y[2];
    return Math.sqrt(dr * dr + dg * dg + db * db) + Math.abs(luminance(x[0], x[1], x[2]) - luminance(y[0], y[1], y[2])) * 0.7;
  }

  var usedArr = Array.from(used);
  candidates.sort(function(a, b) {
    var da = Math.min.apply(null, usedArr.map(function(c){ return distance(a.color, c); }));
    var db = Math.min.apply(null, usedArr.map(function(c){ return distance(b.color, c); }));
    if (db !== da) return db - da;
    return a.seedDistance - b.seedDistance;
  });
  return candidates[0].color;
};
try { if (typeof App !== 'undefined' && App) { App.pickRandomColor = pickRandomColor; } } catch(_) {}
/* === End random color helpers === */
// src/lib/semanticMap.js
import * as d3 from 'd3';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/* =========================
 * 样式与常量（集中）
 * ========================= */
const STYLE = {
  CONFLICT_GRAY: '#DCDCDC',
  HEX_RADIUS: 16,
  HEX_BORDER_WIDTH: 1.2,
  HEX_BORDER_COLOR: '#ffffff',
  // HEX_FILL_TEXT: '#a9d08d',
  // HEX_FILL_IMAGE: '#a6cee3',
  HEX_FILL_TEXT: '#DCDCDC',
  HEX_FILL_IMAGE: '#DCDCDC',
  HEX_FILL_DEFAULT: '#ffffff',

  OPACITY_DEFAULT: 0.2,
  OPACITY_HOVER: 1.0,
  OPACITY_SELECTED: 1.0,
  OPACITY_NEIGHBOR: 0.6,
  OPACITY_PREVIEW: 0.5,      // 预览（待选）态透明度
  HATCH_ID: 'preview-hatch', // 预览斜线填充的 <pattern> id

  // --- ALT（国家预览）态 ---
  OPACITY_ALT_ACTIVE: 0.95,     // 当前国家的格子
  OPACITY_ALT_OTHER:  0.08,     // 其它国家/无归属格子
  BORDER_ALT_ACTIVE:  0.95,     // 当前国家的边界线透明度
  BORDER_ALT_OTHER:   0,      // 其它国家的边界线透明度（含虚线）

  CITY_RADIUS: 3.5,
  CITY_BORDER_WIDTH: 1.2,
  CITY_FILL: '#ffffff',     // 城市填充：白色
  CAPITAL_FILL: '#000',     // 首都内圆：黑色
  CITY_BORDER_COLOR: '#777777',

  FLIGHT_COLOR: '#4a5f7e',
  FLIGHT_WIDTH: 1.2,
  FLIGHT_OPACITY: 0.98,
  FLIGHT_DASH: '3,2',
  FLIGHT_CONTROL_RATIO: 0.18,
  FLIGHT_TEMP_WIDTH: 1.2,
  FLIGHT_TEMP_OPACITY: 0.72,
  FLIGHT_TEMP_DASH: '3,2',

  ROAD_COLOR: '#e9c46b',
  ROAD_WIDTH: 1.2,
  ROAD_OPACITY: 0.88,
  ROAD_DASH: null,

  RIVER_COLOR: '#e9c46b',
  // RIVER_COLOR: '#a6cee3',
  RIVER_WIDTH: 1.2,
  RIVER_OPACITY: 0.88,
  RIVER_DASH: null,

  COUNTRY_BORDER_COLOR: '#292929ff',
  COUNTRY_BORDER_WIDTH: 1,
  COUNTRY_BORDER_DASH: "2,1",

  PLAYGROUND_PADDING: 12,
  CLICK_DELAY: 350,

  SUBSPACE_MIN_W: 360,
  SUBSPACE_MIN_H: 400,
  SUBSPACE_GAP: 20,
  SUBSPACE_DEFAULT_LEFT: 30,
  SUBSPACE_DEFAULT_TOP: 30,
  
   // --- preview 透明度 ---
  OPACITY_PREVIEW_CENTER: 0.85,   // 鼠标所在 hex（中心）
  OPACITY_PREVIEW_NEIGHBOR: 0.7,  // 与中心点“有关系”的预览邻居
  OPACITY_ALT_FADE: 0.08,   // Alt 国家聚焦时：非该国家的 hex 统一降到这层透明度
  OPACITY_SELECTED_MIN: 0.96,

  // --- 斜线阴影样式 ---
  HATCH_SPACING: 5,               // 斜线间距（px）
  HATCH_STROKE: '#000',           // 斜线颜色（可依据主题调）
  HATCH_STROKE_WIDTH: 0.8,          // 斜线粗细
  HATCH_OPACITY: 0.6,            // 斜线透明度
  HATCH_ANGLE: 45,                // 斜线角度（度）

  FOCUS_COUNTRY_FILL: '#FCFCFC',   // Alt 聚焦国家的统一填充色（不区分 modality）
  OPACITY_NONFOCUS: 0.08,          // Alt 聚焦时，非该国家 hex 的压暗透明度

  // MSU → 透明度映射区间：MSU 越少越透明，越多越实。
  // 使用全项目稳健参考值，避免单个极端 HSU 把大多数点压得过浅。
  OPACITY_MSU_MIN: 0.22,
  OPACITY_MSU_MAX: 0.9,
  OPACITY_MSU_REFERENCE_QUANTILE: 0.9,
  // 高亮透明度“加成”而不是绝对值：final = base + (1-base)*boost
  OVERLAY_ALPHA_BOOST: {
    hover: 0.15,          // 悬停 / 航线起点/hover
    previewCenter: 0.12,  // 预览中心
    previewNeighbor: 0.08,// 预览邻居
    selected: 0.20        // 选中（无覆盖色时）
  },

};

// src/lib/semanticMap.js（在 STYLE 下方添加）
const LAYOUT = {
  TARGET_COLS: 3,          // 目标列数（默认 3）
  MAX_COLS: 5,             // 大屏最多 4 列（可按需改）
  MIN_COLS: 1,
  GAP: 20,                 // 卡片间距，沿用你已有的 SUBSPACE_GAP 也可
  PAD_H: 12,               // playground 水平内边距
  ASPECT: 0.72,            // 高/宽，决定子空间纵横比（可调 0.7~0.8）
  MIN_W: STYLE.SUBSPACE_MIN_W,
  MIN_H: STYLE.SUBSPACE_MIN_H,
};

const DEFAULT_AGGREGATION_RANGE = 32;


/* =========================
 * 初始化入口
 * ========================= */
export async function initSemanticMap({
  outerEl,
  playgroundEl,
  globalOverlayEl,
  mainTitleEl,
  initialData,
  initialProjectId = null,
  initialHidden = true
}) {

  playgroundEl = playgroundEl || document.getElementById('playground');
  globalOverlayEl = globalOverlayEl || document.getElementById('global-overlay');
  if (!playgroundEl || !globalOverlayEl) {
    throw new Error('[semanticMap] playgroundEl/globalOverlayEl is missing.');
  }

  /* =========================
   * App 状态
   * ========================= */
  const instanceId = `semantic-map-${++semanticMapInstanceSeq}`;
  const App = {
    instanceId,
    config: {
      hex: {
        radius: STYLE.HEX_RADIUS,
        fillOpacity: STYLE.OPACITY_DEFAULT,
        altOtherOpacity: STYLE.OPACITY_ALT_OTHER,
        borderWidth: STYLE.HEX_BORDER_WIDTH,
        borderColor: STYLE.HEX_BORDER_COLOR,
        textFill: STYLE.HEX_FILL_TEXT,
        imageFill: STYLE.HEX_FILL_IMAGE,
        zIndex: 1,
        borderDash: STYLE.COUNTRY_BORDER_DASH,
      },
      city: {
        radius: STYLE.CITY_RADIUS,
        borderWidth: STYLE.CITY_BORDER_WIDTH,
        fill: STYLE.CITY_FILL,
        capitalFill: STYLE.CAPITAL_FILL,
        borderColor: STYLE.CITY_BORDER_COLOR,
        zIndex: 3,
      },
      flight: {
        color: STYLE.FLIGHT_COLOR,
        width: STYLE.FLIGHT_WIDTH,
        opacity: STYLE.FLIGHT_OPACITY,
        dash: STYLE.FLIGHT_DASH,
        tempWidth: STYLE.FLIGHT_TEMP_WIDTH,
        tempOpacity: STYLE.FLIGHT_TEMP_OPACITY,
        tempDash: STYLE.FLIGHT_TEMP_DASH,
        zIndex: 100,
        controlCurveRatio: STYLE.FLIGHT_CONTROL_RATIO,
      },
      road:  { color: STYLE.ROAD_COLOR,  width: STYLE.ROAD_WIDTH,  opacity: STYLE.ROAD_OPACITY,  dash: STYLE.ROAD_DASH,  zIndex: 2 },
      river: { color: STYLE.RIVER_COLOR, width: STYLE.RIVER_WIDTH, opacity: STYLE.RIVER_OPACITY, dash: STYLE.RIVER_DASH, zIndex: 2 },
      countryBorder: { color: STYLE.COUNTRY_BORDER_COLOR, width: STYLE.COUNTRY_BORDER_WIDTH },
      background: STYLE.HEX_FILL_DEFAULT,
      playground: { padding: STYLE.PLAYGROUND_PADDING },
    },

    // 渲染缓存
    subspaceSvgs: [],
    overlaySvgs: [],
    hexMapsByPanel: [],
    hexBucketsByPanel: [],
    allHexDataByPanel: [],
    zoomStates: [],
    panelStates: [],

    // 交互状态
    _lastLinks: [],
    currentMouse: { x: 0, y: 0 },
    selectedHex: null,
    lastSelectionKind: null, // 'conflict' | 'group' | 'route' | 'connect' | null

    neighborKeySet: new Set(),
    flightStart: null,
    flightHoverTarget: null,
    hoveredFlightId: null,
    flightDeleteTimer: null,
    flightDeleteHideTimer: null,
    flightHoverClient: null,
    flightDeleteAnchor: null,
    flightDeleteTargetId: null,
    flightDeleteTargetLink: null,
    flightDeleteTargetSignature: null,
    hoveredHex: null,
    highlightedHexKeys: new Set(),  // ★ NEW：仅用于 hover 预览
    _clickTimer: null,
    _awaitingSingle: false,   // ★ NEW：是否在等待触发单击处理
    _lastClickAt: 0,          // ★ NEW：最近一次 click 的时间戳（非必须，但留作需要）
    insertMode: null, 
    uiPref: {
      route: false,          // 按钮想保持“Route Select 绿色”
      connectArmed: false,   // 按钮想保持“Connect 黄色（armed）”
      area: false,           // 鼠标点击 Area Select 后保持 Alt/区域选择模式
    },
    //程序性布局/尺寸调整时，静默 RO 标记
    _squelchResize: false,
    // 选中与快照
    persistentHexKeys: new Set(),
    excludedHexKeys: new Set(),
    selectedRouteIds: new Set(),
    selectedEdgeKeys: new Set(),  // NEW: selected single-edge set (undirected keys)   // ★ 新增：当前被选中的“整条线路”的 id 集合（统计 road/river/flight）
    modKeys: { ctrl: false, meta: false, shift: false, alt: false },
    _isConfirmingAltColor: false,
    _lastSnapshot: null,
    activeAltCountry: null,

    // 每个 panel 的 { country_id -> Set<"panel|q,r"> }
    countryKeysByPanel: [],

    // 回调 & 容器
    onSubspaceRename: null,
    onMainTitleRename: null,
    // ★ FIX: 点击 hex 时把完整 MSU 数据抛给上层（可选）
    onHexClick: null,
    playgroundEl,
    globalOverlayEl,

    // 数据
    currentData: null,
    currentProjectId: initialProjectId || initialData?.project_id || initialData?.projectId || null,
    countryKeysGlobal: new Map(),   // ★ 新增：全局 { country_id -> Set("panel|q,r") }
    focusCountryId: null,   // ★ 当前 Alt 高亮的国家（跨面板生效）
    focusMode: 'filled',      // ★ 新增：'filled' | 'outline'

    // —— Alt 聚焦隔离 & 面板级聚焦覆盖 —— //
    altIsolatedPanels: new Set(),     // 被隔离 Alt 聚焦的面板索引集合（复制面板会加入）
    panelFocusOverrides: new Map(),   // panelIdx -> { countryId, mode: 'filled'|'outline' }
    hsuSummaryCache: new Map(),
    hsuSummaryPending: new Map(),
    hsuSummaryHoverTimer: null,
    hsuSummaryHoverTarget: null,
    hoveredTooltipBucket: null,
    lastHexTooltipClient: null,

    // ★ 新增：全局（跨子空间）国家颜色表 + 开关
    globalCountryColors: new Map(),  // Map<normalizedCountryId, "#RRGGBB">
    syncCountryColorAcrossPanels: true, // 打开后，任何一次给某国设色，会同步到全部子空间

    
    routeDraft: null,

  }
  // record initialHidden flag
  App.initialHidden = !!initialHidden;
  
  // 3) 提前“声明”一个 controller 变量，供后面闭包引用（避免 TDZ）
  let controller;
  const cleanupFns = [];

  /* =========================
   * 小工具
   * ========================= */
  // ======== Fuzzy helpers（放在 controller 定义的同一作用域）========
  const __getSubspaceEls = () =>
    Array.from((App?.playgroundEl || document).querySelectorAll('.subspace'));

  const __getDomTitles = () =>
    __getSubspaceEls().map(el => {
      const t = el.querySelector('.subspace-title');
      return (t?.textContent || '').trim();
    });

  // 简单标准化：小写、去标点、合并空白、粗糙单复数归一
  function __normalize(s) {
    let x = String(s || '').toLowerCase().trim();
    x = x.normalize('NFKC');
    x = x.replace(/[，。、《》【】（）()“”"'`·:;|/\\]+/g, ' ');
    x = x.replace(/\s+/g, ' ').trim();
    if (x.endsWith('ies')) x = x.slice(0, -3) + 'y';
    else if (x.endsWith('ses')) x = x.slice(0, -2);
    else if (x.endsWith('s') && x.length > 3) x = x.slice(0, -1);
    return x;
  }

  // 容错：编辑距离 ≤ 1 认为近似
  function __lev1(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 1) return 2;
    let i = 0, j = 0, edits = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return edits;
      if (m > n) i++; else if (m < n) j++; else { i++; j++; }
    }
    if (i < m || j < n) edits++;
    return edits;
  }

  // 可扩展别名表（中英都放进来）
  const __ALIASES = {
    background: ['bg', '背景', 'intro', 'introduction', '研究背景'],
    method:     ['methods', '方法', 'approach', 'technique', '方法学'],
    result:     ['results', '结论', '结果', 'finding', 'findings', 'outcome', '研究结果'],
    experiment: ['experiments', '实验', 'exp'],
    discussion: ['discussions', '讨论'],
    conclusion: ['conclusions', '总结'],
    related:    ['related work', 'relatedwork', '相关工作', 'rw']
  };

  // 归一到规范化空间
  const __aliasCanon = new Map();          // canon -> Set(aliases)
  const __aliasReverse = new Map();        // alias -> Set(canons)
  Object.entries(__ALIASES).forEach(([k, arr]) => {
    const canon = __normalize(k);
    const set = new Set([canon, ...arr.map(__normalize)]);
    __aliasCanon.set(canon, set);
    set.forEach(a => {
      if (!__aliasReverse.has(a)) __aliasReverse.set(a, new Set());
      __aliasReverse.get(a).add(canon);
    });
  });


  const pkey = (panelIdx, q, r) => `${panelIdx}|${q},${r}`;
  // const pointId = (panelIdx, q, r) => `${panelIdx}:${q},${r}`;
  const isCtrlLike = (e) => !!(e.metaKey || e.ctrlKey);

  const styleOf = (t) =>
    (t === 'flight') ? App.config.flight
    : (t === 'river') ? App.config.river
    : App.config.road;

  const getHexFillColor = (d) =>
    d.modality === 'text'   ? App.config.hex.textFill
    : d.modality === 'image'? App.config.hex.imageFill
    : App.config.background;


  /* =========================
   * Panel layout mode (hex vs scatter)
   * ========================= */
  function _parseXY(v) {
    if (v == null) return null;
    // array: [x,y]
    if (Array.isArray(v) && v.length >= 2) {
      const x = Number(v[0]), y = Number(v[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
      return null;
    }
    // object: {x,y} or {0:..,1:..}
    if (typeof v === 'object') {
      const x = Number(v.x ?? v.X ?? v[0]);
      const y = Number(v.y ?? v.Y ?? v[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
      return null;
    }
    // string: "x,y" or "x y"
    if (typeof v === 'string') {
      const s = v.trim().replace(/[\[\]()]/g, '');
      const parts = s.split(/[^0-9eE+\-\.]+/).filter(Boolean);
      if (parts.length >= 2) {
        const x = Number(parts[0]), y = Number(parts[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
      }
    }
    return null;
  }

  /* =========================
   * Scatter alignment helpers
   * ========================= */

  function computeHexXYFromMsuIds(msuIds, msuIndex) {
    if (!msuIndex || !Array.isArray(msuIds) || msuIds.length === 0) return null;
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < msuIds.length; i++) {
      const id = msuIds[i];
      const m = msuIndex[id] || msuIndex[String(id)];
      if (!m) continue;
      const xy = _parseXY(m['2d_coord']);
      if (!xy) continue;
      sx += xy[0];
      sy += xy[1];
      n += 1;
    }
    if (n === 0) return null;
    return [sx / n, sy / n];
  }

  function _solve3x3(M, b) {
    // Gaussian elimination with partial pivoting.
    const A = [
      [M[0][0], M[0][1], M[0][2], b[0]],
      [M[1][0], M[1][1], M[1][2], b[1]],
      [M[2][0], M[2][1], M[2][2], b[2]],
    ];

    for (let col = 0; col < 3; col++) {
      // pivot
      let pivot = col;
      let maxAbs = Math.abs(A[col][col]);
      for (let r = col + 1; r < 3; r++) {
        const v = Math.abs(A[r][col]);
        if (v > maxAbs) { maxAbs = v; pivot = r; }
      }
      if (maxAbs < 1e-12) return null;
      if (pivot !== col) {
        const tmp = A[col]; A[col] = A[pivot]; A[pivot] = tmp;
      }

      // normalize row
      const div = A[col][col];
      for (let c = col; c < 4; c++) A[col][c] /= div;

      // eliminate
      for (let r = 0; r < 3; r++) {
        if (r === col) continue;
        const factor = A[r][col];
        if (Math.abs(factor) < 1e-12) continue;
        for (let c = col; c < 4; c++) {
          A[r][c] -= factor * A[col][c];
        }
      }
    }

    return [A[0][3], A[1][3], A[2][3]];
  }

  function _fitAffine2D(pairs) {
    // pairs: [ [x, y, X, Y], ... ]  where (x,y) in embedding space, (X,Y) in hex pixel space
    if (!pairs || pairs.length < 3) return null;

    let xx = 0, xy = 0, x1 = 0;
    let yy = 0, y1 = 0;
    let n = 0;

    let xX = 0, yX = 0, X1 = 0;
    let xY = 0, yY = 0, Y1 = 0;

    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      const x = Number(p[0]), y = Number(p[1]), X = Number(p[2]), Y = Number(p[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(X) || !Number.isFinite(Y)) continue;

      xx += x * x;
      xy += x * y;
      x1 += x;

      yy += y * y;
      y1 += y;

      n += 1;

      xX += x * X;
      yX += y * X;
      X1 += X;

      xY += x * Y;
      yY += y * Y;
      Y1 += Y;
    }

    if (n < 3) return null;

    const M = [
      [xx, xy, x1],
      [xy, yy, y1],
      [x1, y1, n],
    ];

    const solX = _solve3x3(M, [xX, yX, X1]);
    const solY = _solve3x3(M, [xY, yY, Y1]);
    if (!solX || !solY) return null;

    const a = solX[0], b = solX[1], tx = solX[2];
    const c = solY[0], d = solY[1], ty = solY[2];
    if (![a, b, c, d, tx, ty].every(Number.isFinite)) return null;

    return { a, b, c, d, tx, ty, type: 'affine' };
  }

  function _applyAffine(t, x, y) {
    return [
      t.a * x + t.b * y + t.tx,
      t.c * x + t.d * y + t.ty
    ];
  }

  /* =========================
   * End scatter helpers
   * ========================= */


  function buildMsuScatterData(panelIdx) {
    const hexes = App.allHexDataByPanel[panelIdx] || [];
    const msuIndex = App.currentData?.msu_index || {};

    const points = [];

    hexes.forEach(h => {
      const hexKey = pkey(panelIdx, h.q, h.r);
      const ids = Array.isArray(h.msu_ids) ? h.msu_ids : [];

      ids.forEach(id => {
        const m = msuIndex[id];
        if (!m) return;

        const xy = _parseXY(m['2d_coord']);
        if (!xy) return;

        points.push({
          id,
          panelIdx,
          country_id: m.country_id || h.country_id || null,
          rawX: xy[0],
          rawY: xy[1],
          sentence: m.sentence,
          __hexKey: hexKey
        });
      });
    });

    return points;
  }

  function buildScatterTransform(panelIdx, points) {
    // Prefer panel-level affine transform fitted from (hex centroid in 2d_coord space) -> (hex pixel center)
    const t = (App.scatterTransformByPanel && App.scatterTransformByPanel[panelIdx]) ? App.scatterTransformByPanel[panelIdx] : null;
    if (t && t.type === 'affine' && [t.a, t.b, t.c, t.d, t.tx, t.ty].every(Number.isFinite)) {
      return function(pt) {
        return [
          t.a * pt.rawX + t.b * pt.rawY + t.tx,
          t.c * pt.rawX + t.d * pt.rawY + t.ty
        ];
      };
    }

    // Fallback: extent-to-extent scaling (no rotation) — may look slightly rotated vs hex
    const hexes = App.allHexDataByPanel[panelIdx] || [];

    const xExtent = d3.extent(points, d => d.rawX);
    const yExtent = d3.extent(points, d => d.rawY);

    const centers = hexes
      .map(h => [h._hexX, h._hexY])
      .filter(d => Number.isFinite(d[0]) && Number.isFinite(d[1]));

    const dstX = d3.extent(centers, d => d[0]);
    const dstY = d3.extent(centers, d => d[1]);

    const scaleX = d3.scaleLinear().domain(xExtent).range(dstX);

    // Default flipY = true is often correct for Cartesian embeddings (y-up) into SVG (y-down).
    const flipY = (App && App.config && App.config.scatter && typeof App.config.scatter.flipY === 'boolean')
      ? App.config.scatter.flipY
      : true;
    const yRange = flipY ? [dstY[1], dstY[0]] : dstY;
    const scaleY = d3.scaleLinear().domain(yExtent).range(yRange);

    return function(pt) {
      return [scaleX(pt.rawX), scaleY(pt.rawY)];
    };
  }

  function renderScatterLayer(panelIdx) {
    const svg = App.subspaceSvgs[panelIdx];
    if (!svg) return;

    const rootG = svg.select('g');

    // remove old layer
    rootG.selectAll('.scatter-layer').remove();

    const points = buildMsuScatterData(panelIdx);
    if (!points.length) return;

    const tf = buildScatterTransform(panelIdx, points);

    // Pre-project once
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const xy = tf(p);
      p._px = xy[0];
      p._py = xy[1];
    }

    const cfg = (App && App.config && App.config.scatter) ? App.config.scatter : {};
    const R = Number.isFinite(cfg.r) ? cfg.r : 4.8;
    const DEFAULT_FILL = cfg.defaultFill || '#555';
    const MIN_OPACITY = Number.isFinite(cfg.minOpacity) ? cfg.minOpacity : 0.55;

    const layer = rootG.append('g')
      .attr('class', 'scatter-layer');

    layer.selectAll('circle')
      .data(points, d => d.id)
      .join('circle')
      .attr('class', 'msu-point')
      .attr('r', R)
      .attr('cx', d => d._px)
      .attr('cy', d => d._py)
      .attr('fill', d => {
        return resolveScatterPointFill(d, DEFAULT_FILL);
      })
      // gallery 论文筛选：country 不在选中集的散点整体隐藏（含冲突 hex 里非选中论文的点）
      .attr('display', d => {
        if (!App.visibleCountries) return null;
        const cid = d.country_id ? normalizeCountryId(String(d.country_id)) : null;
        return (cid && App.visibleCountries.has(cid)) ? null : 'none';
      })
      .style('pointer-events', d => {
        if (!App.visibleCountries) return null;
        const cid = d.country_id ? normalizeCountryId(String(d.country_id)) : null;
        return (cid && App.visibleCountries.has(cid)) ? null : 'none';
      })
      // Use fill-opacity (not overall opacity) to avoid compounding with other layers
      .attr('opacity', 1)
      .attr('fill-opacity', d => {
        if (App.visibleCountries) {
          const cid = d.country_id ? normalizeCountryId(String(d.country_id)) : null;
          if (!cid || !App.visibleCountries.has(cid)) return 0; // 筛掉的散点不占透明度下限
        }
        const style = (App._hexStyleByKey && App._hexStyleByKey.get) ? App._hexStyleByKey.get(d.__hexKey) : null;
        const op = (style && typeof style.opacity === 'number') ? style.opacity : 0.95;
        return Math.max(MIN_OPACITY, op);
      })
      .on('mouseenter', function(e, d) {
        // fine-grained hover: show MSU sentence
        showTooltip(e, d);
      })
      .on('mousemove', function(e) { moveTooltip(e); })
      .on('mouseleave', hideTooltip);
  }

  function getPanelLayoutMode(panelIdx) {
    if (!Array.isArray(App.panelLayoutMode)) App.panelLayoutMode = [];
    return App.panelLayoutMode[panelIdx] || 'hex';
  }

  function setPanelLayoutMode(panelIdx, mode) {
    if (!Array.isArray(App.panelLayoutMode)) App.panelLayoutMode = [];
    App.panelLayoutMode[panelIdx] = (mode === 'scatter') ? 'scatter' : 'hex';
  }

  function _layoutBtnLabel(mode) {
    return '';
  }

  function _layoutBtnTitle(mode) {
    return (mode === 'scatter') ? 'Switch to Hex Layout' : 'Switch to Scatter Layout';
  }


  const hexPoints = (radius) => {
    const angle = Math.PI / 3;
    return d3.range(6).map(i => [radius * Math.cos(angle * i), radius * Math.sin(angle * i)])
      .concat([[radius, 0]]);
  };

  // === Only reset points (do NOT touch country boundaries/focus/colors) ===
  function resetSubspacePoints(panelIdx) {
    // panel-scoped removal from a Set of "panel|q,r" keys
    const dropKeysOfPanel = (set) => {
      if (!set || typeof set.forEach !== 'function') return;
      const toDel = [];
      set.forEach((k) => {
        const s = String(k);
        const p = s.split('|')[0];
        if (p === panelIdx) toDel.push(k);
      });
      toDel.forEach(k => set.delete(k));
    };

    // Clear point-related transient states
    App.hoveredHex = null;
    App.flightHoverTarget = null;
    dropKeysOfPanel(App.highlightedHexKeys);
    dropKeysOfPanel(App.persistentHexKeys);
    dropKeysOfPanel(App.excludedHexKeys);

    // Do NOT clear country focus / colors / country layers here.
    // Just refresh styles to reflect point reset.
    if (typeof updateHexStyles === 'function') {
      updateHexStyles();
    }
  }

    // ---- helpers: country keys / conflict keys 统一出口 ----
  function getConflictKeysForCountry(panelIdx, countryId) {
    const cid = normalizeCountryId(countryId);
    const conflicts = App.conflictHexKeysByPanel?.[panelIdx]; // 假设已存在的结构：Map<stringCountryId, Set<hexKey>> 或等价
    if (!conflicts || !conflicts.get) return new Set();
    return new Set(conflicts.get(cid) || []);
  }
 
  // 约定：includeConflicts = true 用于 Hover 预览；false 用于 Click 应用/上色
  function getCountryKeysFiltered(panelIdx, countryId, includeConflicts = false) {
    const cid = normalizeCountryId(countryId);
    const allKeys = new Set(getCountryKeysInPanel(panelIdx, cid)); // 你原有函数，返回该面板该国家的全量 hexKey
    if (includeConflicts) return allKeys;
    const conflictKeys = getConflictKeysForCountry(panelIdx, cid);
    // 差集：去掉冲突区
    conflictKeys.forEach(k => allKeys.delete(k));
    return allKeys;
  }

  // === helpers for click payload (full multi-country data) ===
  function ensureBucketFor(panelIdx, q, r, d) {
    const b = (typeof getBucket === 'function') ? getBucket(panelIdx, q, r) : null;
    if (b && Array.isArray(b.items)) return filterBucketToVisibleCountries(b);
    const one = (App.hexMapsByPanel && App.hexMapsByPanel[panelIdx] && App.hexMapsByPanel[panelIdx].get(`${q},${r}`)) || d || {};
    let cid = '—'; try { cid = normalizeCountryId(one && one.country_id ? one.country_id : '—'); } catch(e) {}
    const set = new Set(); if (cid && cid !== '—') set.add(cid);
    const msuCount = (one && Array.isArray(one.msu_ids)) ? one.msu_ids.length : 0;
    return filterBucketToVisibleCountries({ panelIdx, q, r, items: [one], countries: set, msuCount, _cycleIdx: 0 });
  }
  
  function bucketGroupsFor(panelIdx, q, r) {
    const rawBucket = (typeof getBucket === 'function') ? getBucket(panelIdx, q, r) : null;
    const b = filterBucketToVisibleCountries(rawBucket);
    const out = new Map();
    if (!b) return out;
    (b.items || []).forEach(it => {
      const cid = normalizeCountryId(it && it.country_id ? it.country_id : '—');
      if (!out.has(cid)) out.set(cid, { country_id: cid, items: [], msu_ids: [] });
      const g = out.get(cid);
      g.items.push(it);
      if (Array.isArray(it.msu_ids)) g.msu_ids.push(...it.msu_ids);
    });
    return out;
  }

  // ===== 可见性控制 & 名称索引 =====
function setVisible(el, on) {
  if (!el) return;
  el.dataset.visible = on ? '1' : '0';
  // 若你项目是用 class 控制，也可改成 el.classList.toggle('hidden', !on)
  el.style.display = on ? '' : 'none';
}

function getAllSubspaceEls(rootEl) {
  // 你的每个子空间根节点 className 若不是 '.subspace'，请改成实际 class
  return Array.from(rootEl.querySelectorAll('.subspace'));
}

function readSubspaceName(el) {
  // 标题节点 class 若不是 '.subspace-title'，请改成实际 class
  const t = el.querySelector('.subspace-title');
  const raw = (t?.textContent || '').trim();
  return raw || el.getAttribute('data-subspace-name') || '';
}

function buildNameIndex(rootEl) {
  const map = new Map(); // name(lower) -> [idx1, idx2...]
  const els = getAllSubspaceEls(rootEl);
  els.forEach((el, i) => {
    const name = readSubspaceName(el);
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(i);
  });
  return { els, map };
}

  
function emitHexClick(panelIdx, q, r, d) {
  try {
    // 1) 统一拿整格 bucket（若没有就包成单格 bucket）
    const bucket = ensureBucketFor(panelIdx, q, r, d);
    // 2) 按国家分组
    const groupsMap = bucketGroupsFor(panelIdx, q, r);
    const groups = Array.from(groupsMap.entries()).map(([cid, g]) => ({
      country_id: cid,
      items: g.items,
      msu_ids: g.msu_ids,
      msu: (typeof resolveMSUs === 'function')
            ? resolveMSUs(g.msu_ids || [])
            : (g.msu_ids || [])
    }));
    // 3) 兼容字段（所有组的并集）
    const all_msu_ids = groups.flatMap(x => x.msu_ids || []);
    const all_msu = (typeof resolveMSUs === 'function') ? resolveMSUs(all_msu_ids) : all_msu_ids;

    const payload = { panelIdx, q, r, bucket, groups, all_msu_ids, all_msu, raw: d };

    // 优先走外部钩子
    if (typeof App?.onHexClick === 'function') {
      App.onHexClick(payload);
    }
    // 同时抛一个 DOM 事件，方便外部监听
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('semanticmap:hexclick', { detail: payload }));
    }
  } catch (e) {
    console.warn('emitHexClick error:', e);
  }
}


// === Helper: ensure hatch pattern exists (optional overlay for conflicts) ===
function ensureHatchPattern(panelIdx, svg, color) {
  try {
    var defs = svg.select('defs');
    if (defs.empty()) defs = svg.append('defs');
    var pid = 'hatch-' + panelIdx;
    var pat = defs.select('#' + pid);
    if (pat.empty()) {
      pat = defs.append('pattern')
        .attr('id', pid)
        .attr('patternUnits', 'userSpaceOnUse')
        .attr('width', 6)
        .attr('height', 6)
        .attr('patternTransform', 'rotate(45)');
      pat.append('line')
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', 0).attr('y2', 6)
        .attr('stroke', color || '#999')
        .attr('stroke-width', 1);
    }
  } catch(e) {}
}

// —— 颜色工具：把输入安全规范成 "#RRGGBB" ——

// 把 0-255 的 r,g,b 转成 "#RRGGBB"
function _rgbToHex(r, g, b) {
  const to2 = (n) => {
    const v = Math.max(0, Math.min(255, n|0));
    return v.toString(16).padStart(2, '0').toUpperCase();
  };
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

// 尝试把任意形式的颜色转成 "#RRGGBB"
function normalizeColorToHex(color, fallback = '#4C78A8') {
  try {
    // 1) null/undefined：直接回退
    if (color == null) return fallback;

    // 2) 数组/对象：常见 {r,g,b} 或 [r,g,b]
    if (Array.isArray(color) && color.length >= 3) {
      return _rgbToHex(+color[0], +color[1], +color[2]);
    }
    if (typeof color === 'object') {
      if ('r' in color && 'g' in color && 'b' in color) {
        return _rgbToHex(+color.r, +color.g, +color.b);
      }
      // 其它对象：不认识，回退
      return fallback;
    }

    // 3) 数字：按 0xRRGGBB 解释
    if (typeof color === 'number' && Number.isFinite(color)) {
      const n = Math.max(0, Math.min(0xFFFFFF, color|0));
      return `#${n.toString(16).padStart(6, '0').toUpperCase()}`;
    }

    // 4) 字符串：各种 CSS 颜色
    if (typeof color === 'string') {
      let s = color.trim();
      if (!s) return fallback;

      // 4.1 处理 hex
      const mHex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (mHex) {
        const h = mHex[1];
        if (h.length === 3) {
          // #abc -> #AABBCC
          const r = h[0], g = h[1], b = h[2];
          return `#${(r+r+g+g+b+b).toUpperCase()}`;
        } else {
          return `#${h.toUpperCase()}`;
        }
      }

      // 4.2 处理 rgb/rgba(...)
      const mRgb = s.match(/^rgba?\s*\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i);
      if (mRgb) {
        return _rgbToHex(+mRgb[1], +mRgb[2], +mRgb[3]);
      }

      // 4.3 其它命名色/复杂格式：用 Canvas 解析成 rgb(...)
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000';          // 先设个默认
        ctx.fillStyle = s;                // 让浏览器解析
        const resolved = ctx.fillStyle;   // 通常变成 "rgb(r, g, b)"
        const m2 = resolved && resolved.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
        if (m2) return _rgbToHex(+m2[1], +m2[2], +m2[3]);
      }
    }

    // 都没命中：回退
    return fallback;
  } catch {
    return fallback;
  }
}


// 基于“原始 hexList”构建坐标索引：panelIdx -> Map("q,r" -> [多条记录])
function ensureCoordIndex(panelIdx) {
  if (!App.coordIndexByPanel) App.coordIndexByPanel = new Map();
  let m = App.coordIndexByPanel.get(panelIdx);
  if (m) return m;

  m = new Map();
  // 优先使用我们保存的“原始未去重列表”
  const src = (Array.isArray(App._rawHexListByPanel?.[panelIdx]))
    ? App._rawHexListByPanel[panelIdx]
    : (App.currentData?.subspaces?.[panelIdx]?.hexList || []);

  for (const it of src) {
    if (!it) continue;
    const key = `${it.q},${it.r}`;
    let arr = m.get(key);
    if (!arr) { arr = []; m.set(key, arr); }
    arr.push(it);
  }
  App.coordIndexByPanel.set(panelIdx, m);
  return m;
}

// Gallery filtering is applied at two levels: rendering hides an HSU, while
// detail/selection code reads the underlying bucket.  Keep the latter on the
// same source set, otherwise a visible HSU can still expose MSUs belonging to
// papers that the gallery has filtered out.
function isVisibleCountry(rawCountryId) {
  if (!App.visibleCountries) return true;
  if (rawCountryId == null || rawCountryId === '') return false;
  return App.visibleCountries.has(normalizeCountryId(String(rawCountryId)));
}

function filterBucketToVisibleCountries(bucket) {
  if (!bucket || !Array.isArray(bucket.items) || !App.visibleCountries) return bucket;

  const items = bucket.items.filter(item => isVisibleCountry(item?.country_id));
  const countries = new Set(
    items
      .map(item => item?.country_id == null ? null : normalizeCountryId(String(item.country_id)))
      .filter(Boolean)
  );
  const msuCount = items.reduce(
    (total, item) => total + (Array.isArray(item?.msu_ids) ? item.msu_ids.length : 0),
    0
  );

  return { ...bucket, items, countries, msuCount };
}

// One SVG hex represents an HSU, not a particular record within that HSU.
// Never let whichever raw MSU happened to be first/last determine the HSU's
// country identity: a multi-source HSU deliberately has no single country.
function buildHsuDisplayRecord(bucket) {
  const scoped = filterBucketToVisibleCountries(bucket);
  const items = scoped?.items || [];
  const first = items[0] || bucket?.items?.[0] || {};
  const msuIds = Array.from(new Set(
    items.flatMap(item => Array.isArray(item?.msu_ids) ? item.msu_ids : [])
  ));
  const countries = scoped?.countries || new Set();

  return {
    ...first,
    panelIdx: bucket?.panelIdx ?? first.panelIdx,
    q: bucket?.q ?? first.q,
    r: bucket?.r ?? first.r,
    // A conflict remains neutral; with gallery filtering, exactly one visible
    // source correctly becomes the HSU's colour owner.
    country_id: countries.size === 1 ? Array.from(countries)[0] : null,
    msu_ids: msuIds,
    _hsuCountryIds: Array.from(countries)
  };
}

// 安全获取 bucket：优先用 getBucket；失败则从坐标索引兜底组一个“临时 bucket”
function getBucketSafe(panelIdx, q, r) {
  let b = (typeof getBucket === 'function') ? getBucket(panelIdx, q, r) : null;
  if (b && Array.isArray(b.items) && b.items.length) return filterBucketToVisibleCountries(b);

  const idx = ensureCoordIndex(panelIdx);
  const items = (idx.get(`${q},${r}`) || []).slice();
  if (!items.length) return null;

  const normCid = (cid) =>
    (typeof normalizeCountryId === 'function')
      ? normalizeCountryId(cid || '')
      : (cid || '');

  const countries = new Set(
    items.map(it => normCid(it.country_id)).filter(Boolean)
  );

  return filterBucketToVisibleCountries({ panelIdx, q, r, items, countries });
}


// === Tooltip: build single-item bucket for unified rendering ===
function buildSingleBucket(panelIdx, q, r, hex) {
  var cid = '—';
  try { cid = normalizeCountryId(hex && hex.country_id ? hex.country_id : '—'); } catch(e) {}
  var msuCount = (hex && Array.isArray(hex.msu_ids)) ? hex.msu_ids.length : 0;
  var set = new Set();
  if (cid && cid !== '—') set.add(cid);
  return { panelIdx: panelIdx, q: q, r: r, items: [hex], countries: set, msuCount: msuCount, _cycleIdx: 0 };
}

// === Color helpers ===
function getPanelCountryColor(panelIdx, cidRaw) {
  let cid = cidRaw;
  try { cid = normalizeCountryId(cidRaw); } catch(e) {}

  // 1) Gallery/source-wide color is authoritative. It keeps every HSU for a
  // paper aligned with the one color shown on that paper's Gallery card.
  const g = App.globalCountryColors?.get?.(cid);
  if (g) return g;

  // 2) Panel-local override is only a fallback when no source-wide color has
  // been assigned.
  const panelMap = App.panelCountryColors?.get?.(panelIdx);
  const rec = panelMap?.get?.(cid);
  if (rec?.color) return rec.color;

  // 3) 旧的“getCountryColorOverride(panelIdx, cid)”兜底（如果你保留了它）
  if (typeof getCountryColorOverride === 'function') {
    const tmp = getCountryColorOverride(panelIdx, cid);
    if (tmp?.color) return tmp.color;
  }

  // 4) 最后回退
  return (App.config?.countryBorder?.color) || '#999';
}

function getExplicitCountryColor(panelIdx, cidRaw) {
  if (cidRaw == null || cidRaw === '') return null;
  let cid = cidRaw;
  try { cid = normalizeCountryId(cidRaw); } catch(e) {}

  const global = App.globalCountryColors?.get?.(cid) || App.globalCountryColors?.get?.(cidRaw);
  if (global) return global;

  const panelMap = App.panelCountryColors?.get?.(panelIdx);
  const rec = panelMap?.get?.(cid) || panelMap?.get?.(cidRaw);
  if (rec?.color) return rec.color;

  const ov = (typeof getCountryColorOverride === 'function') ? getCountryColorOverride(panelIdx, cid) : null;
  return ov?.color || null;
}

function resolveScatterPointFill(d, fallback = '#999') {
  const hexStyle = App._hexStyleByKey?.get?.(d.__hexKey);
  const parentFill = hexStyle?.fill || fallback;
  const panelIdx = Number.isFinite(Number(d.panelIdx))
    ? Number(d.panelIdx)
    : Number(String(d.__hexKey || '').split('|')[0]);
  const countryColor = getExplicitCountryColor(panelIdx, d.country_id);
  return countryColor || parentFill;
}

function getConflictContextCountryId(panelIdx, q, r, key, focusCid = null) {
  const bucket = getBucket(panelIdx, q, r);
  if (!bucket || !bucket.countries || bucket.countries.size <= 1) return null;
  const countries = new Set(Array.from(bucket.countries).map(normalizeCountryId));

  if (App.visibleCountries) {
    const visible = Array.from(countries).filter(cid => App.visibleCountries.has(cid));
    if (visible.length === 1) return visible[0];
  }

  const pendingCid = App._pendingColorEdit?.countryId
    ? normalizeCountryId(App._pendingColorEdit.countryId)
    : null;
  if (pendingCid && countries.has(pendingCid) && App._pendingColorEdit?.keys?.has?.(key)) {
    return pendingCid;
  }

  if (App.highlightedHexKeys?.has?.(key) && App.hoveredHex) {
    const hoveredBucket = getBucket(App.hoveredHex.panelIdx, App.hoveredHex.q, App.hoveredHex.r);
    if (hoveredBucket?.countries?.size === 1) {
      const hoveredCid = normalizeCountryId(Array.from(hoveredBucket.countries)[0]);
      if (countries.has(hoveredCid)) return hoveredCid;
    }
    // A multi-source HSU has no source owner on hover.  In particular, do not
    // fall back to its visual representative here: after aggregation that
    // representative may be a filtered source and would recolor the whole
    // conflict HSU according to one underlying MSU.
  }

  if (focusCid && countries.has(focusCid)) return focusCid;
  return null;
}

function emitSemanticColorSnapshot() {
  try {
    const detail = (typeof _buildMiniSnapshot === 'function')
      ? _buildMiniSnapshot()
      : {};
    window.dispatchEvent(new CustomEvent('semanticmap:colorschange', { detail }));
  } catch (_) {}
}

function applySourceColorFromGallery({ countryId, projectId = null, color } = {}) {
  if (countryId == null || countryId === '' || !color) return false;
  const activeProjectId = App.currentProjectId || App.currentData?.project_id || App.currentData?.projectId || window.__activeProjectId || null;
  // c0/c1/... are only unique within a case. Ignore a gallery card from a
  // different case instead of recolouring its same-named country here.
  if (projectId && activeProjectId && String(projectId) !== String(activeProjectId)) return false;
  const chosen = normalizeColorToHex(color, '#4C78A8').toUpperCase();
  App._isConfirmingAltColor = true;
  try {
    propagateCountryColorToAllPanels(countryId, chosen);
  } finally {
    App._isConfirmingAltColor = false;
  }
  return true;
}


// === Base fill logic: single-country = that country's color; conflict = gray; none = modality fallback ===
function computeHexBaseFill(panelIdx, q, r, modality) {
  try {
    const b = getBucket(panelIdx, q, r);
    if (b && b.countries && b.countries.size > 0) {
      // gallery 选择联动：仅保留可见 country；冲突区随之重算；全不可见则落到背景(该 hex 当前隐藏)
      let cs = b.countries;
      if (App.visibleCountries) {
        cs = new Set(Array.from(b.countries).filter(c => App.visibleCountries.has(c)));
      }
      if (cs.size === 1) {
        return getPanelCountryColor(panelIdx, Array.from(cs)[0]);
      } else if (cs.size >= 2) {
        return (STYLE && STYLE.CONFLICT_GRAY) ? STYLE.CONFLICT_GRAY : '#B0B0B0';
      }
      // cs.size === 0 → 落到下方 modality/背景色
    }
  } catch (e) {}
  if (modality === 'image') return (App.config && App.config.hex && App.config.hex.imageFill) || '#dddddd';
  if (modality === 'text')  return (App.config && App.config.hex && App.config.hex.textFill)  || '#eeeeee';
  return (App.config && App.config.background) || '#f5f5f5';
}


// === Per-country split builders ===
function _bucketCountrySlices(panelIdx, q, r) {
  const b = filterBucketToVisibleCountries(getBucket(panelIdx, q, r));
  const out = new Map();
  if (!b) return out;
  b.items.forEach(it => {
    const cid = normalizeCountryId(it.country_id || '—');
    if (!out.has(cid)) out.set(cid, { country_id: cid, items: [], msu_ids: [] });
    const g = out.get(cid);
    g.items.push(it);
    if (Array.isArray(it.msu_ids)) g.msu_ids.push(...it.msu_ids);
  });
  return out;
}

function buildSplitNodes() {
  const nodes = [];
  (App.hexBucketsByPanel || []).forEach((map, panelIdx) => {
    if (!map) return;
    map.forEach(b => {
      const slices = _bucketCountrySlices(panelIdx, b.q, b.r);
      if (slices.size === 0) {
        nodes.push({ panelIdx, q: b.q, r: b.r, country_id: null, msu_ids: [], key: `${panelIdx}|${b.q},${b.r}|` });
      } else {
        slices.forEach((g, cid) => {
          nodes.push({ panelIdx, q: b.q, r: b.r, country_id: cid, msu_ids: g.msu_ids.slice(), key: `${panelIdx}|${b.q},${b.r}|${cid}` });
        });
      }
    });
  });
  return nodes;
}

function buildSplitLinks(rawLinks) {
  const links = [];
  (rawLinks || []).forEach(L => {
    if (!L || !Array.isArray(L.path) || L.path.length < 2) return;
    for (let i=0;i<L.path.length-1;i++) {
      const a = L.path[i], b = L.path[i+1];
      const pa = (typeof a.panelIdx === 'number') ? a.panelIdx : (L.panelIdx ?? 0);
      const pb = (typeof b.panelIdx === 'number') ? b.panelIdx : (L.panelIdx ?? 0);
      const slicesA = _bucketCountrySlices(pa, a.q, a.r);
      const slicesB = _bucketCountrySlices(pb, b.q, b.r);
      const cidsA = slicesA.size ? Array.from(slicesA.keys()) : [null];
      const cidsB = slicesB.size ? Array.from(slicesB.keys()) : [null];
      cidsA.forEach(cidA => {
        cidsB.forEach(cidB => {
          links.push({
            baseId: L.id || L._uid || null,
            type: L.type || 'road',
            country_from: cidA,
            country_to: cidB,
            from: { panelIdx: pa, q: a.q, r: a.r, key: `${pa}|${a.q},${a.r}|${cidA||''}` },
            to:   { panelIdx: pb, q: b.q, r: b.r, key: `${pb}|${b.q},${b.r}|${cidB||''}` },
          });
        });
      });
    }
  });
  return links;
}


function emitSelectionPayload(){
  try{
    const nodes = [];
    const edges = [];
    (App.persistentHexKeys||new Set()).forEach(k=>{
      const [p, qr] = String(k).split('|');
      const [q, r] = qr.split(',').map(Number);
      const panelIdx = Number(p);
      const hex = App.hexMapsByPanel?.[panelIdx]?.get(`${q},${r}`) || { q, r };
      // Determine fill and alpha
      let fill = null;
      try { fill = getHexFillColor(hex); } catch(e) {}
      const alpha = App.msuAlphaByHex?.get?.(`${panelIdx}|${q},${r}`) ?? STYLE.OPACITY_DEFAULT;
      nodes.push({ panelIdx, q, r, color: fill, alpha, state: 'selected' });
    });
    (App.selectedEdgeKeys||new Set()).forEach(e=>edges.push(e));
    const payload = { nodes, edges, kind: App.lastSelectionKind||null };
    if (typeof App.onHexSelectionChange === 'function') App.onHexSelectionChange(payload);
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('semanticmap:selection', { detail: payload }));
    }
  }catch(e){ console.warn('emitSelectionPayload failed:', e); }
}


function publishToStepAnalysis() {
  try {
    const nodesAll = buildSplitNodes();

    // 1) 路线级选择 → 分段导出 linksA
    const hasRouteSel = App.selectedRouteIds && App.selectedRouteIds.size > 0;
    const selectedRoutes = hasRouteSel
      ? (App._lastLinks || []).filter(L => {
          const id = (typeof linkKey === 'function') ? linkKey(L) : (L && (L.id || L._uid));
          return id && App.selectedRouteIds.has(id);
        })
      : (App._lastLinks || []);
    const linksA = buildSplitLinks(selectedRoutes);

    // 2) 点级 extras（persistentHexKeys）→ 切段 snap.links，并与 linksA 合并去重
    let links = linksA.slice();
    if (App.persistentHexKeys && App.persistentHexKeys.size > 0 && typeof snapshotFromKeySet === 'function') {
      // 先把“已在路线里的节点”排除，避免重复片段
      const inRoute = new Set();
      (buildSplitNodes(selectedRoutes) || []).forEach(n => inRoute.add(`${n.panelIdx}|${n.q},${n.r}`));
      const extras = new Set([...App.persistentHexKeys].filter(k => !inRoute.has(String(k))));

      const snap = snapshotFromKeySet(extras);
      if (snap && Array.isArray(snap.links) && snap.links.length) {
        const seen = new Set(linksA.map(e => `${e.type}|${e.from.key}->${e.to.key}`));
        snap.links.forEach(e => {
          const sig = `${e.type}|${e.from.key}->${e.to.key}`;
          if (!seen.has(sig)) { links.push(e); seen.add(sig); }
        });
      }
    }

    if (typeof window !== 'undefined' && window.dispatchEvent) {
      // ★ 给导出的 links 也盖上名字，保证外部拿到的 link 已包含 panelNames / panelNamesByIndex
      stampSubspaceNamesOnAllLinks(links);
      const panelNamesByIndex = getSubspaceNameMap();

      const ev = new CustomEvent('semantic-map-export', {
        detail: { nodes: nodesAll, links, panelNamesByIndex }
      });
      window.dispatchEvent(ev);

    }
    App._exportSplit = { nodes: nodesAll, links };
  } catch (e) {
    console.warn('publishToStepAnalysis failed:', e);
  }
}

// 从“当前子空间的原始列表”按坐标取出所有条目，并做一次规范化聚合
function _gatherByCoordFromSubspace(panelIdx, q, r) {
  // 1) 优先使用每个子空间的原始 hexList
  const space = App?.currentData?.subspaces?.[panelIdx];
  const list1 = Array.isArray(space?.hexList) ? space.hexList : [];

  // 2) 如果你前面有保存过“未去重原始表”（推荐），也合并进来兜底
  const list2 = Array.isArray(App?._rawHexListByPanel?.[panelIdx]) ? App._rawHexListByPanel[panelIdx] : [];

  // 合并两个来源，但按引用去重
  const all = [];
  const seen = new Set();
  for (const it of [...list1, ...list2]) {
    if (!it || it.q !== q || it.r !== r) continue;
    const key = it === Object(it) ? (it.__id || `${it.country_id}|${(it.msu_ids||[]).join(',')}`) : String(Math.random());
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(it);
  }

  // 规范化 country id（兼容别名）
  const normCid = (cid) => (App?.countryIdAlias?.get?.(cid) || cid || '').toString();

  // 分组与并集
  const countries = new Set(all.map(it => normCid(it.country_id)).filter(Boolean));
  const groupsMap = new Map();
  for (const it of all) {
    const cid = normCid(it.country_id) || '—';
    if (!groupsMap.has(cid)) groupsMap.set(cid, { items: [], msu_ids: [] });
    const g = groupsMap.get(cid);
    g.items.push(it);
    if (Array.isArray(it.msu_ids)) g.msu_ids.push(...it.msu_ids);
  }

  const merged_msu_ids = Array.from(new Set([].concat(...Array.from(groupsMap.values()).map(g => g.msu_ids))));

  // 代表项（用第一条，避免破坏既有 UI 依赖）
  const first = all[0] || {};
  return {
    ok: all.length > 0,
    items: all,
    countries,
    groupsMap,
    merged_msu_ids,
    representative: {
      modality: first.modality || '',
      label: first.label || `${q},${r}`
    }
  };
}


// === Buckets helpers (aggregate multiple records in one hex) ===
function ensureHatchPattern(panelIdx, svg, color) {
  var defs = svg.select('defs');
  if (defs.empty()) defs = svg.append('defs');
  var pid = 'hatch-' + panelIdx;
  var pat = defs.select('#' + pid);
  if (pat.empty()) {
    pat = defs.append('pattern')
      .attr('id', pid)
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 6)
      .attr('height', 6)
      .attr('patternTransform', 'rotate(45)');
    pat.append('line')
      .attr('x1', 0).attr('y1', 0)
      .attr('x2', 0).attr('y2', 6)
      .attr('stroke', color || '#999')
      .attr('stroke-width', 1);
  }
  return 'url(#' + pid + ')';
}

function getRobustGlobalMsuReferenceCount() {
  const counts = [];
  const pushCount = (n) => {
    const v = Number(n);
    if (Number.isFinite(v) && v > 0) counts.push(v);
  };

  (App.currentData?.subspaces || []).forEach(space => {
    const byCoord = new Map();
    (space?.hexList || []).forEach(h => {
      const key = `${h?.q},${h?.r}`;
      const count = Array.isArray(h?.msu_ids) ? h.msu_ids.length : 0;
      byCoord.set(key, (byCoord.get(key) || 0) + count);
    });
    byCoord.forEach(pushCount);
  });

  if (!counts.length) {
    (App.hexBucketsByPanel || []).forEach(bmap => {
      if (!bmap || !(bmap instanceof Map)) return;
      bmap.forEach(b => pushCount(b?.msuCount));
    });
  }

  if (!counts.length) return 1;
  counts.sort((a, b) => a - b);
  const q = Math.max(0, Math.min(1, STYLE.OPACITY_MSU_REFERENCE_QUANTILE ?? 0.9));
  const idx = Math.min(counts.length - 1, Math.max(0, Math.ceil(q * counts.length) - 1));
  return Math.max(1, counts[idx]);
}

function opacityForMsuCount(msuCount) {
  const reference = getRobustGlobalMsuReferenceCount();
  const t = Math.max(0, Math.min(1, (Number(msuCount) || 0) / reference));
  const minAlpha = STYLE.OPACITY_MSU_MIN ?? 0.42;
  const maxAlpha = STYLE.OPACITY_MSU_MAX ?? 0.92;
  return minAlpha + (maxAlpha - minAlpha) * t;
}

// === 依据全项目 MSU 数量分布，建立“每格 alpha”缓存 ===
function recomputeMsuAlphaForPanel(panelIdx) {
  if (!App.msuAlphaByHex) App.msuAlphaByHex = new Map();
  const bmap = App.hexBucketsByPanel?.[panelIdx];
  if (!bmap || !(bmap instanceof Map)) return;

  bmap.forEach(b => {
    const k = `${panelIdx}|${b.q},${b.r}`;
    App.msuAlphaByHex.set(k, opacityForMsuCount(b?.msuCount));
  });
}

function recomputeMsuAlphaForAllPanels() {
  App.msuAlphaByHex = new Map();
  (App.hexBucketsByPanel || []).forEach((bmap, panelIdx) => {
    if (!bmap || !(bmap instanceof Map)) return;
    bmap.forEach(b => {
      const k = `${panelIdx}|${b.q},${b.r}`;
      App.msuAlphaByHex.set(k, opacityForMsuCount(b?.msuCount));
    });
  });
}


function buildBucketsForPanel(panelIdx, hexList) {
  var buckets = new Map(); // key: "q,r" -> {q,r,items:[], countries:Set, msuCount, _cycleIdx}
  for (var i=0;i<hexList.length;i++) {
    var d = hexList[i];
    var key = d.q + ',' + d.r;
    var b = buckets.get(key);
    if (!b) {
      b = { panelIdx: panelIdx, q: d.q, r: d.r, items: [], countries: new Set(), msuCount: 0, _cycleIdx: 0 };
      buckets.set(key, b);
    }
    b.items.push(d);
    if (d && d.country_id) {
      try { b.countries.add(normalizeCountryId(d.country_id)); } catch(e) { b.countries.add(String(d.country_id)); }
    }
    if (Array.isArray(d.msu_ids)) b.msuCount += d.msu_ids.length;
  }
  return buckets;
}



function getBucket(panelIdx, q, r) {
  var map = (App.hexBucketsByPanel && App.hexBucketsByPanel[panelIdx]) ? App.hexBucketsByPanel[panelIdx] : null;
  return map ? map.get(String(q)+','+String(r)) : null;
}

function isDynamicAggregationActive() {
  return Math.abs((Number(App?.aggregationRange) || DEFAULT_AGGREGATION_RANGE) - DEFAULT_AGGREGATION_RANGE) > 0.001;
}

function getMsuRecord(msuId) {
  const idx = App?.currentData?.msu_index || {};
  return idx?.[msuId] ?? idx?.[String(msuId)] ?? null;
}

function cleanMsuEvidenceText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncatePromptText(text, maxLen = 900) {
  const clean = cleanMsuEvidenceText(text);
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 3).trim() + '...';
}

function normalizeHsuSummaryResponse(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') return parsed.trim();
    return String(
      parsed?.summary ||
      parsed?.answer ||
      parsed?.text ||
      parsed?.RouteSummary ||
      parsed?.payload?.summary ||
      parsed?.payload?.answer ||
      parsed?.payload?.text ||
      ''
    ).trim();
  } catch (_) {
    return text;
  }
}

function buildLocalHsuSummary(item, maxSentences = 4) {
  const ids = Array.isArray(item?.msu_ids) ? item.msu_ids : [];
  const sentences = [];
  ids.forEach(id => {
    const rec = getMsuRecord(id);
    const text = cleanMsuEvidenceText(rec?.sentence || rec?.text || rec?.content || '');
    if (text && !sentences.includes(text)) sentences.push(text);
  });

  if (!sentences.length) {
    const existing = cleanMsuEvidenceText(item?.summary || '');
    if (existing && !/semantic units are aggregated/i.test(existing)) {
      return `- Main evidence: ${existing}`;
    }
    return '';
  }

  if (sentences.length === 1) return `- Main evidence: ${sentences[0]}`;

  const visible = sentences.slice(0, maxSentences);
  const lines = visible.map((sentence, idx) => {
    const label = idx === 0 ? 'Primary evidence' : `Related evidence ${idx + 1}`;
    return `- ${label}: ${truncatePromptText(sentence, 360)}`;
  });
  if (sentences.length > visible.length) {
    lines.push(`- Additional evidence: ${sentences.length - visible.length} more MSUs are included in this aggregated HSU.`);
  }
  return lines.join('\n');
}

function getHsuSummaryKey(panelIdx, item) {
  const ids = (Array.isArray(item?.msu_ids) ? item.msu_ids : [])
    .map(x => String(x))
    .sort((a, b) => Number(a) - Number(b));
  const cid = item?.country_id ? normalizeCountryId(item.country_id) : '';
  const project = window.__activeProjectId || App?.currentData?.title || 'default';
  const range = Number(App?.aggregationRange || DEFAULT_AGGREGATION_RANGE).toFixed(2);
  return [project, range, panelIdx, item?.q, item?.r, cid, ids.join(',')].join('|');
}

function buildHsuHoverPrompt(panelIdx, item) {
  const ids = Array.isArray(item?.msu_ids) ? item.msu_ids : [];
  const sentenceLines = [];
  const contextMap = new Map();
  const maxPromptMsus = 24;

  ids.slice(0, maxPromptMsus).forEach((id, idx) => {
    const rec = getMsuRecord(id);
    const sentence = truncatePromptText(rec?.sentence || rec?.text || rec?.content || '', 520);
    if (!sentence) return;

    const category = cleanMsuEvidenceText(rec?.category || rec?.type || '');
    const msuLabel = `MSU ${idx + 1}`;
    sentenceLines.push(`- ${msuLabel}${category ? ` (${category})` : ''}: ${sentence}`);

    const paragraph = cleanMsuEvidenceText(
      rec?.paragraph_info ||
      rec?.paragraphInfo ||
      rec?.raw_text ||
      rec?.rawText ||
      rec?.original_text ||
      rec?.originalText ||
      ''
    );
    if (!paragraph) return;

    const paraKey = [
      rec?.paper_id ?? '',
      rec?.para_id ?? '',
      paragraph.slice(0, 160)
    ].join('|');
    if (!contextMap.has(paraKey)) {
      contextMap.set(paraKey, { text: paragraph, msus: [] });
    }
    contextMap.get(paraKey).msus.push(idx + 1);
  });

  if (ids.length > maxPromptMsus) {
    sentenceLines.push(`- Coverage note: ${ids.length - maxPromptMsus} additional MSUs are omitted from this LLM prompt to keep hover summarization responsive.`);
  }

  const originalContexts = Array.from(contextMap.values());
  const contextLines = originalContexts
    .slice(0, 10)
    .map((ctx, idx) => {
      const refs = Array.from(new Set(ctx.msus)).join(', ');
      return `Original context ${idx + 1} (for MSUs ${refs}): ${truncatePromptText(ctx.text)}`;
    });
  if (originalContexts.length > contextLines.length) {
    contextLines.push(`Original context note: ${originalContexts.length - contextLines.length} additional source paragraphs are omitted for prompt length; all selected MSU sentences remain listed above.`);
  }

  return `
Classify and summarize the MSU content inside one dynamically aggregated HSU for tooltip display.

HSU
- panelIdx: ${panelIdx}
- q,r: ${item?.q},${item?.r}
- country_id: ${item?.country_id || 'unknown'}
- total_msu_count: ${ids.length}

Requirements:
1) Use the selected MSU sentences as the scope of the summary.
2) Use the original context paragraphs to preserve important wording, proper nouns, methods, metrics, datasets, and domain terms.
3) Group related MSUs into 2-5 semantic categories.
4) Output bullet points only, using "- Category: simple but detailed synthesis".
   Never output a category-only bullet. The category label and its synthesis must be on the same bullet line.
   Correct: "- Core theme: The cluster of sentences revolves around ..."
   Incorrect:
   "- Core Theme:"
   "- The cluster of sentences revolves around ..."
5) Keep the sentences simple, but do not over-compress or drop core technical details.
6) Do not use paper/source titles as categories or headings.
7) Do not mention HSU ids, MSU ids, panelIdx, coordinates, country ids, or paper titles in the final bullets.
8) Do not use bold, italic, markdown headings, nested bullets, tables, JSON, or code fences.

Selected MSU sentences in this HSU:
${sentenceLines.join('\n') || '(none)'}

Original text context from the same MSUs:
${contextLines.join('\n\n') || '(none)'}
  `.trim();
}

async function requestHsuHoverSummary(panelIdx, item) {
  if (!isDynamicAggregationActive()) return;
  const ids = Array.isArray(item?.msu_ids) ? item.msu_ids : [];
  if (!ids.length) return;
  const key = getHsuSummaryKey(panelIdx, item);
  if (!App.hsuSummaryCache) App.hsuSummaryCache = new Map();
  if (!App.hsuSummaryPending) App.hsuSummaryPending = new Map();
  if (App.hsuSummaryCache.has(key) || App.hsuSummaryPending.has(key)) return;

  if (ids.length === 1) {
    App.hsuSummaryCache.set(key, { status: 'ready', text: buildLocalHsuSummary(item) });
    return;
  }

  const fallbackText = buildLocalHsuSummary(item);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 26000) : null;

  const pending = fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller ? controller.signal : undefined,
    body: JSON.stringify({
      task: 'hsu_hover_summary',
      query: buildHsuHoverPrompt(panelIdx, item)
    })
  })
    .then(async res => {
      const raw = await res.text();
      const text = normalizeHsuSummaryResponse(raw);
      if (!res.ok) throw new Error(text || `HSU summary failed (${res.status})`);
      App.hsuSummaryCache.set(key, { status: 'ready', text: text || fallbackText });
    })
    .catch(err => {
      console.warn('[HSU hover summary] failed:', err);
      App.hsuSummaryCache.set(key, fallbackText
        ? { status: 'ready', text: fallbackText }
        : { status: 'error', text: '' });
    })
    .finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
      App.hsuSummaryPending.delete(key);
      refreshHoveredBucketTooltip();
    });

  App.hsuSummaryPending.set(key, pending);
  refreshHoveredBucketTooltip();
}

function getVisibleBucketSummaryItems(bucket) {
  if (!bucket) return [];
  const groups = new Map();
  const items = Array.isArray(bucket.items) ? bucket.items : [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const cid = normalizeCountryId(it.country_id || '—');
    if (!groups.has(cid)) groups.set(cid, { cid, items: [] });
    groups.get(cid).items.push(it);
  }

  const focusCid = App && App.focusCountryId ? normalizeCountryId(App.focusCountryId) : null;
  const ordered = Array.from(groups.values()).sort((a, b) => {
    if (focusCid) {
      if (a.cid === focusCid && b.cid !== focusCid) return -1;
      if (b.cid === focusCid && a.cid !== focusCid) return 1;
    }
    return (a.cid < b.cid) ? -1 : (a.cid > b.cid) ? 1 : 0;
  });

  const out = [];
  ordered.slice(0, 4).forEach(group => {
    group.items.slice(0, 4).forEach(item => out.push(item));
  });
  return out;
}

function scheduleBucketDynamicSummaries(bucket) {
  if (!isDynamicAggregationActive() || !bucket) return;
  if (App.hsuSummaryHoverTimer) clearTimeout(App.hsuSummaryHoverTimer);
  App.hsuSummaryHoverTimer = null;
  const target = `${bucket.panelIdx}|${bucket.q},${bucket.r}`;
  App.hsuSummaryHoverTarget = target;

  if (!App.hoveredHex) return;
  const current = `${App.hoveredHex.panelIdx}|${App.hoveredHex.q},${App.hoveredHex.r}`;
  if (current !== target) return;
  getVisibleBucketSummaryItems(bucket).forEach(item => requestHsuHoverSummary(bucket.panelIdx, item));
}

function getDisplaySummaryForHsuItem(panelIdx, item) {
  if (!isDynamicAggregationActive()) {
    return (item && typeof item.summary === 'string') ? item.summary.trim() : '';
  }
  const ids = Array.isArray(item?.msu_ids) ? item.msu_ids : [];
  if (!ids.length) return '';
  const key = getHsuSummaryKey(panelIdx, item);
  const cached = App.hsuSummaryCache?.get?.(key);
  if (cached?.status === 'ready') return cached.text || '';
  if (cached?.status === 'error') return buildLocalHsuSummary(item) || 'LLM summary unavailable for this aggregated HSU.';
  if (App.hsuSummaryPending?.has?.(key)) return 'Generating LLM summary...';
  return 'Generating LLM summary...';
}

function refreshHoveredBucketTooltip() {
  const bucket = App.hoveredTooltipBucket;
  const pos = App.lastHexTooltipClient;
  if (!bucket || !pos) return;
  if (!App.hoveredHex) return;
  if (App.hoveredHex.panelIdx !== bucket.panelIdx || App.hoveredHex.q !== bucket.q || App.hoveredHex.r !== bucket.r) return;
  // Dynamic summaries resolve independently. Replacing innerHTML must not kick
  // a reader back to the top of a long tooltip while they are scrolling it.
  const tip = getVisibleHexTooltip();
  const previousScrollTop = tip ? tip.scrollTop : 0;
  const previousScrollLeft = tip ? tip.scrollLeft : 0;
  showHexTooltip(pos.x, pos.y, { _rawHTML: true, html: renderBucketTooltipHTML(bucket) });
  if (tip) {
    tip.scrollTop = Math.min(previousScrollTop, Math.max(0, tip.scrollHeight - tip.clientHeight));
    tip.scrollLeft = Math.min(previousScrollLeft, Math.max(0, tip.scrollWidth - tip.clientWidth));
  }
}

function cleanHsuSummaryLine(line) {
  return String(line || '')
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*(summary|classification|categories)\s*[:：]\s*/i, '')
    .replace(/^\s*[-*•]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/(\*\*|__|[*_`~])/g, '')
    .trim();
}

function isHsuSummaryLabelOnly(line) {
  const text = String(line || '').trim();
  if (!/[:：]$/.test(text)) return false;
  const label = text.replace(/[:：]+$/, '').trim();
  if (!label) return false;
  if (/[.!?。！？]/.test(label)) return false;
  return label.split(/\s+/).length <= 5;
}

function normalizeHsuSummaryLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || '').trim();
    if (!line) continue;

    if (isHsuSummaryLabelOnly(line)) {
      const next = String(lines[i + 1] || '').trim();
      if (next && !isHsuSummaryLabelOnly(next)) {
        out.push(`${line} ${next}`);
        i++;
      } else {
        out.push(line);
      }
      continue;
    }

    out.push(line);
  }
  return out;
}

function truncateTooltipLine(line, maxChars = 138) {
  const text = String(line || '').trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
}

function smartTooltipExcerpt(line, maxChars = 138) {
  const text = String(line || '')
    .replace(/\s+/g, ' ')
    .replace(/\$+/g, '')
    .trim();
  if (text.length <= maxChars) return text;
  const clipped = text.slice(0, maxChars + 1);
  const sentenceEnd = Math.max(
    clipped.lastIndexOf('. '),
    clipped.lastIndexOf('; '),
    clipped.lastIndexOf('。'),
    clipped.lastIndexOf('；')
  );
  if (sentenceEnd >= 64) return clipped.slice(0, sentenceEnd + 1).trim();
  const comma = Math.max(clipped.lastIndexOf(', '), clipped.lastIndexOf('，'));
  if (comma >= 72) return clipped.slice(0, comma).trim() + '…';
  return truncateTooltipLine(text, maxChars);
}

function renderHsuSummaryHTML(summary) {
  const raw = String(summary || '')
    .replace(/^\s*```(?:\w+)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  if (!raw) return '';

  if (/^(Generating LLM summary|LLM summary unavailable)/i.test(raw)) {
    return '<span style="opacity:.72">' + _escapeHtml(raw) + '</span>';
  }

  const lines = raw
    .split(/\r?\n/)
    .map(cleanHsuSummaryLine)
    .filter(Boolean)
    .filter(line => !/^(summary|classification|categories)$/i.test(line));

  const normalizedLines = normalizeHsuSummaryLines(lines);

  if (!normalizedLines.length) return '';

  return '<ul style="margin:3px 0 0 0;padding-left:16px;overflow-wrap:anywhere;word-break:break-word">'
       + normalizedLines.map(line => '<li style="margin:1px 0;white-space:normal;overflow-wrap:anywhere;word-break:break-word">' + _escapeHtml(line) + '</li>').join('')
       + '</ul>';
}


function renderBucketTooltipHTML(bucket) {
  if (!bucket) return '<span style="opacity:.62">No data</span>';
  bucket = filterBucketToVisibleCountries(bucket);
  var panelIdx = bucket.panelIdx != null ? bucket.panelIdx : 0;

  var groups = new Map();
  var items = Array.isArray(bucket.items) ? bucket.items : [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var cid = normalizeCountryId(it.country_id || '—');
    var g = groups.get(cid);
    if (!g) {
      var colRec = getCountryColorOverride(panelIdx, cid);
      var col = getExplicitCountryColor(panelIdx, cid) || (colRec && colRec.color) || '#999';
      g = { cid: cid, items: [], msuCount: 0, color: col };
      groups.set(cid, g);
    }
    g.items.push(it);
    if (Array.isArray(it.msu_ids)) g.msuCount += it.msu_ids.length;
  }

  var focusCid = App && App.focusCountryId ? normalizeCountryId(App.focusCountryId) : null;
  var ordered = Array.from(groups.values()).sort(function (a, b) {
    if (focusCid) {
      if (a.cid === focusCid && b.cid !== focusCid) return -1;
      if (b.cid === focusCid && a.cid !== focusCid) return 1;
    }
    return (a.cid < b.cid) ? -1 : (a.cid > b.cid) ? 1 : 0;
  });

  if (!items.length) return '<span style="opacity:.62">No visible source data</span>';

  var totalMSU = bucket.msuCount || 0;
  var totalCountries = groups.size;
  var regionLabel = totalCountries === 1
    ? '1 Exclusive Region'
    : ('Boundary Zone with ' + totalCountries + ' Regions');
  var html = '';
  html += '<div style="margin-bottom:6px;font-weight:600;overflow-wrap:anywhere">'
       +  ' · ' + regionLabel
       +  ' · ' + (totalMSU === 1 ? '1 MSU' : (totalMSU + ' MSUs'))
       +  '</div>';

  var maxGroups = 4;
  var visibleGroups = ordered.slice(0, maxGroups);
  for (var gi = 0; gi < visibleGroups.length; gi++) {
    var g2 = visibleGroups[gi];
    html += '<div style="display:flex;align-items:center;gap:8px;margin:.22em 0 .12em">'
         +   '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;'
         +   'background:' + g2.color + ';flex:none;border:1px solid rgba(255,255,255,0.25)"></span>'
         +   '<span style="opacity:.9;flex:none">' + (g2.msuCount === 1 ? '1 MSU' : (g2.msuCount + ' MSUs')) + '</span>'
         + '</div>';

    var maxLines = Math.min(g2.items.length, 4);
    for (var j = 0; j < maxLines; j++) {
      var it2 = g2.items[j] || {};
      var sum = getDisplaySummaryForHsuItem(panelIdx, it2);

      var sumHtml = sum ? renderHsuSummaryHTML(sum) : '';

      html += '<div style="margin-left:18px;margin-top:2px;opacity:.95;min-width:0;overflow-wrap:anywhere;word-break:break-word;white-space:normal">'
           +   (sumHtml
                ? ('<div style="font-weight:700;color:#1f2937;margin-bottom:1px">Summary:</div>' + sumHtml)
                : '<span style="opacity:.62">No summary</span>')
           + '</div>';
    }

    if (g2.items.length > maxLines) {
      html += '<div style="margin-left:18px;opacity:.6">… and ' + (g2.items.length - maxLines) + ' more HSU groups</div>';
    }
  }

  if (ordered.length > visibleGroups.length) {
    html += '<div style="margin-top:6px;opacity:.6">… and ' + (ordered.length - visibleGroups.length) + ' more sources</div>';
  }

  return '<div style="max-width:100%;box-sizing:border-box;overflow-x:hidden;overflow-wrap:anywhere;word-break:break-word;white-space:normal">' + html + '</div>';
}
  // —— 简易防抖 —— //
  function debounce(fn, wait = 240) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...args); }, wait);
    };
  }

  function setCountryFocus(countryId, mode = 'filled') {
    // 切换聚焦国家 → 清除 release toggle 状态
    if (typeof App !== 'undefined' && App._releaseToggleByPanel) {
      // 找到当前面板 idx，这里假设传入的是全局焦点，可根据你的上下文选择具体 idx
      // 若已有 panelIdx 参数或可获取当前 activePanelIdx，请替换掉 0
      const panelIdx = 0;
      App._releaseToggleByPanel.set(panelIdx, false);
    }
 
    const normId = countryId ? normalizeCountryId(countryId) : null;
    App.focusCountryId = normId;
    App.focusMode = normId ? mode : null;
    // 预览集合可不强依赖（保持或清空均可）
    if (normId && mode === 'filled') App.highlightedHexKeys = getCountryKeysAllPanels(normId);
    else App.highlightedHexKeys.clear();
    updateHexStyles();
  }


  // ★ FIX: 访问全量 msu_index 并解析
  function getMSUIndex() {
    // 允许 key 是字符串或数字；JS 访问时会自动转字符串
    return (App.currentData && App.currentData.msu_index) || {};
  }
  function resolveMSUs(msuIds) {
    const idx = getMSUIndex();
    const out = [];
    (msuIds || []).forEach((id) => {
      // 兼容字符串/数字 id
      const rec = idx[id] ?? idx[String(id)];
      if (!rec) return;

      // Dynamic re-aggregation only changes HSU membership.  Preserve a
      // canonical, stable MSU identity on every record handed to Stepwise so
      // it never falls back to a local array index such as "0|q,r#2".
      const canonicalId = rec.MSU_id ?? rec.msu_id ?? rec.msuid ?? rec.id ?? id;
      out.push({
        ...rec,
        MSU_id: canonicalId,
        id: canonicalId,
        sentence: rec.sentence ?? rec.text ?? rec.content ?? ''
      });
    });
    return out;
  }


  // ★ 可选：国家 ID 归一化（当不同面板用不同 id 表示同一国家时）
  // 用 controller.setCountryIdAlias(...) 可注入 { "p0_c1":"CN", "p1_c01":"CN" } 这样的映射
  App.countryIdAlias = new Map();
  function normalizeCountryId(cid) {
    return App.countryIdAlias.get(cid) || cid;
  }

  function cloneSemanticData(data) {
    return JSON.parse(JSON.stringify(data || { title: 'Semantic Map', subspaces: [], links: [], msu_index: {} }));
  }

  function clearInteractionForAggregation() {
    App.selectedHex = null;
    App.flightStart = null;
    App.flightDraft = null;
    App.flightHoverTarget = null;
    App.hoveredHex = null;
    App.neighborKeySet?.clear?.();
    App.highlightedHexKeys?.clear?.();
    App.persistentHexKeys?.clear?.();
    App.excludedHexKeys?.clear?.();
    App.selectedRouteIds?.clear?.();
  }

  function fitPanelAxialTransform(space, msuIndex) {
    const pairs = [];
    (space?.hexList || []).forEach(h => {
      const ids = Array.isArray(h.msu_ids) ? h.msu_ids : [];
      ids.forEach(id => {
        const m = msuIndex?.[id] ?? msuIndex?.[String(id)];
        const xy = _parseXY(m?.['2d_coord'] || m?.['2dCoord']);
        if (!xy) return;
        if (!Number.isFinite(Number(h.q)) || !Number.isFinite(Number(h.r))) return;
        pairs.push([xy[0], xy[1], Number(h.q), Number(h.r)]);
      });
    });
    return pairs.length >= 3 ? _fitAffine2D(pairs) : null;
  }

  function summarizeCluster(msuIds, msuIndex) {
    const sentences = (msuIds || [])
      .map(id => {
        const m = msuIndex?.[id] ?? msuIndex?.[String(id)];
        return (m?.sentence || m?.text || '').trim();
      })
      .filter(Boolean);
    if (!sentences.length) return '';
    if (sentences.length === 1) return sentences[0];
    return `${sentences.length} semantic units are aggregated in this HSU.`;
  }

  function buildCountriesFromHexList(hexList) {
    const byCountry = new Map();
    (hexList || []).forEach(h => {
      if (!h || !h.country_id) return;
      const cid = normalizeCountryId(h.country_id);
      if (!byCountry.has(cid)) {
        byCountry.set(cid, {
          country_id: cid,
          hexes: [],
        });
      }
      const rec = byCountry.get(cid);
      if (!rec.hexes.some(x => Number(x.q) === Number(h.q) && Number(x.r) === Number(h.r))) {
        rec.hexes.push({ q: h.q, r: h.r });
      }
    });
    return Array.from(byCountry.values());
  }

  function reaggregateSemanticData(rangeRaw) {
    const range = Math.max(1, Number(rangeRaw) || DEFAULT_AGGREGATION_RANGE);
    const base = App.baseSemanticData || App.currentData;
    const data = cloneSemanticData(base);
    const msuIndex = data.msu_index || {};

    if (Math.abs(range - DEFAULT_AGGREGATION_RANGE) < 0.001) {
      return { data, changed: false };
    }

    const scale = DEFAULT_AGGREGATION_RANGE / range;
    data.links = [];

    data.subspaces = (data.subspaces || []).map((space) => {
      const transform = fitPanelAxialTransform(space, msuIndex);
      const groups = new Map();

      (space.hexList || []).forEach(h => {
        const ids = Array.isArray(h.msu_ids) ? h.msu_ids : [];
        ids.forEach(id => {
          const m = msuIndex?.[id] ?? msuIndex?.[String(id)];
          const xy = _parseXY(m?.['2d_coord'] || m?.['2dCoord']);
          let qBase = Number(h.q);
          let rBase = Number(h.r);
          if (transform && xy) {
            const p = _applyAffine(transform, xy[0], xy[1]);
            qBase = p[0];
            rBase = p[1];
          }
          if (!Number.isFinite(qBase) || !Number.isFinite(rBase)) return;

          const q = Math.round(qBase * scale);
          const r = Math.round(rBase * scale);
          const country = h.country_id || m?.country_id || '';
          const modality = h.modality || m?.modality || 'text';
          const key = `${q},${r}|${country}|${modality}`;

          if (!groups.has(key)) {
            groups.set(key, {
              q,
              r,
              modality,
              country_id: country,
              label: h.label,
              msu_ids: [],
            });
          }
          const bucket = groups.get(key);
          if (!bucket.msu_ids.includes(id)) bucket.msu_ids.push(id);
        });
      });

      const hexList = Array.from(groups.values()).map(h => ({
        ...h,
        summary: summarizeCluster(h.msu_ids, msuIndex)
      }));

      return {
        ...space,
        hexList,
        countries: buildCountriesFromHexList(hexList)
      };
    });

    return { data, changed: true };
  }

  function applyAggregationRange(rangeRaw) {
    const nextRange = Math.max(1, Number(rangeRaw) || DEFAULT_AGGREGATION_RANGE);
    if (!App.baseSemanticData) App.baseSemanticData = cloneSemanticData(App.currentData);
    if (Math.abs((App.aggregationRange || DEFAULT_AGGREGATION_RANGE) - nextRange) < 0.001) return;

    const { data, changed } = reaggregateSemanticData(nextRange);
    App.aggregationRange = nextRange;
    App.currentData = data;
    App._lastLinks = changed ? [] : (data.links || []);
    stampSubspaceNamesOnAllLinks(App._lastLinks);
    App.countryKeysGlobal = new Map();
    App.countryKeysByPanel = [];
    App.coordIndexByPanel = new Map();
    App.hexBucketsByPanel = [];
    App.allHexDataByPanel = [];
    App.hexMapsByPanel = [];
    App.msuAlphaByHex = new Map();
    App.alphaCacheByHex = new Map();
    App.borderCacheByHex = new Map();
    App.hsuSummaryCache = new Map();
    App.hsuSummaryPending = new Map();
    if (App.hsuSummaryHoverTimer) clearTimeout(App.hsuSummaryHoverTimer);
    App.hsuSummaryHoverTimer = null;
    App.hoveredTooltipBucket = null;

    if (!Array.isArray(App._rawHexListByPanel)) App._rawHexListByPanel = [];
    (data.subspaces || []).forEach((space, i) => {
      App._rawHexListByPanel[i] = Array.isArray(space.hexList) ? space.hexList.slice() : [];
    });

    clearInteractionForAggregation();
    (data.subspaces || []).forEach((space, i) => renderHexGridFromData(i, space, App.config.hex.radius));
    recomputeMsuAlphaForAllPanels();
    refreshColorOverridesForCurrentAggregation();
    drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, false);
    updateHexStyles();
    emitSemanticColorSnapshot();
    publishToStepAnalysis();
    applyResponsiveLayout(true);
  }

  // 仅取单面板（原有逻辑保留，如需）
  function getCountryKeysInPanel(panelIdx, countryIdRaw) {
    const m = App.countryKeysByPanel?.[panelIdx];
    if (!m) return new Set();
    const cid = normalizeCountryId(countryIdRaw);
    return new Set(m.get(cid) || []);
  }

    // ★ 新增：面板内冲突区域 key 集合（countries.size > 1）
  function getConflictKeysInPanel(panelIdx, countriesFilter) {
    const out = new Set();
    const buckets = App.hexBucketsByPanel?.[panelIdx];
    if (!buckets) return out;
    const filter = countriesFilter ? new Set(Array.from(countriesFilter).map(normalizeCountryId)) : null;
    buckets.forEach((b, key) => {
      if (!b || !b.countries || b.countries.size <= 1) return;
      if (filter) {
        // 与过滤国家有交集才纳入
        let has = false;
        b.countries.forEach(cid => { if (filter.has(normalizeCountryId(cid))) has = true; });
        if (!has) return;
      }
      out.add(`${panelIdx}|${b.q},${b.r}`);
    });
    return out;
  }

  // ★ 新增：面板内某国家参与的“冲突区域” key 集合
  function getConflictKeysForCountryInPanel(panelIdx, countryIdRaw) {
    const cid = normalizeCountryId(countryIdRaw);
    return getConflictKeysInPanel(panelIdx, new Set([cid]));
  }


  // ★ 新增：跨所有面板，取同一国家（规范 id 后）的全部 hex key
  function getCountryKeysAllPanels(countryIdRaw) {
    const out = new Set();
    const cid = normalizeCountryId(countryIdRaw);
    (App.countryKeysByPanel || []).forEach((m) => {
      if (!m) return;
      const s = m.get(cid);
      if (s && s.size) s.forEach(k => out.add(k));
    });
    return out;
  }

  // —— 颜色快照工具：把面板级国家改色拍扁成两个映射 ——
  // 1) colorByCountry: { [normCountryId]: "#RRGGBB" }（跨面板统一色，取第一次出现为主）
  // 2) colorByPanelCountry: { ["panelIdx|normCountryId"]: "#RRGGBB" }（面板内覆盖）
  // —— 小工具：把 "p|q,r" 统一成 "p:q,r" —— //
  const _keyPipeToColon = (k) => {
    if (typeof k !== 'string') return String(k);
    const i = k.indexOf('|');
    return i >= 0 ? `${k.slice(0,i)}:${k.slice(i+1)}` : k;
  };

  // —— 从 App 中构造小卡用的颜色 & 透明度快照 —— //
  function _buildMiniSnapshot() {
    const colorByCountry = {};
    const colorByPanelCountry = {};
    const alphaByNode = {}; // key: "panelIdx:q,r" → 0~1

    if (App && App.globalCountryColors instanceof Map) {
      App.globalCountryColors.forEach((color, rawCid) => {
        const cid = App.countryIdAlias?.get?.(rawCid) || rawCid;
        const hex = color ? normalizeColorToHex(color, null) : null;
        if (cid && hex) colorByCountry[cid] = hex;
      });
    }

    // 颜色：来自 App.panelCountryColors（你的存储结构）
    if (App && App.panelCountryColors instanceof Map) {
      App.panelCountryColors.forEach((m, panelIdx) => {
        if (!(m instanceof Map)) return;
        m.forEach((rec, rawCid) => {
          const cid = App.countryIdAlias?.get?.(rawCid) || rawCid;
          const hex = rec?.color || null;
          if (hex) {
            colorByPanelCountry[`${panelIdx}|${cid}`] = hex;
            if (!(cid in colorByCountry)) colorByCountry[cid] = hex;
          }

          // 透明度：优先 rec.alphaByKey（Map 或对象）
          const abk = rec?.alphaByKey;
          if (abk instanceof Map) {
            abk.forEach((a, k) => {
              if (typeof a === 'number' && a >= 0 && a <= 1) {
                alphaByNode[_keyPipeToColon(k)] = a;
              }
            });
          } else if (abk && typeof abk === 'object') {
            Object.entries(abk).forEach(([k, a]) => {
              if (typeof a === 'number' && a >= 0 && a <= 1) {
                alphaByNode[_keyPipeToColon(k)] = a;
              }
            });
          }
        });
      });
    }

    // 透明度兜底：渲染时缓存（updateHexStyles 写入）
    if (App && App.alphaCacheByHex) {
      if (App.alphaCacheByHex instanceof Map) {
        App.alphaCacheByHex.forEach((a, k) => {
          const kc = _keyPipeToColon(k);
          if (alphaByNode[kc] == null && typeof a === 'number' && a >= 0 && a <= 1) {
            alphaByNode[kc] = a;
          }
        });
      } else if (typeof App.alphaCacheByHex === 'object') {
        Object.entries(App.alphaCacheByHex).forEach(([k, a]) => {
          const kc = _keyPipeToColon(k);
          if (alphaByNode[kc] == null && typeof a === 'number' && a >= 0 && a <= 1) {
            alphaByNode[kc] = a;
          }
        });
      }
    }

    const normalizeCountryId = (cid) => App.countryIdAlias?.get?.(cid) || cid;

    // === 追加：边框样式映射（把 "p|q,r" 转 "p:q,r"） ===
    const borderColorByNode = {};
    const borderWidthByNode = {};
    if (App && App.borderCacheByHex) {
      const put = (k, v) => {
        const colonKey = String(k).replace('|', ':');
        if (v && v.stroke) borderColorByNode[colonKey] = v.stroke;
        if (v && Number.isFinite(v.strokeW)) borderWidthByNode[colonKey] = v.strokeW;
      };
      if (App.borderCacheByHex instanceof Map) {
        App.borderCacheByHex.forEach((v, k) => put(k, v));
      } else if (typeof App.borderCacheByHex === 'object') {
        Object.entries(App.borderCacheByHex).forEach(([k, v]) => put(k, v));
      }
    }

    // 4) 逐点填充（Alt 冲突色）：来自 App.panelConflictColors
    const fillByNode = {};
    if (App && App.panelConflictColors instanceof Map) {
      App.panelConflictColors.forEach((rec /*, panelIdx */) => {
        const fallback = (App.config?.background || '#ffffff');        // NEW: 底色兜底
        const color = rec?.color ?? fallback;                           // NEW: 没配色也用底色
        const alphaByKey = rec?.alphaByKey;
        if (!(alphaByKey instanceof Map)) return;
        alphaByKey.forEach((a, k) => {
          const keyColon = _keyPipeToColon(k);
          fillByNode[keyColon] = color;                                 // 覆盖国家色
          if (typeof a === 'number' && a >= 0 && a <= 1) {              // NEW: 同步冲突透明度
            alphaByNode[keyColon] = a;
          }
        });
      });
    }

    const projectId = App?.currentProjectId || App?.currentData?.project_id || App?.currentData?.projectId || window.__activeProjectId || null;

    // —— 原有返回，补充 3 张表 —— 
    return { projectId, colorByCountry, colorByPanelCountry, alphaByNode, normalizeCountryId,
            borderColorByNode, borderWidthByNode, fillByNode };

  }

  // —— 颜色/透明度/边框/逐点填充 的右侧快照 ——
  // 注意：这是在 semanticMap.js 里替换 _buildColorMapsSnapshot 的完整实现
  function _buildColorMapsSnapshot() {
    const colorByCountry = {};
    const colorByPanelCountry = {};
    const alphaByNode = {}; // "panelIdx:q,r" -> 0..1

    const _keyPipeToColon = (k) => {
      if (typeof k !== 'string') return String(k);
      const i = k.indexOf('|');
      return i >= 0 ? `${k.slice(0,i)}:${k.slice(i+1)}` : k;
    };
    const normalizeCountryId = (cid) => App.countryIdAlias?.get?.(cid) || cid;

    // 1) 颜色（保持你原逻辑）
    if (App && App.panelCountryColors instanceof Map) {
      App.panelCountryColors.forEach((m, panelIdx) => {
        if (!(m instanceof Map)) return;
        m.forEach((rec, rawCid) => {
          const cid = normalizeCountryId ? normalizeCountryId(rawCid) : rawCid;
          const hex = rec?.color || null;
          if (hex) {
            colorByPanelCountry[`${panelIdx}|${cid}`] = hex;
            if (!(cid in colorByCountry)) colorByCountry[cid] = hex;
          }
          const abk = rec?.alphaByKey;
          if (abk instanceof Map) {
            abk.forEach((a, k) => {
              const keyColon = _keyPipeToColon(k);
              if (typeof a === 'number' && a >= 0 && a <= 1) alphaByNode[keyColon] = a;
            });
          } else if (abk && typeof abk === 'object') {
            Object.entries(abk).forEach(([k, a]) => {
              const keyColon = _keyPipeToColon(k);
              if (typeof a === 'number' && a >= 0 && a <= 1) alphaByNode[keyColon] = a;
            });
          }
        });
      });
    }

    // 2) 透明度兜底：来自渲染缓存（updateHexStyles 写入）
    if (App && App.alphaCacheByHex) {
      if (App.alphaCacheByHex instanceof Map) {
        App.alphaCacheByHex.forEach((a, k) => {
          const keyColon = _keyPipeToColon(k);
          if (alphaByNode[keyColon] == null && typeof a === 'number' && a >= 0 && a <= 1) {
            alphaByNode[keyColon] = a;
          }
        });
      } else if (typeof App.alphaCacheByHex === 'object') {
        Object.entries(App.alphaCacheByHex).forEach(([k, a]) => {
          const keyColon = _keyPipeToColon(k);
          if (alphaByNode[keyColon] == null && typeof a === 'number' && a >= 0 && a <= 1) {
            alphaByNode[keyColon] = a;
          }
        });
      }
    }

    // 3) 边框样式：来自 App.borderCacheByHex（updateHexStyles 写入）
    const borderColorByNode = {};
    const borderWidthByNode = {};
    if (App && App.borderCacheByHex) {
      const put = (k, v) => {
        const keyColon = _keyPipeToColon(k);
        if (v && v.stroke) borderColorByNode[keyColon] = v.stroke;
        if (v && Number.isFinite(v.strokeW)) borderWidthByNode[keyColon] = v.strokeW;
      };
      if (App.borderCacheByHex instanceof Map) {
        App.borderCacheByHex.forEach((v, k) => put(k, v));
      } else if (typeof App.borderCacheByHex === 'object') {
        Object.entries(App.borderCacheByHex).forEach(([k, v]) => put(k, v));
      }
    }

    // 4) 逐点填充（Alt 冲突色）：来自 App.panelConflictColors
    const fillByNode = {};
    if (App && App.panelConflictColors instanceof Map) {
      App.panelConflictColors.forEach((rec /*, panelIdx */) => {
        const color = rec?.color;
        const alphaByKey = rec?.alphaByKey;
        if (!color || !(alphaByKey instanceof Map)) return;
        alphaByKey.forEach((_, k) => {
          const keyColon = _keyPipeToColon(k);
          fillByNode[keyColon] = color; // 只要在冲突 alpha 表里，就按冲突统一色涂满
        });
      });
    }

    // 统一返回
    return { colorByCountry, colorByPanelCountry, alphaByNode, borderColorByNode, borderWidthByNode, fillByNode };
  }


    function degradeFocusToOutlineFor(panelIdx) {
      // 面板级优先：如果该面板有本地聚焦，改成 outline
      const local = App.panelFocusOverrides.get(panelIdx);
      if (local && local.countryId && local.mode !== 'outline') {
        App.panelFocusOverrides.set(panelIdx, { countryId: local.countryId, mode: 'outline' });
        return true;
      }
      // 否则退全局：有全局聚焦就把模式改成 outline（不清 countryId）
      if (App.focusCountryId && App.focusMode !== 'outline') {
        App.focusMode = 'outline';
        return true;
      }
      return false;
    }


    // 在指定 svg 里确保存在一个用于“预览态”的斜线填充 pattern
    function ensureHatchPattern(svgSel) {
      if (!svgSel || svgSel.empty && svgSel.empty()) return;
      const defs = svgSel.select('defs').empty() ? svgSel.append('defs') : svgSel.select('defs');
      if (defs.select(`#${STYLE.HATCH_ID}`).empty()) {
        const pat = defs.append('pattern')
          .attr('id', STYLE.HATCH_ID)
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 6).attr('height', 6)
          .attr('patternTransform', 'rotate(45)');
        pat.append('line')
          .attr('x1', 0).attr('y1', 0)
          .attr('x2', 0).attr('y2', 6)
          .attr('stroke', '#444')        // 阴影线的颜色（可按需调整）
          .attr('stroke-width', 1)
          .attr('stroke-opacity', 0.6);  // 线条稍微淡一些
      }
    }

    const safeNum = (v, fallback = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    function isConnectActive() {
      return !!(App.insertMode || App.flightStart);
    }
    function isConnectArmedNow(withCtrl, withShift) {
  // connect-edit disabled
  return false;
}


    // ★ 新增：Route 模式是否开启（键盘 Ctrl/⌘ 或 按钮 Route 绿灯）
    function isRouteMode(withCtrlLike) {
      return !!withCtrlLike || App.uiPref.route;
    }

    const isFiniteTransform = (t) => t && Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.k);

    function getPanelRect(panelIdx) {
      const panelDom = App.playgroundEl.querySelectorAll('.subspace')[panelIdx];
      if (!panelDom) return null;
      const container = panelDom.querySelector('.hex-container');
      if (!container) return null;
      const playgroundRect = App.playgroundEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return {
        left: containerRect.left - playgroundRect.left,
        top: containerRect.top - playgroundRect.top,
        right: containerRect.right - playgroundRect.left,
        bottom: containerRect.bottom - playgroundRect.top
      };
    }
    const pointInRect = (x, y, rect) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

    function getHexGlobalXY(panelIdx, q, r) {
      const hexMap = App.hexMapsByPanel[panelIdx];
      if (!hexMap) return null;
      const hex = hexMap.get(`${q},${r}`);
      if (!hex) return null;
      const panelDom = App.playgroundEl.querySelectorAll('.subspace')[panelIdx];
      const container = panelDom.querySelector('.hex-container');
      const playgroundRect = App.playgroundEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const offsetX = containerRect.left - playgroundRect.left;
      const offsetY = containerRect.top - playgroundRect.top;
      const t = App.zoomStates[panelIdx] || d3.zoomIdentity;
      const [tx, ty] = [t.applyX(hex.x), t.applyY(hex.y)];
      return [tx + offsetX, ty + offsetY];
    }

    // 为每个 panel 的 <svg> 确保一个斜线填充 pattern
    function ensureHatchDefs(svgSel, panelIdx) {
      let defs = svgSel.select('defs');
      if (defs.empty()) defs = svgSel.append('defs');

      const pid = `hex-hatch-${panelIdx}`;
      let pat = defs.select(`#${pid}`);
      if (pat.empty()) {
        pat = defs.append('pattern')
          .attr('id', pid)
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', STYLE.HATCH_SPACING)
          .attr('height', STYLE.HATCH_SPACING)
          .attr('patternTransform', `rotate(${STYLE.HATCH_ANGLE})`);

        // 只画线，不画背景；“空白”区域透明 → 下方的底色可见
        pat.append('line')
          .attr('x1', 0).attr('y1', 0)
          .attr('x2', 0).attr('y2', STYLE.HATCH_SPACING)
          .attr('stroke', STYLE.HATCH_STROKE)
          .attr('stroke-width', STYLE.HATCH_STROKE_WIDTH)
          .attr('opacity', STYLE.HATCH_OPACITY);
      }
      return `url(#${pid})`;
    }

    // —— 从 App.panelCountryColors 构建小卡片可用的颜色映射 —— //
    // 返回 { colorByCountry: {...}, colorByPanelCountry: {...} }
    function _buildMiniColorMaps() {
      const colorByPanelCountry = {};
      const colorByCountry = {}; // 目前你主图没有“全局国家改色”，先留空对象

      // 1) 面板级改色（右键调色存这里）：App.panelCountryColors: Map(panelIdx -> Map(countryId -> { color, alphaByKey }))
      App.panelCountryColors.forEach((countryMap, panelIdx) => {
        countryMap.forEach((entry, rawCid) => {
          const cid = normalizeCountryId(rawCid);
          if (!entry || !entry.color) return;

          // 主键：用“规范化 id”
          colorByPanelCountry[`${panelIdx}|${cid}`] = entry.color;

          // 兼容：如果你有别名（raw -> canonical），把“原始 id”也一并写入，防止小卡片节点用的是 rawCid
          // App.countryIdAlias: Map(raw -> canonical)
          App.countryIdAlias?.forEach((to, from) => {
            if (to === cid) {
              colorByPanelCountry[`${panelIdx}|${from}`] = entry.color;
            }
          });
        });
      });

      // 2) 若以后你做了“全局国家改色”，在这里把 { canonicalCid: color } 写到 colorByCountry 即可

      return { colorByCountry, colorByPanelCountry };
    }


  // 从当前已选节点集合（persistentHexKeys）推导出涉及到的整条线路，灌入 selectedRouteIds
  function seedSelectedRoutesFromPersistent() {
    if (!App.persistentHexKeys || App.persistentHexKeys.size === 0) return false;
    if (App.selectedRouteIds && App.selectedRouteIds.size > 0) return false;

    let added = false;
    (App._lastLinks || []).forEach(link => {
      if (!isSelectableRoute(link)) return;
      const path = Array.isArray(link.path) ? link.path : [];
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const pIdx = resolvePanelIdxForPathPoint(p, link, i);
        const key = `${pIdx}|${p.q},${p.r}`;
        if (App.persistentHexKeys.has(key)) {
          App.selectedRouteIds.add(linkKey(link));
          added = true;
          break;
        }
      }
    });

    if (added) {
      // 用路线+排除点重算一次持久选集，保证后续操作都在“路线视角”上进行
      recomputePersistentFromRoutes();
    }
    return added;
  }


  /* =========================
 * Alt 改色：状态与工具
 * ========================= */

// 面板级颜色覆盖：panelIdx -> (countryId -> { color: '#RRGGBB', alphaByKey: Map<'p|q,r', number> })
App.panelCountryColors = new Map();

// 临时预览态（打开菜单时用）
App._pendingColorEdit = null; 
// { panelIdx, countryId, color, keys:Set<"p|q,r">, alphaByKey:Map }

App.panelConflictColors = new Map();
// 临时预览（和国家改色的 pending 并存）
App._pendingConflictEdit = null;
// 判断某格是否冲突（countries.size > 1）
function isConflictHex(panelIdx, q, r) {
  try {
    const b = getBucket(panelIdx, q, r);
    return !!(b && b.countries && b.countries.size > 1);
  } catch { return false; }
}

// 冲突区：构建透明度渐变（整面板的冲突 hex）
function buildConflictAlphaRampFor(panelIdx) {
  const keys = getConflictKeysInPanel(panelIdx); // 已有函数
  const alphaByKey = new Map();
  Array.from(keys).forEach(k => {
    const [pStr, qr] = String(k).split('|');
    const [qs, rs] = String(qr || '').split(',');
    const p = Number(pStr);
    const q = Number(qs);
    const r = Number(rs);
    const bucket = getBucket(p, q, r);
    const alpha =
      App.msuAlphaByHex?.get?.(k) ??
      (bucket ? opacityForMsuCount(bucket.msuCount) : STYLE.OPACITY_DEFAULT);
    alphaByKey.set(k, alpha);
  });
  return { keys: new Set(keys), alphaByKey };
}

// 写入/读取 冲突色
function setConflictColorOverride(panelIdx, color, alphaByKey) {
  
  if ((App?.modKeys?.alt || App?.uiPref?.area) && App?._pendingConflictEdit && !App._isConfirmingAltColor) {
    // 未经确认：忽略任何写入请求（防外部监听或意外调用）
    return;
  }
  let alphaMap = new Map();
  if (alphaByKey instanceof Map) {
    alphaMap = new Map(
      Array.from(alphaByKey.entries()).map(([k, v]) => {
        const kk = (typeof k === 'string') ? (k.includes('|') ? k : k.replace(':','|')) : String(k);
        return [kk, v];
      })
    );
  } else if (alphaByKey && typeof alphaByKey === 'object') {
    for (const [k, v] of Object.entries(alphaByKey)) {
      const kk = k.includes('|') ? k : k.replace(':','|');
      alphaMap.set(kk, v);
    }
  }
  
  if (!alphaMap || alphaMap.size === 0) {
    alphaMap = new Map();
    const keys = getConflictKeysInPanel(panelIdx); // Set<"p|q,r">
    keys.forEach(k => {
      const a = (App.alphaCacheByHex?.get?.(k) ?? App.msuAlphaByHex?.get?.(k) ?? STYLE.OPACITY_DEFAULT);
      alphaMap.set(k, a);
    });
  }


  App.panelConflictColors.set(panelIdx, { color, alphaByKey: alphaMap });
  emitSemanticColorSnapshot();
}

function getConflictColorOverride(panelIdx) {
  return App.panelConflictColors?.get(panelIdx) || null;
}

// —— 工具：规范化国家 ID（含别名） ——
function _normCid(cid) {
  return (App?.countryIdAlias?.get?.(cid) || cid || '').toString();
}

// ★ 新增：为“某面板 + 某国家”的全部 hex 重建 alphaMap（遵循你现有的 MSU → 透明度逻辑）
function buildAlphaMapForPanelCountry(panelIdx, countryId) {
  const cid = normalizeCountryId(countryId);
  const keys = getCountryKeysInPanel(panelIdx, cid); // Set<"p|q,r">
  const conflict = (typeof getConflictKeysForCountryInPanel === 'function')
    ? getConflictKeysForCountryInPanel(panelIdx, cid)
    : new Set();

  const alphaMap = new Map();
  for (const k of keys) {
    if (conflict.has(k)) continue;
    const a =
      (App.msuAlphaByHex?.get?.(k)) ??
      (App.alphaCacheByHex?.get?.(k)) ??
      STYLE.OPACITY_DEFAULT;
    alphaMap.set(k, a);
  }
  return alphaMap;
}


// ★ 新增：把某个国家的颜色同步到所有子空间
function propagateCountryColorToAllPanels(countryId, color) {
  const cid = normalizeCountryId(countryId);

  // 1) 记录到全局颜色表（供渲染兜底）
  App.globalCountryColors.set(cid, color);

  // 2) 写入每个面板的 panelCountryColors，并重建 alphaMap（按该面板的 MSU 分布）
  if (!App.panelCountryColors) App.panelCountryColors = new Map();

  (App.countryKeysByPanel || []).forEach((m, panelIdx) => {
    if (!m) return; // 该面板内可能没有任何国家
    let perPanel = App.panelCountryColors.get(panelIdx);
    if (!perPanel) {
      perPanel = new Map();
      App.panelCountryColors.set(panelIdx, perPanel);
    }
    const alphaByKey = buildAlphaMapForPanelCountry(panelIdx, cid);
    perPanel.set(cid, { color, alphaByKey });

    
  });

  // 3) 刷新
  if (typeof updateHexStyles === 'function') updateHexStyles();
  emitSemanticColorSnapshot();
}


// —— 覆盖色：写入（按 MSU → 透明度 基线为该国每个 hex 建立 alphaMap）——
function setCountryColorOverride(panelIdx, countryId, color, alphaByKey) {
  if ((App?.modKeys?.alt || App?.uiPref?.area) && App?._pendingColorEdit && !App._isConfirmingAltColor) {
    return;
  }

  if (!App.panelCountryColors) App.panelCountryColors = new Map();

  let perPanel = App.panelCountryColors.get(panelIdx);
  if (!perPanel) {
    perPanel = new Map();
    App.panelCountryColors.set(panelIdx, perPanel);
  }

  const cid = _normCid(countryId);

  // 统一 alphaByKey 的 key 形态 -> `${panelIdx}|${q},${r}`
  let incoming = new Map();
  if (alphaByKey instanceof Map) {
    incoming = new Map(Array.from(alphaByKey.entries()).map(([k, v]) => {
      const kk = (typeof k === 'string') ? (k.includes('|') ? k : k.replace(':','|')) : String(k);
      return [kk, v];
    }));
  } else if (alphaByKey && typeof alphaByKey === 'object') {
    for (const [k, v] of Object.entries(alphaByKey)) {
      const kk = k.includes('|') ? k : k.replace(':','|');
      incoming.set(kk, v);
    }
  }

  // —— 关键：为“该国在该面板里的所有 hex”构造每格透明度 —— //
  // 规则：优先用 “MSU 基线” -> 没有就用 “渲染时的最终透明度缓存” -> 再没有用默认
  // —— 关键：为“该国在该面板里的所有 hex”构造每格透明度 —— //
  const alphaMap = new Map();
  const cidNorm = _normCid(countryId);
  const allKeys = getCountryKeysInPanel(panelIdx, cidNorm); // Set<"p|q,r">
  const conflict = (typeof getConflictKeysForCountryInPanel === 'function')
    ? getConflictKeysForCountryInPanel(panelIdx, cidNorm)
    : new Set();

  allKeys.forEach(k => {
    if (conflict.has(k)) return;
    const a =
      (App.msuAlphaByHex?.get?.(k)) ??
      (App.alphaCacheByHex?.get?.(k)) ??
      incoming.get(k) ??
      STYLE.OPACITY_DEFAULT;
    alphaMap.set(k, a);
  });


  perPanel.set(cid, { color, alphaByKey: alphaMap });

  // ★ 可选追加：保证调用 setCountryColorOverride 也能全局同步
  if (App.syncCountryColorAcrossPanels) {
    propagateCountryColorToAllPanels(countryId, color);
  }


  // Ensure visual refresh immediately (including scatter points) after color changes.
  // Use rAF to avoid repeated synchronous recomputations during rapid edits.
  try {
    const raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
    if (!App._scheduledStyleUpdate) {
      App._scheduledStyleUpdate = true;
      raf(() => {
        App._scheduledStyleUpdate = false;
        if (typeof updateHexStyles === 'function') updateHexStyles();
      });
    }
  } catch (e) {}
  emitSemanticColorSnapshot();
}


// —— 覆盖色：读取 —— //
function getCountryColorOverride(panelIdx, countryId) {
  const perPanel = App.panelCountryColors?.get(panelIdx);
  if (!perPanel) return null;
  const cid = _normCid(countryId);
  return perPanel.get(cid) || null;
}


// 依据“该面板 + 国家”的实际 hex 集合，生成一条透明度比例尺（层次感）
// 策略：沿用 MSU 数量透明度，颜色可改，密度表达保持稳定
function buildAlphaRampFor(panelIdx, countryId) {
  const cid = normalizeCountryId(countryId);
  const keys = getCountryKeysInPanel(panelIdx, cid); // Set<"p|q,r">
  const conflict = (typeof getConflictKeysForCountryInPanel === 'function')
    ? getConflictKeysForCountryInPanel(panelIdx, cid)
    : new Set();
  const filtered = Array.from(keys).filter(k => !conflict.has(k));

  const alphaByKey = new Map();
  filtered.forEach(k => {
    const [pStr, qr] = String(k).split('|');
    const [qs, rs] = String(qr || '').split(',');
    const p = Number(pStr);
    const q = Number(qs);
    const r = Number(rs);
    const bucket = getBucket(p, q, r);
    const alpha =
      App.msuAlphaByHex?.get?.(k) ??
      (bucket ? opacityForMsuCount(bucket.msuCount) : STYLE.OPACITY_DEFAULT);
    alphaByKey.set(k, alpha);
  });
  return { keys: new Set(filtered), alphaByKey };
}

function refreshColorOverridesForCurrentAggregation() {
  const previousPanelColors = App.panelCountryColors instanceof Map
    ? App.panelCountryColors
    : new Map();
  const previousGlobalColors = App.globalCountryColors instanceof Map
    ? App.globalCountryColors
    : new Map();
  const previousConflictColors = App.panelConflictColors instanceof Map
    ? App.panelConflictColors
    : new Map();

  const nextPanelColors = new Map();
  const rememberPanelColor = (panelIdx, countryId, color) => {
    if (!color) return;
    const cid = normalizeCountryId(countryId);
    const alphaByKey = buildAlphaMapForPanelCountry(panelIdx, cid);
    if (!alphaByKey.size) return;
    let perPanel = nextPanelColors.get(panelIdx);
    if (!perPanel) {
      perPanel = new Map();
      nextPanelColors.set(panelIdx, perPanel);
    }
    perPanel.set(cid, { color, alphaByKey });
  };

  if (App.syncCountryColorAcrossPanels) {
    const colorsByCountry = new Map();
    previousPanelColors.forEach(countryMap => {
      if (!(countryMap instanceof Map)) return;
      countryMap.forEach((rec, rawCid) => {
        const cid = normalizeCountryId(rawCid);
        if (rec?.color && !colorsByCountry.has(cid)) colorsByCountry.set(cid, rec.color);
      });
    });
    previousGlobalColors.forEach((color, rawCid) => {
      const cid = normalizeCountryId(rawCid);
      if (color) colorsByCountry.set(cid, color);
    });
    colorsByCountry.forEach((color, cid) => {
      (App.countryKeysByPanel || []).forEach((countryMap, panelIdx) => {
        if (countryMap?.has?.(cid)) rememberPanelColor(panelIdx, cid, color);
      });
    });
    App.globalCountryColors = colorsByCountry;
  } else {
    previousPanelColors.forEach((countryMap, panelIdx) => {
      if (!(countryMap instanceof Map)) return;
      countryMap.forEach((rec, rawCid) => {
        rememberPanelColor(panelIdx, rawCid, rec?.color);
      });
    });
    App.globalCountryColors = previousGlobalColors;
  }

  const nextConflictColors = new Map();
  previousConflictColors.forEach((rec, panelIdx) => {
    if (!rec?.color) return;
    const ramp = buildConflictAlphaRampFor(panelIdx);
    if (!ramp.alphaByKey.size) return;
    nextConflictColors.set(panelIdx, { color: rec.color, alphaByKey: ramp.alphaByKey });
  });

  App.panelCountryColors = nextPanelColors;
  App.panelConflictColors = nextConflictColors;
}

function isHexKeyVisible(key) {
  if (!App.visibleCountries) return true;
  const [p, qr] = String(key || '').split('|');
  const [q, r] = String(qr || '').split(',');
  const bucket = getBucket(Number(p), q, r);
  return !!(bucket && bucket.countries && Array.from(bucket.countries).some(cid => App.visibleCountries.has(normalizeCountryId(cid))));
}

function refreshAfterVisibleCountriesChange() {
  App._pendingColorEdit = null;
  App._pendingConflictEdit = null;
  App.hoveredTooltipBucket = null;
  App.highlightedHexKeys?.clear?.();
  App.alphaCacheByHex = new Map();
  App.borderCacheByHex = new Map();
  App._hexStyleByKey = new Map();

  const filterKeySet = (set) => new Set(Array.from(set || []).filter(isHexKeyVisible));
  App.persistentHexKeys = filterKeySet(App.persistentHexKeys);
  App.highlightedHexKeys = filterKeySet(App.highlightedHexKeys);
  App.excludedHexKeys = filterKeySet(App.excludedHexKeys);

  if (App.visibleCountries && App.selectedRouteIds?.size) {
    const keptRoutes = new Set();
    (App._lastLinks || []).forEach(link => {
      const rid = linkKey(link);
      if (!rid || !App.selectedRouteIds.has(rid)) return;
      const hasVisiblePoint = (link.path || []).some((pt, i) => {
        const pIdx = resolvePanelIdxForPathPoint(pt, link, i);
        return isHexKeyVisible(pkey(pIdx, pt.q, pt.r));
      });
      if (hasVisiblePoint) keptRoutes.add(rid);
    });
    App.selectedRouteIds = keptRoutes;
    recomputePersistentFromRoutesPreservingExtras();
    App.persistentHexKeys = filterKeySet(App.persistentHexKeys);
  }

  recomputeMsuAlphaForAllPanels();
  refreshColorOverridesForCurrentAggregation();
  drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!(App.flightStart || App.flightDraft));
  updateHexStyles?.();
  emitSelectionPayload?.();
  emitSemanticColorSnapshot();
  publishToStepAnalysis?.();
}

/* =========================
 * 右键菜单（全局唯一）
 * ========================= */
function ensureColorMenu() {
  let menu = document.getElementById('alt-color-menu');
  if (menu && menu.dataset.semanticMapOwner !== App.instanceId) {
    menu.remove();
    menu = null;
  }
  if (menu) return menu;

  menu = document.createElement('div');
  menu.id = 'alt-color-menu';
  menu.dataset.semanticMapOwner = App.instanceId;
  Object.assign(menu.style, {
    position: 'fixed',
    display: 'none',
    zIndex: 9999,
    width: '180px',
    boxSizing: 'border-box',
    padding: '8px',
    borderRadius: '8px',
    background: '#ffffff',
    color: '#111827',
    boxShadow: '0 12px 28px rgba(15,23,42,.18)',
    border: '1px solid rgba(0,0,0,.12)',
    backdropFilter: 'blur(6px)',
  });

  const colorSwatches = (Array.isArray(COLOR_PALETTE) ? COLOR_PALETTE : [])
    .slice(0, 7)
    .map(color => {
      const hex = normalizeColorToHex(color, '#4C78A8').toUpperCase();
      return `<button type="button" data-alt-color-swatch="${hex}" aria-label="Use ${hex}"
        style="width:18px;height:18px;padding:0;border:1px solid rgba(0,0,0,.18);
               border-radius:999px;background:${hex};cursor:pointer"></button>`;
    })
    .join('');

  menu.innerHTML = `
    <div style="display:grid;grid-template-columns:30px 94px 26px;align-items:center;gap:6px;margin-bottom:7px">
      <input id="alt-color-input" type="color" 
            style="width:30px;height:26px;box-sizing:border-box;padding:0;border:1px solid #d1d5db;
                   border-radius:5px;background:#fff;cursor:pointer" />
      <input id="alt-color-hex" type="text" placeholder="#AABBCC"
            spellcheck="false"
            style="width:94px;min-width:94px;max-width:94px;box-sizing:border-box;height:26px;border-radius:5px;
                   border:1px solid #d1d5db;background:#fff;color:#111827;
                   padding:0 7px;font-size:11.5px;outline:none;
                   font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono',monospace" />
      <button id="alt-color-random" type="button" title="Random color" aria-label="Random color"
              style="width:26px;height:26px;box-sizing:border-box;border:1px solid #111827;
                     border-radius:999px;background:#111827;color:#fff;cursor:pointer;
                     font-size:11px;font-weight:800;line-height:24px;text-align:center;padding:0">
        R
      </button>
    </div>

    <div style="display:grid;grid-template-columns:repeat(7, 18px);gap:6px;margin-bottom:7px">
      ${colorSwatches}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:6px">
      <button id="alt-color-cancel" type="button"
              style="height:27px;box-sizing:border-box;padding:0 9px;border-radius:6px;
                     border:1px solid #d1d5db;background:#fff;color:#111827;
                     font-size:11.5px;cursor:pointer">
        Cancel
      </button>
      <button id="alt-color-confirm" type="button"
              style="height:27px;box-sizing:border-box;padding:0 9px;border-radius:6px;
                     border:1px solid #111827;background:#111827;color:#fff;
                     font-size:11.5px;cursor:pointer">
        Apply
      </button>
    </div>
  `;

  document.body.appendChild(menu);


  const pick = () => {
    const inp = /** @type {HTMLInputElement} */(menu.querySelector('#alt-color-input'));
    const hex = /** @type {HTMLInputElement} */(menu.querySelector('#alt-color-hex'));
    return { inp, hex };
  };

  const applyMenuColor = (color) => {
    const { inp, hex } = pick();
    const next = normalizeColorToHex(color, '#4C78A8').toUpperCase();
    if (inp) inp.value = next;
    if (hex) hex.value = next;
    if (App._pendingColorEdit) App._pendingColorEdit.color = next;
    if (App._pendingConflictEdit) App._pendingConflictEdit.color = next;
    debouncedPreview();
  };

  // 同步：色盘 <-> 文本
  // —— 输入同步：色盘 <-> 文本，并同时更新两个 pending —— 
  menu.querySelector('#alt-color-input').addEventListener('input', () => {
    const inp = /** @type {HTMLInputElement} */(menu.querySelector('#alt-color-input'));
    const hex = /** @type {HTMLInputElement} */(menu.querySelector('#alt-color-hex'));
    hex.value = inp.value.toUpperCase();

    if (App._pendingColorEdit)    App._pendingColorEdit.color = inp.value;
    if (App._pendingConflictEdit) App._pendingConflictEdit.color = inp.value;
    debouncedPreview();
  });

  menu.querySelector('#alt-color-hex').addEventListener('input', () => {
    const inp = /** @type {HTMLInputElement} */(menu.querySelector('#alt-color-input'));
    const hex = /** @type {HTMLInputElement} */(menu.querySelector('#alt-color-hex'));
    const v = hex.value.trim();
    if (/^#([0-9a-f]{6})$/i.test(v)) {
      inp.value = v;
      if (App._pendingColorEdit)    App._pendingColorEdit.color = v;
      if (App._pendingConflictEdit) App._pendingConflictEdit.color = v;
      debouncedPreview();
    }
  });

  menu.querySelector('#alt-color-random').addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const { inp, hex } = pick();
    const current = normalizeColorToHex(hex?.value || inp?.value || '#4C78A8', '#4C78A8').toUpperCase();
    if (!Array.isArray(App._colorMenuRandomHistory)) App._colorMenuRandomHistory = [];
    App._colorMenuRandomHistory.push(current);

    const tried = Array.from(new Set(App._colorMenuRandomHistory.map(c => String(c).toUpperCase())));
    const palette = Array.isArray(COLOR_PALETTE) ? COLOR_PALETTE : [];
    const unusedInSession = palette.filter(color => !tried.includes(String(color).toUpperCase()));
    const extraUsed = unusedInSession.length ? tried : [current];
    const next = pickRandomColor(`menu-random:${Date.now()}:${current}:${tried.length}`, extraUsed);
    App._colorMenuRandomHistory.push(normalizeColorToHex(next, '#4C78A8').toUpperCase());
    applyMenuColor(next);
  });

  menu.querySelectorAll('[data-alt-color-swatch]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyMenuColor(btn.getAttribute('data-alt-color-swatch'));
    });
  });

  // —— 确认：同时落盘冲突颜色 & 国家颜色 —— 
  menu.querySelector('#alt-color-confirm').addEventListener('click', () => {
    App._isConfirmingAltColor = true;   
    const colorInp = /** @type {HTMLInputElement} */(menu.querySelector('#alt-color-input'));
    const colorHex = /** @type {HTMLInputElement} */(menu.querySelector('#alt-color-hex'));
    let chosen = (colorHex?.value || colorInp?.value || '').trim();
    if (!/^#([0-9a-f]{6})$/i.test(chosen)) chosen = null;

    const pendC = App._pendingConflictEdit;
    const pendN = App._pendingColorEdit;

    if (pendC && chosen) {
      App._isConfirmingAltColor = true;
      setConflictColorOverride(pendC.panelIdx, chosen, pendC.alphaByKey);
      App._isConfirmingAltColor = false;
    }
    if (pendN && chosen) {
      // 1) 原面板先落一份（不破坏你原来的 per-panel 行为）
      setCountryColorOverride(pendN.panelIdx, pendN.countryId, chosen, pendN.alphaByKey);

      // 2) ★ 新增：跨子空间同步
      if (App.syncCountryColorAcrossPanels) {
        propagateCountryColorToAllPanels(pendN.countryId, chosen);
      }
    }
    App._isConfirmingAltColor = false;
    App._pendingConflictEdit = null;
    App._pendingColorEdit = null;
    hideColorMenu();
    updateHexStyles();
  });

  // —— 取消 / 点击外部：同时丢弃两个 pending —— 
  menu.querySelector('#alt-color-cancel').addEventListener('click', () => {
    App._pendingConflictEdit = null;
    App._pendingColorEdit = null;
    hideColorMenu();
    updateHexStyles();
  });

  document.addEventListener('click', (e) => {
    if (menu.style.display === 'none') return;
    if (!menu.contains(e.target)) {
      App._pendingConflictEdit = null;
      App._pendingColorEdit = null;
      hideColorMenu();
      updateHexStyles();
    }
  });

  // —— 预览刷新：任一 pending 存在就预览 —— 
  const debouncedPreview = debounce(() => {
    if (App._pendingColorEdit || App._pendingConflictEdit) updateHexStyles();
  }, 160);


  return menu;
}

function showColorMenu(x, y, initColor = '#a9d08d') {
  const menu = ensureColorMenu();
  if (!menu) return;

  const inp = /** @type {HTMLInputElement|null} */(menu.querySelector('#alt-color-input'));
  const hex = /** @type {HTMLInputElement|null} */(menu.querySelector('#alt-color-hex'));

  // 统一成 "#RRGGBB"（大写）
  const hexColor = normalizeColorToHex(initColor, '#4C78A8');

  if (inp) inp.value = hexColor;               // <input type="color"> 也能接受大写
  if (hex) hex.value = hexColor.toUpperCase(); // 文本显示大写
  App._colorMenuRandomHistory = [hexColor.toUpperCase()];

  // 避免出屏
  const pad = 8;
  const vw = window.innerWidth, vh = window.innerHeight;
  // 先显示，再测量 offsetWidth/Height 更准确
  menu.style.display = 'block';
  const w = menu.offsetWidth || 240;
  const h = menu.offsetHeight || 120;
  menu.style.left = Math.min(x, vw - w - pad) + 'px';
  menu.style.top  = Math.min(y, vh - h - pad) + 'px';
}

function hideColorMenu() {
  const menu = document.getElementById('alt-color-menu');
  if (menu) menu.style.display = 'none';
}

function isHexTooltipNode(node) {
  return !!(node && (
    node.id === 'hex-tip' ||
    (typeof node.closest === 'function' && node.closest('#hex-tip'))
  ));
}

function clearHexTooltipState() {
  if (App.hsuSummaryHoverTimer) clearTimeout(App.hsuSummaryHoverTimer);
  App.hsuSummaryHoverTimer = null;
  App.hoveredTooltipBucket = null;
  App.lastHexTooltipClient = null;
}

function getVisibleHexTooltip() {
  const tip = document.getElementById('hex-tip');
  if (!tip || tip.style.display === 'none') return null;
  return tip;
}

function isPointInsideHexTooltip(clientX, clientY) {
  const tip = getVisibleHexTooltip();
  if (!tip) return false;
  const rect = tip.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function wheelDeltaInPixels(delta, deltaMode = 0) {
  // WheelEvent.deltaY is normally pixels, but trackpads/mice may also report
  // lines or pages. Convert them so manual tooltip scrolling stays natural.
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * window.innerHeight;
  return delta;
}

function consumeHexTooltipWheel(event) {
  const tip = getVisibleHexTooltip();
  if (!tip) return false;

  // Prefer the actual event path. This still works when a browser does not
  // provide useful client coordinates for a high-precision wheel event.
  const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
  const targetsTooltip = eventPath.includes(tip)
    || isHexTooltipNode(event.target)
    || isPointInsideHexTooltip(event.clientX, event.clientY);
  if (!targetsTooltip) return false;

  // The map owns wheel-to-zoom, so consume every wheel gesture over a tooltip
  // even if it is currently at its top/bottom boundary.
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

  const maxScrollTop = Math.max(0, tip.scrollHeight - tip.clientHeight);
  const maxScrollLeft = Math.max(0, tip.scrollWidth - tip.clientWidth);
  tip.scrollTop = Math.min(maxScrollTop, Math.max(0, tip.scrollTop + wheelDeltaInPixels(event.deltaY, event.deltaMode)));
  tip.scrollLeft = Math.min(maxScrollLeft, Math.max(0, tip.scrollLeft + wheelDeltaInPixels(event.deltaX, event.deltaMode)));
  return true;
}

// —— Hover Tooltip（与改色菜单同级的小组件）——
function ensureHexTooltip() {
  let tip = document.getElementById('hex-tip');
  if (tip) return tip;

  tip = document.createElement('div');
  tip.id = 'hex-tip';
  Object.assign(tip.style, {
    position: 'fixed',
    display: 'none',
    zIndex: 2147483600,
    width: 'auto',
    minWidth: '240px',
    maxWidth: 'min(460px, calc(100vw - 28px))',
    maxHeight: 'min(84vh, 820px)',
    overflowY: 'auto',
    overflowX: 'hidden',
    overscrollBehavior: 'contain',
    scrollbarGutter: 'stable',
    touchAction: 'pan-y',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: '12px',
    background: '#ffffff',         // 白底
    color: '#111',                 // 黑字
    boxShadow: '0 8px 18px rgba(0,0,0,0.15)', // 阴影也可以调浅一点
    border: '1px solid rgba(0,0,0,0.1)',      // 边框浅灰
    backdropFilter: 'blur(6px)',
    fontSize: '12.5px',
    lineHeight: '1.45',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    pointerEvents: 'auto'
  });
  tip.addEventListener('wheel', (event) => {
    consumeHexTooltipWheel(event);
  }, { passive: false });
  tip.addEventListener('mouseleave', () => {
    hideHexTooltip();
    clearHexTooltipState();
    App.hoveredHex = null;
    App.highlightedHexKeys?.clear?.();
    updateHexStyles?.();
  });
  tip.innerHTML = ''; // 动态填充
  document.body.appendChild(tip);
  return tip;
}

function renderHexTooltipHTML({ color = '#999', msuCount = 0, summary = '' }) {
  const safeSummary = (summary || '').toString().trim();
  // 根据数量决定显示 "MSU" 还是 "MSUs"
  const label = msuCount === 1 ? 'MSU' : 'MSUs';
  return `
    <div style="display:flex;align-items:center;gap:8px">
      <span style="
        display:inline-block;width:10px;height:10px;border-radius:50%;
        background:${color};flex:none;border:1px solid rgba(255,255,255,0.25)
      "></span>
      <span style="opacity:.9;flex:none"><b>${msuCount}</b> ${label}: </span>
      <span style="opacity:.95;flex:1">${safeSummary || '<span style="opacity:.62">No summary</span>'}</span>
    </div>
  `;
}


function _escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMSUTooltipHTML(d) {
  // d: {msu_id, sentence, __hexKey}
  let color = '#999';
  try {
    const st = App && App._hexStyleByKey && App._hexStyleByKey.get ? App._hexStyleByKey.get(d.__hexKey) : null;
    if (st && st.fill) color = st.fill;
  } catch(e) {}

  const sid = (d && (d.msu_id ?? d.msuid ?? d.MSU_id)) != null ? (d.msu_id ?? d.msuid ?? d.MSU_id) : '';
  const sent = _escapeHtml((d && d.sentence) ? d.sentence : '');

  return `
    <div style="display:flex;align-items:flex-start;gap:8px">
      <span style="
        margin-top:3px;display:inline-block;width:10px;height:10px;border-radius:50%;
        background:${color};flex:none;border:1px solid rgba(0,0,0,0.12)
      "></span>
      <div style="min-width:0">
        <div style="opacity:.85;margin-bottom:4px"><b>MSU ${sid}</b></div>
        <div style="white-space:normal;word-break:break-word">${sent || '<span style="opacity:.62">No sentence</span>'}</div>
      </div>
    </div>
  `;
}


// -------- Generic Tooltip API (for scatter/MSU points) --------
// We reuse the existing hex tooltip DOM (#hex-tip) for consistent look&feel.
function showTooltip(evtOrX, payloadOrY, maybePayload) {
  try {
    let x, y, payload;
    if (typeof evtOrX === 'number') {
      x = evtOrX;
      y = typeof payloadOrY === 'number' ? payloadOrY : 0;
      payload = maybePayload;
    } else if (evtOrX && typeof evtOrX.clientX === 'number') {
      x = evtOrX.clientX;
      y = evtOrX.clientY;
      payload = payloadOrY;
    } else {
      x = 0; y = 0; payload = payloadOrY;
    }

    // Allow passing a plain string (sentence)
    if (typeof payload === 'string') payload = { sentence: payload };

    const html = (typeof renderMSUTooltipHTML === 'function')
      ? renderMSUTooltipHTML(payload || {})
      : _escapeHtml((payload && payload.sentence) ? payload.sentence : '');

    showHexTooltip(x, y, { _rawHTML: true, html });
  } catch (e) {
    // fail silently; tooltips must never break rendering
  }
}

function moveTooltip(evtOrX, maybeY) {
  try {
    if (typeof moveHexTooltip !== 'function') return;
    if (typeof evtOrX === 'number') moveHexTooltip(evtOrX, typeof maybeY === 'number' ? maybeY : 0);
    else if (evtOrX && typeof evtOrX.clientX === 'number') moveHexTooltip(evtOrX.clientX, evtOrX.clientY);
  } catch (e) {}
}

function hideTooltip() {
  try { hideHexTooltip(); } catch (e) {}
}

function showHexTooltip(clientX, clientY, payload) {
  const tip = ensureHexTooltip();
  if (payload && payload._rawHTML && payload.html) {
    tip.innerHTML = payload.html;
  } else {
    tip.innerHTML = renderHexTooltipHTML(payload);
  }
  // ↓ 下面定位&防溢出逻辑保持不变
  const pad = 10;
  tip.style.display = 'block';
  tip.style.left = (clientX + 14) + 'px';
  tip.style.top  = (clientY + 14) + 'px';
  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = tip.getBoundingClientRect();
  if (rect.right > vw - pad) tip.style.left = (vw - rect.width - pad) + 'px';
  if (rect.bottom > vh - pad) tip.style.top = (vh - rect.height - pad) + 'px';
}


function moveHexTooltip(clientX, clientY) {
  const tip = document.getElementById('hex-tip');
  if (!tip || tip.style.display === 'none') return;
  const pad = 10;
  tip.style.left = (clientX + 14) + 'px';
  tip.style.top  = (clientY + 14) + 'px';

  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = tip.getBoundingClientRect();
  if (rect.right > vw - pad) tip.style.left = (vw - rect.width - pad) + 'px';
  if (rect.bottom > vh - pad) tip.style.top = (vh - rect.height - pad) + 'px';
}

function hideHexTooltip() {
  const tip = document.getElementById('hex-tip');
  if (tip) tip.style.display = 'none';
}

function isFlightDeleteHoverEnabled() {
  return !(
    App.flightStart ||
    App.flightDraft ||
    App.routeDraft ||
    App.insertMode ||
    App.uiPref?.connectArmed
  );
}

function ensureFlightDeleteButton() {
  let btn = document.getElementById('flight-delete-button');
  if (btn && btn.dataset.semanticMapOwner !== App.instanceId) {
    btn.remove();
    btn = null;
  }
  if (btn) return btn;

  btn = document.createElement('button');
  btn.id = 'flight-delete-button';
  btn.className = 'subspace-close flight-delete-button';
  btn.dataset.semanticMapOwner = App.instanceId;
  btn.setAttribute('aria-label', 'Delete flight');
  btn.title = 'Delete flight';
  Object.assign(btn.style, {
    position: 'fixed',
    display: 'none',
    top: '0px',
    left: '0px',
    right: 'auto',
    zIndex: 2147483647,
    pointerEvents: 'auto'
  });
  btn.addEventListener('mouseenter', () => {
    if (App.flightDeleteHideTimer) clearTimeout(App.flightDeleteHideTimer);
    App.flightDeleteHideTimer = null;
  });
  btn.addEventListener('mouseleave', () => hideFlightDeleteButton());
  btn.addEventListener('mousemove', (event) => {
    if (!isPointerNearFlightDeleteButton(event, 42)) hideFlightDeleteButton();
  });
  document.addEventListener('pointerdown', (event) => {
    if (btn.style.display === 'none') return;
    const rect = btn.getBoundingClientRect();
    const hitByCoord =
      event.clientX >= rect.left - 4 &&
      event.clientX <= rect.right + 4 &&
      event.clientY >= rect.top - 4 &&
      event.clientY <= rect.bottom + 4;
    const target = event.target;
    const hitByTarget = target && target.closest ? target.closest('#flight-delete-button') === btn : false;
    if (!hitByCoord && !hitByTarget) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    const id = btn.dataset.flightId || App.flightDeleteTargetId || App.hoveredFlightId;
    deleteFlightTarget(id, App.flightDeleteTargetLink, App.flightDeleteTargetSignature);
  }, true);
  document.addEventListener('mousemove', (event) => {
    if (btn.style.display === 'none') return;
    if (btn.contains(event.target)) return;
    if (isPointerNearFlightDeleteButton(event, 34)) return;
    const a = App.flightDeleteAnchor;
    if (!a) return;
    const dx = event.clientX - a.x;
    const dy = event.clientY - a.y;
    if (Math.hypot(dx, dy) > 92) hideFlightDeleteButton();
  }, true);
  const commitDelete = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const id = btn.dataset.flightId || App.flightDeleteTargetId || App.hoveredFlightId;
    deleteFlightTarget(id, App.flightDeleteTargetLink, App.flightDeleteTargetSignature);
  };
  btn.addEventListener('pointerdown', commitDelete);
  btn.addEventListener('click', commitDelete);
  document.body.appendChild(btn);
  return btn;
}

function flightSignature(link) {
  if (!link || (link.type || '') !== 'flight') return '';
  const path = Array.isArray(link.path) ? link.path : [];
  return path.map((point, i) => {
    const panelIdx = resolvePanelIdxForPathPoint(point, link, i);
    return `${panelIdx}:${point.q},${point.r}`;
  }).join('>');
}

function positionFlightDeleteButton(clientX, clientY, routeId, linkRef = null) {
  const btn = ensureFlightDeleteButton();
  const pad = 8;
  const size = 18;
  const x = Math.max(pad, Math.min((clientX || 0) + 12, window.innerWidth - size - pad));
  const y = Math.max(pad, Math.min((clientY || 0) - 26, window.innerHeight - size - pad));
  btn.dataset.flightId = routeId || '';
  App.flightDeleteTargetId = routeId || null;
  App.flightDeleteTargetLink = linkRef || App.flightDeleteTargetLink || null;
  App.flightDeleteTargetSignature = flightSignature(linkRef) || App.flightDeleteTargetSignature || null;
  App.flightDeleteAnchor = { x: clientX || 0, y: clientY || 0 };
  btn.style.left = `${x}px`;
  btn.style.top = `${y}px`;
  btn.style.right = 'auto';
  btn.style.display = 'inline-flex';
}

function isPointerNearFlightDeleteButton(event, margin = 34) {
  const btn = document.getElementById('flight-delete-button');
  if (!btn || btn.style.display === 'none') return false;
  const rect = btn.getBoundingClientRect();
  const x = event?.clientX;
  const y = event?.clientY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return x >= rect.left - margin && x <= rect.right + margin && y >= rect.top - margin && y <= rect.bottom + margin;
}

function hideFlightDeleteButton() {
  if (App.flightDeleteTimer) clearTimeout(App.flightDeleteTimer);
  if (App.flightDeleteHideTimer) clearTimeout(App.flightDeleteHideTimer);
  App.flightDeleteTimer = null;
  App.flightDeleteHideTimer = null;
  App.hoveredFlightId = null;
  App.flightHoverClient = null;
  App.flightDeleteAnchor = null;
  App.flightDeleteTargetId = null;
  App.flightDeleteTargetLink = null;
  App.flightDeleteTargetSignature = null;
  const btn = document.getElementById('flight-delete-button');
  if (btn) {
    btn.style.display = 'none';
    btn.dataset.flightId = '';
  }
  highlightFlightLink(null);
}

function scheduleFlightDeleteButton(routeId, clientX, clientY, linkRef = null) {
  if (!routeId || !isFlightDeleteHoverEnabled()) return;
  if (App.flightDeleteTimer) clearTimeout(App.flightDeleteTimer);
  App.flightHoverClient = { x: clientX, y: clientY };
  App.flightDeleteTimer = setTimeout(() => {
    if (App.hoveredFlightId !== routeId) return;
    if (!isFlightDeleteHoverEnabled()) return;
    const pos = App.flightHoverClient || { x: clientX, y: clientY };
    positionFlightDeleteButton(pos.x, pos.y, routeId, linkRef);
  }, 1500);
}

function highlightFlightLink(routeId) {
  try {
    const layer = d3.select(App.globalOverlayEl).selectAll('g.flight-link');
    layer.each(function () {
      const active = !!routeId && this.__flightId === routeId;
      const g = d3.select(this);
      g.selectAll('path.flight-shadow')
        .attr('stroke-opacity', active ? 0.11 : 0)
        .style('filter', active ? 'blur(0.45px)' : null);
      g.selectAll('path.flight-visible')
        .attr('stroke-width', function () {
          const base = Number(this.__baseStrokeWidth || this.getAttribute('data-base-width') || 1.4);
          return active ? base + 0.45 : base;
        })
        .style('filter', active ? 'drop-shadow(0 1px 1.5px rgba(15,23,42,.18))' : null);
      g.selectAll('path.flight-arrow')
        .style('filter', active ? 'drop-shadow(0 1px 1.5px rgba(15,23,42,.18))' : null);
    });
  } catch (_) {}
}

function deleteFlightTarget(routeId, linkRef = null, signature = null) {
  if (!routeId && !linkRef && !signature) return false;
  const before = App._lastLinks || [];
  const removed = before.find(link => {
    if ((link?.type || '') !== 'flight') return false;
    if (linkRef && link === linkRef) return true;
    if (signature && flightSignature(link) === signature) return true;
    return !!routeId && linkKey(link) === routeId;
  });
  if (!removed) return false;
  const removedId = linkKey(removed) || routeId || '';
  const removedKeys = new Set();
  (Array.isArray(removed.path) ? removed.path : []).forEach((point, i) => {
    const panelIdx = resolvePanelIdxForPathPoint(point, removed, i);
    removedKeys.add(pkey(panelIdx, point.q, point.r));
  });

  App._lastLinks = before.filter(link => {
    if ((link?.type || '') !== 'flight') return true;
    if (link === removed) return false;
    return removedId ? linkKey(link) !== removedId : true;
  });
  if (App.currentData && Array.isArray(App.currentData.links)) {
    App.currentData.links = App._lastLinks;
  }
  if (removedId) App.selectedRouteIds?.delete?.(removedId);
  if (routeId) App.selectedRouteIds?.delete?.(routeId);
  App.selectedEdgeKeys?.clear?.();
  removedKeys.forEach(key => {
    App.persistentHexKeys?.delete?.(key);
    App.highlightedHexKeys?.delete?.(key);
    App.excludedHexKeys?.delete?.(key);
  });
  if (typeof recomputePersistentFromRoutesPreservingExtras === 'function') {
    recomputePersistentFromRoutesPreservingExtras();
  }
  hideFlightDeleteButton();
  stampSubspaceNamesOnAllLinks(App.currentData);
  drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!(App.flightStart || App.flightDraft));
  updateHexStyles();
  emitSelectionPayload?.();
  publishToStepAnalysis?.();
  return true;
}

function deleteFlightById(routeId) {
  return deleteFlightTarget(routeId, null);
}


  // flight 端点可见性（用于“端点不可见则不画”）
  const isPointVisible = (panelIdx, q, r) => {
    const pt = getHexGlobalXY(panelIdx, q, r);
    const rect = getPanelRect(panelIdx);
    return !!(pt && rect && pointInRect(pt[0], pt[1], rect));
  };
  const flightEndpointsVisible = (pStart, pEnd) =>
    isPointVisible(pStart.panelIdx, pStart.q, pStart.r) &&
    isPointVisible(pEnd.panelIdx,   pEnd.q,   pEnd.r);

  // 解析 path 点的 panelIdx（兼容 flight 的 From/To）
  function resolvePanelIdxForPathPoint(p, link, i) {
    if (typeof p.panelIdx === 'number') return p.panelIdx;
    if (link?.type === 'flight') {
      if (i === 0 && typeof link.panelIdxFrom === 'number') return link.panelIdxFrom;
      if (i === (link.path?.length || 1) - 1 && typeof link.panelIdxTo === 'number') return link.panelIdxTo;
    }
    if (typeof link?.panelIdx === 'number') return link.panelIdx;
    return 0;
  }

  // —— Subspace 名称工具 ——
  // ========== 1) 从 DOM 抓取子空间名 ==========
  function getPanelNameMapFromDOM() {
    const map = {};
    // .subspace-title 可能是 <div contenteditable> / <input> / <span> 等
    const els = document.querySelectorAll('.subspace-title');
    els.forEach((el, i) => {
      // 面板索引：优先 data-panel-idx，其次 data-idx，再次顺序 i
      const idxAttr = el.dataset?.panelIdx ?? el.getAttribute('data-panel-idx') ?? el.dataset?.idx ?? el.getAttribute('data-idx');
      const panelIdx = Number.isFinite(Number(idxAttr)) ? Number(idxAttr) : i;

      // 文本：优先 input.value；否则 contentEditable 的 innerText；否则 textContent
      const raw =
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el.value :
        el.isContentEditable ? el.innerText :
        el.textContent;
      const name = (raw || '').trim() || `Subspace ${panelIdx}`;

      map[panelIdx] = name;
    });
    return map;
  }

  // ========== 2) 把子空间名“刻”到每条 link 上（可传入外部 map）==========
  function stampSubspaceNamesOnAllLinksUsingMap(semantic, nameMap) {
    if (!semantic || !Array.isArray(semantic.links)) return;
    const nm = nameMap || {};

    semantic.links.forEach(link => {
      const path = Array.isArray(link?.path) ? link.path : [];

      // 顶部显示（我默认做了“连续相同去重”，更友好；想完全不去重就去掉判重）
      const ordered = [];
      let last = null;

      path.forEach(pt => {
        const idx = pt?.panelIdx;
        const title = (idx != null && nm[idx] != null) ? nm[idx] : `Subspace ${idx}`;
        if (title !== last) ordered.push(title);
        last = title;
      });

      link.panelNamesByIndex = { ...nm }; // 供 LinkCard 和 prompt 的 Legend 使用
      link.panelNames = ordered;          // 顶部“Subspaces: A -> B -> C”显示
    });
  }

  // ========== 3) 统一刷新：优先用 DOM 的名字，没有就退回数据里的 ==========
  function refreshLinkNamesFromDOM() {
    if (!window.App || !App.currentData) return;
    const domMap = getPanelNameMapFromDOM();
    // 如果 DOM 为空（例如页面尚未渲染好），退回旧方法
    if (Object.keys(domMap).length === 0) {
      // 旧方法：从数据层 build
      const fallback = {};
      (App.currentData.subspaces || []).forEach((s, i) => {
        const name = s?.subspaceName || s?.title || s?.name || `Subspace ${i}`;
        fallback[i] = name;
      });
      stampSubspaceNamesOnAllLinksUsingMap(App.currentData, fallback);
    } else {
      stampSubspaceNamesOnAllLinksUsingMap(App.currentData, domMap);
    }
  }

  // ========== 4) 监听 DOM 里的标题变化，自动刷新 ==========
  function watchSubspaceTitleDOM() {
    try {
      if (window.__subspaceTitleObserver) {
        window.__subspaceTitleObserver.disconnect();
        window.__subspaceTitleObserver = null;
      }
      const root = document.body; // 或者传你子空间容器根节点
      const obs = new MutationObserver(() => {
        refreshLinkNamesFromDOM();
        // 2) 开启监听（用户改名后自动同步）
        watchSubspaceTitleDOM();
        // 如果你有事件总线导出给右侧卡片，可以一起发布
        if (typeof publishToStepAnalysis === 'function') publishToStepAnalysis();
      });
      obs.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['value', 'data-panel-idx', 'contenteditable']
      });
      window.__subspaceTitleObserver = obs;
    } catch (e) {
      console.warn('[watchSubspaceTitleDOM] failed:', e);
    }
  }


  // 生成 panelIdx -> subspaceName 的映射
  function getSubspaceNameMap() {
    const dom = getPanelNameMapFromDOM();
    if (dom && Object.keys(dom).length) return dom;
    const m = {};
    const arr = App?.currentData?.subspaces || [];
    arr.forEach((s, i) => {
      m[i] = (s && (s.subspaceName || s.title || s.name)) ? (s.subspaceName || s.title || s.name) : `Subspace ${i}`;
    });
    return m;
  }

  // 给单条 link 写入 panelNames / panelNamesByIndex
  function stampSubspaceNamesOnLink(link) {
    if (!link) return link;
    const nameByIdx = getSubspaceNameMap();
    const path = Array.isArray(link.path) ? link.path : [];
    const names = [];
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const pIdx = resolvePanelIdxForPathPoint(p, link, i); // 你已有的工具，能处理 flight 跨子空间
      names.push(nameByIdx[pIdx] ?? `Subspace ${pIdx}`);
    }
    link.panelNames = names;            // 如 ["background","method","background", ...]（保序、不合并）
    link.panelNamesByIndex = nameByIdx; // 如 {0:"background",1:"method",...}
    return link;
  }

  // —— 从全量 semantic 数据建立 panelIdx → 子空间名 —— //
  function buildPanelNameMap(semantic) {
    const map = {};
    const subs = (semantic && Array.isArray(semantic.subspaces)) ? semantic.subspaces : [];
    subs.forEach(sp => {
      const idx = (sp && sp.panelIdx != null) ? sp.panelIdx : null;
      if (idx != null) {
        // 数据里字段可能是 subspaceName 或 title，兼容两种
        const name = sp.subspaceName || sp.title || `Subspace ${idx}`;
        map[idx] = name;
      }
    });
    return map;
  }

  // —— 把子空间名信息“刻到”每一条 link 上 —— //
  function stampSubspaceNamesOnAllLinks(semantic) {
    if (!semantic || !Array.isArray(semantic.links)) return;
    const nameMap = buildPanelNameMap(semantic);

    semantic.links.forEach(link => {
      const path = Array.isArray(link?.path) ? link.path : [];
      // 按路径顺序生成“子空间名序列”，并压缩连续重复（用于 LinkCard 顶部 meta 标签）
      const orderedNames = [];
      let last = null;
      path.forEach(pt => {
        const idx = (pt && pt.panelIdx != null) ? pt.panelIdx : null;
        const name = (idx != null && nameMap[idx] != null) ? nameMap[idx] : `Subspace ${idx}`;
        if (name !== last) orderedNames.push(name);
        last = name;
      });

      // 给 LinkCard 用：
      link.panelNamesByIndex = { ...nameMap };   // 索引→名称（供 summarize / 回退使用）
      link.panelNames = orderedNames;            // “A -> B -> B -> C” 压缩成 “A -> B -> C” 的显示用
    });
  }


  function findLinkById(routeId){
    return (App._lastLinks || []).find(l => linkKey(l) === routeId) || null;
  }
  function findSelectedRouteContaining(panelIdx, q, r){
    // 在已选路线中找包含这个点的路线
    for (const l of (App._lastLinks || [])) {
      if (!App.selectedRouteIds.has(linkKey(l))) continue;
      if (linkContainsNode(l, panelIdx, q, r)) return l;
    }
    return null;
  }
  function indexOfPointInLink(link, panelIdx, q, r){
    const path = Array.isArray(link?.path) ? link.path : [];
    for (let i=0;i<path.length;i++){
      const p = path[i];
      const pIdx = resolvePanelIdxForPathPoint(p, link, i);
      if (pIdx === panelIdx && p.q === q && p.r === r) return i;
    }
    return -1;
  }

  // 插入一个点到 link.path 的 anchorIndex 之后
  function insertPointAfter(link, anchorIndex, panelIdx, q, r){
    if (!link || !Array.isArray(link.path)) return;
    // 已存在就跳过
    if (indexOfPointInLink(link, panelIdx, q, r) >= 0) return;

    const newPt = { q, r, panelIdx };
    // 注意：保留 flight 的两端 panelIdxFrom/To，不需要改动
    const insertAt = Math.max(0, Math.min(anchorIndex + 1, link.path.length));
    link.path.splice(insertAt, 0, newPt);
    // anchor 往后移动一个，方便继续“顺序加点”
    App.insertMode.anchorIndex = insertAt; 
  }

  function computeColsAndItemSize(containerW) {
    const pad = (LAYOUT.PAD_H || 0) * 2;
    const usable = Math.max(0, containerW - pad);
    // 基于最小宽度+间距估算最大可放列数
    const maxByWidth = Math.max(
      LAYOUT.MIN_COLS,
      Math.min(
        LAYOUT.MAX_COLS,
        Math.floor((usable + LAYOUT.GAP) / (LAYOUT.MIN_W + LAYOUT.GAP))
      )
    );
    const cols = Math.min(LAYOUT.TARGET_COLS, Math.max(LAYOUT.MIN_COLS, maxByWidth));
    // 计算卡片宽度（夹在 MIN_W 与平均可用宽度之间）
    const itemW = Math.max(
      LAYOUT.MIN_W,
      Math.floor((usable - (cols - 1) * LAYOUT.GAP) / cols)
    );
    const itemH = Math.max(LAYOUT.MIN_H, Math.floor(itemW * LAYOUT.ASPECT));
    const totalW = cols * itemW + (cols - 1) * LAYOUT.GAP;
    const leftPad = Math.max(LAYOUT.PAD_H, Math.floor((containerW - totalW) / 2)); // 居中
    return { cols, itemW, itemH, leftPad };
  }

  function applyResponsiveLayout(force = false) {
    if (!App.playgroundEl) return;

    // 找到滚动容器并保存滚动位置
    const scroller = App.playgroundEl.closest('.mv-scroller') || App.playgroundEl.parentElement;
    const prevTop  = scroller ? scroller.scrollTop  : 0;
    const prevLeft = scroller ? scroller.scrollLeft : 0;

    const containerW = App.playgroundEl.clientWidth || 0;
    if (!containerW) return;

    const { cols, itemW, itemH, leftPad } = computeColsAndItemSize(containerW);
    const subspaces = Array.from(App.playgroundEl.querySelectorAll('.subspace'));

    // 程序性布局：屏蔽 RO 的“用户调整”标记
    App._squelchResize = true;

    subspaces.forEach((div, i) => {
      const st = App.panelStates[i] || {};
      const moved   = !!st.userMoved;
      const resized = !!st.userResized;

      // 非 force 模式，尊重用户拖拽/手动改尺寸过的卡片
      if (!force && (moved || resized)) return;

      const row = Math.floor(i / cols);
      const col = i % cols;
      const left = leftPad + col * (itemW + LAYOUT.GAP);
      const top  = STYLE.SUBSPACE_DEFAULT_TOP + row * (itemH + LAYOUT.GAP);

      Object.assign(div.style, {
        left: `${left}px`,
        top:  `${top}px`,
        width: `${itemW}px`,
        height:`${itemH}px`,
      });

      // 同步状态；force 时顺便清掉用户标记（使后续响应式还能继续生效）
      App.panelStates[i] = {
        ...(st || {}),
        left, top, width: itemW, height: itemH,
        ...(force ? { userMoved: false, userResized: false } : {})
      };

      syncContainerHeight(div);
    });

    // 估算整体高度，更新全局 overlay 尺寸
    const rows = Math.ceil(subspaces.length / cols);
    const approxHeight = STYLE.SUBSPACE_DEFAULT_TOP + rows * (itemH + LAYOUT.GAP) + 40;
    App.globalOverlayEl.setAttribute('width', App.playgroundEl.clientWidth);
    App.globalOverlayEl.setAttribute('height', Math.max(approxHeight, App.playgroundEl.clientHeight));

    // 重画连线与透明度
    drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!App.flightStart);
    updateHexStyles();

    // 释放静默标记并还原滚动位置
    requestAnimationFrame(() => {
      App._squelchResize = false;
      if (scroller) scroller.scrollTo({ top: prevTop, left: prevLeft, behavior: 'auto' });
    });
  }

  function computeHoverOrCountryPreview(panelIdx, q, r, { withCtrl=false, withShift=false, withAlt=false } = {}) {
    if (withAlt) {
      App._forceSingleNextClick = true;
      // 判定当前格是否冲突：同一 (q,r) 存在多个国家
      const bucket = getBucket(panelIdx, q, r);
      const isConflict = !!(bucket && bucket.countries && bucket.countries.size > 1);

      if (isConflict) {
        // 仅显示“当前子空间下的冲突区域”
        // 为了语义聚焦，仅取与鼠标所在格同一冲突国家集合有交集的冲突格
        const countriesHere = new Set(bucket.countries || []);
        return getConflictKeysInPanel(panelIdx, countriesHere);
      } else {
        // 非冲突格：按国家版图显示，并把该国家参与的冲突格也纳入当前子空间预览
        const hex = App.hexMapsByPanel[panelIdx]?.get(`${q},${r}`);
        const cid = hex?.country_id ? normalizeCountryId(hex.country_id) : null;
        if (!cid) return new Set();

        // 复制面板：仅本面板预览（国家格  该国家的冲突格）
        if (App.altIsolatedPanels.has(panelIdx)) {
          const keys = getCountryKeysInPanel(panelIdx, cid);
          const conflicts = getConflictKeysForCountryInPanel(panelIdx, cid);
          conflicts.forEach(k => keys.add(k));
          return keys;
        }
        // 跨面板：沿用原跨面板国家预览，但当前子空间下补充冲突格保证可见
        const keys = getCountryKeysAllPanels(cid);
        getConflictKeysForCountryInPanel(panelIdx, cid).forEach(k => keys.add(k));
        return keys;
      }
    }

    return ModeUI.computeHoverPreview(panelIdx, q, r, { withCtrl, withShift });
  }

  // —— Mode UI：按钮状态（绿色=active，黄色=armed），无 HUD/Chip —— //
  const ModeUI = (() => {
    // 放在 ModeUI IIFE 里
    const TIPS = {
      select:       'Select connected region',
      routeIdle:    'Select an entire route',
      routeActive:  'Route mode (click a node to pick whole line)',
      connIdle:     'Insert custom segment',
      connArmed:    'Armed: click a route node to start inserting',
      connActive:   'Insert mode: Shift-click to add; Ctrl+Shift endpoint to finish (Esc cancel, Enter commit)',
    };


    const btnSel   = document.getElementById('mode-btn-select');
    const btnRoute = document.getElementById('mode-btn-route');
    const btnConn  = document.getElementById('mode-btn-insert'); // Connect
    const btnAlt   = document.getElementById('mode-btn-alt');     // Alt / Option

    // 统一清理三个按钮的状态类
    function clearAll() {
      [btnSel, btnRoute, btnConn, btnAlt].forEach(b => {
        if (!b) return;
        b.classList.remove('is-active', 'is-armed');
      });
    }

    // —— NEW：强制默认 = Group Select（无修饰键、无路由/连线偏好） —— //
    function forceGroupDefault() {
      App.uiPref.route = false;
      App.uiPref.connectArmed = false;
      App.uiPref.area = false;
      App.insertMode = null;
      App.flightStart = null;
      App.modKeys = { ...(App.modKeys||{}), ctrl:false, meta:false, shift:false, alt:false };

      // ★ 新增：彻底清理悬停预览与路线/排除态，避免回到 Group 后残影
      App.selectedRouteIds.clear();
      App.excludedHexKeys.clear();
      App.highlightedHexKeys.clear();
      recomputePersistentFromRoutes();   // 会把 persistent 与路线状态同步一遍（此时为空集）
      drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, false);
      updateHexStyles();
      publishToStepAnalysis();


      // 显示：Group 按钮绿；行为：单击走 Group 选择
      computeAndApply({ ctrl:false, meta:false, shift:false });
    }

    // —— Alt/Option 开关 —— //
    function setAlt(val) {
      App.modKeys = { ...(App.modKeys||{}), alt: !!val };
      if (val) {
        // Alt 独占：关掉 Route / Connect / 其它修饰键
        App.uiPref && (App.uiPref.route = false);
        App.uiPref && (App.uiPref.connectArmed = false);
        App.insertMode = null;
        App.modKeys.ctrl = false;
        App.modKeys.meta = false;
        App.modKeys.shift = false;
      }
      // 可选：若 Alt 会影响即时上色（如“灰化非选中”），这里顺手刷新
      updateHexStyles?.();

      stampSubspaceNamesOnAllLinks(App._lastLinks);
      refreshLinkNamesFromDOM();
      publishToStepAnalysis?.();

      // 更新按钮视觉
      const connectActive = !!App.insertMode;
      const connectArmed  = isConnectArmedNow(App.modKeys.ctrl, App.modKeys.shift);
      const routeActive   = isRouteMode(App.modKeys.ctrl || App.modKeys.meta);
      setVisualState({ connectActive, connectArmed, routeActive, altActive: !!(App.modKeys.alt || App.uiPref.area) });

    }
    function setAreaMode(val) {
      App.uiPref.area = !!val;
      if (val) {
        App.uiPref.route = false;
        App.uiPref.connectArmed = false;
        App.insertMode = null;
        App.flightStart = null;
        App.modKeys = { ...(App.modKeys || {}), ctrl: false, meta: false, shift: false };
      } else {
        App._pendingColorEdit = null;
        App._pendingConflictEdit = null;
      }
      if (App.hoveredHex) {
        const { panelIdx, q, r } = App.hoveredHex;
        App.highlightedHexKeys = val
          ? computeHoverOrCountryPreview(panelIdx, q, r, { withAlt: true })
          : ModeUI.computeHoverPreview(panelIdx, q, r, {});
      } else {
        App.highlightedHexKeys?.clear?.();
      }
      updateHexStyles?.();
      computeAndApply();
    }
    function toggleAlt() { setAreaMode(!(App.uiPref && App.uiPref.area)); }

    // 绑定按钮点击
    btnAlt?.addEventListener?.('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleAlt();
    });

    // 选中/多选按钮被点击时，关闭 Alt 以保持互斥
    btnSel?.addEventListener?.('click', () => setAreaMode(false));
    btnRoute?.addEventListener?.('click', () => setAreaMode(false));

    // 键盘监听（mac 上 Option 就是 Alt）
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Alt' || e.altKey) setAlt(true);
      // if (e.ctrlKey || e.metaKey) setAlt(false); // 按下 Ctrl/⌘ 时互斥关闭 Alt
    }, { passive: true });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Alt' || !e.altKey) setAlt(false);
    }, { passive: true });
    window.addEventListener('blur', () => setAlt(false));


    // 路线的可见点（已被排除的点不参与高亮/预览）
    function visiblePathKeys(link) {
      const out = [];
      const path = Array.isArray(link?.path) ? link.path : [];
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const pIdx = resolvePanelIdxForPathPoint(p, link, i);
        const k = pkey(pIdx, p.q, p.r);
        if (!App.excludedHexKeys.has(k)) out.push(k);
      }
      return out; // Array<"panelIdx|q,r">
    }

    // —— 预览工具：根据当前模式，计算鼠标悬停点应该高亮的 key 集 —— //
    function computeHoverPreview(panelIdx, q, r, { withCtrl=false, withShift=false } = {}) {
      const ctrlLike   = !!withCtrl;
      const armedNow   = isConnectArmedNow(withCtrl, withShift);   // 键盘(Ctrl+Shift) 或 按钮黄灯
      const routeMode  = isRouteMode(ctrlLike);                    // 键盘(Ctrl/⌘) 或 按钮 Route 绿灯

      const result = new Set();

      // —— Connect Active（已进入插入）优先 —— //
      if (App.insertMode) {
        // 尚未选锚点：提示“可作为锚点”的整条路线
        if (App.insertMode.awaitingAnchor) {
          (App._lastLinks || []).forEach(link => {
            if (!isSelectableRoute(link)) return;
            if (linkContainsNode(link, panelIdx, q, r)) {
              visiblePathKeys(link).forEach(k => result.add(k));
            }
          });
          return result;
        }

        // 已有锚点：高亮当前 route 全路径；并依据 armed/端点给出暗示
        const link = findLinkById(App.insertMode.routeId);
        if (link) {
          visiblePathKeys(link).forEach(k => result.add(k));

          const iIn = indexOfPointInLink(link, panelIdx, q, r);
          if (iIn >= 0) {
            const isEnd = (iIn === 0 || iIn === link.path.length - 1);
            if (isEnd && (armedNow || (withCtrl && withShift))) {
              const mate = findEndpointMate(panelIdx, q, r);
              if (mate.found) result.add(mate.mateKey);
            } else {
              const aIdx = App.insertMode.anchorIndex;
              if (aIdx >= 0) {
                const anchor = link.path[aIdx];
                const pIdxA  = resolvePanelIdxForPathPoint(anchor, link, aIdx);
                starKeys(pIdxA, anchor.q, anchor.r).forEach(k => result.add(k));
              }
              starKeys(panelIdx, q, r).forEach(k => result.add(k));
            }
          }
        }
        return result;
      }

      // —— Connect Armed（黄灯但未进入 active） —— //
      if (armedNow && !isConnectActive()) {
        (App._lastLinks || []).forEach(link => {
          if (!isSelectableRoute(link)) return;
          if (linkContainsNode(link, panelIdx, q, r)) {
            visiblePathKeys(link).forEach(k => result.add(k));
          }
        });
        return result;
      }

      // —— Route 模式 —— //
      if (routeMode) {
        // 若是从 Group 模式切过来且还没选线路，把现有选中的节点映射成整条线路
        seedSelectedRoutesFromPersistent();
        let added = false;
        (App._lastLinks || []).forEach(link => {
          if (!isSelectableRoute(link)) return;
          if (isStartOfLink(link, panelIdx, q, r)) {
            visiblePathKeys(link).forEach(k => result.add(k));
            added = true;
          }
        });
        if (!added) {
          (App._lastLinks || []).forEach(link => {
            if (!isSelectableRoute(link)) return;
            if (linkContainsNode(link, panelIdx, q, r)) {
              visiblePathKeys(link).forEach(k => result.add(k));
            }
          });
        }
        return result;
      }

      // —— Group（默认）：整条连通分量 —— //
      getComponentKeysFrom(buildUndirectedAdjacency(), pkey(panelIdx, q, r))
        .forEach(k => result.add(k));

      return result;
    }


    /**
     * setVisualState 根据当前“事实状态”上色：
     *  - connectActive：已进入插入/连线（insertMode 或 flightStart）
     *  - connectArmed：Ctrl+Shift 按下，但尚未点第一个点
     *  - routeActive：Ctrl/⌘ 按下（且不在 connect 状态）
     *  - 其余默认：Cluster Select 绿色
     */
    function setVisualState({ connectActive=false, connectArmed=false, routeActive=false, altActive=false } = {}) {

      clearAll();

      // 默认 tooltip
      btnSel  && (btnSel.title  = TIPS.select);
      btnRoute&& (btnRoute.title= TIPS.routeIdle);
      btnConn && (btnConn.title = TIPS.connIdle);

      if (connectActive) {
        btnConn?.classList.add('is-active');    // 绿
        if (btnConn) btnConn.title = TIPS.connActive;
        return;
      }
      if (connectArmed) {
        btnConn?.classList.add('is-armed');     // 黄
        if (btnConn) btnConn.title = TIPS.connArmed;
        return;
      }
      if (routeActive) {
        btnRoute?.classList.add('is-active');   // 绿
        if (btnRoute) btnRoute.title = TIPS.routeActive;
        return;
      }
      // Alt / Option 模式的提示（保持整齐：只高亮按钮，不改变默认 Group 的逻辑）
      if (altActive) {
        btnAlt?.classList.add('is-active');     // 绿
        if (btnAlt) btnAlt.title = 'Alt/Option mode';
        return;
      }
      btnSel?.classList.add('is-active');       // 绿（默认）
    }

    /**
     * computeAndApply 从“键盘/应用状态”推导视觉态：
     *  - armed：CtrlLike + Shift（且没进入 active）
     *  - active：insertMode 存在 或 flightStart 存在
     *  - route：CtrlLike（且不 armed/active）
     */
    function computeAndApply(overrides = null) {
      // 键盘态（优先读 overrides，否则读 App.modKeys）
      const { ctrl, meta, shift } = overrides || App.modKeys;
      const ctrlLike = !!(ctrl || meta);

      // 事实 active：插入模式 or 航线选择进行中
      const connectActive = !!(App.insertMode || App.flightStart);

      // 允许“按钮黄灯”（armed）在没有 Shift 的情况下保持黄色
      const connectArmed = !connectActive && ( (ctrlLike && !!shift) || App.uiPref.connectArmed );

      // 允许“按钮绿灯 Route”在没有 Ctrl 的情况下保持绿色
      const routeActive  = !connectActive && !connectArmed && ( ctrlLike || App.uiPref.route );

      const altActive = !!(App.modKeys && (App.modKeys.alt || App.uiPref.area));

      setVisualState({ connectActive, connectArmed, routeActive, altActive });

      // ★ 模式视觉态变化后，如有悬停，刷新一次预览
      if (App.hoveredHex) {
        const { panelIdx, q, r } = App.hoveredHex;
        const ctrlLike = overrides ? !!(overrides.ctrl || overrides.meta) : !!(App.modKeys.ctrl || App.modKeys.meta);
        const shift    = overrides ? !!overrides.shift : !!App.modKeys.shift;
        const alt      = overrides ? !!overrides.alt   : !!(App.modKeys.alt || App.uiPref.area);
        App.highlightedHexKeys = alt
          ? computeHoverOrCountryPreview(panelIdx, q, r, { withCtrl: ctrlLike, withShift: shift, withAlt: alt })
          : ModeUI.computeHoverPreview(panelIdx, q, r, { withCtrl: ctrlLike, withShift: shift });
        updateHexStyles();
      }

    }

    // 鼠标状态
    function wireButtons() {
      if (btnSel) {
        btnSel.addEventListener('click', () => {
          forceGroupDefault();
        });
      }
      if (btnRoute) {
        btnRoute.addEventListener('click', () => {
          //若 Connect 正在 active（绿灯），先退出（等价 Esc）
          if (App.insertMode) {
            endInsertMode(false); // 取消插入，回落
          }
          if (App.flightStart) {
            App.flightStart = null; // 取消航线起点
            drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, false);
            updateHexStyles();
            publishToStepAnalysis();
          }
          // 点 Route：关掉 Connect 黄灯，点亮 Route 绿灯
          App.uiPref.area = false;
          App.uiPref.connectArmed = false;
          App.uiPref.route = true;
          seedSelectedRoutesFromPersistent();
          computeAndApply();
        });
      }

      if (btnConn) {
        btnConn.addEventListener('click', () => {
          const active = isConnectActive();
          const armed  = App.uiPref.connectArmed;

          if (!armed && !active) {
            // ① 空 → 黄（armed）
            App.uiPref.connectArmed = true;
            App.uiPref.route = false;        // 黄灯时不和 Route 抢态
            computeAndApply();
            return;
          }

          if (armed && !active) {
            // ② 黄 → 绿（active：进入插入模式，但先等待锚点）
            App.uiPref.connectArmed = false;
            // ★ 进入“等待锚点”的插入态（先点到一条路线上的节点作为锚点）
            App.insertMode = { routeId: null, anchorIndex: -1, inserting: true, awaitingAnchor: true };
            computeAndApply();
            return;
          }

          // ③ 绿（active） → 回到 Group（退出 Connect）
          if (active) {
            endInsertMode(false);    // 取消提交
            App.flightStart = null;
            App.uiPref.connectArmed = false;
            App.uiPref.route = false;
            drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, false);
            computeAndApply();
            return;
          }
        });
      }
    }
    wireButtons();

    // 让页面一进来就是 Group 绿灯（默认态）
    forceGroupDefault();

    return { setVisualState, computeAndApply, forceGroupDefault, computeHoverPreview };
  })();




  function beginInsertMode(route, anchorIdx){
  // removed connect-edit
  return;
}


  function endInsertMode(commit = true){
  // removed connect-edit
  return;
}

  // NEW: 给定一个点，找出“包含该点”的所有整条链路 IDs（按你重申的‘邻居=整条链路’）
  function getRouteIdsByNode(panelIdx, q, r){
    const out = new Set();
    (App._lastLinks || []).forEach(link => {
      if (!isSelectableRoute(link)) return;
      if (linkContainsNode(link, panelIdx, q, r)) out.add(linkKey(link));
    });
    return out;
  }

  // === 路线级选择：辅助 ===
  function linkKey(link){
    return link?.id || link?._uid || '';
  }
  
  // 统一的“可选择的整条线路类型”判断：road / river / flight 都计入
  function isSelectableRoute(link){
    const t = (link?.type || 'road');
    return t === 'road' || t === 'river' || t === 'flight';
  }

  function linkContainsNode(link, panelIdx, q, r){
    const path = Array.isArray(link?.path) ? link.path : [];
    for (let i=0;i<path.length;i++){
      const p = path[i];
      const pIdx = resolvePanelIdxForPathPoint(p, link, i);
      if (pIdx === panelIdx && p.q === q && p.r === r) return true;
    }
    return false;
  }
  function isStartOfLink(link, panelIdx, q, r){
    const path = Array.isArray(link?.path) ? link.path : [];
    if (path.length < 1) return false;
    const p0 = path[0];
    const pIdx0 = resolvePanelIdxForPathPoint(p0, link, 0);
    return (pIdx0 === panelIdx && p0.q === q && p0.r === r);
  }

  // 在不改动原函数的前提下，重算路线点并“保留额外单点”
  function recomputePersistentFromRoutesPreservingExtras() {
    // 1) 记录当前已选的所有点（含此前 Ctrl 叠加的单点）
    const extras = new Set(App.persistentHexKeys || []);

    // 2) 预先算出“路线上的所有点”，用于后面判断哪些是路线点
    const routeKeys = new Set();
    if (App.selectedRouteIds && App.selectedRouteIds.size > 0 && Array.isArray(App._lastLinks)) {
      (App._lastLinks || []).forEach(L => {
        const id = (typeof linkKey === 'function') ? linkKey(L) : (L && (L.id || L._uid));
        if (!id || !App.selectedRouteIds.has(id)) return;
        if (Array.isArray(L.path)) {
          L.path.forEach(p => routeKeys.add(pkey(p.panelIdx, p.q, p.r)));
        } else if (L.from && L.to) {
          routeKeys.add(pkey(L.from.panelIdx, L.from.q, L.from.r));
          routeKeys.add(pkey(L.to.panelIdx, L.to.q, L.to.r));
        }
      });
    }

    // 3) 用原有逻辑重建“路线点”到 persistentHexKeys（这一步会清空重算）
    if (typeof recomputePersistentFromRoutes === 'function') {
      recomputePersistentFromRoutes();
    }

    // 4) 把非路线的“额外点”再并回 persistentHexKeys
    const target = App.persistentHexKeys || (App.persistentHexKeys = new Set());
    extras.forEach(k => {
      if (!routeKeys.has(k)) target.add(k);
    });
  }


  // === 根据当前选中的“整条线路 + 排除点”，重建节点选集 App.persistentHexKeys ===
  function recomputePersistentFromRoutes(){
    App.persistentHexKeys.clear();
    (App._lastLinks || []).forEach(link => {
      if (!isSelectableRoute(link)) return;
      const k = linkKey(link);
      if (!App.selectedRouteIds.has(k)) return;

      const path = Array.isArray(link.path) ? link.path : [];
      for (let i=0;i<path.length;i++){
        const p = path[i];
        const pIdx = resolvePanelIdxForPathPoint(p, link, i);
        const key = `${pIdx}|${p.q},${p.r}`;
        if (!App.excludedHexKeys.has(key)) {
          App.persistentHexKeys.add(key);
        }
      }
    });
    // ★ 集合变更后立即重画
    drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!App.flightStart);
  
  }

  /* =========================
   * DOM/子空间
   * ========================= */
  function ensureOverlayRoot(svgSel) {
    if (svgSel.select('g.overlay-root').empty()) {
      const root = svgSel.append('g').attr('class', 'overlay-root');
      root.append('g').attr('class', 'links');   // road/river OR flight（global）
      root.append('g').attr('class', 'cities');  // 仅 panel：城市/首都
    }
    return {
      root: svgSel.select('g.overlay-root'),
      links: svgSel.select('g.overlay-root').select('g.links'),
      cities: svgSel.select('g.overlay-root').select('g.cities'),
    };
  }

  // —— 全局键盘监听：键盘抬起后的自动切换 —— //
  function wireKeyboardHints() {
    const setFromEvent = (e, down) => {
      // 只认修饰键，其他键忽略
      if (e.key === 'Control') App.modKeys.ctrl = down;
      if (e.key === 'Meta')    App.modKeys.meta = down;
      if (e.key === 'Shift')   App.modKeys.shift = down;
      if (e.key === 'Alt')     App.modKeys.alt  = down;

      ModeUI.computeAndApply();  // ← 读取 App.modKeys，自动回落

      // ★ 若正在悬停，重算预览
      if (App.hoveredHex) {
          const { panelIdx, q, r } = App.hoveredHex;
          App.highlightedHexKeys = computeHoverOrCountryPreview(panelIdx, q, r, {
            withCtrl: (App.modKeys.ctrl || App.modKeys.meta),
            withShift: App.modKeys.shift,
            withAlt:  !!(App.modKeys.alt || App.uiPref.area)
          });
          updateHexStyles();
        }

      if (!down && e.key === 'Alt') {
        App.activeAltCountry = null;   // ★ 退出 ALT，清掉当前国家
      }

    };
 
    const onKeyDown = (e) => setFromEvent(e, true);
    const onKeyUp   = (e) => setFromEvent(e, false);
 
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    cleanupFns.push(() => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    });
 
    // 窗口失焦时重置（防止“卡住 Ctrl/Shift”）
    // 窗口失焦时：清干净修饰键 + 关闭 Route/Connect 偏好，并回到 Group
    const onBlur = () => {
      App.modKeys = { ctrl:false, meta:false, shift:false, alt:false };
      ModeUI.computeAndApply();
    };

    window.addEventListener('blur', onBlur);
    cleanupFns.push(() => window.removeEventListener('blur', onBlur));
 
    // 初始化：默认 Cluster 绿
    App.modKeys = { ctrl:false, meta:false, shift:false, alt:false };
    ModeUI.computeAndApply();
  }

  wireKeyboardHints();

  function createSubspaceElement(space, i) {
    const div = document.createElement('div');
    div.className = 'subspace';
    div.style.position = 'absolute';
    div.style.boxSizing = 'border-box';
    div.style.margin = '0';
    div.dataset.index = String(i);

    // 默认网格位置
    const offsetX = STYLE.SUBSPACE_MIN_W + STYLE.SUBSPACE_GAP;
    const offsetY = STYLE.SUBSPACE_MIN_H + STYLE.SUBSPACE_GAP;
    const defaultLeft = STYLE.SUBSPACE_DEFAULT_LEFT + offsetX * (i % 3);
    const defaultTop  = STYLE.SUBSPACE_DEFAULT_TOP  + offsetY * Math.floor(i / 3);

    // 读取持久化位置/尺寸
    const st = App.panelStates[i] || {};
    const w = Math.max(STYLE.SUBSPACE_MIN_W, st.width  ?? STYLE.SUBSPACE_MIN_W);
    const h = Math.max(STYLE.SUBSPACE_MIN_H, st.height ?? STYLE.SUBSPACE_MIN_H);
    const l = Math.max(0, st.left ?? defaultLeft);
    const t = Math.max(0, st.top  ?? defaultTop);

    Object.assign(div.style, {
      left: `${l}px`,
      top: `${t}px`,
      width: `${w}px`,
      height: `${h}px`,
      resize: 'both',
      overflow: 'hidden',
    });

    const title = document.createElement('div');
    title.className = 'subspace-title';
    title.dataset.panelIdx = String(i);
    title.innerText = space.subspaceName || `Subspace ${i + 1}`;
    div.appendChild(title);

    // Layout toggle (hex <-> scatter) — placed before release
    const layoutBtn = document.createElement('button');
    layoutBtn.className = 'subspace-layout';
    const refreshLayoutBtn = () => {
      const idxNow = Number(div.dataset.index ?? i);
      const modeNow = getPanelLayoutMode(idxNow);
      layoutBtn.textContent = _layoutBtnLabel(modeNow);
      layoutBtn.setAttribute('data-layout-mode', modeNow);
      layoutBtn.title = _layoutBtnTitle(modeNow);
      layoutBtn.classList.toggle('is-scatter', modeNow === 'scatter');
    };
    refreshLayoutBtn();
    layoutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idxNow = Number(div.dataset.index ?? i);
      const cur = getPanelLayoutMode(idxNow);
      const next = (cur === 'scatter') ? 'hex' : 'scatter';
      setPanelLayoutMode(idxNow, next);
      refreshLayoutBtn();
      if (typeof applyPanelLayoutMode === 'function') {
        applyPanelLayoutMode(idxNow);
      }
    });
    div.appendChild(layoutBtn);

    // ... 现有 addBtn 之后
    const releaseBtn = document.createElement('button');
    releaseBtn.className = 'subspace-release';
    releaseBtn.setAttribute('aria-label', 'Release selections in this subspace');
    releaseBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>';
    releaseBtn.title = 'Release selections in this subspace';
    releaseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idxNow = Number(div.dataset.index ?? i);
      releaseSubspaceSelections(idxNow);            // ← 调用下面的新函数
    });
    div.appendChild(releaseBtn);


    const addBtn = document.createElement('button');
    addBtn.className = 'subspace-add';
    addBtn.setAttribute('aria-label', 'Duplicate Subspace');
    addBtn.title = 'Duplicate Subspace';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idxNow = Number(div.dataset.index ?? i);
      _duplicateSubspaceByIndex(idxNow);
    });
    div.appendChild(addBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'subspace-close';
    closeBtn.setAttribute('aria-label', 'Delete Subspace');
    closeBtn.title = 'Delete Subspace';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idxNow = Number(div.dataset.index ?? i);
      _deleteSubspaceByIndex(idxNow);
    });
    div.appendChild(closeBtn);

    // 标题双击重命名
    title.addEventListener('dblclick', (evt) => {
      evt.stopPropagation();
      const idx = Number(div.dataset.index || i);
      const placeholder = `Subspace ${idx + 1}`;
      title.setAttribute('contenteditable', 'plaintext-only');
      title.focus();

      const range = document.createRange();
      range.selectNodeContents(title);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);

      const commit = async () => {
        const newName = (title.textContent || '').trim() || placeholder;
        title.textContent = newName;
        title.removeAttribute('contenteditable');
        if (App.currentData?.subspaces?.[idx]) {
          App.currentData.subspaces[idx].subspaceName = newName;
        }
        if (typeof App.onSubspaceRename === 'function') {
          try { await App.onSubspaceRename(idx, newName); } catch (e) { console.warn(e); }
        }
        syncContainerHeight(div, title);
      };
      const cancel = () => {
        title.removeAttribute('contenteditable');
        const old = App.currentData?.subspaces?.[idx]?.subspaceName || placeholder;
        title.textContent = old;
        syncContainerHeight(div, title);
      };

      const onBlur = () => { title.removeEventListener('keydown', onKey); commit(); };
      const onKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); title.removeEventListener('blur', onBlur); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); title.removeEventListener('blur', onBlur); cancel(); }
      };

      title.addEventListener('blur', onBlur, { once: true });
      title.addEventListener('keydown', onKey);
    });

    // 内容容器 + 两层 SVG
    const container = document.createElement('div');
    container.className = 'hex-container';
    Object.assign(container.style, { position: 'relative', width: '100%' });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'hex-svg');
    container.appendChild(svg);

    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('class', 'overlay-svg');
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = App.config.road.zIndex;
    container.appendChild(overlay);

    div.appendChild(container);
    App.playgroundEl.appendChild(div);

    // 根据标题高度扣减内容高度
    syncContainerHeight(div, title);

    // 缓存 d3 选择
    App.subspaceSvgs.push(d3.select(svg));
    App.overlaySvgs.push(d3.select(overlay));

    // 激活拖拽（标题栏）
    enableSubspaceDrag(div, i);
  }

  function syncContainerHeight(subspaceDiv, titleEl) {
    const th = (titleEl || subspaceDiv.querySelector('.subspace-title'))?.offsetHeight || 0;
    const container = subspaceDiv.querySelector('.hex-container');
    const svg = subspaceDiv.querySelector('svg.hex-svg');
    const overlay = subspaceDiv.querySelector('svg.overlay-svg');
    const cs = getComputedStyle(subspaceDiv);
    const w = parseFloat(cs.width);
    const h = parseFloat(cs.height);
    const ch = Math.max(0, h - th);
    if (container) container.style.height = `calc(100% - ${th}px)`;
    if (svg)     { svg.setAttribute('width',  w); svg.setAttribute('height', ch); }
    if (overlay) { overlay.setAttribute('width', w); overlay.setAttribute('height', ch); }
  }

  function renderPanels(subspaces) {
    Array.from(App.playgroundEl.querySelectorAll('.subspace')).forEach(el => el.remove());
    App.subspaceSvgs = [];
    App.overlaySvgs = [];
    App.hexMapsByPanel = [];
    App.allHexDataByPanel = [];
    subspaces.forEach((space, i) => createSubspaceElement(space, i));
  }

  /* =========================
   * Hex 网格渲染（每面板）
   * ========================= */
  function renderHexGridFromData(panelIdx, space, hexRadius) {
    const svg = App.subspaceSvgs[panelIdx];
    const overlay = App.overlaySvgs[panelIdx];
    if (!svg || svg.empty() || !overlay || overlay.empty()) return;
    // 确保当前面板 svg 拥有用于预览态的斜线填充
    ensureHatchPattern(svg);

    const { root: overlayRoot } = ensureOverlayRoot(overlay);

    // Cache space & radius for later redraw (e.g., switching layout back to hex)
    if (!App.spacesByPanel) App.spacesByPanel = {};
    if (!App.hexRadiusByPanel) App.hexRadiusByPanel = {};
    App.spacesByPanel[panelIdx] = space;
    App.hexRadiusByPanel[panelIdx] = hexRadius;

    const msuIndex = (App.currentData && App.currentData.msu_index) ? App.currentData.msu_index : null;

    // >>> 新增：为当前 panel 的 svg 定义斜线 pattern
    ensureHatchDefs(svg, panelIdx);

    // 尺寸计算
    const parent = svg.node().parentNode; // .hex-container
    const pcs = getComputedStyle(parent);
    let width  = pcs ? safeNum(pcs.width)  : 0;
    let height = pcs ? safeNum(pcs.height) : 0;
    if (!width)  width  = safeNum(parent?.clientWidth,  svg.node().clientWidth || 1);
    if (!height) height = safeNum(parent?.clientHeight, svg.node().clientHeight || 1);

    svg.attr('width', width).attr('height', height);
    overlay.attr('width', width).attr('height', height);

    // ★ 新增：panel 背景点击捕获（空白处点击=回到 Group 并清理选集）
    let bg = svg.select('rect.bg-capture');
    if (bg.empty()) {
      bg = svg.insert('rect', ':first-child')   // 放在最底层
        .attr('class', 'bg-capture')
        .attr('x', 0).attr('y', 0)
        .attr('fill', 'transparent')
        .on('click', (evt) => {
          // Alt + 空白：只清国家聚焦（其他逻辑照旧）
          if (evt && evt.altKey) {
            setCountryFocus(null, null);
          }

          App.selectedHex = null;
          App.neighborKeySet.clear();
          App.selectedRouteIds.clear();
          App.excludedHexKeys.clear();
          App.persistentHexKeys.clear();
          App.highlightedHexKeys.clear();
          emitSelectionPayload();
          drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!App.flightStart);
          App.hoveredHex = null;
          updateHexStyles();
          publishToStepAnalysis();
          ModeUI.forceGroupDefault();
        });
    }
    // 保持尺寸同步
    bg.attr('width', width).attr('height', height);

    // 容器组
    let container = svg.select('g');

    if (container.empty()) container = svg.append('g');
    // 数据坐标（平顶六边形）
    // Build raw hex list with both axial-derived pixel coords and original 2D coords (for scatter)
    const rawHexList = (space.hexList || []).map(h => {
      const hx = (3 / 4) * 2 * hexRadius * h.q;
      const hy = Math.sqrt(3) * hexRadius * (h.r + h.q / 2);
      const xy = _parseXY(h.xy) || computeHexXYFromMsuIds(h.msu_ids, msuIndex); // prefer hex.xy; fallback: centroid of MSU 2d_coord
      return { ...h, rawX: hx, rawY: hy, _hexX: hx, _hexY: hy, _origXY: xy };
    });

    // Bounds for centering + alignment
    const xs = rawHexList.map(h => h.rawX);
    const ys = rawHexList.map(h => h.rawY);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2 || 0;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2 || 0;

    // --- Scatter alignment (MSU 2d_coord -> hex pixel space) ---
    // We fit an affine transform using per-hex centroids in embedding space (h._origXY)
    // mapped to their hex centers in pixel space (h.rawX, h.rawY). This captures the ~30° rotation
    // between embedding axes and the flat-top axial grid basis.
    const validPairs = rawHexList
      .filter(h => h._origXY && Number.isFinite(h._origXY[0]) && Number.isFinite(h._origXY[1]) && Number.isFinite(h.rawX) && Number.isFinite(h.rawY))
      .map(h => [h._origXY[0], h._origXY[1], h.rawX, h.rawY]);

    const affine = (validPairs.length >= 3) ? _fitAffine2D(validPairs) : null;

    // Precompute scatter positions for hexes (only used when panel is in scatter layout)
    rawHexList.forEach(h => {
      if (affine && h._origXY) {
        const p = _applyAffine(affine, h._origXY[0], h._origXY[1]);
        h._scatterX = p[0];
        h._scatterY = p[1];
      } else {
        h._scatterX = h.rawX;
        h._scatterY = h.rawY;
      }
    });

    if (!App.scatterTransformByPanel) App.scatterTransformByPanel = {};
    App.scatterTransformByPanel[panelIdx] = affine;
const mode = getPanelLayoutMode(panelIdx);
    const hexList = rawHexList.map(h => ({
      ...h,
      x: (mode === 'scatter') ? h._scatterX : h._hexX,
      y: (mode === 'scatter') ? h._scatterY : h._hexY,
      panelIdx
    }));
    App.allHexDataByPanel[panelIdx] = hexList;

    // 为当前 panel 建立国家索引
    const cmap = new Map(); // country_id -> Set(keys)
    hexList.forEach(h => {
      if (!h.country_id) return;
      const normId = normalizeCountryId(h.country_id);  // ★ 归一化
      const k = `${panelIdx}|${h.q},${h.r}`;
      if (!cmap.has(normId)) cmap.set(normId, new Set());
      cmap.get(normId).add(k);
    });
    App.countryKeysByPanel[panelIdx] = cmap;

    // ★ 新增：合并到全局索引
    cmap.forEach((set, cid) => {
      if (!App.countryKeysGlobal.has(cid)) App.countryKeysGlobal.set(cid, new Set());
      const gset = App.countryKeysGlobal.get(cid);
      set.forEach(k => gset.add(k));   // k 形如 "panel|q,r"
    });

    // 初始/持久化变换
    const savedZoom = App.panelStates[panelIdx]?.zoom;
    const defaultTransform = d3.zoomIdentity
      .translate((width / 2) - centerX/2, (height / 2) - centerY/2)
      .scale(0.6);

    let lastTransform =
      savedZoom && isFiniteTransform(savedZoom)
        ? d3.zoomIdentity.translate(savedZoom.x, savedZoom.y).scale(savedZoom.k)
        : (isFiniteTransform(App.zoomStates[panelIdx]) ? App.zoomStates[panelIdx] : defaultTransform);

    if (!isFiniteTransform(lastTransform)) lastTransform = defaultTransform;
    if (!savedZoom && !App.zoomStates[panelIdx]) {
      App.panelStates[panelIdx] = { ...(App.panelStates[panelIdx] || {}), zoom: { k: 1, x: defaultTransform.x, y: defaultTransform.y } };
      App.zoomStates[panelIdx] = defaultTransform;
    }

    const zoom = d3.zoom()
      .scaleExtent([0.4, 3])
      .on('zoom', (event) => {
        const t = event?.transform;
        if (!isFiniteTransform(t)) return;
        container.attr('transform', t);
        overlayRoot.attr('transform', t);
        App.zoomStates[panelIdx] = t;
        App.panelStates[panelIdx] = { ...(App.panelStates[panelIdx] || {}), zoom: { k: t.k, x: t.x, y: t.y } };
        drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!App.flightStart);
        updateHexStyles();
      });

    svg.on('dblclick.zoom', null).call(zoom);
    const applyTransform = (t) => {
      if (!isFiniteTransform(t)) return;
      container.attr('transform', t);
      overlayRoot.attr('transform', t);
      svg.call(zoom.transform, t);
    };
    applyTransform(lastTransform);

    
    // === Build per-hex buckets to avoid overlapping ===
    var _buckets = buildBucketsForPanel(panelIdx, hexList);
    App.hexBucketsByPanel[panelIdx] = _buckets;
    recomputeMsuAlphaForPanel(panelIdx);

    var uniqueHexes = [];
    _buckets.forEach(function(b){
      uniqueHexes.push(buildHsuDisplayRecord(b));
    });

    // Ensure hatch pattern exists (for conflict visualization)
    try { ensureHatchPattern(panelIdx, svg, (App.config && App.config.countryBorder && App.config.countryBorder.color) || '#999'); } catch(e) {}
    // 绑定 hex
    container.selectAll('g.hex')
      .data(uniqueHexes, d => `${d.panelIdx}_${d.q}_${d.r}`)
      .join(
        enter => {
          const g = enter.append('g').attr('class', 'hex');

          // Hex glyph
          g.append('path')
            .attr('class', 'hex-shape')
            .attr('d', d3.line()(hexPoints(hexRadius)))
            .attr('fill', d => getHexFillColor(d))
            .attr('stroke', App.config.hex.borderColor)
            .attr('stroke-width', App.config.hex.borderWidth)
            .attr('fill-opacity', App.config.hex.fillOpacity)
            .attr('display', mode === 'scatter' ? 'none' : null);

          // Hatch overlay (used by preview neighbors)
          g.append('path')
            .attr('class', 'hex-hatch')
            .attr('d', d3.line()(hexPoints(hexRadius)))
            .attr('fill', 'none')
            .style('pointer-events', 'none')
            .attr('display', mode === 'scatter' ? 'none' : null);

          // // Scatter glyph
          // g.append('circle')
          //   .attr('class', 'scatter-dot')
          //   .attr('r', (App.config.hex && App.config.hex.scatterRadius) ? App.config.hex.scatterRadius : Math.max(2.2, (hexRadius || 12) * 0.22))
          //   .attr('fill', d => getHexFillColor(d))
          //   .attr('stroke', App.config.hex.borderColor)
          //   .attr('stroke-width', Math.max(0.6, App.config.hex.borderWidth * 0.8))
          //   .attr('fill-opacity', App.config.hex.fillOpacity)
          //   .attr('display', mode === 'scatter' ? null : 'none');

          g.on('mouseover', (event, d) => {
            // // 若已经处于“国家聚焦”锁定，悬停不再改写高亮集合
            App.hoveredHex = { panelIdx, q: d.q, r: d.r };
            if (App.flightStart) App.flightHoverTarget = { panelIdx, q: d.q, r: d.r };

            const withCtrl  = isCtrlLike(event);
            const withShift = !!event.shiftKey;
            const withAlt   = !!(event.altKey || App.uiPref.area);

            App.highlightedHexKeys = computeHoverOrCountryPreview(
              panelIdx, d.q, d.r,
              { withCtrl, withShift, withAlt }
            );
            updateHexStyles();

            // —— Tooltip: 读取 msu 数、summary、国家颜色 —— //
            const hex = App.hexMapsByPanel?.[panelIdx]?.get(`${d.q},${d.r}`) || d;

            // 1) 统计 MSU 数
            const msuCount = Array.isArray(hex?.msu_ids) ? hex.msu_ids.length : 0;

            // 2) 读取 summary（后端放在 hex 对象上；没有就为空字符串）
            // console.log('renderHexgridfromdata', hex);    //这里就没有summary
            const summary = (hex && typeof hex.summary === 'string') ? hex.summary : '';

            // 3) 取当前“国家色”（优先用面板内覆盖色；否则用聚焦色；最后兜底基础填充）
            let color = '#A0A0A0';
            const rawCid = hex?.country_id || null;
            if (rawCid) {
              const cid = normalizeCountryId(rawCid); // 你已有
              // 你项目里面板级颜色存储在 App.panelCountryColors（Map）
              // 先查面板覆盖色
              const panelMap = App.panelCountryColors?.get(panelIdx);
              const rec = panelMap?.get?.(cid);
              if (rec?.color) {
                color = rec.color;
              } else if (App.focusCountryId && normalizeCountryId(App.focusCountryId) === cid) {
                // 聚焦中的国家就用默认聚焦色（与改色菜单默认一致）
                color = (STYLE.FOCUS_COUNTRY_FILL || '#FCFCFC');
              } else {
                // 最后兜底：按该 hex 的 modality 取基础色
                color = (hex?.modality === 'image') ? App.config.hex.imageFill
                    : (hex?.modality === 'text')  ? App.config.hex.textFill
                    : (App.config.background || '#ffffff');
              }
            }
            // 4) 显示 tooltip（用 client 坐标）
            // console.log('renderHexgridfromdata', color, msuCount, summary);
            // —— Tooltip: 统一使用“按国家分组”的模板 —— //
            const _b = getBucket(panelIdx, d.q, d.r);
            const _rawBucket = (_b && _b.items)
              ? _b
              : buildSingleBucket(panelIdx, d.q, d.r, hex);  // 单条也转成 bucket
            const _bucket = filterBucketToVisibleCountries(_rawBucket);
            App.hoveredTooltipBucket = _bucket;
            App.lastHexTooltipClient = { x: event.clientX, y: event.clientY };
            scheduleBucketDynamicSummaries(_bucket);
            const _html = renderBucketTooltipHTML(_bucket);
            showHexTooltip(event.clientX, event.clientY, { _rawHTML: true, html: _html });

          })

          .on('mousemove', (event) => {
            App.lastHexTooltipClient = { x: event.clientX, y: event.clientY };
            moveHexTooltip(event.clientX, event.clientY);
          })

          .on('mouseout', (event, d) => {
            if (isHexTooltipNode(event.relatedTarget)) return;
            if (App.hoveredHex?.panelIdx === panelIdx && App.hoveredHex.q === d.q && App.hoveredHex.r === d.r) {
              App.hoveredHex = null;
            }
            clearHexTooltipState();
            // 无论是否有国家聚焦，都清理预览集合
            App.highlightedHexKeys.clear();
            updateHexStyles();
            hideHexTooltip();
          })
          
          .on('click', (event, d) => {
            App._releaseToggleByPanel?.set?.(panelIdx, false);
            event.preventDefault();
            event.stopPropagation();
            // 阻断双击序列里的单击
            if (event.detail && event.detail > 1) return;
            if (App._clickTimer) clearTimeout(App._clickTimer);

            const withCtrl = isCtrlLike(event);
            const withShift = !!event.shiftKey;
            App._clickTimer = setTimeout(() => {
              handleSingleClick(panelIdx, d.q, d.r, withCtrl, withShift);
            }, STYLE.CLICK_DELAY);
            // 统一：点击时抛出“该 hex 的完整（含多国）数据”
            if (!(App.modKeys && (App.modKeys.alt || App.uiPref.area))) {      // ← Alt 流程：仅预览，不抛事件
              emitHexClick(panelIdx, d.q, d.r, d);
            }

          }).on('dblclick', (event, d) => {
            event.preventDefault(); event.stopPropagation();
            if (App._clickTimer) { clearTimeout(App._clickTimer); App._clickTimer = null; }
            handleDoubleClick(panelIdx, d.q, d.r, event);
          }).on('contextmenu', (event, d) => {
              if (!(App.modKeys.alt || App.uiPref.area)) return;
              event.preventDefault();

              const panelIdx = d.panelIdx ?? d.panel_index ?? 0;
              const q = d.q, r = d.r;
              const isConflict = isConflictHex(panelIdx, q, r);

              if (isConflict) {
                const { keys, alphaByKey } = buildConflictAlphaRampFor(panelIdx);
                App._pendingConflictEdit = {
                  panelIdx,
                  color: getConflictColorOverride(panelIdx)?.color || pickRandomColor(`conflict:${panelIdx}`),
                  keys,
                  alphaByKey
                };
                App._pendingColorEdit = null;
              } else {
                const raw = d.country_id || null;
                if (!raw) return;
                const countryId = normalizeCountryId(raw);
                const { keys, alphaByKey } = buildAlphaRampFor(panelIdx, countryId); // 你现有的方法
                App._pendingColorEdit = {
                  panelIdx,
                  countryId,
                  color: getCountryColorOverride(panelIdx, countryId)?.color || pickRandomColor(`country:${panelIdx}:${String(countryId)}`),
                  keys,
                  alphaByKey
                };
                App._pendingConflictEdit = null;
              }

              showColorMenu(event.clientX, event.clientY,
                (App._pendingConflictEdit?.color || App._pendingColorEdit?.color || '#4C78A8')
              );
            });


          return g.attr('transform', d => `translate(${d.x},${d.y})`);
        },
        update => update.attr('transform', d => `translate(${d.x},${d.y})`),
        exit => exit.remove()
      );


    // === Fine-grained MSU points (scatter mode) ===
    // Each MSU inherits the fill color from its parent hex via __hexKey.
    let msuPoints = [];
    try {
      const idx = getMSUIndex();
      const tf = App.scatterTransformByPanel ? App.scatterTransformByPanel[panelIdx] : null;
      const seen = new Set();

      rawHexList.forEach(h => {
        const ids = Array.isArray(h.msu_ids) ? h.msu_ids : [];
        (ids || []).forEach(msuId => {
          const key = `${panelIdx}|${msuId}`;
          if (seen.has(key)) return;

          const rec = idx[msuId] ?? idx[String(msuId)];
          if (!rec) return;

          const xy = _parseXY(rec.xy || rec['2d_coord'] || rec['2dCoord']);
          let x = (Number.isFinite(h._scatterX) ? h._scatterX : (Number.isFinite(h._hexX) ? h._hexX : (Number.isFinite(h.rawX) ? h.rawX : 0)));
          let y = (Number.isFinite(h._scatterY) ? h._scatterY : (Number.isFinite(h._hexY) ? h._hexY : (Number.isFinite(h.rawY) ? h.rawY : 0)));

          if (tf && Number.isFinite(tf.scale) && xy && Number.isFinite(xy[0]) && Number.isFinite(xy[1])) {
            x = (xy[0] - tf.srcCx) * tf.scale + tf.dstCx;
            y = (xy[1] - tf.srcCy) * tf.scale + tf.dstCy;
          }

          seen.add(key);
          msuPoints.push({
            panelIdx,
            msu_id: Number(msuId),
            country_id: rec.country_id || h.country_id || null,
            sentence: rec.sentence || rec.text || rec.content || '',
            x, y,
            __hexKey: `${panelIdx}|${h.q},${h.r}`
          });
        });
      });
    } catch (e) {
      msuPoints = [];
    }

    let scatterLayer = container.select('g.scatter-layer');
    if (scatterLayer.empty()) {
      scatterLayer = container.append('g').attr('class', 'scatter-layer');
    }
    scatterLayer.attr('display', mode === 'scatter' ? null : 'none');


    scatterLayer
      .selectAll('circle.msu-point')
      .data(msuPoints, d => `${panelIdx}|${d.msu_id}`)
      .join(
        enter => enter.append('circle')
          .attr('class', 'msu-point')
          .attr('r', 2.0)
          .attr('cx', d => d.x)
          .attr('cy', d => d.y)
          .attr('fill', d => {
            return resolveScatterPointFill(d, '#999');
          })
          .attr('fill-opacity', 0.9)
          .on('mouseover', (event, d) => {
            const html = renderMSUTooltipHTML(d);
            showHexTooltip(event.clientX, event.clientY, { _rawHTML: true, html });
          })
          .on('mousemove', (event) => {
            moveHexTooltip(event.clientX, event.clientY);
          })
          .on('mouseout', (event) => {
            if (isHexTooltipNode(event.relatedTarget)) return;
            hideHexTooltip();
          }),
        update => update
          .attr('cx', d => d.x)
          .attr('cy', d => d.y),
        exit => exit.remove()
      );

    // 国家边界
    drawCountries(space, svg, hexRadius);

    // Build the coordinate map from the HSU display records, rather than the
    // raw list.  Raw entries overwrite one another at a shared coordinate and
    // used to make hover/Alt read a random underlying MSU as the HSU source.
    const hexMap = new Map();
    uniqueHexes.forEach(d => {
      hexMap.set(`${d.q},${d.r}`, d);
    });
    App.hexMapsByPanel[panelIdx] = hexMap;

    updateHexStyles();
  }

  // Apply panel layout mode (hex <-> scatter): update coordinates + toggle glyph visibility + refresh overlays/styles
  function applyPanelLayoutMode(panelIdx) {
    const mode = getPanelLayoutMode(panelIdx);

    const svg = App.subspaceSvgs[panelIdx];
    if (!svg) return;

    const rootG = svg.select('g');

    if (mode === 'scatter') {
      // Ensure hex style cache (_hexStyleByKey) is up-to-date BEFORE drawing scatter points,
      // so points can inherit the correct per-hex color/opacity immediately.
      try { if (typeof updateHexStyles === 'function') updateHexStyles(); } catch(_) {}

      // Hide all hex glyphs & borders (your hex groups are class 'hex', not 'hex-cell')
      rootG.selectAll('g.hex').attr('display', 'none');
      rootG.selectAll('.country-border').attr('display', 'none');

      renderScatterLayer(panelIdx);

      // Re-sync styles once after layer creation (so color edits reflect without needing a drag)
      try { if (typeof updateHexStyles === 'function') updateHexStyles(); } catch(_) {}

    } else {
      // Remove scatter
      rootG.selectAll('.scatter-layer').remove();

      // Restore hex + borders
      rootG.selectAll('g.hex').attr('display', null);
      rootG.selectAll('.country-border').attr('display', null);

      // Ensure borders are back (some states may have overwritten stroke)
      rootG.selectAll('path.hex-shape')
        .attr('stroke', STYLE.HEX_BORDER_COLOR)
        .attr('stroke-width', STYLE.HEX_BORDER_WIDTH);

      // Re-apply style pipeline (opacity, hatch, alt focus, etc.)
      try { updateHexStyles(panelIdx); } catch(_) {}
    }
  }
  
  function drawCountries(space, svg, hexRadius, opts = {}) {
    const focusId  = opts.focusCountryId || null;
    const focusMode= opts.focusMode || null; // 'filled'|'outline'|null
    const container = svg.select('g');
    container.selectAll('.country-border').remove();

    // 1) claimMap: (q,r) -> Set(country_id)
    const claimMap = new Map();
    (space.countries || []).forEach(cn => {
      const cid = normalizeCountryId(cn.country_id);
      // gallery 论文筛选：非选中国家不进 claimMap → 不画其边界，冲突边界只在选中子集间重算
      if (App.visibleCountries && !App.visibleCountries.has(cid)) return;
      (cn.hexes || []).forEach(h => {
        const k = `${h.q},${h.r}`;
        if (!claimMap.has(k)) claimMap.set(k, new Set());
        claimMap.get(k).add(cid);
      });
    });

    // 2) 像素位置索引
    const hexDict = new Map();
    container.selectAll('g.hex').each(function(d){
      hexDict.set(`${d.q},${d.r}`, { x: d.x, y: d.y });
    });
    const dirs = [[+1,0],[0,+1],[-1,+1],[-1,0],[0,-1],[+1,-1]];
    const hexCorner = (i) => {
      const ang = Math.PI/3 * i;
      return [hexRadius*Math.cos(ang), hexRadius*Math.sin(ang)];
    };
    const edgeKey = (ax,ay,bx,by) => {
      const k1 = `${ax},${ay}`, k2 = `${bx},${by}`;
      return (k1 < k2) ? `${k1}_${k2}` : `${k2}_${k1}`;
    };
    const edgeEndpoints = (cx, cy, i) => {
      const p1 = hexCorner(i);
      const p2 = hexCorner((i+1)%6);
      return [[cx+p1[0], cy+p1[1]], [cx+p2[0], cy+p2[1]]];
    };

    // 3) 两类边：otherEdges（很浅） 与 focusEdges（正常）
    const focusCid = focusId; 
    const otherEdges = new Map(); // key -> {a,b,dashed}
    const focusEdges = new Map();

    claimMap.forEach((currSet, qr) => {
      const [qStr, rStr] = qr.split(',');
      const q = +qStr, r = +rStr;
      const hex = hexDict.get(qr);
      if (!hex) return;

      for (let i=0; i<6; i++) {
        const [dq, dr] = dirs[i];
        const nq = q + dq, nr = r + dr;
        const nKey = `${nq},${nr}`;
        const nbSet = claimMap.get(nKey) || new Set(); // 邻居可为空（外部）

        // 内部边（集合相同）跳过
        const same =
          currSet.size === nbSet.size &&
          [...currSet].every(c => nbSet.has(c));
        if (same) continue;

        // 冲突：任一侧多国认领
        const dashed = (currSet.size > 1) || (nbSet.size > 1);
        const [a,b] = edgeEndpoints(hex.x, hex.y, i);
        const k = edgeKey(a[0],a[1], b[0],b[1]);

        if (!focusCid) {
          // ★ 非 Alt：如你之前的逻辑（全部国家一起画）
          const prev = otherEdges.get(k);
          if (prev) prev.dashed = prev.dashed || dashed;
          else otherEdges.set(k, { a, b, dashed });
        } else {
          // ★ Alt：只把“focus 国家格子与非 focus 邻居”的边划到 focusEdges；
          // 其余边归 other（很浅显示）
          const currHasFocus = currSet.has(focusCid);
          const nbHasFocus   = nbSet.has(focusCid);

          // 只要 curr 有 focus，且邻居“不完全相同”，且（邻居里不含 focus 或为空/他国），就是焦点外边
          if (currHasFocus && !nbHasFocus) {
            const prev = focusEdges.get(k);
            if (prev) prev.dashed = prev.dashed || dashed;
            else focusEdges.set(k, { a, b, dashed });
          } else {
            const prev = otherEdges.get(k);
            if (prev) prev.dashed = prev.dashed || dashed;
            else otherEdges.set(k, { a, b, dashed });
          }
        }
      }
    });

    // 4) 绘制
    // other：outline 模式下，其他边界完全隐藏；filled / 无聚焦则按原逻辑
    otherEdges.forEach(({a,b,dashed}) => {
      const show = focusId
        ? (focusMode === 'filled' ? true : false) // outline 不画 other
        : true;
      if (!show) return;

      container.append('line')
        .attr('class', 'country-border country-border-other')
        .attr('x1', a[0]).attr('y1', a[1])
        .attr('x2', b[0]).attr('y2', b[1])
        .attr('stroke', App.config.countryBorder.color)
        .attr('stroke-width', App.config.countryBorder.width)
        .attr('stroke-opacity', focusId ? STYLE.BORDER_ALT_OTHER : 1)
        .attr('stroke-dasharray', dashed ? '6,4' : null)
        .attr('pointer-events', 'none');
    });

    // focus：outline/filled 都画，但在 outline 下更突出
    if (focusId) {
      focusEdges.forEach(({a,b,dashed}) => {
        container.append('line')
          .attr('class', 'country-border country-border-focus')
          .attr('x1', a[0]).attr('y1', a[1])
          .attr('x2', b[0]).attr('y2', b[1])
          .attr('stroke', App.config.countryBorder.color)
          .attr('stroke-width', App.config.countryBorder.width)
          .attr('stroke-opacity', 1) // 聚焦边界始终清晰
          .attr('stroke-dasharray', dashed ? '6,4' : null)
          .attr('pointer-events', 'none');
      });
    }
  }

  /* =========================
   * Overlay（roads / rivers / cities / flights）
   * ========================= */
  function drawOverlayLinesFromLinks(links, allHexDataByPanel, hexMapsByPanel, showTempFlight=false) {
    // 清空每个 panel 的 overlay-root
    App.overlaySvgs.forEach(overlaySvg => {
      const { links, cities } = ensureOverlayRoot(overlaySvg);
      links.selectAll('*').remove();
      cities.selectAll('*').remove();
    });

    // 全局 overlay（flight 最高层）
    const gGlobal = d3.select(App.globalOverlayEl);
    const gG = ensureOverlayRoot(gGlobal);
    gG.links.selectAll('*').remove();   // flight 曲线层

    // 起点计数（城市/首都）
    const startCountPerPanel = new Map();
    const ensureCountMap = (idx) => {
      if (!startCountPerPanel.has(idx)) startCountPerPanel.set(idx, new Map());
      return startCountPerPanel.get(idx);
    };
    const bump = (idx, q, r) => {
      const m = ensureCountMap(idx);
      const k = `${q},${r}`;
      m.set(k, (m.get(k) || 0) + 1);
    };

    const getLocalXY = (panelIdx, q, r) => {
      const hex = App.hexMapsByPanel[panelIdx]?.get(`${q},${r}`);
      return hex ? [hex.x, hex.y] : null;
    };

    const appendFlightArrow = (layer, p0, c1, p1, style, opacity) => {
      const t = 0.5;
      const mt = 1 - t;
      const x = mt * mt * p0[0] + 2 * mt * t * c1[0] + t * t * p1[0];
      const y = mt * mt * p0[1] + 2 * mt * t * c1[1] + t * t * p1[1];
      const dx = 2 * mt * (c1[0] - p0[0]) + 2 * t * (p1[0] - c1[0]);
      const dy = 2 * mt * (c1[1] - p0[1]) + 2 * t * (p1[1] - c1[1]);
      const len = Math.hypot(dx, dy);
      if (!len) return;
      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;
      const size = Math.max(5.5, (style.width || 1.2) * 4.8);
      const half = size * 0.42;
      const tip = [x + ux * size * 0.62, y + uy * size * 0.62];
      const base = [x - ux * size * 0.55, y - uy * size * 0.55];
      const left = [base[0] + px * half, base[1] + py * half];
      const right = [base[0] - px * half, base[1] - py * half];
      layer.append('path')
        .attr('class', 'flight-arrow')
        .attr('d', `M${tip[0]},${tip[1]} L${left[0]},${left[1]} L${right[0]},${right[1]} Z`)
        .attr('fill', style.color)
        .attr('fill-opacity', opacity ?? style.opacity ?? 0.9)
        .style('pointer-events', 'none');
    };

    const appendFlightCurve = (layer, p0, c1, p1, style, width, opacity, dash, meta = {}) => {
      const pathD = `M${p0[0]},${p0[1]} Q${c1[0]},${c1[1]} ${p1[0]},${p1[1]}`;
      if (meta.hoverable) {
        layer.append('path')
          .attr('class', 'flight-shadow')
          .attr('d', pathD)
          .attr('stroke', '#111827')
          .attr('stroke-width', Math.max(width + 3, 5))
          .attr('stroke-opacity', meta.hovered ? 0.11 : 0)
          .attr('fill', 'none')
          .attr('stroke-linecap', 'round')
          .style('pointer-events', 'none')
          .style('filter', meta.hovered ? 'blur(0.45px)' : null);
      }
      const visiblePath = layer.append('path')
        .attr('class', meta.hoverable ? 'flight-visible' : null)
        .attr('d', `M${p0[0]},${p0[1]} Q${c1[0]},${c1[1]} ${p1[0]},${p1[1]}`)
        .attr('stroke', style.color)
        .attr('stroke-width', meta.hovered ? width + 0.45 : width)
        .attr('data-base-width', width)
        .attr('stroke-opacity', opacity)
        .attr('fill', 'none')
        .attr('stroke-dasharray', dash || null)
        .style('filter', meta.hovered ? 'drop-shadow(0 1px 1.5px rgba(15,23,42,.18))' : null);
      visiblePath.node().__baseStrokeWidth = width;
      appendFlightArrow(layer, p0, c1, p1, { ...style, width }, opacity);
      if (meta.hoverable) {
        layer.append('path')
          .attr('class', 'flight-hit')
          .attr('d', pathD)
          .attr('stroke', 'transparent')
          .attr('stroke-width', Math.max(width + 14, 16))
          .attr('fill', 'none')
          .attr('stroke-linecap', 'round')
          .style('pointer-events', 'stroke');
      }
    };

    (links || []).forEach(link => {
      const type  = link.type || 'road';
      const style = styleOf(type);

      // 1) 原始路径 → 标准化 panelIdx
      const ptsRaw = (link.path || []).map((p, i) => ({
        panelIdx: resolvePanelIdxForPathPoint(p, link, i),
        q: p.q, r: p.r
      }));

      // 2) 若这条线路被选中：按排除点过滤（关键改动）
      let pts = ptsRaw;
      const lk = linkKey(link);
      if (App.selectedRouteIds.has(lk)) {
        pts = ptsRaw.filter(p => !App.excludedHexKeys.has(`${p.panelIdx}|${p.q},${p.r}`));
      }

      // 3) 过滤后不足两点，不画
      if (pts.length < 2) return;

      // 4) 起点计数（用于城市/首都，基于过滤后的首点）
      const p0 = pts[0];
      bump(p0.panelIdx, p0.q, p0.r);

      if (type === 'flight') {
        const flightId = lk || link.id || link._uid || `flight-${Math.random().toString(36).slice(2)}`;
        if (!link.id && !link._uid) link._uid = flightId;
        const hovered = App.hoveredFlightId === flightId;
        const flightGroup = gG.links.append('g')
          .attr('class', 'flight-link')
          .attr('data-flight-id', flightId)
          .datum(link)
          .on('mouseenter', (event) => {
            if (!isFlightDeleteHoverEnabled()) return;
            if (App.flightDeleteHideTimer) clearTimeout(App.flightDeleteHideTimer);
            App.flightDeleteHideTimer = null;
            App.hoveredFlightId = flightId;
            App.flightHoverClient = { x: event.clientX, y: event.clientY };
            App.flightDeleteTargetLink = link;
            App.flightDeleteTargetSignature = flightSignature(link);
            highlightFlightLink(flightId);
            scheduleFlightDeleteButton(flightId, event.clientX, event.clientY, link);
          })
          .on('mousemove', (event) => {
            if (!isFlightDeleteHoverEnabled()) {
              hideFlightDeleteButton();
              return;
            }
            App.hoveredFlightId = flightId;
            App.flightHoverClient = { x: event.clientX, y: event.clientY };
            App.flightDeleteTargetLink = link;
            App.flightDeleteTargetSignature = flightSignature(link);
          })
          .on('mouseleave', (event) => {
            if (App.flightDeleteTimer) clearTimeout(App.flightDeleteTimer);
            App.flightDeleteTimer = null;
            App.flightDeleteHideTimer = setTimeout(() => {
              const btn = document.getElementById('flight-delete-button');
              if (btn && btn.matches(':hover')) return;
              if (isPointerNearFlightDeleteButton(event, 34)) return;
              hideFlightDeleteButton();
            }, 520);
          });
        flightGroup.node().__flightId = flightId;

        // 多跳 flight：逐段绘制二次贝塞尔曲线（a-b, b-c, ...）
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];

          // 可见性：逐段判断（若跨 panel 也能画，因为用的是“全局坐标”）
          if (!flightEndpointsVisible(a, b)) continue;

          const g0 = getHexGlobalXY(a.panelIdx, a.q, a.r);
          const g1 = getHexGlobalXY(b.panelIdx, b.q, b.r);
          if (!g0 || !g1) continue;

          const dx = g1[0] - g0[0], dy = g1[1] - g0[1];
          const mx = (g0[0] + g1[0]) / 2, my = (g0[1] + g1[1]) / 2;
          const curveOffset = Math.sign(dx) * style.controlCurveRatio * Math.sqrt(dx*dx + dy*dy);
          const c1x = mx + curveOffset, c1y = my - curveOffset;

          appendFlightCurve(flightGroup, g0, [c1x, c1y], g1, style, style.width, style.opacity, style.dash, {
            hoverable: true,
            hovered,
            flightId
          });
        }
      } else {
        // road/river：按过滤后的 pts 直接画，跳过被排除的中间点
        const panelIdx = pts[0].panelIdx;
        const overlaySvg = App.overlaySvgs[panelIdx];
        if (!overlaySvg) return;
        const gLines = ensureOverlayRoot(overlaySvg).links;

        const xy = pts.map(p => getLocalXY(p.panelIdx, p.q, p.r)).filter(Boolean);
        if (xy.length < 2) return;

        if (xy.length === 2) {
          gLines.append('line')
            .attr('x1', xy[0][0]).attr('y1', xy[0][1])
            .attr('x2', xy[1][0]).attr('y2', xy[1][1])
            .attr('stroke', style.color).attr('stroke-width', style.width)
            .attr('stroke-opacity', style.opacity).attr('fill', 'none')
            .attr('stroke-dasharray', style.dash || null);
        } else {
          gLines.append('polyline')
            .attr('points', xy.map(p => p.join(',')).join(' '))
            .attr('stroke', style.color).attr('stroke-width', style.width)
            .attr('stroke-opacity', style.opacity).attr('fill', 'none')
            .attr('stroke-dasharray', style.dash || null);
        }
      }
    });

    // 城市/首都（中层）—保持不变
    startCountPerPanel.forEach((map, pIdx) => {
      const overlay = App.overlaySvgs[pIdx];
      if (!overlay) return;
      const gCities = ensureOverlayRoot(overlay).cities;
      const baseR = App.config.city.radius;

      map.forEach((count, key) => {
        const [qStr, rStr] = key.split(',');
        const q = +qStr, r = +rStr;
        const hex = App.hexMapsByPanel[pIdx]?.get(`${q},${r}`);
        if (!hex) return;

        const cx = hex.x, cy = hex.y;

        if (count === 1) {
          gCities.append('circle')
            .attr('cx', cx).attr('cy', cy)
            .attr('r', baseR)
            .attr('fill', App.config.city.fill)
            .attr('stroke', App.config.city.borderColor)
            .attr('stroke-width', App.config.city.borderWidth)
            .attr('vector-effect', 'non-scaling-stroke')
            .style('pointer-events', 'none');
        } else if (count >= 2) {
          const outerR = baseR * 1.4;
          const innerR = baseR * 0.8;
          gCities.append('circle')
            .attr('cx', cx).attr('cy', cy)
            .attr('r', outerR)
            .attr('fill', App.config.city.fill)
            .attr('stroke', App.config.city.borderColor)
            .attr('stroke-width', App.config.city.borderWidth)
            .attr('vector-effect', 'non-scaling-stroke')
            .style('pointer-events', 'none');
          gCities.append('circle')
            .attr('cx', cx).attr('cy', cy)
            .attr('r', innerR)
            .attr('fill', App.config.city.capitalFill)
            .attr('stroke', App.config.city.borderColor)
            .attr('stroke-width', App.config.city.borderWidth)
            .attr('vector-effect', 'non-scaling-stroke')
            .style('pointer-events', 'none');
        }
      });

      gCities.raise();
    });

    // 临时 flight（保持不变）
    if (showTempFlight && App.flightStart) {
      const a = App.flightStart;
      const startVisible = isPointVisible(a.panelIdx, a.q, a.r);
      if (startVisible) {
        const p0 = getHexGlobalXY(a.panelIdx, a.q, a.r);
        const p1 = [App.currentMouse.x, App.currentMouse.y];
        if (p0 && p1) {
          const style = App.config.flight;
          const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
          const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
          const curveOffset = Math.sign(dx) * style.controlCurveRatio * Math.sqrt(dx*dx + dy*dy);
          const c1x = mx + curveOffset, c1y = my - curveOffset;

          appendFlightCurve(gG.links, p0, [c1x, c1y], p1, style, style.tempWidth, style.tempOpacity, style.tempDash);
        }
      }
    }
  }

  /* =========================
   * 选中/高亮样式
   * ========================= */
  function getConnectedHexKeys(panelIdx, q, r) {
    const out = new Set();
    for (const link of (App._lastLinks || [])) {
      if (link.type !== 'road' && link.type !== 'river') continue;
      const pts = (link.path || []).map((p, i) => ({
        panelIdx: resolvePanelIdxForPathPoint(p, link, i),
        q: p.q, r: p.r
      })).filter(p => p.panelIdx === panelIdx);
      if (!pts.length) continue;
      if (pts.some(p => p.q === q && p.r === r)) {
        pts.forEach(p => out.add(`${p.q},${p.r}`));
      }
    }
    return out;
  }

function updateHexStyles() {
  App.subspaceSvgs.forEach((svg, panelIdx) => {
    const override = App.panelFocusOverrides.get(panelIdx);
    const focusCid  = override && override.countryId
      ? normalizeCountryId(override.countryId)
      : (App.focusCountryId ? normalizeCountryId(App.focusCountryId) : null);
    const focusMode = override && override.mode ? override.mode : (App.focusMode || null);


    // Layout mode for this panel (hex vs scatter)
    const showScatter = (typeof getPanelLayoutMode === 'function') ? (getPanelLayoutMode(panelIdx) === 'scatter') : false;
    const containerG = svg.select('g');
    const scatterLayer = containerG.select('g.scatter-layer');
    if (!scatterLayer.empty()) scatterLayer.attr('display', showScatter ? null : 'none');

    if (!App._hexStyleByKey) App._hexStyleByKey = new Map();

    svg.selectAll('g.hex').each(function(d) {
      // —— gallery 论文筛选：不含任一选中 country 的 hex 整体隐藏（含底层 core）——
      let filteredOut = false;
      if (App.visibleCountries) {
        const _bkt = getBucket(panelIdx, d.q, d.r);
        const _hasVisible = !!(_bkt && _bkt.countries && _bkt.countries.size &&
          Array.from(_bkt.countries).some(c => App.visibleCountries.has(c)));
        filteredOut = !_hasVisible;
      }

      const core = d3.select(this).select('path.hex-core');
      if (!core.empty()) {
        core.attr('fill', filteredOut ? 'none' : computeHexBaseFill(panelIdx, d.q, d.r, d.modality))
            .attr('display', filteredOut ? 'none' : null); // core 层也整体隐藏（含描边）
      }

      const gSel  = d3.select(this);
      const path  = gSel.select('path.hex-shape').empty() ? gSel.select('path') : gSel.select('path.hex-shape');
      const hatch = gSel.select('path.hex-hatch');
      const key   = `${panelIdx}|${d.q},${d.r}`;

      // 基础底色（未覆盖时）
      const baseFill = getHexFillColor(d);

      // === 记录最终边框样式到缓存（供右端使用） ===
      const stroke  = path.attr('stroke') || (App?.config?.hex?.borderColor) || '#FFFFFF';
      const strokeW = Number(path.attr('stroke-width')) || (App?.config?.hex?.borderWidth) || 1;
      if (!App.borderCacheByHex) App.borderCacheByHex = new Map();
      App.borderCacheByHex.set(key, { stroke, strokeW });

      // —— 国家与 Alt 焦点 —— //
      const thisCid     = d.country_id ? normalizeCountryId(d.country_id) : null;
      const isFocusHex  = !!(focusCid && thisCid === focusCid);

      // Alt=filled：仅改变焦点国内的“填充色”，并压暗非焦点；不要统一透明度
      let focusBaseFill   = baseFill;
      let nonFocusOpacity = null;
      if (focusCid && focusMode === 'filled') {
        focusBaseFill   = isFocusHex ? STYLE.FOCUS_COUNTRY_FILL : baseFill;
        if (!isFocusHex) nonFocusOpacity = STYLE.OPACITY_NONFOCUS; // 仅非焦点压暗
      }

      // —— 覆盖色（国家） —— //
      const countryOv = thisCid ? getCountryColorOverride(panelIdx, thisCid) : null;
      const confirmedCountryAlphaMap = countryOv?.alphaByKey || null;
      const sourceWideCountryColor = thisCid
        ? App.globalCountryColors?.get?.(thisCid)
        : null;
      let confirmedCountryColor = null;
      if (sourceWideCountryColor) {
        confirmedCountryColor = sourceWideCountryColor;
      } else if (countryOv?.color && confirmedCountryAlphaMap?.has?.(key)) {
        confirmedCountryColor = countryOv.color;
      }
      
      // —— 预览（国家） —— //
      let previewColor = null;
      let previewAlpha = null;
      if (App._pendingColorEdit && isFocusHex) {
        const p = App._pendingColorEdit;
        if (p.panelIdx === panelIdx && p.countryId === thisCid && p.keys.has(key)) {
          previewColor = p.color || null;
          previewAlpha = p.alphaByKey?.get?.(key) ?? null;
        }
      }

      // —— 冲突优先：当 hex 是冲突时，用冲突覆盖 —— //
      const isConflict = isConflictHex(panelIdx, d.q, d.r);
      const conflictBaseFill = isConflict
        ? ((STYLE && STYLE.CONFLICT_GRAY) ? STYLE.CONFLICT_GRAY : '#B0B0B0')
        : null;
      const conflictContextCid = isConflict
        ? getConflictContextCountryId(panelIdx, d.q, d.r, key, focusCid)
        : null;
      const conflictContextColor = conflictContextCid
        ? (
            (App._pendingColorEdit?.countryId && normalizeCountryId(App._pendingColorEdit.countryId) === conflictContextCid && App._pendingColorEdit?.keys?.has?.(key))
              ? App._pendingColorEdit.color
              : getExplicitCountryColor(panelIdx, conflictContextCid)
          )
        : null;
      // 冲突格平时保持灰色；当 Alt/筛选/聚焦明确指向某个已上色国家时，临时显示该国家色。
      if (isConflict) {
        confirmedCountryColor = null;
        if (!conflictContextColor) {
          previewColor = null;
          previewAlpha = null;
        }
      }
      let confirmedConflictColor = null;
      let confirmedConflictAlphaMap = null;
      let previewConflictColor = null;
      let previewConflictAlpha = null;

      if (isConflict) {
        const cov = getConflictColorOverride(panelIdx);
        if (cov) {
          confirmedConflictColor    = cov.color || null;
          confirmedConflictAlphaMap = cov.alphaByKey || null;
        }
        if (App._pendingConflictEdit && App._pendingConflictEdit.panelIdx === panelIdx) {
          const p = App._pendingConflictEdit;
          if (p.keys.has(key)) {
            previewConflictColor = p.color || null;
            previewConflictAlpha = p.alphaByKey?.get?.(key) ?? null;
          }
        }
      }

      // —— 颜色与 alpha 选择优先级 —— //
      // 颜色：冲突预览 > 当前国家上下文里的冲突色 > 冲突已确认 > 国家预览 > 国家已确认 > 焦点底色 > 默认底色
      let finalFill =
        previewConflictColor ??
        conflictContextColor ??
        confirmedConflictColor ??
        previewColor ??
        confirmedCountryColor ??
        conflictBaseFill ??
        focusBaseFill ??
        baseFill;

      // alpha：默认用 MSU 基线；若覆盖/预览提供 per-hex alpha，用它覆盖该格
      const msuAlpha = App.msuAlphaByHex?.get?.(key) ?? STYLE.OPACITY_DEFAULT;

      let confirmedAlpha = null;
      if (isConflict) {
        confirmedAlpha = confirmedConflictAlphaMap?.get?.(key) ?? null;
      } else {
        confirmedAlpha = confirmedCountryAlphaMap?.get?.(key) ?? null;
      }

      // 2) 基底透明度
      let baseOpacity = msuAlpha;

      // Alt 填充聚焦：压暗非焦点国家；焦点国内保留各自 MSU 透明度
      if (nonFocusOpacity != null) {
        baseOpacity = Math.min(baseOpacity, nonFocusOpacity);
      }

      // 覆盖色/预览若提供 per-hex alpha，则替换基线
      if (previewConflictAlpha != null) {
        baseOpacity = previewConflictAlpha;
      } else if (confirmedAlpha != null) {
        baseOpacity = confirmedAlpha;
      } else if (previewAlpha != null) {
        baseOpacity = previewAlpha;
      }

      // —— 交互态 —— //
      let isSelected       = App.persistentHexKeys.has(key);
      let isHovered        = !!(App.hoveredHex && App.hoveredHex.panelIdx === panelIdx && App.hoveredHex.q === d.q && App.hoveredHex.r === d.r);
      let isFlightStart    = !!(App.flightStart  && App.flightStart.panelIdx  === panelIdx && App.flightStart.q === d.q && App.flightStart.r === d.r);
      let isFlightHover    = !!(App.flightHoverTarget && App.flightHoverTarget.panelIdx === panelIdx && App.flightHoverTarget.q === d.q && App.flightHoverTarget.r === d.r);
      let inPreview        = App.highlightedHexKeys.has(key);
      let isPreviewCenter  = inPreview && isHovered;
      let isPreviewNeighbor= inPreview && !isPreviewCenter;
      // 若当前存在选中集，则所有“未选中”的格子统一压暗到非焦点透明度
      if (App.persistentHexKeys && App.persistentHexKeys.size > 0 && !isSelected) {
        // baseOpacity 是上面算好的“基底透明度”（MSU/覆盖/预览已经体现在 baseOpacity 里）
        // 这里我们在它之上再做一道压暗
        if (typeof baseOpacity === 'number') {
          baseOpacity = Math.min(baseOpacity, STYLE.OPACITY_NONFOCUS);
        }
      }

      // 3) 交互叠加透明度（不要把有覆盖色的选中态硬拉到 1）
      let overlayOpacity = STYLE.OPACITY_DEFAULT;
      // 选中态优先于 hover/preview（但保留“有覆盖色不拉满”的规则）
      if (isSelected) {
        if (!previewColor && !confirmedCountryColor && !confirmedConflictColor && previewConflictColor == null) {
          overlayOpacity = STYLE.OPACITY_SELECTED; // 只有在无覆盖色时才抬高
        } else {
          overlayOpacity = Math.max(overlayOpacity, STYLE.OPACITY_NEIGHBOR); // 有覆盖时也给点抬升
        }
      } else if (isHovered || isFlightStart || isFlightHover) {
        overlayOpacity = STYLE.OPACITY_HOVER;
      } else if (isPreviewCenter) {
        overlayOpacity = STYLE.OPACITY_PREVIEW_CENTER;
      } else if (isPreviewNeighbor) {
        overlayOpacity = STYLE.OPACITY_PREVIEW_NEIGHBOR;
      }

      let boost = Math.max(0, Math.min(1, overlayOpacity)); // overlayOpacity 改名更贴切也可
      let finalOpacity = baseOpacity + (1 - baseOpacity) * boost;
      if (isSelected) {
        finalOpacity = Math.max(finalOpacity, STYLE.OPACITY_SELECTED_MIN ?? 0.96);
      }

      // —— gallery 论文筛选：隔离选中论文的 HSU（filteredOut 已在 .each 开头按 visibleCountries 算好）——
      if (filteredOut) {
        finalFill = 'none';   // 上层彩色 shape 也不画
        finalOpacity = 0;     // 完全隐藏
      }

      // 写入最终透明度缓存（右侧用）
      if (!App.alphaCacheByHex) App.alphaCacheByHex = new Map();
      App.alphaCacheByHex.set(key, finalOpacity);

       // Cache final style for this hex (used by scatter MSU points to inherit color/opacity)
       try { App._hexStyleByKey.set(key, { fill: finalFill, opacity: finalOpacity }); } catch(e) {}

      // 预览邻居的斜线填充 + 应用样式
      hatch.attr('fill', (isPreviewNeighbor && !filteredOut) ? `url(#hex-hatch-${panelIdx})` : 'none');
      path .attr('fill', finalFill)
           .attr('fill-opacity', finalOpacity);

      // Scatter dot uses the same final color/alpha as hex
      // const dot = gSel.select('circle.scatter-dot');
      // if (!dot.empty()) {
      //   dot.attr('fill', finalFill)
      //      .attr('fill-opacity', finalOpacity);
      // }

      // 冲突选择态的边框专属规则
      let conflictMode = (App.lastSelectionKind === 'conflict' && App.persistentHexKeys && App.persistentHexKeys.size > 0);
      isSelected = App.persistentHexKeys && App.persistentHexKeys.has(`${panelIdx}|${d.q},${d.r}`);
      let strokeOpacity = conflictMode ? (isSelected ? STYLE.BORDER_ALT_ACTIVE : STYLE.BORDER_ALT_OTHER) : 1;
      let strokeWidth   = conflictMode ? (App.config.hex.borderWidth * (isSelected ? 1.6 : 1.0)) : App.config.hex.borderWidth;
      if (filteredOut) strokeOpacity = 0; // 被筛掉的 hex 边框彻底去掉
      path.attr('stroke-opacity', strokeOpacity).attr('stroke-width', strokeWidth)
          .style('pointer-events', filteredOut ? 'none' : null); // 隐藏的 hex 不响应 hover

      // const dot2 = gSel.select('circle.scatter-dot');
      // if (!dot2.empty()) {
      //   dot2.attr('stroke-opacity', strokeOpacity)
      //       .attr('stroke-width', Math.max(0.6, strokeWidth * 0.8));
      // }
      // 普通选中态：在非冲突模式下也给边框加一点强调
      if (!conflictMode && isSelected) {
        path.attr('stroke-width', Math.max(Number(path.attr('stroke-width')) || App.config.hex.borderWidth, App.config.hex.borderWidth * 1.6));
        path.attr('stroke-opacity', 1);
      }
      try { applySpotlight(panelIdx); } catch(e) { console.warn(e); }

      });
    // Sync MSU scatter points with the cached hex styles (inherit hex color/opacity)
    if (!scatterLayer.empty()) {
      const _isScatterVisible = (d) => {
        if (!App.visibleCountries) return true;
        const cid = d.country_id ? normalizeCountryId(String(d.country_id)) : null;
        return !!(cid && App.visibleCountries.has(cid));
      };
      scatterLayer.selectAll('circle.msu-point')
        .attr('fill', d => {
          return resolveScatterPointFill(d, '#999');
        })
        // gallery 论文筛选：country 不在选中集的散点整体隐藏
        .attr('display', d => _isScatterVisible(d) ? null : 'none')
        .style('pointer-events', d => _isScatterVisible(d) ? null : 'none')
        .attr('opacity', 1)
        .attr('fill-opacity', d => {
          if (!_isScatterVisible(d)) return 0;
          const st = App._hexStyleByKey && App._hexStyleByKey.get ? App._hexStyleByKey.get(d.__hexKey) : null;
          const cfg = (App && App.config && App.config.scatter) ? App.config.scatter : {};
          const MIN_OPACITY = Number.isFinite(cfg.minOpacity) ? cfg.minOpacity : 0.72;
          const op = (st && typeof st.opacity === 'number') ? st.opacity : 0.9;
          return Math.max(MIN_OPACITY, op);
        });
    }

  });

  // —— 边界重绘（保持你的原逻辑）—— //
  App.currentData?.subspaces?.forEach((space, i) => {
    const svg = App.subspaceSvgs[i];
    if (!svg || svg.empty()) return;

    const override = App.panelFocusOverrides.get(i);
    const focusCid  = override && override.countryId ? normalizeCountryId(override.countryId)
                                                    : (App.focusCountryId ? normalizeCountryId(App.focusCountryId) : null);
    const focusMode = override && override.mode ? override.mode : (App.focusMode || null);

    // Scatter layout: do not draw country borders (they are defined on the hex lattice)
    if (getPanelLayoutMode(i) === 'scatter') {
      svg.select('g').selectAll('.country-border').remove();
      return;
    }

    drawCountries(space, svg, App.config.hex.radius, {
      focusCountryId: focusCid,
      focusMode: focusMode
    });


  });
}


  /* =========================
   * 交互/快照
   * ========================= */
  function buildUndirectedAdjacency() {
    const adj = new Map();
    const key = (panelIdx, q, r) => `${panelIdx}|${q},${r}`;
    const ensure = (k) => { if (!adj.has(k)) adj.set(k, new Set()); return adj.get(k); };

    for (const e of (App._lastLinks || [])) {
      const path = Array.isArray(e.path) ? e.path : [];
      if (path.length < 2) continue;
      const pts = path.map((p, i) => ({
        panelIdx: resolvePanelIdxForPathPoint(p, e, i),
        q: p.q, r: p.r
      }));
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i+1];
        const ka = key(a.panelIdx, a.q, a.r);
        const kb = key(b.panelIdx, b.q, b.r);

        // ★ 关键：如果任一端被排除了，就不要把这条边放进连通图
        if (App.excludedHexKeys.has(ka) || App.excludedHexKeys.has(kb)) continue;

        ensure(ka).add(kb);
        ensure(kb).add(ka);
      }
    }
    return adj;
  }

  // ==== NEW: 基于“整条线路”的 star：返回所有“包含 (panelIdx,q,r)” 的线路上所有点 ====
  function lineStarKeys(panelIdx, q, r, opts = { includeFlight: true }) {
    const result = new Set();
    const matchAt = (pt, link, i) => {
      const pIdx = resolvePanelIdxForPathPoint(pt, link, i);
      return pIdx === panelIdx && pt.q === q && pt.r === r;
    };

    (App._lastLinks || []).forEach(link => {
      if (!opts.includeFlight && link.type === 'flight') return; // 如需把航线也纳入一跳，改为 true
      const path = Array.isArray(link.path) ? link.path : [];
      if (!path.length) return;

      // 该线路是否包含点击点
      const hit = path.some((pt, i) => matchAt(pt, link, i));
      if (!hit) return;

      // 把该线路全路径上的点加入选中集
      path.forEach((pt, i) => {
        const pIdx = resolvePanelIdxForPathPoint(pt, link, i);
        result.add(pkey(pIdx, pt.q, pt.r));
      });
    });

    return result; // Set<"panelIdx|q,r">
  }


  // 计算某点的一跳邻居（含自身）
  function computeOneHopStar(panelIdx, q, r) {
    const center = pkey(panelIdx, q, r);
    const adj = buildUndirectedAdjacency();      // 基于全部 links（road/river/flight）构建无向图
    const star = new Set([center]);
    const nbs = adj.get(center);
    if (nbs && nbs.size) {
      nbs.forEach(nb => star.add(nb));
    }
    return star;  // Set<"panel|q,r">
  }


  function findEndpointMate(panelIdx, q, r) {
    const k = (p, q, r) => `${p}|${q},${r}`;
    for (const e of (App._lastLinks || [])) {
      const path = Array.isArray(e.path) ? e.path : [];
      if (path.length < 2) continue;
      const pts = path.map((p, i) => ({
        panelIdx: resolvePanelIdxForPathPoint(p, e, i), q: p.q, r: p.r
      }));
      const idx = pts.findIndex(p => p.panelIdx === panelIdx && p.q === q && p.r === r);
      if (idx < 0) continue;

      if (idx === 0) {
        const nb = pts[1];
        return { found: true, mateKey: k(nb.panelIdx, nb.q, nb.r) };
      }
      if (idx === pts.length - 1) {
        const nb = pts[pts.length - 2];
        return { found: true, mateKey: k(nb.panelIdx, nb.q, nb.r) };
      }
      // 中间点返回 not-found
    }
    return { found: false };
  }

  function removeSingleNode(panelIdx, q, r) {
    const key = pkey(panelIdx, q, r);
    App.persistentHexKeys.delete(key);
    App.excludedHexKeys.add(key);
  }


  // ★ NEW：从某个 key 出发，拿到“整条连通分量”（Set<key>）
   function getComponentKeysFrom(adj, startKey) {
     const visited = new Set([startKey]);
     const q = [startKey];
     while (q.length) {
       const cur = q.shift();
       for (const nb of (adj.get(cur) || new Set())) {
         if (!visited.has(nb)) { visited.add(nb); q.push(nb); }
       }
     }
     return visited;
   }
 
   // ★ NEW：批量选中/取消一个点所在的整条连通分量
   function selectComponent(panelIdx, q, r) {
      const k = pkey(panelIdx, q, r);
      const adj = buildUndirectedAdjacency();
      const comp = getComponentKeysFrom(adj, k);
      comp.forEach(kk => {
        App.persistentHexKeys.add(kk);
        App.excludedHexKeys.delete(kk);   // ★ NEW：被选中的点不应再保留“排除”标记
      });
    }

    function deselectComponent(panelIdx, q, r) {
      const k = pkey(panelIdx, q, r);
      const adj = buildUndirectedAdjacency();
      const comp = getComponentKeysFrom(adj, k);
      comp.forEach(kk => {
        App.persistentHexKeys.delete(kk);
        //（可选）也可以把 comp 内的排除清掉，看你的需求：
        // App.excludedHexKeys.delete(kk);
      });
    }

  // 在当前子空间中，按 (q,r) 收集并合并所有记录
  // —— 工具：多路兜底的“按子空间 + 坐标”聚合器 ——
  function _gatherAt(panelIdx, q, r) {
    const key = `${q},${r}`;
    let items = [];

    // 1) 直接从 buckets 取（如果你在 render 阶段已经 buildBuckets）
    try {
      const m = App?.hexBucketsByPanel?.[panelIdx];
      const b = m && typeof m.get === 'function' ? m.get(key) : null;
      if (b && Array.isArray(b.items) && b.items.length) items = items.concat(b.items);
    } catch (e) {}

    // 2) getBucket 函数（有就用）
    try {
      if (!items.length && typeof getBucket === 'function') {
        const b = getBucket(panelIdx, q, r);
        if (b && Array.isArray(b.items) && b.items.length) items = items.concat(b.items);
      }
    } catch (e) {}

    // 3) 你的“原始未去重列表”备份
    try {
      const raw = App?._rawHexListByPanel?.[panelIdx];
      if (Array.isArray(raw)) {
        items = items.concat(raw.filter(it => it && it.q === q && it.r === r));
      }
    } catch (e) {}

    // 4) 当前子空间的 hexList（有些项目会被覆盖成“唯一代表”，但也兜底尝试）
    try {
      const list = App?.currentData?.subspaces?.[panelIdx]?.hexList || [];
      if (Array.isArray(list)) {
        items = items.concat(list.filter(it => it && it.q === q && it.r === r));
      }
    } catch (e) {}

    // 5) 其它你项目里常见的缓存（可能已去重，作为最后兜底）
    try {
      const all = App?.allHexDataByPanel?.[panelIdx] || [];
      if (Array.isArray(all)) {
        items = items.concat(all.filter(it => it && it.q === q && it.r === r));
      }
    } catch (e) {}

    // —— 去掉完全重复（以 “country+msu_ids+modality” 作为签名） ——
    const seen = new Set();
    const uniq = [];
    for (const it of items) {
      if (!it) continue;
      const sig = `${_normCid(it.country_id)}|${Array.isArray(it.msu_ids) ? it.msu_ids.join(',') : ''}|${it.modality || ''}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      uniq.push(it);
    }

    // The visible gallery sources are the authoritative data scope for details
    // and saved selections as well as rendering.
    const visibleItems = uniq.filter(it => isVisibleCountry(it.country_id));
    if (!visibleItems.length) return { ok: false };

    // 国家集合
    const countries = new Set(visibleItems.map(it => _normCid(it.country_id)).filter(Boolean));

    // 合并 msu 并去重
    const merged_msu_ids = Array.from(new Set(
      visibleItems.flatMap(it => Array.isArray(it.msu_ids) ? it.msu_ids : [])
    ));

    // 分国明细（给右侧等用）
    const groupsMap = new Map();
    for (const it of visibleItems) {
      const cid = _normCid(it.country_id) || '—';
      if (!groupsMap.has(cid)) groupsMap.set(cid, { items: [], msu_ids: [] });
      const g = groupsMap.get(cid);
      g.items.push(it);
      if (Array.isArray(it.msu_ids)) g.msu_ids.push(...it.msu_ids);
    }
    for (const [, g] of groupsMap) g.msu_ids = Array.from(new Set(g.msu_ids));

    const first = visibleItems[0] || {};
    return {
      ok: true,
      items: visibleItems,
      countries,
      merged_msu_ids,
      groupsMap,
      representative: {
        modality: first.modality || '',
        label: first.label || key
      }
    };
  }
 
  function snapshotFromKeySet(keySet) {
    if (!keySet || keySet.size === 0) return { nodes: [], links: [] };
    const nameByIdx = getSubspaceNameMap();

    const nodes = [];
    for (const k of keySet) {
      const [pStr, qr] = String(k).split('|');
      const [qStr, rStr] = qr.split(',');
      const panelIdx = parseInt(pStr, 10);
      const q = parseInt(qStr, 10);
      const r = parseInt(rStr, 10);

      // ★ 直接用多路兜底聚合器（不会被“最上层覆盖”影响）
      const agg = _gatherAt(panelIdx, q, r);
      if (!agg.ok) continue;

      const modality   = agg.representative.modality;
      const label      = agg.representative.label;
      const country_id = (agg.countries.size === 1) ? Array.from(agg.countries)[0] : null; // 多国 → null
      const msu_ids    = agg.merged_msu_ids;
      const msu        = (typeof resolveMSUs === 'function') ? resolveMSUs(msu_ids) : msu_ids;

      nodes.push({
        id: `${panelIdx}:${q},${r}`,
        panelIdx, q, r,
        label, modality, country_id,
        msu_ids, msu,
        conflict: agg.countries.size > 1
      });
    }

    // ===== 下面是你原来的“切段生成 links”逻辑，保持不变 =====
    const links = [];
    const inSet = (p) => keySet.has(`${p.panelIdx}|${p.q},${p.r}`);
    const usedKeys = new Set();

    for (const e of (App._lastLinks || [])) {
      const rawPts = Array.isArray(e.path) ? e.path : [];
      if (rawPts.length < 2) continue;
      const norm = rawPts.map((p, i) => ({
        panelIdx: resolvePanelIdxForPathPoint(p, e, i), q: p.q, r: p.r
      }));

      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          run.forEach(pt => usedKeys.add(`${pt.panelIdx}|${pt.q},${pt.r}`));
          const panels = Array.from(new Set(run.map(pt => pt.panelIdx)));
          const panelNames = panels.map(idx => nameByIdx[idx] || `Subspace ${idx}`);
          const first = run[0], last = run[run.length - 1];
          links.push({
            id: `${e.type || 'road'}:${first.panelIdx}:${first.q},${first.r}->${last.panelIdx}:${last.q},${last.r}`,
            type: e.type || 'road',
            path: run.map(pt => ({ panelIdx: pt.panelIdx, q: pt.q, r: pt.r })),
            panels, panelNames,
            panelNamesByIndex: { ...nameByIdx }
          });
        }
        run = [];
      };
      for (let i = 0; i < norm.length; i++) {
        const pt = norm[i];
        if (inSet(pt)) run.push(pt); else flush();
      }
      flush();
    }

    // “孤点” single（保持原行为）
    for (const key of keySet) {
      if (usedKeys.has(String(key))) continue;
      const [pStr, qr] = String(key).split('|');
      const [qStr, rStr] = qr.split(',');
      const panelIdx = parseInt(pStr, 10);
      const q = parseInt(qStr, 10);
      const r = parseInt(rStr, 10);
      const panels = [panelIdx];
      const panelNames = [nameByIdx[panelIdx] || `Subspace ${panelIdx}`];
      links.push({
        id: `single:${panelIdx}:${q},${r}`,
        type: 'single',
        path: [{ panelIdx, q, r }],
        panels, panelNames,
        panelNamesByIndex: { ...nameByIdx }
      });
    }

    return { nodes, links };
  }


  function snapshotFromSelectedRoutes() {
    const nodesSet = new Set();  // 收集被选路线中“未被排除”的节点 key
    const linksOut = [];
    const nameByIdx = getSubspaceNameMap();

    (App._lastLinks || []).forEach(link => {
      if (!isSelectableRoute(link)) return;
      const lk = linkKey(link);
      if (!App.selectedRouteIds.has(lk)) return;

      const raw = Array.isArray(link.path) ? link.path : [];
      // 过滤掉被排除点，同时保留原始顺序
      const filtered = [];
      for (let i=0;i<raw.length;i++){
        const p = raw[i];
        const pIdx = resolvePanelIdxForPathPoint(p, link, i);
        const key = `${pIdx}|${p.q},${p.r}`;
        if (!App.excludedHexKeys.has(key)) {
          filtered.push({ panelIdx: pIdx, q: p.q, r: p.r });
          nodesSet.add(key);
        }
      }
      if (filtered.length >= 2) {
        const panels = Array.from(new Set(filtered.map(pt => pt.panelIdx)));
        const panelNames = panels.map(idx => nameByIdx[idx] || `Subspace ${idx}`);

        linksOut.push({
          id: `${(link.type || 'road')}:${linkKey(link)}`,
          type: link.type || 'road',
          path: filtered,
          panels, panelNames,
          panelNamesByIndex: { ...nameByIdx }
        });
      }
    });

    // nodes：从 nodesSet 萃取（改为“并集版”）
    const nodes = [];
    nodesSet.forEach(k => {
      const [pStr, qr] = k.split('|');
      const [qStr, rStr] = qr.split(',');
      const panelIdx = +pStr, q = +qStr, r = +rStr;

      // 优先：拿聚合后的 bucket（保证包含同一格的多条记录）
      const bucket = (typeof getBucketSafe === 'function')
        ? getBucketSafe(panelIdx, q, r)
        : (typeof getBucket === 'function' ? getBucket(panelIdx, q, r) : null);

      if (bucket && Array.isArray(bucket.items) && bucket.items.length) {
        const items = bucket.items;
        const modality = items[0]?.modality || '';
        const label    = items[0]?.label || `${q},${r}`;
        const countries = bucket.countries && bucket.countries.size
          ? bucket.countries
          : new Set(items.map(it => (typeof normalizeCountryId === 'function' ? normalizeCountryId(it?.country_id) : it?.country_id)).filter(Boolean));
        const country_id = (countries.size === 1) ? Array.from(countries)[0] : null;

        const msu_ids = Array.from(new Set(
          items.flatMap(it => Array.isArray(it?.msu_ids) ? it.msu_ids : [])
        ));
        const msu = (typeof resolveMSUs === 'function') ? resolveMSUs(msu_ids) : msu_ids;

        nodes.push({
          id: `${panelIdx}:${q},${r}`,
          panelIdx, q, r,
          label, modality, country_id,
          msu_ids, msu,
          conflict: countries.size > 1
        });
        return; // 已经用 bucket 成功聚合，提前返回
      }

      // A previously selected route can contain a hex that the gallery has
      // since hidden.  Do not fall back to its raw representative record,
      // because that would reintroduce MSUs from an excluded paper.
      if (App.visibleCountries) return;

      // 兜底：仍然保留原来的“顶层单条”逻辑，避免没有 bucket 时直接丢数据
      const hex = App.hexMapsByPanel?.[panelIdx]?.get(`${q},${r}`);
      if (hex) {
        const msu_ids = Array.isArray(hex.msu_ids) ? hex.msu_ids : [];
        const msu = (typeof resolveMSUs === 'function') ? resolveMSUs(msu_ids) : msu_ids;
        nodes.push({
          id: `${panelIdx}:${q},${r}`,
          panelIdx, q, r,
          label: hex.label || `${q},${r}`,
          modality: hex.modality || '',
          country_id: hex.country_id || null,
          msu_ids,
          msu,
          conflict: false
        });
      }
    });


    // 若完全没有选中路线（比如只点了一个且被排除），退回原有方案
    if (!linksOut.length && nodes.length) {
      return snapshotFromKeySet(App.persistentHexKeys);
    }
    console.log( nodes, linksOut );
    return { nodes, links: linksOut };
  }


  // —— 小工具：无向边 key —— //
  function undirectedEdgeKey(panelIdx, q1, r1, q2, r2) {
    const a = `${q1},${r1}`, b = `${q2},${r2}`;
    const [u, v] = (a < b) ? [a, b] : [b, a];
    return `${panelIdx}|${u}|${v}`;
  }

  // —— 单击：按“整条链路”为基本单位；Ctrl 做并/差集 —— //
  function handleSingleClick(panelIdx, q, r, withCtrl = false, withShift = false) {
    const k = pkey(panelIdx, q, r);

    // -------- Alt：只“预览”冲突块或整国，不进入选集，也不 emit --------
    if (App.modKeys && (App.modKeys.alt || App.uiPref.area)) {
      const conflict = isConflictHex(panelIdx, q, r);
      // 清除任何待上色状态
      App._pendingConflictEdit = null;
      App._pendingColorEdit = null;
      if (App.highlightedHexKeys) App.highlightedHexKeys.clear();

      if (conflict) {
        const ramp = buildConflictAlphaRampFor(panelIdx);  // { keys:Set, alphaByKey:Map }
        App.highlightedHexKeys = new Set(ramp.keys);
        App._pendingConflictEdit = {
          panelIdx,
          keys: new Set(ramp.keys),                 // 仅用于右键“确认上色”
          color: getConflictColorOverride(panelIdx)?.color || null,
          alphaByKey: ramp.alphaByKey               // 预览透明度仍按 MSU 逻辑
        };
        App.lastSelectionKind = 'conflict-preview';
        updateHexStyles();
        return; // ← 不改 persistent、不 emit
      } else {
        // Alt 点击普通国家格：只把整国放入“高亮预览”，用于右键确认上色
        const hex = App.hexMapsByPanel?.[panelIdx]?.get(`${q},${r}`);
        const cid = hex?.country_id ? normalizeCountryId(hex.country_id) : null;
        if (cid) {
          // 差集：国家 - 冲突区（保证 Alt Click 后的“高亮/上色集合”与右键逻辑一致）
          const all = getCountryKeysInPanel(panelIdx, cid);
          const conflicts = getConflictKeysForCountryInPanel(panelIdx, cid);
          const filteredKeys = new Set([...all].filter(k => !conflicts.has(k)));

          App.highlightedHexKeys = new Set(filteredKeys);
          App._pendingColorEdit = {
            panelIdx,
            countryId: cid,
            keys: new Set(filteredKeys),
            color: getCountryColorOverride(panelIdx, cid)?.color || null,
            alphaByKey: buildAlphaMapForPanelCountry(panelIdx, cid)
          };

          App.lastSelectionKind = 'country-preview';
          updateHexStyles();
          return; // ← 同样不改 persistent、不 emit
        }
      }
    }

    // 普通点击前：轻量降级 Alt 聚焦（不动你的上色记录）
    degradeFocusToOutlineFor(panelIdx);

    // 清掉“预览”态
    App._pendingConflictEdit = null;
    App._pendingColorEdit = null;
    if (App.highlightedHexKeys) App.highlightedHexKeys.clear?.();

    // —— 依据“点 ⇒ 所在整条链路集合”来选择（而不是一跳邻居） —— //
    const routeIdsAtPoint = new Set();
    (App._lastLinks || []).forEach(L => {
      const t = (L && L.type) || 'road';
      const isSelectable = (t === 'flight' || t === 'road' || t === 'river');
      if (!isSelectable) return;
      try {
        if (typeof linkContainsNode === 'function') {
          if (linkContainsNode(L, panelIdx, q, r)) {
            const rid = (typeof linkKey === 'function') ? linkKey(L) : (L.id || L._uid);
            if (rid) routeIdsAtPoint.add(rid);
          }
        } else {
          // 兜底：简单判断 path 中是否含该点
          const inPath = Array.isArray(L.path) && L.path.some(p => p.panelIdx === panelIdx && p.q === q && p.r === r);
          if (inPath) {
            const rid = (typeof linkKey === 'function') ? linkKey(L) : (L.id || L._uid);
            if (rid) routeIdsAtPoint.add(rid);
          }
        }
      } catch(_) {}
    });

    const ctrlLike = !!(withCtrl || App.modKeys?.ctrl || App.modKeys?.meta || App.uiPref?.route);

    if (!ctrlLike) {
      // —— 非 Ctrl：选择“该点所在的整条链路集合”；若该点不在任何链路上，则退化为仅该点 —— //
      App.selectedEdgeKeys?.clear?.();
      App.selectedRouteIds?.clear?.();

      if (routeIdsAtPoint.size > 0) {
        routeIdsAtPoint.forEach(id => App.selectedRouteIds.add(id));
        App.lastSelectionKind = 'route';
        if (typeof recomputePersistentFromRoutes === 'function') {
          recomputePersistentFromRoutes(); // 由路线级选择推导节点集
        } else {
          // 兜底：把这些链路的所有 path 点落入 persistent
          App.persistentHexKeys.clear();
          (App._lastLinks || []).forEach(L => {
            const rid = (typeof linkKey === 'function') ? linkKey(L) : (L.id || L._uid);
            if (rid && App.selectedRouteIds.has(rid) && Array.isArray(L.path)) {
              L.path.forEach(p => App.persistentHexKeys.add(pkey(p.panelIdx, p.q, p.r)));
            }
          });
        }
      } else {
        // 无链路：只选该点
        App.persistentHexKeys.clear();
        App.persistentHexKeys.add(k);
        App.lastSelectionKind = 'single';
      }

      App.selectedHex = { panelIdx, q, r };
    } else {
      // —— Ctrl：对“该点所在的整条链路集合”做并/差切换；若无链路则对单点切换 —— //
      if (!App.selectedRouteIds) App.selectedRouteIds = new Set();

      if (routeIdsAtPoint.size > 0) {
        routeIdsAtPoint.forEach(id => {
          if (App.selectedRouteIds.has(id)) App.selectedRouteIds.delete(id);
          else App.selectedRouteIds.add(id);
        });
        App.lastSelectionKind = 'route';
        if (typeof recomputePersistentFromRoutesPreservingExtras === 'function') {
          recomputePersistentFromRoutesPreservingExtras();
        } else {
          // 兜底：用当前 selectedRouteIds 回填节点集
          App.persistentHexKeys.clear();
          (App._lastLinks || []).forEach(L => {
            const rid = (typeof linkKey === 'function') ? linkKey(L) : (L.id || L._uid);
            if (rid && App.selectedRouteIds.has(rid) && Array.isArray(L.path)) {
              L.path.forEach(p => App.persistentHexKeys.add(pkey(p.panelIdx, p.q, p.r)));
            }
          });
        }
      } else {
        // 无链路：退化为单点切换
        if (App.persistentHexKeys.has(k)) App.persistentHexKeys.delete(k);
        else App.persistentHexKeys.add(k);
        App.lastSelectionKind = 'single';
      }

      App.selectedHex = { panelIdx, q, r };
    }

    // 清掉临时 hover 预览，避免覆盖选中态视觉
    App.highlightedHexKeys?.clear?.();

    // 统一刷新/抛数
    drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!App.flightStart);
    emitSelectionPayload?.();          // nodes/edges/kind
    updateHexStyles();
    refreshLinkNamesFromDOM();
    publishToStepAnalysis?.();
  }
   function commitRouteDraft() {
    const draft = App.routeDraft;
    if (!draft || !Array.isArray(draft.path) || draft.path.length < 2) {
      cancelRouteDraft();
      return;
    }
    const path = draft.path.map(p => ({ q: p.q, r: p.r, panelIdx: p.panelIdx }));
    const first = path[0], last = path[path.length-1];

    const uid = draft._uid || draft.id || ('user-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    const link = {
      _uid: uid,
      id: uid,
      type: 'flight',
      panelIdxFrom: first.panelIdx,
      panelIdxTo:   last.panelIdx,
      from: { q:first.q, r:first.r, panelIdx:first.panelIdx },
      to:   { q:last.q,  r:last.r,  panelIdx:last.panelIdx  },
      path
    };

    stampSubspaceNamesOnLink(link);  
    App._lastLinks.push(link);
    
    // 清理草稿 & 临时线
    App.routeDraft = null;
    App.flightStart = null;
    App.flightDraft = null;  
      // ★ 更新选中路线集合（尊重 Ctrl 并/差集）
     if (!App.selectedRouteIds) App.selectedRouteIds = new Set();
     const rid = link.id || link._uid;
     const ctrlLike = !!(App.uiPref?.route || App.modKeys?.ctrl || App.modKeys?.meta);
     if (rid) {
       if (ctrlLike) {
         if (App.selectedRouteIds.has(rid)) App.selectedRouteIds.delete(rid);
         else App.selectedRouteIds.add(rid);
       } else {
         App.selectedRouteIds.clear();
         App.selectedRouteIds.add(rid);
       }
     }
 
     if (typeof recomputePersistentFromRoutes === 'function') {
       recomputePersistentFromRoutesPreservingExtras();
     }
 
     drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, false);
     updateHexStyles();
     publishToStepAnalysis();

  }


  function cancelRouteDraft() {
    App.routeDraft = null;
    App.flightStart = null;
    drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, false);
    updateHexStyles();
    publishToStepAnalysis();
  }

  function handleDoubleClick(panelIdx, q, r, event) {
    const here = { panelIdx, q, r };

    // ① 第一次双击：设起点 + 进入预览（不写入持久选集）
    if (!App.flightStart && !App.flightDraft) {
      App.flightStart = here;
      const rect = App.playgroundEl.getBoundingClientRect();
      App.currentMouse.x = event.clientX - rect.left;
      App.currentMouse.y = event.clientY - rect.top;

      updateHexStyles();
      drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, true);
      publishToStepAnalysis();
      return;
    }

    // ② 双击“当前端点” => 结束构建（不清已建内容）
    const sameAsStart =
      App.flightStart &&
      App.flightStart.panelIdx === panelIdx &&
      App.flightStart.q === q &&
      App.flightStart.r === r;

    if (sameAsStart && App.flightDraft) {
      const d = App.flightDraft;

      // （保险）若当前端点未写入 path，则补上
      const last = d.path[d.path.length - 1];
      if (!(last.panelIdx === here.panelIdx && last.q === here.q && last.r === here.r)) {
        d.path.push(here);
      }

       // ★ 选中整条新建航线（路线级）——支持 Ctrl 并/差集
       const rid = (typeof linkKey === 'function') ? linkKey(d) : (d.id || d._uid);
       if (!App.selectedRouteIds) App.selectedRouteIds = new Set();
       const ctrlLike = !!(event?.ctrlKey || event?.metaKey || App.uiPref?.route || App.modKeys?.ctrl || App.modKeys?.meta);
       if (rid) {
         if (ctrlLike) {
           if (App.selectedRouteIds.has(rid)) App.selectedRouteIds.delete(rid);
           else App.selectedRouteIds.add(rid);
         } else {
           App.selectedRouteIds.clear();
           App.selectedRouteIds.add(rid);
         }
       }

      App.lastSelectionKind = 'route';

      // ★ 清理预览/hover/单点残留，避免端点常亮
      App.highlightedHexKeys?.clear?.();
      App.hoveredHex = null;
      App.selectedHex = null;
      App.flightHoverTarget = null;  // ← 关键：清掉航线 hover 目标
      // 结束构建状态
      App.flightStart = null;
      App.flightDraft = null;

      // ★ 路线→节点：由路线级回填持久选集并统一重绘
      if (typeof recomputePersistentFromRoutesPreservingExtras === 'function') {
        recomputePersistentFromRoutesPreservingExtras();
      }
      drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, false);
      updateHexStyles();
      if (typeof emitSelectionPayload === 'function') emitSelectionPayload();
      publishToStepAnalysis();
      return;
    }

    // ③ 追加/新建草稿
    if (!App.flightDraft) {
      // 新建一条草稿线：a -> b
      const start = App.flightStart; // 第一次必有
      const uid = 'user-' + Date.now() + '-' + Math.random().toString(36).slice(2);

      const draft = {
        type: 'flight',
        _uid: uid, // 让 buildSplitLinks 把它视作一条线
        panelIdxFrom: start.panelIdx,
        panelIdxTo:   here.panelIdx,
        from: { q: start.q, r: start.r, panelIdx: start.panelIdx },
        to:   { q, r, panelIdx },
        path: [
          { q: start.q, r: start.r, panelIdx: start.panelIdx },
          { q, r, panelIdx }
        ]
      };
      App._lastLinks.push(draft);
      App.flightDraft = draft;
    } else {
      // 已有草稿：把 here 追加为下一跳
      const d = App.flightDraft;
      const last = d.path[d.path.length - 1];
      if (!(last.panelIdx === panelIdx && last.q === q && last.r === r)) {
        d.path.push({ q, r, panelIdx });
        // 同步终点元信息
        d.panelIdxTo = panelIdx;
        d.to = { q, r, panelIdx };
      }
    }

    // ④ 更新“当前端点”为 here，用于下一段预览（拖尾从最新端点出发）
    App.flightStart = here;

    // —— 预览而非落盘：只保留当前端点（可选：也把倒数第二个点做轻微预览） —— //
    // 预览：先清旧再加新（避免 a,b,c... 残留）
    if (App.highlightedHexKeys && typeof pkey === 'function') {
      App.highlightedHexKeys.clear();                     // ★ 关键：不累计
      App.highlightedHexKeys.add(pkey(here.panelIdx, here.q, here.r));
    }

    // 预览继续：已建路径 + 当前端点 → 鼠标
    drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, true);
    updateHexStyles();
    publishToStepAnalysis();
  }


  /* =========================
   * 面板拖拽/尺寸变化/全局事件
   * ========================= */
  function enableSubspaceDrag(subspaceDiv, idxInitial) {
    const title = subspaceDiv.querySelector('.subspace-title');
    let startX, startY, origLeft, origTop;
    let isDragging = false;

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      subspaceDiv.style.left = (origLeft + dx) + 'px';
      subspaceDiv.style.top  = (origTop  + dy) + 'px';
      requestAnimationFrame(() => {
        drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!(App.flightStart || App.flightDraft));
      });
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      document.body.style.userSelect = '';
      const idx = Number(subspaceDiv.dataset.index ?? idxInitial);
      const left = parseFloat(subspaceDiv.style.left || '0');
      const top  = parseFloat(subspaceDiv.style.top  || '0');
      App.panelStates[idx] = { ...(App.panelStates[idx] || {}), left, top, userMoved: true };
    };

    title.addEventListener('mousedown', (e) => {
      if (e.detail === 2) return; // 双击时不拖拽
      if (title.isContentEditable) return;
      isDragging = true;
      startX = e.clientX; startY = e.clientY;
      origLeft = parseFloat(subspaceDiv.style.left || '0');
      origTop  = parseFloat(subspaceDiv.style.top  || '0');
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    const onKeyDownGlobal = (e) => {
      if (e.key === 'Escape') {
        // 先退插入模式
        if (App.insertMode) { endInsertMode(false); }
        // 再退国家聚焦
        if (App.focusCountryId) { setCountryFocus(null); }
      }
      if (e.key === 'Enter')  { if (App.insertMode) endInsertMode(true); }
    };

    document.addEventListener('keydown', onKeyDownGlobal);
    cleanupFns.push(() => document.removeEventListener('keydown', onKeyDownGlobal));


    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    cleanupFns.push(() => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    });
  }

function observePanelResize() {
  App.playgroundEl.querySelectorAll('.subspace').forEach((subspaceDiv) => {
    if (subspaceDiv._resizeObserver) return;
    const ro = new ResizeObserver(() => {
      const idx = Number(subspaceDiv.dataset.index ?? -1);
      const cs = getComputedStyle(subspaceDiv);
      const w = parseFloat(cs.width);
      const h = parseFloat(cs.height);
      if (idx >= 0) {
        const base = App.panelStates[idx] || {};
        // ★ 程序性布局期间只同步宽高，不打“用户”标记
        App.panelStates[idx] = {
          ...base,
          width: w,
          height: h,
          ...(App._squelchResize ? {} : { userResized: true })
        };
      }
      syncContainerHeight(subspaceDiv);
      schedulePanelGeometryRefresh(idx);
    });
    subspaceDiv._resizeObserver = ro;
    ro.observe(subspaceDiv);
    cleanupFns.push(() => ro.disconnect());
  });
}

function schedulePanelGeometryRefresh(panelIdx = null) {
  if (!App._panelGeometryRefreshSet) App._panelGeometryRefreshSet = new Set();
  if (panelIdx == null || panelIdx < 0) {
    (App.currentData?.subspaces || []).forEach((_, i) => App._panelGeometryRefreshSet.add(i));
  } else {
    App._panelGeometryRefreshSet.add(panelIdx);
  }
  if (App._panelGeometryRefreshRaf) return;
  App._panelGeometryRefreshRaf = requestAnimationFrame(() => {
    App._panelGeometryRefreshRaf = null;
    const indices = Array.from(App._panelGeometryRefreshSet || []);
    App._panelGeometryRefreshSet?.clear?.();
    indices.forEach(i => {
      const space = App.currentData?.subspaces?.[i];
      const radius = App.hexRadiusByPanel?.[i] || App.config.hex.radius;
      if (space) renderHexGridFromData(i, space, radius);
    });
    drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!(App.flightStart || App.flightDraft));
    updateHexStyles();
  });
}


  // 确保全局 overlay 有根节点
  ensureOverlayRoot(d3.select(App.globalOverlayEl));

  // 初始化渲染
  function renderSemanticMapFromData(data) {
    App.currentData = data;
    App.baseSemanticData = cloneSemanticData(data);
    App.aggregationRange = DEFAULT_AGGREGATION_RANGE;
    App._lastLinks = data.links || [];
    App._rawHexListByPanel = (data.subspaces || []).map(space =>
      Array.isArray(space.hexList) ? space.hexList.slice() : []
    );
    stampSubspaceNamesOnAllLinks(App._lastLinks);   // ★ 写入子空间名字
    App.countryKeysGlobal = new Map();   // ★ 新增：全量重建前清空

    // ★ 给每条 link 分配稳定 id（若已有 id 则复用，否则生成 _uid）
    let _uidSeq = 0;
    (App._lastLinks || []).forEach(link => {
      if (!link) return;
      if (!link.id) link._uid = `L${_uidSeq++}`;     // 没有 id 用 _uid
    });

    renderPanels(data.subspaces || []);
    (data.subspaces || []).forEach((space, i) => renderHexGridFromData(i, space, App.config.hex.radius));
    drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, false);
    observePanelResize();
    updateHexStyles();
    publishToStepAnalysis();
    ModeUI.computeAndApply({});

    // 初次渲染后
    applyResponsiveLayout(true);

    // after applyResponsiveLayout(true) —— 首轮布局完成后兜底隐藏
    if (!App._didInitialHide && (App.initialHidden ?? true)) {
      App._didInitialHide = true;
      const nodes = App.playgroundEl?.querySelectorAll?.('.subspace');
      if (nodes && nodes.forEach) {
        nodes.forEach(n => (n.style.display = 'none'));
      }
      // 同步隐藏集，确保控制器状态一致
      App.hiddenPanelIdxes = new Set(
        (App.currentData?.subspaces || []).map((_, i) => i)
      );
    }

    const resizeHandler = () => {
      App.globalOverlayEl.setAttribute('width', App.playgroundEl.clientWidth);
      App.globalOverlayEl.setAttribute('height', App.playgroundEl.clientHeight);
      applyResponsiveLayout(false);   // ← 新增：窗口变化时重新排布
      schedulePanelGeometryRefresh();
    };
    window.addEventListener('resize', resizeHandler);
    cleanupFns.push(() => window.removeEventListener('resize', resizeHandler));

    const fullscreenHandler = () => {
      App.globalOverlayEl.setAttribute('width', App.playgroundEl.clientWidth);
      App.globalOverlayEl.setAttribute('height', App.playgroundEl.clientHeight);
      applyResponsiveLayout(false);
      schedulePanelGeometryRefresh();
    };
    document.addEventListener('fullscreenchange', fullscreenHandler);
    cleanupFns.push(() => document.removeEventListener('fullscreenchange', fullscreenHandler));

    const ro = new ResizeObserver(() => {
      App.globalOverlayEl.setAttribute('width', App.playgroundEl.clientWidth);
      App.globalOverlayEl.setAttribute('height', App.playgroundEl.clientHeight);
      applyResponsiveLayout(false);   // ← 新增
      schedulePanelGeometryRefresh();
    });
    ro.observe(App.playgroundEl);
    cleanupFns.push(() => ro.disconnect());
  }

  // 全局鼠标（临时航线）
  const onMouseMoveGlobal = (event) => {
    if (!App.flightStart) return;
    const rect = App.playgroundEl.getBoundingClientRect();
    App.currentMouse.x = event.clientX - rect.left;
    App.currentMouse.y = event.clientY - rect.top;
    drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, true);
    updateHexStyles();
    moveHexTooltip(event.clientX, event.clientY);
  };
  document.addEventListener('mousemove', onMouseMoveGlobal);
  cleanupFns.push(() => document.removeEventListener('mousemove', onMouseMoveGlobal));

  const onWheelCaptureForTooltip = (event) => {
    consumeHexTooltipWheel(event);
  };
  document.addEventListener('wheel', onWheelCaptureForTooltip, { capture: true, passive: false });
  cleanupFns.push(() => document.removeEventListener('wheel', onWheelCaptureForTooltip, { capture: true }));

  // 点击空白：单击 = 清空并回到默认；双击 = 优先处理正在绘制的连线/起点
  const onBlankClick = (e) => {
    if (e.target !== App.playgroundEl) return;

    // —— 双击空白：优先收尾/取消 —— //
    if (e.detail === 2) {
      // 有多跳草稿：≥2 点提交；否则取消
      if (App.routeDraft && Array.isArray(App.routeDraft.path)) {
        if (App.routeDraft.path.length >= 2) {
          commitRouteDraft();   // 生成一条 {type:'flight', path:[...]} link 并 push 到 App._lastLinks
        } else {
          cancelRouteDraft();   // 清空草稿与临时线
        }
        return; // 已处理完，不再复位 UI
      }
      // 仅有旧的一跳临时起点：清掉即可
      if (App.flightStart) {
        App.flightStart = null;
        drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, false);
        updateHexStyles();
        publishToStepAnalysis();
        return; // 不复位 UI，避免用户连线时被强制切回 Group
      }
      // 若无草稿/起点，落回到“单击清空”的逻辑（不 return）
    }

    // —— 单击空白：清空一切临时/选中，并回到默认模式 —— //
    App.selectedHex = null;
    App.neighborKeySet.clear();
    App.selectedRouteIds.clear();
    App.excludedHexKeys.clear();
    App.persistentHexKeys.clear();
    App.highlightedHexKeys.clear();
    drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!App.flightStart);
    App.highlightedHexKeys.clear();
    App.hoveredHex = null;
    updateHexStyles();
    publishToStepAnalysis();

    // UI 复位（仅单击时复位，双击分支已提前 return）
    ModeUI.forceGroupDefault();
  };

  const onBlankDblClick = (e) => {
    if (e.target === App.playgroundEl) {
      App.flightStart = null;
      App.flightDraft = null;
      App.flightHoverTarget = null;

      // 双击空白才取消国家聚焦
      App.focusCountryId = null;
      App.highlightedHexKeys.clear();

      drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, false);
      App.highlightedHexKeys.clear();
      App.panelFocusOverrides.clear();   // 如果不想清，删掉这行

      App.hoveredHex = null;  
      updateHexStyles();
      publishToStepAnalysis();
    }
  };
  App.playgroundEl.addEventListener('click', onBlankClick);
  App.playgroundEl.addEventListener('dblclick', onBlankDblClick);
  cleanupFns.push(() => {
    App.playgroundEl.removeEventListener('click', onBlankClick);
    App.playgroundEl.removeEventListener('dblclick', onBlankDblClick);
  });

  App.globalOverlayEl.setAttribute('width', App.playgroundEl.clientWidth);
  App.globalOverlayEl.setAttribute('height', App.playgroundEl.clientHeight);

  // 主标题：双击可编辑
  if (mainTitleEl) {
    setupInlineEditableTitle(mainTitleEl, {
      getInitial: () => (
        (App.currentData?.title ?? (mainTitleEl.textContent || '').trim()) || 'Semantic Map'
      ),
      placeholder: 'Semantic Map',
      onRename: async (newText) => {
        if (!App.currentData) App.currentData = {};
        App.currentData.title = newText;
        if (typeof App.onMainTitleRename === 'function') {
          await App.onMainTitleRename(newText);
        }
      }
    });
  }

  function setupInlineEditableTitle(el, { getInitial, placeholder, onRename }) {
    if (!el) return;
    el.addEventListener('dblclick', () => {
      // 与 subspace-title 一致：使用 plaintext-only
      el.setAttribute('contenteditable', 'plaintext-only');
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);

      const finish = async (commit = true) => {
        el.removeAttribute('contenteditable');
        if (commit) {
          const txt = (el.textContent || '').trim() || placeholder;
          el.textContent = txt;
          try { await onRename(txt); } catch (e) { console.warn(e); }
        } else {
          el.textContent = getInitial();
        }
      };
      const onBlur = () => finish(true);
      const onKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      };
      el.addEventListener('blur', onBlur, { once: true });
      el.addEventListener('keydown', onKey, { once: true });
    });
  }

  /* =========================
   * 删除子空间（重建索引/连线）
   * ========================= */
  function _rebuildLinksAfterRemove(links, removedIdx) {
    const out = [];
    const touchesRemovedPanel = (value) => Number.isInteger(Number(value)) && Number(value) === removedIdx;
    const remapPanelValue = (value) => {
      const n = Number(value);
      if (!Number.isInteger(n)) return value;
      return n > removedIdx ? n - 1 : n;
    };

    for (const link of links || []) {
      const touchesRemoved =
        touchesRemovedPanel(link.panelIdx) ||
        touchesRemovedPanel(link.panelIdxFrom) ||
        touchesRemovedPanel(link.panelIdxTo) ||
        touchesRemovedPanel(link.from?.panelIdx) ||
        touchesRemovedPanel(link.to?.panelIdx) ||
        (link.path || []).some(p => touchesRemovedPanel(p.panelIdx));

      if (touchesRemoved) continue;

      const copy = JSON.parse(JSON.stringify(link));
      if (copy.panelIdxFrom != null) copy.panelIdxFrom = remapPanelValue(copy.panelIdxFrom);
      if (copy.panelIdxTo != null) copy.panelIdxTo = remapPanelValue(copy.panelIdxTo);
      if (copy.panelIdx != null) copy.panelIdx = remapPanelValue(copy.panelIdx);
      if (copy.from && copy.from.panelIdx != null) copy.from.panelIdx = remapPanelValue(copy.from.panelIdx);
      if (copy.to && copy.to.panelIdx != null) copy.to.panelIdx = remapPanelValue(copy.to.panelIdx);
      if (Array.isArray(copy.path)) {
        copy.path.forEach(p => {
          if (p.panelIdx != null) p.panelIdx = remapPanelValue(p.panelIdx);
        });
      }
      out.push(copy);
    }
    return out;
  }

  function _remapPanelIndexAfterRemove(panelIdx, removedIdx) {
    const n = Number(panelIdx);
    if (!Number.isInteger(n)) return panelIdx;
    if (n === removedIdx) return null;
    return n > removedIdx ? n - 1 : n;
  }

  function _remapPanelKeyAfterRemove(key, removedIdx) {
    const raw = String(key || '');
    const pipeIdx = raw.indexOf('|');
    const colonIdx = raw.indexOf(':');
    const sepIdx = pipeIdx >= 0 ? pipeIdx : colonIdx;
    if (sepIdx <= 0) return raw;

    const panelToken = raw.slice(0, sepIdx);
    const panel = Number(panelToken);
    if (!Number.isInteger(panel)) return raw;

    const nextPanel = _remapPanelIndexAfterRemove(panel, removedIdx);
    if (nextPanel == null) return null;
    return `${nextPanel}|${raw.slice(sepIdx + 1)}`;
  }

  function _remapPanelKeySetAfterRemove(set, removedIdx) {
    const out = new Set();
    if (!set || typeof set.forEach !== 'function') return out;
    set.forEach(k => {
      const next = _remapPanelKeyAfterRemove(k, removedIdx);
      if (next != null) out.add(next);
    });
    return out;
  }

  function _remapPanelIndexSetAfterRemove(set, removedIdx) {
    const out = new Set();
    if (!set || typeof set.forEach !== 'function') return out;
    set.forEach(panelIdx => {
      const next = _remapPanelIndexAfterRemove(panelIdx, removedIdx);
      if (next != null) out.add(next);
    });
    return out;
  }

  function _remapAlphaByKeyAfterRemove(alphaByKey, removedIdx) {
    const out = new Map();
    if (alphaByKey instanceof Map) {
      alphaByKey.forEach((value, key) => {
        const next = _remapPanelKeyAfterRemove(key, removedIdx);
        if (next != null) out.set(next, value);
      });
      return out;
    }
    if (alphaByKey && typeof alphaByKey === 'object') {
      Object.entries(alphaByKey).forEach(([key, value]) => {
        const next = _remapPanelKeyAfterRemove(key, removedIdx);
        if (next != null) out.set(next, value);
      });
    }
    return out;
  }

  function _remapPanelIndexedMapAfterRemove(map, removedIdx, valueMapper = v => v) {
    const out = new Map();
    if (!(map instanceof Map)) return out;
    map.forEach((value, panelIdx) => {
      const nextPanel = _remapPanelIndexAfterRemove(panelIdx, removedIdx);
      if (nextPanel == null) return;
      out.set(nextPanel, valueMapper(value, nextPanel, panelIdx));
    });
    return out;
  }

  function _remapPanelCountryColorsAfterRemove(map, removedIdx) {
    return _remapPanelIndexedMapAfterRemove(map, removedIdx, (countryMap) => {
      const nextCountryMap = new Map();
      if (!(countryMap instanceof Map)) return nextCountryMap;
      countryMap.forEach((rec, cid) => {
        nextCountryMap.set(cid, {
          ...(rec || {}),
          alphaByKey: _remapAlphaByKeyAfterRemove(rec?.alphaByKey, removedIdx)
        });
      });
      return nextCountryMap;
    });
  }

  function _remapPanelConflictColorsAfterRemove(map, removedIdx) {
    return _remapPanelIndexedMapAfterRemove(map, removedIdx, (rec) => ({
      ...(rec || {}),
      alphaByKey: _remapAlphaByKeyAfterRemove(rec?.alphaByKey, removedIdx)
    }));
  }

  function _remapPanelPointAfterRemove(point, removedIdx) {
    if (!point || !Number.isFinite(Number(point.panelIdx))) return point || null;
    const nextPanel = _remapPanelIndexAfterRemove(point.panelIdx, removedIdx);
    if (nextPanel == null) return null;
    return { ...point, panelIdx: nextPanel };
  }

  function _remapLinkDraftAfterRemove(link, removedIdx) {
    if (!link) return null;
    return _rebuildLinksAfterRemove([link], removedIdx)[0] || null;
  }

  function _resetPanelRenderIndexes() {
    App.countryKeysGlobal = new Map();
    App.countryKeysByPanel = [];
    App.coordIndexByPanel = new Map();
    App.hexBucketsByPanel = [];
    App.allHexDataByPanel = [];
    App.hexMapsByPanel = [];
    App.msuAlphaByHex = new Map();
    App.alphaCacheByHex = new Map();
    App.borderCacheByHex = new Map();
    App._hexStyleByKey = new Map();
    App.hsuSummaryCache = new Map();
    App.hsuSummaryPending = new Map();
    App.spacesByPanel = {};
    App.hexRadiusByPanel = {};
    App.scatterTransformByPanel = {};
    App._panelGeometryRefreshSet?.clear?.();
    if (App.hsuSummaryHoverTimer) clearTimeout(App.hsuSummaryHoverTimer);
    App.hsuSummaryHoverTimer = null;
    App.hsuSummaryHoverTarget = null;
    App.hoveredTooltipBucket = null;
  }

function releaseSubspaceSelections(panelIdx) {
  const panel = Number(panelIdx);
  if (!Number.isInteger(panel)) return;

  const keyBelongsToPanel = (key) => {
    const s = String(key || '');
    const [panelStr] = s.split('|');
    return Number(panelStr) === panel;
  };

  const dropKeysOfPanel = (set) => {
    if (!set || typeof set.forEach !== 'function') return;
    Array.from(set).forEach(k => {
      if (keyBelongsToPanel(k)) set.delete(k);
    });
  };

  const linkTouchesPanel = (link) => {
    if (!link) return false;
    if (link.panelIdx === panel || link.panelIdxFrom === panel || link.panelIdxTo === panel) return true;
    const path = Array.isArray(link.path) ? link.path : [];
    return path.some((point, i) => resolvePanelIdxForPathPoint(point, link, i) === panel);
  };

  const removedFlightIds = new Set();
  const outsideKeysToKeep = new Set();
  const collectOutsideKeysFromLink = (link) => {
    const path = Array.isArray(link?.path) ? link.path : [];
    path.forEach((point, i) => {
      const pIdx = resolvePanelIdxForPathPoint(point, link, i);
      if (pIdx !== panel) outsideKeysToKeep.add(pkey(pIdx, point.q, point.r));
    });
  };

  App._lastLinks = (App._lastLinks || []).filter(link => {
    const isFlight = (link?.type || '') === 'flight';
    const remove = isFlight && linkTouchesPanel(link);
    if (remove) {
      const id = linkKey(link);
      if (id && App.selectedRouteIds?.has?.(id)) collectOutsideKeysFromLink(link);
      removedFlightIds.add(id);
    }
    return !remove;
  });
  stampSubspaceNamesOnAllLinks(App._lastLinks);

  if (App.currentData && Array.isArray(App.currentData.links)) {
    App.currentData.links = App._lastLinks;
  }

  Array.from(App.selectedRouteIds || []).forEach(routeId => {
    if (removedFlightIds.has(routeId)) {
      App.selectedRouteIds.delete(routeId);
      return;
    }
    const link = (App._lastLinks || []).find(l => linkKey(l) === routeId);
    if (link && linkTouchesPanel(link)) {
      collectOutsideKeysFromLink(link);
      App.selectedRouteIds.delete(routeId);
    }
  });

  dropKeysOfPanel(App.persistentHexKeys);
  dropKeysOfPanel(App.highlightedHexKeys);
  dropKeysOfPanel(App.excludedHexKeys);
  dropKeysOfPanel(App.selectedEdgeKeys);

  if (App.selectedHex?.panelIdx === panel) App.selectedHex = null;
  if (App.hoveredHex?.panelIdx === panel) App.hoveredHex = null;
  if (App.flightStart?.panelIdx === panel) App.flightStart = null;
  if (App.flightHoverTarget?.panelIdx === panel) App.flightHoverTarget = null;
  if (App.flightDraft && linkTouchesPanel(App.flightDraft)) App.flightDraft = null;

  App._pendingColorEdit = null;
  App._pendingConflictEdit = null;
  App.lastSelectionKind = null;
  App._releaseToggleByPanel?.set?.(panel, false);

  recomputePersistentFromRoutesPreservingExtras();
  outsideKeysToKeep.forEach(key => {
    if (!keyBelongsToPanel(key)) App.persistentHexKeys.add(key);
  });
  drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!(App.flightStart || App.flightDraft));
  updateHexStyles();
  publishToStepAnalysis();
}

function releaseSelectionSnapshot(selection = {}) {
  const nodeKeys = new Set();
  const routeIds = new Set();

  const addPoint = (point) => {
    if (!point || !Number.isFinite(Number(point.panelIdx))) return;
    nodeKeys.add(`${Number(point.panelIdx)}|${point.q},${point.r}`);
  };

  (selection.nodes || []).forEach(addPoint);

  (selection.links || []).forEach(link => {
    const id = link?.baseId || link?.routeId || link?.rawId || link?.id || '';
    if (id) {
      routeIds.add(String(id));
      const parts = String(id).split(':');
      if (parts.length > 1) routeIds.add(parts.slice(1).join(':'));
    }
    (link?.path || []).forEach(addPoint);
    if (link?.from) addPoint(link.from);
    if (link?.to) addPoint(link.to);
  });

  Array.from(App.selectedRouteIds || []).forEach(routeId => {
    const raw = String(routeId);
    const link = findLinkById(raw);
    const pathKeys = new Set();
    (link?.path || []).forEach((point, i) => {
      const panelIdx = resolvePanelIdxForPathPoint(point, link, i);
      pathKeys.add(`${panelIdx}|${point.q},${point.r}`);
    });

    const directMatch = routeIds.has(raw) || routeIds.has(`flight:${raw}`) || routeIds.has(`road:${raw}`) || routeIds.has(`river:${raw}`);
    const pathMatch = pathKeys.size > 0 && Array.from(pathKeys).every(key => nodeKeys.has(key));
    if (directMatch || pathMatch) App.selectedRouteIds.delete(routeId);
  });

  nodeKeys.forEach(key => {
    App.persistentHexKeys?.delete?.(key);
    App.highlightedHexKeys?.delete?.(key);
    App.excludedHexKeys?.delete?.(key);
  });

  recomputePersistentFromRoutesPreservingExtras();
  App.selectedEdgeKeys?.clear?.();
  App.hoveredHex = null;
  App.flightStart = null;
  App.flightDraft = null;
  App.flightHoverTarget = null;
  updateHexStyles();
  drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, false);
  emitSelectionPayload();
  publishToStepAnalysis();
}

function getPanelDomRectState(panelIdx) {
  const node = App.playgroundEl?.querySelector?.(`.subspace[data-index="${panelIdx}"]`);
  const st = App.panelStates?.[panelIdx] || {};
  return {
    left: Number.isFinite(parseFloat(node?.style?.left)) ? parseFloat(node.style.left) : (st.left ?? STYLE.SUBSPACE_DEFAULT_LEFT),
    top: Number.isFinite(parseFloat(node?.style?.top)) ? parseFloat(node.style.top) : (st.top ?? STYLE.SUBSPACE_DEFAULT_TOP),
    width: Number.isFinite(parseFloat(node?.style?.width)) ? parseFloat(node.style.width) : (st.width ?? STYLE.SUBSPACE_MIN_W),
    height: Number.isFinite(parseFloat(node?.style?.height)) ? parseFloat(node.style.height) : (st.height ?? STYLE.SUBSPACE_MIN_H),
    zoom: st.zoom
  };
}

function findDuplicatePanelState(srcIdx, newIndex) {
  const srcState = getPanelDomRectState(srcIdx);
  const gap = STYLE.SUBSPACE_GAP;
  const step = 28;
  let left = srcState.left + step;
  let top = srcState.top + step;
  const existing = Array.from(App.playgroundEl?.querySelectorAll?.('.subspace') || [])
    .map(node => ({
      left: parseFloat(node.style.left || '0'),
      top: parseFloat(node.style.top || '0'),
      width: parseFloat(node.style.width || STYLE.SUBSPACE_MIN_W),
      height: parseFloat(node.style.height || STYLE.SUBSPACE_MIN_H)
    }));

  const overlaps = (a, b) =>
    a.left < b.left + b.width + gap &&
    a.left + a.width + gap > b.left &&
    a.top < b.top + b.height + gap &&
    a.top + a.height + gap > b.top;

  const candidate = () => ({ left, top, width: srcState.width, height: srcState.height });
  for (let i = 0; i < 24 && existing.some(rect => overlaps(candidate(), rect)); i++) {
    left += step;
    top += step;
  }

  if (existing.some(rect => overlaps(candidate(), rect))) {
    const maxBottom = existing.reduce((m, rect) => Math.max(m, rect.top + rect.height), STYLE.SUBSPACE_DEFAULT_TOP);
    left = STYLE.SUBSPACE_DEFAULT_LEFT + (newIndex % 3) * (srcState.width + gap);
    top = maxBottom + gap;
  }

  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
    width: srcState.width,
    height: srcState.height,
    zoom: srcState.zoom,
    userMoved: true,
    userResized: true
  };
}

function updatePlaygroundBoundsForPanels() {
  const nodes = Array.from(App.playgroundEl?.querySelectorAll?.('.subspace') || []);
  let maxRight = App.playgroundEl?.clientWidth || 0;
  let maxBottom = App.playgroundEl?.clientHeight || 0;
  nodes.forEach(node => {
    const left = parseFloat(node.style.left || '0');
    const top = parseFloat(node.style.top || '0');
    const width = parseFloat(node.style.width || STYLE.SUBSPACE_MIN_W);
    const height = parseFloat(node.style.height || STYLE.SUBSPACE_MIN_H);
    maxRight = Math.max(maxRight, left + width + STYLE.SUBSPACE_GAP);
    maxBottom = Math.max(maxBottom, top + height + STYLE.SUBSPACE_GAP);
  });
  if (App.playgroundEl?.style) {
    App.playgroundEl.style.minWidth = `${Math.max(maxRight, App.playgroundEl.clientWidth || 0)}px`;
    App.playgroundEl.style.minHeight = `${Math.max(maxBottom, App.playgroundEl.clientHeight || 0)}px`;
  }
  App.globalOverlayEl?.setAttribute?.('width', Math.max(maxRight, App.playgroundEl?.clientWidth || 0));
  App.globalOverlayEl?.setAttribute?.('height', Math.max(maxBottom, App.playgroundEl?.clientHeight || 0));
}

function _duplicateSubspaceByIndex(srcIdx) {
  if (!App.currentData?.subspaces?.[srcIdx]) return;
  const src = App.currentData.subspaces[srcIdx];

  // 1) 深拷贝整个子空间（包含 hexList & countries）
  const cloned = JSON.parse(JSON.stringify(src));

  // ★ 在标题后追加 Copy
  cloned.subspaceName = (src.subspaceName || `Subspace${srcIdx}`) + ' Copy';

  // 2) 挂到数据上
  const newIndex = App.currentData.subspaces.length;
  App.currentData.subspaces.push(cloned);
  if (App.baseSemanticData?.subspaces?.[srcIdx]) {
    const baseClone = JSON.parse(JSON.stringify(App.baseSemanticData.subspaces[srcIdx]));
    baseClone.subspaceName = cloned.subspaceName;
    App.baseSemanticData.subspaces.push(baseClone);
  }

  // Copy layout mode from source panel
  setPanelLayoutMode(newIndex, getPanelLayoutMode(srcIdx));
  App.panelStates[newIndex] = findDuplicatePanelState(srcIdx, newIndex);

  // 3) 渲染这个新面板
  createSubspaceElement(cloned, newIndex);
  renderHexGridFromData(newIndex, cloned, App.config.hex.radius);
  refreshColorOverridesForCurrentAggregation();

  // ★ 新增：复制出来的面板 Alt 只影响自己
  App.altIsolatedPanels.add(newIndex);
  // ★ 新增：给该面板准备本地聚焦容器
  App.panelFocusOverrides.set(newIndex, { countryId: null, mode: null });

  // 4) 正常刷新
  drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!App.flightStart);
  updateHexStyles();
  observePanelResize();
  updatePlaygroundBoundsForPanels();
  emitSemanticColorSnapshot();
  publishToStepAnalysis();
}

function _deleteSubspaceByIndex(idx) {
  if (!App.currentData || !Array.isArray(App.currentData.subspaces)) return;
  if (idx < 0 || idx >= App.currentData.subspaces.length) return;
  const removedIdx = Number(idx);

  // ★ 保存滚动位置
  const scroller = App.playgroundEl.closest('.mv-scroller') || App.playgroundEl.parentElement;
  const prevTop  = scroller ? scroller.scrollTop  : 0;
  const prevLeft = scroller ? scroller.scrollLeft : 0;

  // 1) 删除数据与状态
  App.currentData.subspaces.splice(removedIdx, 1);
  if (Array.isArray(App.currentData.links)) {
    App.currentData.links = _rebuildLinksAfterRemove(App.currentData.links, removedIdx);
  }
  if (App.baseSemanticData && Array.isArray(App.baseSemanticData.subspaces)) {
    App.baseSemanticData.subspaces.splice(removedIdx, 1);
    if (Array.isArray(App.baseSemanticData.links)) {
      App.baseSemanticData.links = _rebuildLinksAfterRemove(App.baseSemanticData.links, removedIdx);
    }
  }
  App.panelStates.splice(removedIdx, 1);
  App.zoomStates.splice(removedIdx, 1);
  if (Array.isArray(App.panelLayoutMode)) App.panelLayoutMode.splice(removedIdx, 1);
  if (Array.isArray(App._rawHexListByPanel)) App._rawHexListByPanel.splice(removedIdx, 1);

  // 2) 重建连线
  App._lastLinks = _rebuildLinksAfterRemove(App._lastLinks, removedIdx);
  App.currentData.links = App._lastLinks;
  stampSubspaceNamesOnAllLinks(App._lastLinks);   // ★ 重建后也写入

  const liveRouteIds = new Set((App._lastLinks || []).map(link => linkKey(link)).filter(Boolean));
  App.selectedRouteIds = new Set(
    Array.from(App.selectedRouteIds || []).filter(id => liveRouteIds.has(id))
  );

  App.persistentHexKeys  = _remapPanelKeySetAfterRemove(App.persistentHexKeys, removedIdx);
  App.highlightedHexKeys = _remapPanelKeySetAfterRemove(App.highlightedHexKeys, removedIdx);
  App.excludedHexKeys    = _remapPanelKeySetAfterRemove(App.excludedHexKeys, removedIdx);
  App.selectedEdgeKeys   = _remapPanelKeySetAfterRemove(App.selectedEdgeKeys, removedIdx);

  App.panelCountryColors  = _remapPanelCountryColorsAfterRemove(App.panelCountryColors, removedIdx);
  App.panelConflictColors = _remapPanelConflictColorsAfterRemove(App.panelConflictColors, removedIdx);
  App.panelFocusOverrides = _remapPanelIndexedMapAfterRemove(App.panelFocusOverrides, removedIdx);
  App._releaseToggleByPanel = _remapPanelIndexedMapAfterRemove(App._releaseToggleByPanel, removedIdx);
  App.altIsolatedPanels = _remapPanelIndexSetAfterRemove(App.altIsolatedPanels, removedIdx);
  if (App.hiddenPanelIdxes) {
    App.hiddenPanelIdxes = _remapPanelIndexSetAfterRemove(App.hiddenPanelIdxes, removedIdx);
  }

  App.selectedHex = _remapPanelPointAfterRemove(App.selectedHex, removedIdx);
  App.hoveredHex = _remapPanelPointAfterRemove(App.hoveredHex, removedIdx);
  App.flightStart = _remapPanelPointAfterRemove(App.flightStart, removedIdx);
  App.flightHoverTarget = _remapPanelPointAfterRemove(App.flightHoverTarget, removedIdx);
  App.flightDraft = _remapLinkDraftAfterRemove(App.flightDraft, removedIdx);
  App.routeDraft = _remapLinkDraftAfterRemove(App.routeDraft, removedIdx);
  App._pendingColorEdit = null;
  App._pendingConflictEdit = null;

  _resetPanelRenderIndexes();

  // 3) 全量重绘
  renderPanels(App.currentData.subspaces || []);
  (App.currentData.subspaces || []).forEach((space, i) => {
    renderHexGridFromData(i, space, App.config.hex.radius);
  });
  recomputeMsuAlphaForAllPanels();
  refreshColorOverridesForCurrentAggregation();
  if (App.selectedRouteIds && App.selectedRouteIds.size > 0) {
    recomputePersistentFromRoutesPreservingExtras();
  }
  drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!(App.flightStart || App.flightDraft));
  updateHexStyles();
  observePanelResize();
  emitSemanticColorSnapshot();

  publishToStepAnalysis();

  // 删除后只更新画布边界，不强制重排其它子空间，保留用户当前布局。
  updatePlaygroundBoundsForPanels();

  // ★ 恢复滚动位置（下一帧，待高度稳定后）
  requestAnimationFrame(() => {
    if (scroller) scroller.scrollTo({ top: prevTop, left: prevLeft, behavior: 'auto' });
  });
}


  /* =========================
   * 对外 API
   * ========================= */
  controller = {
    cleanup() {
      cleanupFns.forEach(fn => fn && fn());
      const colorMenu = document.getElementById('alt-color-menu');
      if (colorMenu?.dataset?.semanticMapOwner === App.instanceId) {
        colorMenu.remove();
      }
      d3.select(App.globalOverlayEl).selectAll('*').remove();
      App.playgroundEl.querySelectorAll('.subspace').forEach(n => n.remove());
    },
    addSubspace(space = {}) {
      if (!App.currentData) App.currentData = { subspaces: [], links: [] };
      const newIndex = App.currentData.subspaces.length;
      // Default layout mode for new subspace
      setPanelLayoutMode(newIndex, 'hex');


      if (!Array.isArray(App.panelStates)) App.panelStates = [];
      App.panelStates.push({});

      const newSpace = {
        subspaceName: space.subspaceName || `Subspace ${newIndex + 1}`,
        hexList: Array.isArray(space.hexList) ? space.hexList : [],
        countries: Array.isArray(space.countries) ? space.countries : []
      };
      App.currentData.subspaces.push(newSpace);

      // ★ 保存“原始 hexList”（未去重）
      if (!Array.isArray(App._rawHexListByPanel)) App._rawHexListByPanel = [];
      App._rawHexListByPanel[newIndex] = Array.isArray(newSpace.hexList) ? newSpace.hexList.slice() : [];

      createSubspaceElement(newSpace, newIndex);
      renderHexGridFromData(newIndex, newSpace, App.config.hex.radius);

      // 可选：预建一次坐标索引
      ensureCoordIndex(newIndex);

      drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!App.flightStart);
      updateHexStyles();
      observePanelResize();
      applyResponsiveLayout(true);
    },
    setOnSubspaceRename(fn) {
      App.onSubspaceRename = typeof fn === 'function' ? fn : null;
    },
    deleteSubspace(idx) {
      _deleteSubspaceByIndex(idx);
    },
    duplicateSubspace(idx) { 
      _duplicateSubspaceByIndex(idx); 
    },
    setOnMainTitleRename(fn) {
      App.onMainTitleRename = typeof fn === 'function' ? fn : null;
    },
    setCountryIdAlias(aliasObj = {}) {
      App.countryIdAlias = new Map(Object.entries(aliasObj || {}));
      // 重新基于现有渲染数据构建索引，让别名立刻生效
      (App.currentData?.subspaces || []).forEach((space, i) => {
        renderHexGridFromData(i, space, App.config.hex.radius);
      });
      updateHexStyles();
    },
    setAggregationRange(range) {
      applyAggregationRange(range);
    },
    getAggregationRange() {
      return App.aggregationRange || DEFAULT_AGGREGATION_RANGE;
    },

    /**
     * 当前聚合尺度下，一个 HSU 连同其六个相邻格所包含的 MSU 数（中位数）。
     * 该值即用户一次读图所考察的语义邻域规模，随语料与尺度动态变化。
     * 返回 { neighborhood, perHsu, hsuCount } ；数据未就绪时返回 null。
     */
    getNeighborhoodSize(panelIdx = null) {
      try {
        // 未指定面板时，取第一个已有数据的面板；避免面板 0 尚未就绪导致取不到值
        let idx = null;
        if (panelIdx === null) {
          const n = (App.currentData?.subspaces || []).length || 1;
          for (let i = 0; i < n; i++) {
            const cand = ensureCoordIndex(i);
            if (cand && cand.size > 0) { idx = cand; break; }
          }
        } else {
          idx = ensureCoordIndex(panelIdx);
        }
        if (!idx || idx.size === 0) return null;

        // 每格 MSU 数：同一 (q,r) 下可能有多条来源记录，按 msu_ids 累加
        const counts = new Map();
        idx.forEach((arr, key) => {
          let n = 0;
          for (const it of arr) {
            const ids = it && Array.isArray(it.msu_ids) ? it.msu_ids : null;
            n += ids ? ids.length : 1;
          }
          if (n > 0) counts.set(key, n);
        });
        if (counts.size === 0) return null;

        const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
        const perHsu = [];
        const neigh = [];
        counts.forEach((n, key) => {
          const [q, r] = key.split(',').map(Number);
          if (!Number.isFinite(q) || !Number.isFinite(r)) return;
          let tot = n;
          for (const [dq, dr] of NB) tot += counts.get(`${q + dq},${r + dr}`) || 0;
          perHsu.push(n);
          neigh.push(tot);
        });
        if (!neigh.length) return null;

        const median = (a) => {
          const v = a.slice().sort((x, y) => x - y);
          const m = v.length >> 1;
          return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
        };
        return {
          neighborhood: median(neigh),
          perHsu: median(perHsu),
          hsuCount: counts.size,
        };
      } catch (e) {
        return null;
      }
    },

    pulseSelection() { publishToStepAnalysis(); },
    releaseSelectionSnapshot(selection) {
      releaseSelectionSnapshot(selection);
    },
    getSelectionSnapshot() {
      // 1) 先取“路线级快照”（若有选择）
      const hasRouteSel = App.selectedRouteIds && App.selectedRouteIds.size > 0;
      const routeSnap = hasRouteSel
        ? snapshotFromSelectedRoutes()
        : { nodes: [], links: [] };

      // 2) 计算需要并入的“额外点集”(extras) = persistentHexKeys - (路线已包含的节点)
      const keySetBase =
        (App.persistentHexKeys && App.persistentHexKeys.size)
          ? App.persistentHexKeys
          : App.highlightedHexKeys;
      const baseSet = new Set(keySetBase || []);

      let extrasSet = baseSet;
      if (hasRouteSel && Array.isArray(routeSnap?.nodes)) {
        const inRoute = new Set(
          routeSnap.nodes.map(n => `${n.panelIdx}|${n.q},${n.r}`)
        );
        extrasSet = new Set([...baseSet].filter(k => !inRoute.has(String(k))));
      }

      // 3) 用 keySet 切段，拿到额外的节点+边（含“孤点”→single）
      const extrasSnap = snapshotFromKeySet(extrasSet || new Set());

      // 4) 合并并去重（节点按 node.id 去重；边简单拼接即可，
      //    extrasSnap 已经是从 keySet 切段生成，不会跟 routeSnap.links 冲突）
      const nodeById = new Map();
      (routeSnap.nodes || []).forEach(n => nodeById.set(n.id, n));
      (extrasSnap.nodes || []).forEach(n => nodeById.set(n.id, n));

      const nodes = [...nodeById.values()];
      const links = [...(routeSnap.links || []), ...(extrasSnap.links || [])];

      // 5) meta
      const focusId = App.selectedHex
        ? `${App.selectedHex.panelIdx}:${App.selectedHex.q},${App.selectedHex.r}`
        : null;
      const mini = _buildMiniSnapshot();

      const panelNamesByIndex = getSubspaceNameMap();
      links.forEach(link => {
        if (link && !link.panelNamesByIndex) link.panelNamesByIndex = { ...panelNamesByIndex };
      });
      return { nodes, links, panelNamesByIndex, meta: { focusId, miniPalette: mini, panelNamesByIndex } };
    },



      // ✅ 单独提供 getMiniColorMaps 给 MainView.vue 用
      getMiniColorMaps() {
        return _buildMiniSnapshot();
      },

      setSourceColor(countryOrSource, color) {
        const source = (countryOrSource && typeof countryOrSource === 'object')
          ? countryOrSource
          : { countryId: countryOrSource };
        return applySourceColorFromGallery({ ...source, color });
      },

      // 可选
      getCountryIdNormalizer() {
        return (cid) => App.countryIdAlias?.get?.(cid) || cid;
      },

      // ★ FIX: 通过坐标直接拿该格完整信息
      // ★ 改为“按 bucket 聚合”的版本：冲突格返回并集（不再只取最上层 country）
      // ★ 通过坐标拿该格“并集版”详情（含每国分组与 MSU 并集）
      getHexDetail(panelIdx, q, r) {
        // 先试用多路兜底聚合器（你文件中已有 _gatherAt；若不存在就用 getBucketSafe）
        const agg = (typeof _gatherAt === 'function') ? _gatherAt(panelIdx, q, r) : null;
        if (agg && agg.items && agg.items.length) {
          const modality   = agg.representative.modality;
          const label      = agg.representative.label;
          const country_id = (agg.countries.size === 1) ? Array.from(agg.countries)[0] : null;
          const msu_ids    = agg.merged_msu_ids;
          const msu        = (typeof resolveMSUs === 'function') ? resolveMSUs(msu_ids) : msu_ids;
          const groups     = Array.from(agg.groupsMap.entries()).map(([cid, g]) => ({
            country_id: cid,
            items: g.items,
            msu_ids: g.msu_ids,
            msu: (typeof resolveMSUs === 'function') ? resolveMSUs(g.msu_ids) : g.msu_ids
          }));
          return { panelIdx, q, r, modality, country_id, label, msu_ids, msu, groups, conflict: agg.countries.size > 1 };
        }

        if (App.visibleCountries) return null;

        // 兜底：单条顶层
        const hex = App.hexMapsByPanel?.[panelIdx]?.get(`${q},${r}`);
        if (!hex) return null;
        const msu_ids = Array.isArray(hex.msu_ids) ? hex.msu_ids : [];
        const msu = (typeof resolveMSUs === 'function') ? resolveMSUs(msu_ids) : msu_ids;
        return {
          panelIdx, q, r,
          modality: hex.modality || '',
          country_id: hex.country_id || null,
          label: hex.label || `${q},${r}`,
          msu_ids, msu,
          groups: [],
          conflict: false
        };
      },

      // ★ FIX: 设置点击回调
      setOnHexClick(fn) {
        App.onHexClick = (typeof fn === 'function') ? fn : null;
      },

      // ① 给右侧卡片或外部调用：取当前的颜色映射快照
      getColorMaps() {
        return _buildColorMapsSnapshot();
      },

      // ②（可选）暴露基础填充，做兜底
      getBaseFillColors() {
        return {
          text:   App.config?.hex?.textFill   || '#DCDCDC',
          image:  App.config?.hex?.imageFill  || '#DCDCDC',
          def:    App.config?.background      || '#ffffff'
        };
      },

      // === 查询能力 ===
      getSubspaceCount() {
        return (App?.currentData?.subspaces || []).length;
      },
      getSubspaceNames() {
        const arr = App?.currentData?.subspaces || [];
        return arr.map((s, i) => (s?.subspaceName || s?.title || `Subspace ${i}`));
      },
      
      // === 显隐控制（重写/新增） ===
      hideAllSubspaces() {
        const nodes = App.playgroundEl.querySelectorAll('.subspace');
        nodes.forEach(n => n.style.display = 'none');

        // 清空全局连线/样式（避免空白时残留）
        drawOverlayLinesFromLinks([], App.allHexDataByPanel, App.hexMapsByPanel, false);
        updateHexStyles?.();
        applyResponsiveLayout?.(true);
      },

      // === gallery 选论文联动：仅显示选中论文(country)，冲突区随选择重算；空/未选 = 显示全部 ===
      setVisibleCountries(ids) {
        if (Array.isArray(ids) && ids.length) {
          App.visibleCountries = new Set(ids.map(c => normalizeCountryId(String(c))));
        } else {
          App.visibleCountries = null;   // null = 显示全部
        }
        refreshAfterVisibleCountriesChange();
        return { handled: true };
      },

      /**
       * 根据名字数组，返回应显示的 panel 索引（支持多名字、模糊、别名）
       * @param {string[]} names
       * @returns {number[]}
       */
      findSubspaceIndicesByNames(names = []) {
        const queries = (Array.isArray(names) ? names : [names])
          .map(__normalize).filter(Boolean);
        if (!queries.length) return [];

        // 1) 标题来源：优先用 DOM（用户可编辑），退回数据模型
        const titlesDom = __getDomTitles().map(__normalize);
        const titlesData = (this.getSubspaceNames?.() || [])
          .map(__normalize);

        // 做一份候选（索引与 label）
        const maxLen = Math.max(titlesDom.length, titlesData.length);
        const candidates = [];
        for (let i = 0; i < maxLen; i++) {
          const lbl = titlesDom[i] || titlesData[i] || '';
          candidates.push({ i, label: lbl });
        }

        const picked = new Set();

        // Pass 0: 完全相等
        queries.forEach(q => {
          candidates.forEach(c => { if (c.label === q) picked.add(c.i); });
        });

        // Pass 1: 包含 / 前缀（长度>=3再做，避免太松）
        queries.forEach(q => {
          if (q.length < 3) return;
          candidates.forEach(c => {
            if (picked.has(c.i)) return;
            if (c.label.includes(q) || c.label.startsWith(q)) picked.add(c.i);
          });
        });

        // Pass 2: 别名匹配
        queries.forEach(q => {
          const canons = __aliasReverse.get(q) || new Set([q]); // q 可能本身就是 canon
          candidates.forEach(c => {
            if (picked.has(c.i)) return;
            for (const canon of canons) {
              const aset = __aliasCanon.get(canon) || new Set([canon]);
              if (aset.has(c.label)) { picked.add(c.i); break; }
              // alias 集内的包含匹配
              for (const a of aset) { if (a.length >= 3 && c.label.includes(a)) { picked.add(c.i); break; } }
            }
          });
        });

        // Pass 3: 轻微拼写错误（编辑距离 ≤ 1）
        queries.forEach(q => {
          candidates.forEach(c => {
            if (picked.has(c.i)) return;
            if (__lev1(q, c.label) <= 1) picked.add(c.i);
          });
        });

        return Array.from(picked.values()).sort((a, b) => a - b);
      },

      /**
       * 只显示给定索引的子空间（支持 0~N 个；空数组=全隐藏）
       * @param {number[]} indices
       * @param {{reflow?: boolean}} opts
       */
      showOnlySubspaces(indices = [], opts = { reflow: true }) {
        const set = new Set(indices || []);
        const nodes = App.playgroundEl.querySelectorAll('.subspace');

        // ⭐ 兜底：若渲染阶段没打上 data-index，这里补齐（防止全显/全隐）
        nodes.forEach((n, i) => {
          if (!n.dataset.index) n.dataset.index = String(i);
        });

        nodes.forEach(n => {
          const idx = Number(n.dataset.index || -1);
          n.style.display = (set.size > 0 && set.has(idx)) ? '' : 'none';
          n.dataset.visible = (set.size > 0 && set.has(idx)) ? '1' : '0';
        });

        // 只针对可见面板重绘连线/样式
        const links = (App._lastLinks || []); // 如需按 panel 过滤，可在此结合 indices 处理
        drawOverlayLinesFromLinks(links, App.allHexDataByPanel, App.hexMapsByPanel, !!(App.flightStart || App.flightDraft));
        updateHexStyles?.();
        if (opts.reflow) applyResponsiveLayout?.(true);
      },

      /**
       * 显示全部子空间
       * @param {{reflow?: boolean}} opts
       */
      showAllSubspaces(opts = { reflow: true }) {
        const nodes = App.playgroundEl.querySelectorAll('.subspace');
        nodes.forEach(n => {
          n.style.display = '';
          n.dataset.visible = '1';
        });

        drawOverlayLinesFromLinks(App._lastLinks, App.allHexDataByPanel, App.hexMapsByPanel, !!(App.flightStart || App.flightDraft));
        updateHexStyles?.();
        if (opts.reflow) applyResponsiveLayout?.(true);
      },


      // === 批量删除（按名或索引）===
      deleteSubspacesByNameOrIdx(targets = []) {
        if (!targets?.length) return;
        const names = this.getSubspaceNames();
        const toIdx = new Set();
        for (const t of targets) {
          if (typeof t === 'number' && Number.isFinite(t)) {
            toIdx.add(t);
          } else {
            const k = String(t).trim().toLowerCase();
            names.forEach((nm, i) => { if (nm.toLowerCase() === k) toIdx.add(i); });
          }
        }
        // 注意：从后往前删，避免索引位移
        [...toIdx].sort((a,b)=>b-a).forEach(i => _deleteSubspaceByIndex(i));
      }

  };

  // —— 首次渲染 & 初始显隐 —— //
  renderSemanticMapFromData(initialData || defaultData);
  if (App.initialHidden) {
    controller.hideAllSubspaces();
  } else {
    controller.showAllSubspaces({ reflow: true });
  }

  // === 暴露控制器 & 广播就绪 ===
  // —— 暴露控制器 & 广播就绪 —— //
  window.SemanticMapCtrl = controller;
  window.dispatchEvent(new CustomEvent('semanticMap:ready'));
  return controller;
}

export function destroySemanticMap(cleanup) {
  if (typeof cleanup === 'function') cleanup();
}

function renderMarkdownSafe(md) {
  if (!md) return '';
  // parseInline 适合 tooltip 这种短文本；如果你有多段落再用 marked.parse
  const unsafeHtml = marked.parseInline(md);
  // 清洗，避免 XSS
  return DOMPurify.sanitize(unsafeHtml, {
    USE_PROFILES: { html: true }
  });
}

/* === Spotlight: fade unrelated hexes when a selection exists === */
function applySpotlight(panelIdx) {

  try {
    const A = (typeof App!=='undefined' && App) || (typeof window!=='undefined' && window.App) || (typeof globalThis!=='undefined' && globalThis.App) || {};
    const S = (typeof STYLE!=='undefined' && STYLE) || {};
    const svg = A.subspaceSvgs ? A.subspaceSvgs[panelIdx] : null;
    if (!svg) return;

    const hasPersistent = !!(A.persistentHexKeys && A.persistentHexKeys.size > 0);
    const hasPreview    = !!(A.highlightedHexKeys && A.highlightedHexKeys.size > 0);
    const spotlightOn   = hasPersistent || hasPreview;
    if (!spotlightOn) return;

    svg.selectAll('g.hex').each(function(d) {
      const gSel = d3.select(this);
      const path = gSel.select('path');
      const key  = `${panelIdx}|${d.q},${d.r}`;
      const inSpot = !!( (hasPersistent && A.persistentHexKeys.has(key)) || (hasPreview && A.highlightedHexKeys.has(key)) );

      if (!inSpot) {
        const baseGray = (S.HEX_FILL_TEXT || S.HEX_FILL_DEFAULT || '#DCDCDC');
        const fade = (typeof S.OPACITY_ALT_FADE === 'number') ? S.OPACITY_ALT_FADE : 0.08;
        path.attr('fill', baseGray);
        path.attr('fill-opacity', fade);
        path.attr('stroke-opacity', 0);
      } else {
        if (A._pendingConflictEdit) {
          const w = (S.HEX_BORDER_WIDTH || 1.2) * 1.6;
          path.attr('stroke-opacity', 1).attr('stroke-width', w);
        }
      }
    });

    // Optional edges
    svg.selectAll('path.edge').attr('opacity', function(){
      const id = d3.select(this).attr('data-edge-key');
      return (A.selectedEdgeKeys && A.selectedEdgeKeys.has(id)) ? 1 : 0.05;
    });
  } catch (e) {
    try { console.warn('[applySpotlight] error:', e); } catch(_){}
  }

}



// === Global contextmenu: confirm color when Alt preview is active (guarded) ===
// @semanticmap_contextmenu_guard
(function(){
  if (typeof document === 'undefined') return;
  document.addEventListener('contextmenu', function(e){
    try {
      const A = (typeof App!=='undefined' && App) || (typeof window!=='undefined' && window.App) || (typeof globalThis!=='undefined' && globalThis.App);
      if (!A) return;
      if (A._pendingConflictEdit || A._pendingColorEdit) {
        e.preventDefault();
        if (typeof showColorMenu === 'function') {
          const init = (A._pendingConflictEdit?.color) || (A._pendingColorEdit?.color) || '#4C78A8';
          showColorMenu(e.clientX||0, e.clientY||0, init);
        }
      }
    } catch(err){ try{console.warn(err);}catch(_){ } }
  }, { capture: true });
})();
