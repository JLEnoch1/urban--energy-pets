'use strict'
// 精灵表切帧:纯函数、零依赖,可直接 node 单测(见 test/cell-split.test.js)
// splitCells:按 alpha 连通域切帧(不规则宫格/散落素材),行优先排序
// splitGrid :按 cols/rows 等分后在格内用 alpha 收边(规则宫格)
// 两者返回 { cells:[{x,y,w,h}], warnings:[], overflow:boolean }
// overflow=true 表示组件数超上限,调用方应回退整图单帧

function splitCells(alpha, w, h, opts) {
  opts = opts || {}
  const minAreaFrac = opts.minAreaFrac == null ? 0.01 : opts.minAreaFrac
  const maxCells = opts.maxCells == null ? 12 : opts.maxCells
  const n = w * h
  const label = new Int32Array(n).fill(-1)
  const comps = []
  const q = new Int32Array(n)
  for (let s = 0; s < n; s++) {
    if (alpha[s] <= 8 || label[s] !== -1) continue
    let qh = 0
    let qt = 0
    q[qt++] = s
    label[s] = comps.length
    let area = 0
    let minX = w
    let minY = h
    let maxX = -1
    let maxY = -1
    while (qh < qt) {
      const p = q[qh++]
      area++
      const x = p % w
      const y = (p / w) | 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const np = yy * w + xx
          if (alpha[np] > 8 && label[np] === -1) {
            label[np] = comps.length
            q[qt++] = np
          }
        }
      }
    }
    comps.push({ area, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 })
  }
  const warnings = []
  const minArea = Math.max(16, minAreaFrac * n)
  let cells = comps.filter((c) => {
    if (c.area < minArea) {
      warnings.push(`丢弃碎块 ${c.w}x${c.h}@${c.x},${c.y}`)
      return false
    }
    const stripH = c.w / Math.max(1, c.h) > 4 && c.h < 0.08 * h
    const stripV = c.h / Math.max(1, c.w) > 4 && c.w < 0.08 * w
    if (stripH || stripV) {
      warnings.push(`丢弃扁条 ${c.w}x${c.h}@${c.x},${c.y}`)
      return false
    }
    return true
  })
  if (cells.length > maxCells) {
    warnings.push(`组件过多 ${cells.length}>${maxCells},回退整图`)
    return { cells: [], warnings, overflow: true }
  }
  if (cells.length <= 1) return { cells, warnings, overflow: false }
  // 近邻合并:浅色毛发被抠图蚀断时(如猫颈),头/身会裂成两个 bbox 相交的组件;
  // bbox 间距 <= pad 视为同一帧合并。并排两帧间距通常远大于 pad,不会误并。
  const pad = Math.max(4, Math.round(0.012 * h))
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i]
        const b = cells[j]
        const hit =
          a.x - pad <= b.x + b.w && b.x - pad <= a.x + a.w &&
          a.y - pad <= b.y + b.h && b.y - pad <= a.y + a.h
        if (!hit) continue
        const x = Math.min(a.x, b.x)
        const y = Math.min(a.y, b.y)
        const x2 = Math.max(a.x + a.w, b.x + b.w)
        const y2 = Math.max(a.y + a.h, b.y + b.h)
        warnings.push(`合并裂开组件 ${a.w}x${a.h} + ${b.w}x${b.h} → ${x2 - x}x${y2 - y}`)
        cells[i] = { x, y, w: x2 - x, h: y2 - y, area: a.area + b.area }
        cells.splice(j, 1)
        merged = true
        break outer
      }
    }
  }
  if (cells.length <= 1) return { cells, warnings, overflow: false }
  // 行聚类:中心 y 相近(阈值=0.5×高度中位数)为同一行,行内按 x 排序
  const hs = cells.map((c) => c.h).sort((a, b) => a - b)
  const medH = hs[hs.length >> 1] || 1
  const cy = (c) => c.y + c.h / 2
  cells = cells.slice().sort((a, b) => cy(a) - cy(b))
  const rows = []
  for (const c of cells) {
    const last = rows[rows.length - 1]
    if (last && Math.abs(cy(c) - last.mean) <= 0.5 * medH) {
      last.items.push(c)
      last.mean = last.items.reduce((s, i) => s + cy(i), 0) / last.items.length
    } else {
      rows.push({ items: [c], mean: cy(c) })
    }
  }
  const ordered = []
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x)
    for (const it of r.items) ordered.push(it)
  }
  return { cells: ordered, warnings, overflow: false }
}

function splitGrid(alpha, w, h, spec) {
  const cols = Math.max(1, spec.cols | 0)
  const rows = Math.max(1, spec.rows | 0)
  const total = cols * rows
  const want =
    Array.isArray(spec.cells) && spec.cells.length
      ? spec.cells.filter((i) => i >= 0 && i < total)
      : Array.from({ length: total }, (_, i) => i)
  const warnings = []
  const cells = []
  for (const idx of want) {
    const cx = idx % cols
    const ry = (idx / cols) | 0
    const x0 = Math.floor((cx * w) / cols)
    const x1 = Math.floor(((cx + 1) * w) / cols)
    const y0 = Math.floor((ry * h) / rows)
    const y1 = Math.floor(((ry + 1) * h) / rows)
    let minX = x1
    let minY = y1
    let maxX = x0
    let maxY = y0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (alpha[y * w + x] > 8) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < minX) {
      warnings.push(`grid 格 ${idx} 为空,保留等分矩形`)
      cells.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
      continue
    }
    cells.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 })
  }
  return { cells, warnings, overflow: false }
}

if (typeof module !== 'undefined') module.exports = { splitCells, splitGrid }
