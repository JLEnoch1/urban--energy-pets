'use strict'
// M3 单测:node test/ledges.test.js
const assert = require('node:assert')
const { filterLedges, screenTopLedge } = require('../lib/ledges.js')

const ctx = {
  workArea: { x: 0, y: 25, width: 1440, height: 875 },
  selfPid: 4242,
}

// 1) 空/异常输入 → 空列表不崩
assert.deepStrictEqual(filterLedges(null, ctx), [])
assert.deepStrictEqual(filterLedges([], ctx), [])
assert.deepStrictEqual(filterLedges([null, {}, { id: 'x' }], ctx), [])

// 2) 正常窗口 → 1 条 ledge
{
  const r = filterLedges([{ id: 1, pid: 10, x: 100, y: 100, w: 800, h: 600, layer: 0 }], ctx)
  assert.strictEqual(r.length, 1)
  assert.strictEqual(r[0].y, 100)
}

// 3) 排除:自身 PID / 非 0 层 / 太窄 / 太矮 / 全屏(y<wa.y) / 贴菜单栏(y-wa.y<4)
{
  const wins = [
    { id: 1, pid: 4242, x: 0, y: 100, w: 800, h: 600, layer: 0 }, // self
    { id: 2, pid: 10, x: 0, y: 100, w: 800, h: 600, layer: 3 }, // 浮层
    { id: 3, pid: 10, x: 0, y: 100, w: 200, h: 600, layer: 0 }, // 窄
    { id: 4, pid: 10, x: 0, y: 100, w: 800, h: 100, layer: 0 }, // 矮
    { id: 5, pid: 10, x: 0, y: 0, w: 1440, h: 875, layer: 0 }, // 全屏
    { id: 6, pid: 10, x: 0, y: 26, w: 1440, h: 874, layer: 0 }, // 贴菜单栏
  ]
  assert.deepStrictEqual(filterLedges(wins, ctx), [])
}

// 4) 露出宽度:窗口大部分在屏外(露出 <120)被排除
{
  const wins = [{ id: 7, pid: 10, x: 1350, y: 100, w: 800, h: 600, layer: 0 }] // 露出 90
  assert.deepStrictEqual(filterLedges(wins, ctx), [])
  const wins2 = [{ id: 8, pid: 10, x: 1250, y: 100, w: 800, h: 600, layer: 0 }] // 露出 190
  assert.strictEqual(filterLedges(wins2, ctx).length, 1)
}

// 5) 屏幕顶沿 ledge 常驻
{
  const s = screenTopLedge(ctx)
  assert.strictEqual(s.id, 'screen-top')
  assert.strictEqual(s.y, 25)
  assert.strictEqual(s.w, 1440)
}

console.log('ledges 单测全部通过')
