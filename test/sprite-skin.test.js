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

  // 5) 切状态清零帧时钟:进入 walk 的第一帧必为 w1(相位不跳)
  for (let i = 0; i < 3; i++) {
    t += 0.25
    skin.draw(pose, t, info('idle', 0.25))
  }
  drawn.length = 0
  t += 0.01
  skin.draw(pose, t, info('walk', 0.01))
  assert.strictEqual(drawn[0], 'w1')

  console.log('sprite-skin 单测全部通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
