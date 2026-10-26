// 图像精灵皮肤 v2:状态多帧循环 + 表情打断短序列 + 代码二级动画(呼吸/颠簸/旋转/压扁/爱心)
// 与 cat.js 的 FSM 解耦:cat.js 只产出 pose 与状态名,这里负责"画成猫"。
// assets v2:{ states:{name:{frames:url[],fps?}}, expressions:{name:{frames,fps,once,hold}} }
// 兼容 v1:{ idle, walk[], tap, sleep, drag, pet, thrown, groom }(单 url 或 url 数组)
'use strict'
;(() => {
  function heartPath(ctx, x, y, s) {
    ctx.beginPath()
    ctx.moveTo(x, y + s * 0.65)
    ctx.bezierCurveTo(x - s * 0.95, y - s * 0.1, x - s * 0.5, y - s * 0.95, x, y - s * 0.3)
    ctx.bezierCurveTo(x + s * 0.5, y - s * 0.95, x + s * 0.95, y - s * 0.1, x, y + s * 0.65)
    ctx.closePath()
  }

  function normalize(assets) {
    if (assets && assets.states) return assets
    const one = (u) => (u ? { frames: [u] } : null)
    const many = (u) => (Array.isArray(u) && u.length ? { frames: u } : u ? { frames: [u] } : null)
    return {
      states: {
        idle: one(assets && assets.idle),
        walk: many(assets && assets.walk),
        tap: one(assets && assets.tap),
        sleep: one(assets && assets.sleep),
        drag: one(assets && assets.drag),
        pet: one(assets && assets.pet),
        thrown: one(assets && assets.thrown),
        groom: one(assets && (assets.groom || assets.tap)),
      },
      expressions: {},
    }
  }

  window.createSpriteSkin = async function createSpriteSkin(assets, opts) {
    opts = opts || {}
    const ctx = opts.ctx
    const CX = opts.cx
    const GROUND = opts.ground
    const load = (url) =>
      new Promise((resolve) => {
        if (!url) return resolve(null)
        const im = new Image()
        im.onload = () => resolve(im)
        im.onerror = () => {
          console.warn('[skin] 图片加载失败', url)
          resolve(null)
        }
        im.src = url
      })

    const norm = normalize(assets)
    const loadSeq = async (spec) => {
      if (!spec || !Array.isArray(spec.frames) || !spec.frames.length) return null
      const imgs = (await Promise.all(spec.frames.map(load))).filter(Boolean)
      return imgs.length ? { imgs, fps: spec.fps || null, anim: spec.anim || null } : null
    }
    const states = {}
    for (const [name, spec] of Object.entries(norm.states || {})) {
      const s = await loadSeq(spec)
      if (s) states[name] = s
    }
    const expressions = {}
    for (const [name, spec] of Object.entries(norm.expressions || {})) {
      const s = await loadSeq(spec)
      if (s) expressions[name] = { ...s, once: spec.once !== false, hold: spec.hold || 0 }
    }
    const idle = states.idle
    if (!idle) throw new Error('idle 图片加载失败')
    // 回退链:各状态缺帧 → idle
    for (const k of ['walk', 'tap', 'sleep', 'drag', 'pet', 'thrown', 'groom']) {
      if (!states[k]) states[k] = idle
    }
    const fps = opts.fps || 8
    const targetH = opts.targetHeight || 250
    const scale = targetH / idle.imgs[0].naturalHeight
    const hearts = []
    const stateClock = {} // 每状态独立帧时钟:切状态清零,防相位跳变
    let expr = null // { name, def, t }
    let prevState = ''
    let t = 0

    // ---------- 步态引擎:相位锁定的两帧走姿 ----------
    // 帧切换不再用墙上时钟,而用"步相位" φ∈[0,1):每步时长在 interval 内随机抽取,
    // 并可按移动速度相对 refSpeed 缩放。颠簸/摇摆/压扁全部是 φ 的连续函数,
    // 且在换帧点(φ=0)取极值 0 → 换帧瞬间变换量连续,视觉无跳变。
    const DEF_ANIM = {
      interval: [0.14, 0.22], // 每步时长随机范围(秒)
      refSpeed: 46, // 参考移速(px/s),速度同步的基准
      bobAmp: 3, // 颠簸幅度(px)
      swayAmp: 0.02, // 摇摆幅度(rad)
      swayPhase: Math.PI / 2, // 摇摆相对步相位的相位差
      squashAmp: 0.012, // 落地压扁幅度
      crossfade: 0.3, // 步内两帧交叉溶解占比(0=硬切)
      entryT: 0.25, // 进入 walk 时幅度渐入时长
      exitT: 0.18, // (预留)退出渐出,当前由 stateXfade 承担
      stateXfade: 0.12, // 状态边界交叉溶解时长(消除姿态突跳)
    }
    const smooth01 = (x) => x * x * (3 - 2 * x)
    const animOf = (state) => {
      const def = states[state]
      return def && def.anim ? Object.assign({}, DEF_ANIM, def.anim) : null
    }
    let gait = null // { phi, idx, stepDur, age }
    let gaitState = '' // 步态归属状态(仅该状态用 gait 取帧)
    let snap = null // 状态边界溶解快照 { bodies, t, dur }
    let lastBody = null

    function gaitReset(a) {
      const [lo, hi] = a.interval
      gait = { phi: 0, idx: 0, age: 0, stepDur: Math.max(0.05, lo + Math.random() * (hi - lo)) }
      gaitState = prevState === 'walk' ? 'walk' : state0()
    }
    function state0() {
      return prevState
    }
    function gaitAdvance(a, dt, speed, n) {
      // 速度同步:移速快 → 步频快(stepDur × refSpeed/speed,夹在 0.6–1.8 倍)
      const k = a.refSpeed > 0 && speed > 1 ? Math.min(1.8, Math.max(0.6, a.refSpeed / speed)) : 1
      gait.phi += dt / gait.stepDur
      while (gait.phi >= 1) {
        gait.phi -= 1
        gait.idx = (gait.idx + 1) % n
        const [lo, hi] = a.interval
        gait.stepDur = Math.max(0.05, (lo + Math.random() * (hi - lo)) * k)
      }
    }
    // 步相位 ph=π/步:|sin| 在换帧点归零 → bob/squash 换帧连续;sway 用带相位差的正弦,全程连续
    function gaitTransform(a, env) {
      const ph = (gait.idx + gait.phi) * Math.PI
      const lift = Math.abs(Math.sin(ph))
      return {
        bob: -lift * a.bobAmp * env,
        sway: Math.sin(ph + a.swayPhase) * a.swayAmp * env,
        sy: 1 - lift * a.squashAmp * env,
        sx: 1 + lift * a.squashAmp * 0.7 * env,
        lift,
      }
    }

    function stateImg(state) {
      const def = states[state] || idle
      // 配置了步态动画的状态:取当前步帧(与 walk 渲染同源),避免墙上时钟与步相位打架
      if (def.anim && def.imgs.length > 1 && gait) return def.imgs[gait.idx % def.imgs.length]
      const clock = stateClock[state] || 0
      const f = def.fps || fps
      return def.imgs[Math.floor(clock * f) % def.imgs.length]
    }

    function drawBody(img, bob, rot, sx, sy, face, alpha) {
      const w = img.naturalWidth * scale
      const h = img.naturalHeight * scale
      ctx.save()
      if (alpha < 1) ctx.globalAlpha *= alpha
      ctx.translate(CX, GROUND + bob)
      ctx.rotate(rot)
      ctx.scale(face * sx, sy)
      ctx.drawImage(img, -w / 2, -h, w, h)
      ctx.restore()
    }

    return {
      // 表情插播:once 播完(+hold)自动回落;循环型持续到再次调用/状态切换
      // 同名重入从头播;不同名直接替换;无该表情素材静默忽略
      playExpression(name) {
        const def = expressions[name]
        if (!def) return false
        expr = { name, def, t: 0 }
        return true
      },
      draw(p, now, info) {
        const dt = info.dt || 0.016
        t = now
        const state = info.state
        const a = animOf(state)
        const walkDef = states.walk
        const walkActive = state === 'walk' && !expr && !!a && !!walkDef && walkDef.imgs.length > 1
        if (state !== prevState) {
          stateClock[state] = 0
          if (expr && !expr.def.once) expr = null // 循环表情随状态切换结束
          // 状态边界:把上一状态的最后一帧做交叉溶解快照,消除姿态/位置突跳
          if (lastBody && lastBody.length) {
            const xf = (a || DEF_ANIM).stateXfade
            if (xf > 0) snap = { bodies: lastBody, t: 0, dur: xf }
          }
          if (state === 'walk' && a) gaitReset(a) // 起步相位归零,步态从头开始
        }
        prevState = state
        stateClock[state] = (stateClock[state] || 0) + dt

        let img
        let bob = 0
        let rot = p.rot
        let sy = 1
        let sx = 1
        if (expr) {
          expr.t += dt
          const def = expr.def
          const dur = def.imgs.length / def.fps
          if (def.once && expr.t >= dur + def.hold) {
            expr = null
            img = stateImg(state)
          } else {
            img = def.imgs[Math.min(def.imgs.length - 1, Math.floor(expr.t * def.fps))]
          }
        }
        if (!img) img = stateImg(state)

        // 摸头瞬间撒爱心
        if (state === 'pet' && prevState !== 'pet') {
          for (let i = 0; i < 3; i++) {
            hearts.push({
              x: CX + (Math.random() * 2 - 1) * 46,
              y: GROUND - 150 + Math.random() * 20,
              life: 1,
              size: 7 + Math.random() * 5,
              seed: Math.random() * 10,
            })
          }
        }

        const sq = Math.min(1, (info.squashT || 0) / 0.22)
        sy *= 1 - 0.14 * sq
        sx *= 1 + 0.1 * sq
        sy *= 1 + Math.sin(t * 2.3) * 0.008 // 呼吸
        if (state === 'walk') {
          bob = -Math.abs(Math.sin(t * 8)) * 3
          rot += Math.sin(t * 8) * 0.02
        } else if (state === 'tap' || state === 'groom') {
          bob = -1.5
          rot += p.face * 0.015
        } else if (state === 'sleep') {
          sy *= 1 + Math.sin(t * 1.2) * 0.012
        } else if (state === 'pet') {
          bob = -Math.abs(Math.sin((info.stateT || 0) * 9)) * 6
        } else if (state === 'drag') {
          rot += Math.sin(t * 10) * 0.03
        }

        // 接地阴影
        const air = info.air || 0
        ctx.fillStyle = `rgba(0,0,0,${0.16 * (1 - 0.6 * air)})`
        ctx.beginPath()
        ctx.ellipse(CX, GROUND + 2, 62 * (1 - 0.5 * air) * sx, 9 * (1 - 0.4 * air), 0, 0, Math.PI * 2)
        ctx.fill()

        // 本体(底部中心对齐地面)
        const w = img.naturalWidth * scale
        const h = img.naturalHeight * scale
        ctx.save()
        ctx.translate(CX, GROUND + bob)
        ctx.rotate(rot)
        ctx.scale(p.face * sx, sy)
        ctx.drawImage(img, -w / 2, -h, w, h)
        ctx.restore()

        // 睡觉 zzz
        if (state === 'sleep') {
          ctx.fillStyle = '#20242a'
          for (let i = 0; i < 3; i++) {
            const a = (Math.sin(t * 1.6 - i * 0.9) + 1) / 2
            ctx.globalAlpha = 0.2 + 0.5 * a
            ctx.font = `700 ${14 + i * 7}px ui-rounded, system-ui`
            ctx.fillText('z', CX + 52 + i * 12, GROUND - 150 - i * 20 - a * 8)
          }
          ctx.globalAlpha = 1
        }

        // 爱心粒子
        for (let i = hearts.length - 1; i >= 0; i--) {
          const h2 = hearts[i]
          h2.life -= dt / 1.4
          if (h2.life <= 0) {
            hearts.splice(i, 1)
            continue
          }
          h2.y -= 26 * dt
          h2.x += Math.sin((t + h2.seed) * 3.2) * 9 * dt
          ctx.save()
          ctx.globalAlpha = Math.min(1, h2.life * 1.6)
          ctx.fillStyle = '#f78ca0'
          heartPath(ctx, h2.x, h2.y, h2.size)
          ctx.fill()
          ctx.restore()
        }
      },
    }
  }
})()
