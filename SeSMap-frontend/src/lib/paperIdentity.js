// Canonical paper identifiers used in the manuscript. `paper_id` in source
// data is a zero-based, case-local storage key, not a manuscript P-number.
const PAPER_IDENTITIES = {
  case1: {
    0: 'P1 — Experimental flame observation',
    1: 'P2 — Large-eddy simulation of combustion dynamics',
    2: 'P3 — TemporalFlowViz'
  },
  case2: {
    0: 'P4 — Compass',
    1: 'P5 — WRF-Chem prediction correction',
    2: 'P6 — Aerosol-model uncertainty analysis',
    3: 'P8 — GeoChron',
    4: 'P7 — VolumeSTCube'
  }
}

function activeProjectId() {
  return typeof window === 'undefined' ? null : window.__activeProjectId
}

/** Return the manuscript-stable label, or null when no mapping is defined. */
export function canonicalPaperLabel(rawMsu, projectId = activeProjectId()) {
  const rawId = rawMsu?.paper_id ?? rawMsu?.paperId
  const paperId = Number(rawId)
  if (!Number.isInteger(paperId)) return null
  return PAPER_IDENTITIES[projectId]?.[paperId] || null
}
