'use strict'
// M1 单测:node test/cell-split.test.js
// 合成用例验证 splitCells/splitGrid 边界;真实素材用例验证 88e22dcf 宫格切 5 帧
const assert = require('node:assert')
const path = require('node:path')
const { splitCells, splitGrid } = require('../lib/cell-split.js')

function makeAlpha(w, h, rects) {
  const a = new Uint8Array(w * h)
  for (const [x, y, rw, rh] of rects) {
    for (let yy = y; yy < y + rh; yy++) {
      for (let xx = x; xx < x + rw; xx++) {
        if (xx >= 0 && xx < w && yy >= 0 && yy < h) a[yy * w + xx] = 255
      }
    }
  }
  return a
}

// 1) 空数据:全透明 → 0 组件,不崩
{
  const r = splitCells(new Uint8Array(100 * 100), 100, 100)
  assert.strictEqual(r.cells.length, 0)
  assert.strictEqual(r.overflow, false)
}

// 2) 单组件 → 1 cell(调用方按单图处理)
{
  const r = splitCells(makeAlpha(100, 100, [[10, 10, 30, 30]]), 100, 100)
  assert.strictEqual(r.cells.length, 1)
  assert.deepStrictEqual([r.cells[0].x, r.cells[0].y, r.cells[0].w, r.cells[0].h], [10, 10, 30, 30])
}

// 3) 行优先排序:第二行左、第二行右、第一行 → 期望 第一行、二左、二右
{
  const r = splitCells(
    makeAlpha(200, 200, [[120, 120, 40, 40], [20, 120, 40, 40], [60, 20, 40, 40]]),
    200,
    200
  )
  assert.deepStrictEqual(
    r.cells.map((c) => [c.x, c.y]),
    [[60, 20], [20, 120], [120, 120]]
  )
}

// 4) 碎块过滤:<1% 面积被丢弃并告警
{
  const r = splitCells(makeAlpha(200, 200, [[10, 10, 60, 60], [150, 150, 3, 3]]), 200, 200)
  assert.strictEqual(r.cells.length, 1)
  assert.ok(r.warnings.some((s) => s.includes('碎块')))
}

// 5) 扁条过滤:宽扁条被丢弃
{
  const r = splitCells(makeAlpha(200, 200, [[10, 10, 60, 60], [100, 100, 90, 6]]), 200, 200)
  assert.strictEqual(r.cells.length, 1)
  assert.ok(r.warnings.some((s) => s.includes('扁条')))
}

// 6) 组件过多 → overflow,cells 为空(调用方回退整图)
{
  const rects = []
  for (let i = 0; i < 14; i++) rects.push([(i % 7) * 28 + 2, ((i / 7) | 0) * 60 + 2, 20, 40])
  const r = splitCells(makeAlpha(200, 200, rects), 200, 200)
  assert.strictEqual(r.overflow, true)
  assert.strictEqual(r.cells.length, 0)
}

// 6b) 近邻合并:2px 间隙的裂开组件(头/身)合并为一帧,远处组件不受影响
{
  const r = splitCells(makeAlpha(200, 200, [[10, 10, 50, 20], [10, 32, 50, 20], [120, 10, 40, 40]]), 200, 200)
  assert.strictEqual(r.cells.length, 2)
  const big = r.cells.find((c) => c.w === 50)
  assert.deepStrictEqual([big.x, big.y, big.w, big.h], [10, 10, 50, 42])
  assert.ok(r.warnings.some((s) => s.includes('合并裂开组件')))
}

// 7) splitGrid:2x2 取 [0,2],格内 alpha 收边(cell2 = 左下格 x∈[0,50), y∈[50,100))
{
  const a = makeAlpha(100, 100, [[10, 10, 20, 20], [10, 60, 20, 20]])
  const r = splitGrid(a, 100, 100, { cols: 2, rows: 2, cells: [0, 2] })
  assert.strictEqual(r.cells.length, 2)
  assert.deepStrictEqual([r.cells[0].x, r.cells[0].y], [10, 10])
  assert.deepStrictEqual([r.cells[1].x, r.cells[1].y], [10, 60])
}

// 8) splitGrid 空单元格 → 保留等分矩形 + 告警
{
  const r = splitGrid(new Uint8Array(100 * 100), 100, 100, { cols: 2, rows: 1 })
  assert.strictEqual(r.cells.length, 2)
  assert.strictEqual(r.cells[0].w, 50)
  assert.ok(r.warnings.length >= 1)
}

// 9) 真实素材:88e22dcf 宫格应切出 5 帧(2+1+1+1)
// nativeImage 只在 electron 运行时可用;纯 node 跑本用例自动跳过
// 完整跑法: npx electron test/cell-split.test.js
{
  const fs = require('node:fs')
  let nativeImage = null
  try {
    nativeImage = require('electron').nativeImage || null
  } catch {
    nativeImage = null
  }
  const p = path.join(__dirname, '..', 'skins', 'default', '.cache', '88e22dcf458a68076efbd9698839e34b.png')
  if (!nativeImage) {
    console.log('skip 真实素材用例:需 electron 运行时(npx electron test/cell-split.test.js)')
  } else if (!fs.existsSync(p)) {
    console.log('skip 真实素材用例:缓存 PNG 不存在,先跑一次 npm start 生成 .cache')
  } else {
    const img = nativeImage.createFromPath(p)
    const { width: w, height: h } = img.getSize()
    const buf = img.toBitmap()
    const alpha = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) alpha[i] = buf[i * 4 + 3]
    const r = splitCells(alpha, w, h)
    console.log(`真实素材 88e22dcf: ${w}x${h} → ${r.cells.length} 帧`, r.warnings)
    assert.strictEqual(r.overflow, false)
    assert.strictEqual(r.cells.length, 5)
  }
}

console.log('cell-split 单测全部通过')
