'use strict'
// M2 单测:node test/sprite-skin.test.js
// 用桩 Image/ctx 驱动 sprite-skin 的帧时钟与表情队列,验证:
// 1) 状态多帧循环按 fps 取帧;2) 表情插播覆盖状态帧;3) once+hold 后回落;
// 4) 无素材表情静默返回 false;5) 切状态清零帧时钟(相位不跳)
const assert = require('node:assert')
const path = require('node:path')

// ---- 桩环境 ----
const drawn = []
const noop = () => {}
const ctx = new Proxy(
  {
    drawImage: (img) => drawn.push(img.tag),
    canvas: {},
  },
  {
    get: (o, k) => (k in o ? o[k] : noop),
    set: (o, k, v) => ((o[k] = v), true),
  }
)
class StubImage {
  set src(v) {
    this.tag = v
    this.naturalWidth = 100
    this.naturalHeight = 100
    setTimeout(() => this.onload && this.onload(), 0)
  }
}
global.window = {}
global.Image = StubImage

require(path.join(__dirname, '..', 'renderer', 'sprite-skin.js'))

const assets = {
  states: {
    idle: { frames: ['idle'] },
    walk: { frames: ['w1', 'w2'], fps: 2 },
  },
  expressions: {
    happy: { frames: ['h1'], fps: 10, once: true, hold: 0.1 },
  },
}

async function main() {
  const skin = await window.createSpriteSkin(assets, { ctx, cx: 180, ground: 374, fps: 8 })
  const pose = { face: 1, rot: 0 }
  const info = (state, dt) => ({ state, dt, stateT: 0, squashT: 0, air: 0 })

  // 1) walk 2 帧 @2fps:0.25s 步进 → 帧序 w1 w2 w2 w1(时钟 0.25/0.5/0.75/1.0)
  drawn.length = 0
  let t = 0
  for (let i = 0; i < 4; i++) {
    t += 0.25
    skin.draw(pose, t, info('walk', 0.25))
  }
  assert.deepStrictEqual(drawn, ['w1', 'w2', 'w2', 'w1'])

  // 2) 表情插播:play 后下一帧画 h1
  assert.strictEqual(skin.playExpression('happy'), true)
  drawn.length = 0
  t += 0.05
  skin.draw(pose, t, info('walk', 0.05))
  assert.strictEqual(drawn[0], 'h1')

  // 3) once(0.1s)+hold(0.1s) 后回落状态帧
  drawn.length = 0
  for (let i = 0; i < 5; i++) {
    t += 0.06
    skin.draw(pose, t, info('walk', 0.06))
  }
  assert.ok(drawn.slice(-2).every((d) => d === 'w1' || d === 'w2'), '应回落到 walk 帧:' + drawn)

  // 4) 无素材表情静默 false
  assert.strictEqual(skin.playExpression('nope'), false)

  // 5) 切状态清零帧时钟 + 边界交叉溶解:进入 walk 首帧,层序为 [上一状态帧淡出, w1]
  for (let i = 0; i < 3; i++) {
    t += 0.25
    skin.draw(pose, t, info('idle', 0.25))
  }
  drawn.length = 0
  t += 0.01
  skin.draw(pose, t, info('walk', 0.01))
  assert.strictEqual(drawn[0], 'idle') // 边界溶解:上一状态最后一帧淡出
  assert.strictEqual(drawn[drawn.length - 1], 'w1') // 当前帧相位归零

  // ---------- 步态引擎(anim 配置) ----------
  const assets2 = {
    states: {
      idle: { frames: ['i'] },
      walk: {
        frames: ['w1', 'w2'],
        anim: { interval: [0.2, 0.2], refSpeed: 46, crossfade: 0.5, entryT: 0.05, stateXfade: 0.1 },
      },
    },
    expressions: {},
  }
  const skin2 = await window.createSpriteSkin(assets2, { ctx, cx: 180, ground: 374, fps: 8 })
  const winfo = (dt, speed) => ({ state: 'walk', dt, stateT: 0, squashT: 0, air: 0, speed: speed || 0 })
  let t2 = 0
  const step = (dt, speed) => {
    t2 += dt
    drawn.length = 0
    skin2.draw(pose, t2, winfo(dt, speed))
    return drawn.slice()
  }

  // 6) 起步:相位归零、渐入包络使首帧 bob=0、步时长=interval
  let batch = step(0.01)
  assert.deepStrictEqual(batch, ['w1'])
  let g = skin2.gaitInfo()
  assert.strictEqual(Math.abs(g.bob), 0)
  assert.strictEqual(g.stepDur, 0.2)

  // 7) 步内交叉溶解:phi>0.75 后同帧画两层(w1+w2)
  let sawXfade = false
  for (let i = 0; i < 18; i++) {
    batch = step(0.01)
    if (batch.length === 2) sawXfade = true
  }
  assert.ok(sawXfade, '应出现步内交叉溶解双层绘制')

  // 8) 换帧点连续:发生 wrap 的那帧 bob 远小于步中值(变换量在换帧瞬间归零)
  let wrapped = false
  for (let i = 0; i < 5 && !wrapped; i++) {
    step(0.01)
    g = skin2.gaitInfo()
    if (g.idx === 1) wrapped = true
  }
  assert.ok(wrapped, '应发生换帧')
  assert.ok(Math.abs(g.bob) < 1.0, '换帧点 bob 应接近 0:' + g.bob)

  // 9) 速度同步:speed=92(2×ref)→ k 钳制 0.6 → 下一步 stepDur=0.12
  for (let i = 0; i < 22; i++) step(0.01, 92)
  g = skin2.gaitInfo()
  assert.ok(Math.abs(g.stepDur - 0.12) < 1e-9, '速度同步 stepDur:' + g.stepDur)

  // 10) 状态边界:walk→idle 回落单帧;再回 walk 相位重置(idx=0)
  t2 += 0.01
  drawn.length = 0
  skin2.draw(pose, t2, info('idle', 0.01))
  assert.strictEqual(drawn[drawn.length - 1], 'i')
  t2 += 0.01
  drawn.length = 0
  skin2.draw(pose, t2, winfo(0.01))
  g = skin2.gaitInfo()
  assert.strictEqual(g.idx, 0)
  assert.ok(g.phi < 0.2)

  // ---------- N 帧循环(4 帧:着地 c / 过渡 p 交替,AI 补帧后的形态) ----------
  const assets3 = {
    states: {
      idle: { frames: ['i3'] },
      walk: {
        frames: ['c0', 'p1', 'c2', 'p3'],
        anim: { interval: [0.2, 0.2], refSpeed: 46, bobAmp: 4, entryT: 0.01, crossfade: 0, stateXfade: 0 },
      },
    },
    expressions: {},
  }
  const skin3 = await window.createSpriteSkin(assets3, { ctx, cx: 180, ground: 374, fps: 8 })
  let t3 = 0
  const step3 = (dt) => {
    t3 += dt
    drawn.length = 0
    skin3.draw(pose, t3, { state: 'walk', dt, stateT: 0, squashT: 0, air: 0, speed: 0 })
    return drawn.slice()
  }

  // 11) 帧序按 c0→p1→c2→p3 循环;颠簸每循环 2 次:过渡帧 |bob| 峰值、着地帧 ≈0
  //     dt=stepDur=0.2 → 每步 phi 恰好 wrap 归零,采样点正落在换帧点上
  let d = step3(0.2) // 起步 gaitReset(idx=0) 后 advance → 画 p1;首帧 env=0(渐入)
  assert.deepStrictEqual(d, ['p1'])
  g = skin3.gaitInfo()
  assert.strictEqual(g.n, 4)
  assert.strictEqual(Math.abs(g.bob), 0) // env=0 → 幅度未渐入

  d = step3(0.2) // idx=2(着地帧):ph=π → lift≈0 → bob≈0
  assert.deepStrictEqual(d, ['c2'])
  assert.ok(Math.abs(skin3.gaitInfo().bob) < 1e-6, '着地帧 bob 应≈0:' + skin3.gaitInfo().bob)

  d = step3(0.2) // idx=3(过渡帧):ph=3π/2 → lift=1 → bob=-bobAmp
  assert.deepStrictEqual(d, ['p3'])
  assert.ok(Math.abs(skin3.gaitInfo().bob + 4) < 1e-6, '过渡帧 bob 应为峰值:' + skin3.gaitInfo().bob)

  d = step3(0.2) // idx 回绕到 0(着地帧)
  assert.deepStrictEqual(d, ['c0'])
  assert.strictEqual(skin3.gaitInfo().idx, 0)
  assert.ok(Math.abs(skin3.gaitInfo().bob) < 1e-6)

  // 12) 换帧点变换量连续:小步长扫过多个 wrap,相邻采样 |Δbob| 不超过斜率上界(无跳变)
  let prevBob = null
  let prevIdx = skin3.gaitInfo().idx
  let maxJump = 0
  let wraps = 0
  for (let i = 0; i < 40; i++) {
    step3(0.015) // Δph=0.075·π/2 → |Δbob| ≤ 4·sin(0.1178) ≈ 0.47
    const gi = skin3.gaitInfo()
    if (prevBob !== null) maxJump = Math.max(maxJump, Math.abs(gi.bob - prevBob))
    if (gi.idx !== prevIdx) wraps++
    prevBob = gi.bob
    prevIdx = gi.idx
  }
  assert.ok(wraps >= 2, '应跨越多个换帧点:' + wraps)
  assert.ok(maxJump < 0.6, '相邻采样 bob 增量应在斜率上界内(换帧无跳变):' + maxJump)

  console.log('sprite-skin 单测全部通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
