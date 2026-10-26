// 桌宠渲染器:程序化卡通猫(零素材)+ 行为 FSM
// 皮肤层约定:update() 产出 pose 参数对象,draw() 只负责把 pose 画出来。
// 未来换"真猫视频皮肤"时,FSM 不动,draw() 换成透明视频片段播放器即可。
'use strict'
;(() => {
  const W = 360
  const H = 380
  const GROUND = H - 6
  const CX = W / 2
  const INK = '#20242a'
  const PINK = '#f78ca0'

  const canvas = document.getElementById('stage')
  const ctx = canvas.getContext('2d')
  const bubbleEl = document.getElementById('bubble')
  document.addEventListener('dragstart', (e) => e.preventDefault())

  let DPR = 1
  function fit() {
    DPR = window.devicePixelRatio || 1
    canvas.width = W * DPR
    canvas.height = H * DPR
    canvas.style.width = W + 'px'
    canvas.style.height = H + 'px'
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
  }
  fit()
  window.addEventListener('resize', fit)

  // ---------- 窗口位置状态 ----------
  let layout = null
  let px = 0
  let py = 0
  let lastX = null
  let lastY = null
  const walkMin = () => layout.x
  const walkMax = () => layout.x + layout.w - W

  // ---------- FSM 状态 ----------
  let st = 'idle'
  let stT = 0
  let dir = 1
  let walkDur = 0
  let nextWalkIn = rand(2.5, 5)
  let nextGroomIn = rand(8, 16)
  let groomSide = 1
  let legPh = 0
  let t = 0
  let blinkIn = rand(1.5, 3)
  let blinkT = 0
  let pawTapT = 0
  let pawSide = 1
  let squashT = 0
  let bounces = 0
  let paused = false
  let lastAct = performance.now()
  const vel = { x: 0, y: 0 }

  // 拖拽
  let dragging = false
  let moved = false
  const dragOff = { x: 0, y: 0 }
  const dragStart = { x: 0, y: 0 }
  let lastMoveT = 0

  // 点击穿透
  let ignoring = true

  // ---------- 窗口顶边(ledge)登高 ----------
  const CAT_W = 170 // 猫体宽:顶边行走按猫体约束,而非窗口宽
  let ledges = [] // 主进程推送的可站顶边(含 screen-top)
  let surface = null // null=地面 | {id} 当前站立的 ledge
  let perchMode = 'stand' // stand|walk|look
  let perchT = 0
  let perchWalkDur = 0
  let lookDur = 0
  let nextPerchIn = rand(4, 10)
  let nextClimbIn = rand(12, 25)
  let climb = null // {x0,y0,x1,y1,T,t,arch,id}
  let fallSkip = null // 下落时忽略的 ledge(刚离开的那条,防原地接住)
  let dragFromSurface = null // 拖拽前的 surface:原地点击(摸头)后恢复

  const ledgeById = (id) => ledges.find((l) => l.id === id) || null
  const feetY = () => py + GROUND // 猫脚屏幕 y
  const cx = () => px + W / 2
  // 顶边上猫中心的允许范围 → 窗口 px 范围
  function perchRange(l) {
    return [l.x + 30 - W / 2, l.x + l.w - 30 - W / 2]
  }
  function setPerch(mode) {
    st = 'perch'
    stT = 0
    perchMode = mode
    perchT = 0
    if (mode === 'walk') perchWalkDur = rand(1.5, 3.5)
    if (mode === 'look') lookDur = rand(2, 4)
    nextPerchIn = rand(4, 10)
  }
  function startFall() {
    fallSkip = surface ? surface.id : null
    surface = null
    climb = null
    vel.x = 0
    vel.y = 0
    set('fall')
  }
  function startClimb(l) {
    const [a, b] = perchRange(l)
    const tx = clamp(cx(), a + 20, Math.max(a + 20, b - 20)) - W / 2
    const dy = feetY() - l.y
    climb = {
      x0: px, y0: py,
      x1: tx, y1: l.y - GROUND,
      T: 0.5 + Math.min(0.5, dy * 0.0008),
      arch: Math.min(140, 40 + dy * 0.25),
      t: 0, id: l.id,
    }
    dir = tx >= px ? 1 : -1
    set('climb')
  }
  // 地面想上去:选上方 40–500px、水平距 <400 的最近 ledge
  function pickClimbLedge() {
    let best = null
    let bestDy = 1e9
    for (const l of ledges) {
      const dy = feetY() - l.y
      if (dy < 40 || dy > 500) continue
      const gap = Math.max(0, l.x - cx(), cx() - (l.x + l.w))
      if (gap > 400) continue
      if (dy < bestDy) { bestDy = dy; best = l }
    }
    return best
  }
  // 顶边间互跳:高度差 <160、水平间隙 <260 的最近 ledge
  function pickAdjacentLedge(cur) {
    let best = null
    let bestD = 1e9
    for (const l of ledges) {
      if (l.id === cur.id) continue
      if (Math.abs(l.y - cur.y) > 160) continue
      const gap = Math.max(0, cur.x - (l.x + l.w), l.x - (cur.x + cur.w))
      if (gap > 260) continue
      if (gap < bestD) { bestD = gap; best = l }
    }
    return best
  }
  // 拖拽/甩出落点吸附:脚底 ±24px 内的 ledge 顶边
  function snapLedge() {
    let best = null
    let bestD = 25
    for (const l of ledges) {
      if (cx() < l.x + 10 || cx() > l.x + l.w - 10) continue
      const d = Math.abs(feetY() - l.y)
      if (d < bestD) { bestD = d; best = l }
    }
    return best
  }

  let bubbleTimer = null
  let keyWarned = false
  let spriteSkin = null
  let lastTapExpr = 0

  // 表情插播入口:无图像皮肤/无该表情素材时静默跳过(返回 false)
  function playExpr(name) {
    if (spriteSkin && spriteSkin.playExpression) return spriteSkin.playExpression(name)
    return false
  }
  // 调试/自测把手:devtools 里 petDebug.play('surprise') 可直接触发
  window.petDebug = {
    state: () => st,
    play: (n) => playExpr(n),
    exprLoaded: () => !!(spriteSkin && spriteSkin.playExpression),
    ledges: () => ledges,
    surface: () => surface,
    climb: (id) => { const l = ledgeById(id); if (l) startClimb(l); return !!l },
    fall: () => startFall(),
  }

  function rand(a, b) { return a + Math.random() * (b - a) }
  function pick(a) { return a[Math.floor(Math.random() * a.length)] }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }

  function bubble(text, ms = 1600) {
    bubbleEl.textContent = text
    bubbleEl.classList.add('show')
    if (bubbleTimer) clearTimeout(bubbleTimer)
    bubbleTimer = setTimeout(() => bubbleEl.classList.remove('show'), ms)
  }

  function set(name, dur) {
    st = name
    stT = 0
    if (name === 'idle') {
      nextWalkIn = rand(3.5, 7)
      nextGroomIn = rand(9, 20)
    }
    if (name === 'walk') walkDur = dur || rand(1.8, 4.2)
    if (name === 'groom') groomSide = Math.random() < 0.5 ? -1 : 1
  }

  // ---------- 行为更新 ----------
  function update(dt) {
    t += dt
    blinkIn -= dt
    if (blinkIn <= 0) { blinkT = 0.12; blinkIn = rand(2.2, 4.5) }
    blinkT = Math.max(0, blinkT - dt)
    pawTapT = Math.max(0, pawTapT - dt)
    squashT = Math.max(0, squashT - dt)

    if (!paused) {
      stT += dt
      switch (st) {
        case 'idle':
          if (performance.now() - lastAct > 45000) set('sleep')
          else if (stT > nextGroomIn) set('groom', 1.5)
          else if (stT > nextWalkIn) { dir = Math.random() < 0.5 ? -1 : 1; set('walk') }
          else if (!surface && stT > nextClimbIn) {
            nextClimbIn = stT + rand(20, 40)
            if (Math.random() < 0.3) {
              const l = pickClimbLedge()
              if (l) startClimb(l)
            }
          }
          break
        case 'walk': {
          const l = surface ? ledgeById(surface.id) : null
          if (surface && !l) { startFall(); break }
          legPh += dt * 10
          px += dir * 46 * dt
          const lo = l ? l.x + 30 - W / 2 : walkMin()
          const hi = l ? l.x + l.w - 30 - W / 2 : walkMax()
          if (px < lo) { px = lo; dir = 1 }
          if (px > hi) { px = hi; dir = -1 }
          if (stT > walkDur) set('idle')
          break
        }
        case 'groom':
          if (stT > 1.5) set('idle')
          break
        case 'pet':
          if (stT > 1.1) set('idle')
          break
        case 'climb': {
          if (!climb) { set('idle'); break }
          climb.t += dt
          const k = Math.min(1, climb.t / climb.T)
          px = climb.x0 + (climb.x1 - climb.x0) * k
          py = climb.y0 + (climb.y1 - climb.y0) * k - Math.sin(Math.PI * k) * climb.arch
          legPh += dt * 14
          if (k >= 1) {
            const l = ledgeById(climb.id)
            const done = { x: climb.x1, y: climb.y1, id: climb.id }
            climb = null
            if (!l) { surface = null; vel.y = 0; set('fall') }
            else {
              surface = { id: done.id }
              px = done.x
              py = done.y
              setPerch('stand')
            }
          }
          break
        }
        case 'perch': {
          const l = surface ? ledgeById(surface.id) : null
          if (!l) { startFall(); break }
          const [lo, hi] = perchRange(l)
          px = clamp(px, lo, hi)
          py = l.y - GROUND
          perchT += dt
          if (perchMode === 'walk') {
            legPh += dt * 10
            px += dir * 40 * dt
            if (px <= lo) { px = lo; dir = 1; setPerch('look') }
            else if (px >= hi) { px = hi; dir = -1; setPerch('look') }
            else if (perchT > perchWalkDur) setPerch('stand')
          } else if (perchMode === 'look') {
            if (perchT > lookDur) setPerch('stand')
          } else if (stT > nextPerchIn) {
            nextPerchIn = stT + rand(4, 10)
            const r = Math.random()
            if (r < 0.4) setPerch('walk')
            else if (r < 0.6) setPerch('look')
            else if (r < 0.75) {
              const nl = pickAdjacentLedge(l)
              if (nl) startClimb(nl)
              else setPerch('walk')
            } else if (r < 0.9) startFall()
            else set('sleep') // 顶边睡觉
          }
          break
        }
        case 'fall': {
          const prevY = py
          vel.y += 1600 * dt
          py += vel.y * dt
          px = clamp(px + vel.x * dt, walkMin(), walkMax())
          let landed = null
          if (py >= layout.groundY) { py = layout.groundY; landed = 'ground' }
          else {
            for (const l of ledges) {
              if (l.id === fallSkip) continue
              if (cx() < l.x + 10 || cx() > l.x + l.w - 10) continue
              const top = l.y - GROUND
              if (py >= top && prevY <= top) { py = top; landed = l; break }
            }
          }
          if (landed) {
            squashT = 0.22
            fallSkip = null
            if (landed === 'ground') { surface = null; set('idle') }
            else { surface = { id: landed.id }; setPerch('stand') }
          }
          break
        }
        case 'thrown': {
          const prevY = py
          vel.y += 1600 * dt
          px += vel.x * dt
          py += vel.y * dt
          px = clamp(px, walkMin(), walkMax())
          let landed = null
          if (py >= layout.groundY) landed = 'ground'
          else if (vel.y > 0) {
            for (const l of ledges) {
              if (cx() < l.x + 10 || cx() > l.x + l.w - 10) continue
              const top = l.y - GROUND
              if (py >= top && prevY <= top) { landed = l; break }
            }
          }
          if (landed) {
            if (landed === 'ground') {
              py = layout.groundY
              if (vel.y > 260 && bounces < 2) {
                vel.y *= -0.42; vel.x *= 0.65; bounces++; squashT = 0.18
              } else {
                squashT = 0.22
                surface = null
                set('idle')
              }
            } else {
              py = landed.y - GROUND
              vel.x = 0; vel.y = 0
              squashT = 0.18
              surface = { id: landed.id }
              setPerch('stand')
            }
          }
          break
        }
        // sleep / drag 无自推进
      }
      // 位置约束:climb/thrown/drag 自管坐标,其余按当前 surface 收敛
      if (st !== 'climb' && st !== 'thrown' && st !== 'drag') {
        const l = surface ? ledgeById(surface.id) : null
        if (surface && !l) { surface = null; startFall() }
        else if (l) {
          py = l.y - GROUND
          px = clamp(px, l.x + 30 - W / 2, l.x + l.w - 30 - W / 2)
        } else {
          py = Math.min(py, layout.groundY)
          px = clamp(px, walkMin(), walkMax())
        }
      }
    }
  }

  // ---------- pose 计算 + 绘制 ----------
  function computePose() {
    const p = {
      face: dir, sx: 1, sy: 1, rot: 0,
      eyes: blinkT > 0 ? 'blink' : 'open',
      mouth: 'w',
      pawL: 0, pawR: 0,
      legsOn: false, legPh,
      splay: 0,
      tailPh: t * 2.4, tailAmp: 1,
      headTilt: 0, tailWrap: false,
      earL: 0, earR: 0,
      zzz: false, zzzPh: t, blush: false,
    }
    p.sy *= 1 + Math.sin(t * (st === 'sleep' ? 1.2 : 2.3)) * 0.018
    switch (st) {
      case 'walk':
      case 'climb':
        p.legsOn = true; p.tailAmp = 1.5; p.sy *= 1 + Math.sin(legPh * 2) * 0.02
        break
      case 'perch':
        if (perchMode === 'walk') { p.legsOn = true; p.tailAmp = 1.5 }
        else if (perchMode === 'look') { p.headTilt = 0.3; p.tailAmp = 0.6 }
        else p.tailAmp = 1
        break
      case 'fall':
        p.splay = 0.5; p.eyes = 'wide'; p.tailAmp = 2.2; p.tailPh = t * 10
        break
      case 'groom':
        if (groomSide < 0) p.pawL = 1; else p.pawR = 1
        p.headTilt = 0.22 * groomSide; p.eyes = 'closed'; p.tailAmp = 0.5
        break
      case 'sleep':
        p.sy *= 0.74; p.headTilt = 0.28; p.eyes = 'closed'; p.mouth = 'line'
        p.tailWrap = true; p.tailAmp = 0.12; p.zzz = true
        break
      case 'pet':
        p.eyes = 'happy'; p.blush = true; p.rot = Math.sin(stT * 20) * 0.05; p.tailAmp = 2.2
        break
      case 'drag':
        p.splay = 1; p.eyes = 'wide'; p.mouth = 'o'; p.tailAmp = 2.4; p.tailPh = t * 10
        break
      case 'thrown':
        p.splay = 0.7; p.eyes = 'wide'; p.mouth = 'o'
        p.rot = clamp(vel.x / 1400, -0.4, 0.4); p.tailAmp = 2.6; p.tailPh = t * 12
        break
    }
    if (st === 'drag' || st === 'thrown' || st === 'fall') { p.earL = 0.55; p.earR = 0.55 }
    else if (st === 'idle') {
      if (t % 4.7 < 0.16) p.earR = 0.6 // 偶尔抖耳,显得警觉
      if (t % 6.1 < 0.14) p.earL = 0.6
    }
    if (pawTapT > 0 && st !== 'drag' && st !== 'thrown') {
      if (pawSide < 0) p.pawL = Math.max(p.pawL, 0.95); else p.pawR = Math.max(p.pawR, 0.95)
    }
    if (squashT > 0) {
      const k = squashT / 0.22
      p.sy *= 1 - 0.16 * k
      p.sx *= 1 + 0.12 * k
    }
    return p
  }

  // 绘图小工具:白底黑边
  function shape(pathFn, fill = true) {
    ctx.beginPath()
    pathFn()
    if (fill) ctx.fill()
    ctx.stroke()
  }
  function ell(x, y, rx, ry, fill = true) {
    shape(() => ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2), fill)
  }
  function circle(x, y, r, fill = true) {
    shape(() => ctx.arc(x, y, r, 0, Math.PI * 2), fill)
  }
  // 描边管状(先粗黑后细白 => 线稿风轮廓)
  function tube(pathFn, w) {
    ctx.beginPath()
    pathFn()
    ctx.lineWidth = w
    ctx.strokeStyle = INK
    ctx.stroke()
    ctx.beginPath()
    pathFn()
    ctx.lineWidth = w - 7
    ctx.strokeStyle = '#fff'
    ctx.stroke()
    ctx.lineWidth = 5
    ctx.strokeStyle = INK
  }

  function drawCat(p) {
    // 接地阴影:离地越高越小越淡
    const air = clamp((layout.groundY - py) / 500, 0, 1)
    ctx.fillStyle = `rgba(0,0,0,${0.16 * (1 - 0.65 * air)})`
    ctx.beginPath()
    ctx.ellipse(CX, GROUND + 2, 60 * (1 - 0.5 * air) * p.sx, 9 * (1 - 0.4 * air), 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.save()
    ctx.translate(CX, GROUND)
    ctx.rotate(p.rot)
    ctx.scale(p.face * p.sx, p.sy)
    ctx.lineWidth = 5
    ctx.strokeStyle = INK
    ctx.fillStyle = '#fff'
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    // 尾巴(身体后)
    if (p.tailWrap) {
      tube(() => { ctx.moveTo(-46, -12); ctx.quadraticCurveTo(0, 8, 46, -10) }, 15)
    } else {
      const ph = p.tailPh, amp = p.tailAmp
      tube(() => {
        ctx.moveTo(44, -36)
        ctx.quadraticCurveTo(86, -46 - Math.sin(ph) * 14 * amp, 92, -96 - Math.sin(ph + 1.1) * 18 * amp)
      }, 15)
    }

    // 走路的小脚
    if (p.legsOn) {
      for (let i = 0; i < 4; i++) {
        const lift = Math.max(0, Math.sin(p.legPh + i * Math.PI)) * 7
        ell(-36 + i * 24, -6 - lift, 10, 8)
      }
    }

    // 身体
    ell(0, -46, 54, 42)

    // 被拎起来/飞出去时四肢张开
    if (p.splay > 0) {
      const s = p.splay
      const flap = Math.sin(t * 26) * 4 * s
      for (const sd of [-1, 1]) {
        tube(() => { ctx.moveTo(sd * 28, -72); ctx.lineTo(sd * (28 + 30 * s), -72 - 26 * s - flap) }, 13)
        circle(sd * (28 + 30 * s), -72 - 26 * s - flap, 9)
        tube(() => { ctx.moveTo(sd * 24, -14); ctx.lineTo(sd * (24 + 26 * s), -14 + 18 * s) }, 13)
        circle(sd * (24 + 26 * s), -14 + 18 * s, 9)
      }
    }

    // 头(耳 → 脸)
    ctx.save()
    ctx.translate(0, -96)
    ctx.rotate(p.headTilt)
    for (const sd of [-1, 1]) {
      const droop = sd < 0 ? p.earL || 0 : p.earR || 0
      const tipX = sd * (30 - droop * 6)
      const tipY = -60 + droop * 24
      shape(() => { ctx.moveTo(sd * 10, -34); ctx.lineTo(sd * 36, -26); ctx.lineTo(tipX, tipY); ctx.closePath() })
      ctx.fillStyle = PINK
      ctx.beginPath()
      ctx.moveTo(sd * 17, -30); ctx.lineTo(sd * 30, -26); ctx.lineTo(tipX * 0.82, tipY * 0.82 - 4); ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#fff'
    }
    circle(0, -8, 40)
    // 眼睛
    for (const sd of [-1, 1]) {
      const ex = sd * 15, ey = -12
      if (p.eyes === 'open') { ctx.fillStyle = INK; circle(ex, ey, 4.5); ctx.fillStyle = '#fff' }
      else if (p.eyes === 'blink') { ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ex - 5, ey); ctx.lineTo(ex + 5, ey); ctx.stroke(); ctx.lineWidth = 5 }
      else if (p.eyes === 'happy') { ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(ex, ey + 3, 6, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); ctx.lineWidth = 5 }
      else if (p.eyes === 'closed') { ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(ex, ey - 3, 6, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke(); ctx.lineWidth = 5 }
      else if (p.eyes === 'wide') { circle(ex, ey, 8); ctx.fillStyle = INK; circle(ex, ey + 1, 3); ctx.fillStyle = '#fff' }
    }
    // 嘴
    ctx.lineWidth = 4
    if (p.mouth === 'w') {
      ctx.beginPath(); ctx.arc(-6, 2, 6, 0, Math.PI); ctx.stroke()
      ctx.beginPath(); ctx.arc(6, 2, 6, 0, Math.PI); ctx.stroke()
    } else if (p.mouth === 'o') {
      ctx.beginPath(); ctx.arc(0, 5, 4.5, 0, Math.PI * 2); ctx.stroke()
    } else {
      ctx.beginPath(); ctx.moveTo(-5, 6); ctx.lineTo(5, 6); ctx.stroke()
    }
    ctx.lineWidth = 5
    // 胡须
    ctx.lineWidth = 3
    for (const sd of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(sd * 30, -2); ctx.lineTo(sd * 52, -6); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(sd * 30, 4); ctx.lineTo(sd * 52, 6); ctx.stroke()
    }
    ctx.lineWidth = 5
    // 脸红
    if (p.blush) {
      ctx.fillStyle = 'rgba(247,140,160,0.55)'
      ctx.beginPath(); ctx.ellipse(-27, 2, 7, 4.5, 0, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.ellipse(27, 2, 7, 4.5, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fff'
    }
    ctx.restore() // 头

    // 前爪:抬起(肉垫)或落地
    for (const [sd, amt] of [[-1, p.pawL], [1, p.pawR]]) {
      if (amt > 0.05) {
        const pxx = sd * 36, pyy = -64 - amt * 40
        circle(pxx, pyy, 13)
        ctx.fillStyle = PINK
        ctx.beginPath(); ctx.ellipse(pxx, pyy + 3, 5.5, 4.5, 0, 0, Math.PI * 2); ctx.fill()
        for (const [tx, ty] of [[-6, -4], [0, -6.5], [6, -4]]) {
          ctx.beginPath(); ctx.arc(pxx + tx, pyy + ty, 2.8, 0, Math.PI * 2); ctx.fill()
        }
        ctx.fillStyle = '#fff'
      } else if (p.splay <= 0) {
        ell(sd * 20, -5, 11, 8)
      }
    }
    ctx.restore() // 整体

    // 睡觉的 z
    if (p.zzz) {
      ctx.fillStyle = INK
      for (let i = 0; i < 3; i++) {
        const a = (Math.sin(p.zzzPh * 1.6 - i * 0.9) + 1) / 2
        ctx.globalAlpha = 0.2 + 0.5 * a
        ctx.font = `700 ${14 + i * 7}px ui-rounded, system-ui`
        ctx.fillText('z', CX + 52 + i * 12, GROUND - 150 - i * 20 - a * 8)
      }
      ctx.globalAlpha = 1
    }
  }

  // ---------- 命中测试(点击穿透用) ----------
  function hitCat(x, y) {
    const dx = (x - CX) / 82
    const dy = (y - (GROUND - 92)) / 104
    return dx * dx + dy * dy <= 1
  }

  // ---------- 鼠标:穿透 / 拖拽 / 点击 ----------
  window.addEventListener('mousemove', (e) => {
    if (dragging) {
      const nx = e.screenX - dragOff.x
      const ny = e.screenY - dragOff.y
      const now = performance.now()
      const dtms = Math.max(1, now - lastMoveT)
      vel.x = vel.x * 0.65 + ((nx - px) / dtms) * 1000 * 0.35
      vel.y = vel.y * 0.65 + ((ny - py) / dtms) * 1000 * 0.35
      lastMoveT = now
      px = clamp(nx, walkMin(), walkMax())
      py = clamp(ny, layout.y - 260, layout.groundY)
      moved = moved || Math.hypot(e.screenX - dragStart.x, e.screenY - dragStart.y) > 4
      lastAct = now
      return
    }
    const x = e.screenX - px
    const y = e.screenY - py
    const inside = hitCat(x, y)
    if (inside && ignoring) { ignoring = false; window.api.setIgnoreMouse(false) }
    else if (!inside && !ignoring) { ignoring = true; window.api.setIgnoreMouse(true, true) }
  })

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    dragging = true
    moved = false
    dragFromSurface = surface
    surface = null
    climb = null
    dragOff.x = e.screenX - px
    dragOff.y = e.screenY - py
    dragStart.x = e.screenX
    dragStart.y = e.screenY
    lastMoveT = performance.now()
    vel.x = 0; vel.y = 0
    if (st !== 'thrown') set('drag')
    lastAct = performance.now()
  })

  window.addEventListener('mouseup', (e) => {
    if (!dragging) return
    dragging = false
    lastAct = performance.now()
    const speed = Math.hypot(vel.x, vel.y)
    if (!moved) {
      // 原地点击=摸头:回到拖拽前的面(顶边或地面),不触发掉落
      const back = dragFromSurface ? ledgeById(dragFromSurface.id) : null
      dragFromSurface = null
      if (back) {
        surface = { id: back.id }
        py = back.y - GROUND
        px = clamp(px, back.x + 30 - W / 2, back.x + back.w - 30 - W / 2)
      } else {
        surface = null
      }
      set('pet')
      playExpr('happy')
      bubble(pick(['喵!', '呼噜呼噜~', '蹭蹭']), 1200)
      return
    }
    dragFromSurface = null
    const l = snapLedge()
    if (l) {
      surface = { id: l.id }
      py = l.y - GROUND
      px = clamp(px, l.x + 30 - W / 2, l.x + l.w - 30 - W / 2)
      setPerch('stand')
      bubble('站高高~', 1200)
    } else if (speed > 420) {
      const k = Math.min(1, 2600 / speed)
      vel.x *= k; vel.y *= k
      bounces = 0
      set('thrown')
    } else if (feetY() < layout.groundY - 24) {
      startFall()
    } else {
      set('idle')
    }
  })

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    window.api.showMenu()
  })

  // ---------- 敲键反应 ----------
  window.api.onKey((d) => {
    if (!d.down || paused) return
    lastAct = performance.now()
    if (st === 'sleep') { set('idle'); bubble(pick(['哈欠…喵?', '嗯?叫我?']), 1400) }
    pawSide *= -1
    pawTapT = 0.13
    if (st === 'drag' || st === 'thrown') return
    if (d.code === 53) {
      bubble('!', 700) // Esc
      playExpr('surprise')
    } else {
      // 敲键抬爪表情:节流 350ms,避免连打时表情反复重启
      const now = performance.now()
      if (now - lastTapExpr > 350) {
        lastTapExpr = now
        playExpr('tap')
      }
    }
  })

  // ---------- 皮肤加载:有图像皮肤用图像,否则回退程序化猫 ----------
  async function loadSkin() {
    try {
      const s = await window.api.getSkin()
      // assets 为 v2 {states,expressions} 或 v1 {idle,...}(sprite-skin 内部 normalize)
      if (s && s.assets && (s.assets.states || s.assets.idle)) {
        spriteSkin = await window.createSpriteSkin(s.assets, {
          fps: s.fps,
          targetHeight: 250,
          cx: CX,
          ground: GROUND,
          ctx,
        })
        bubble('皮肤:' + (s.name || s.id), 1600)
        console.log('[skin] 已加载', s.id, JSON.stringify(s.assets))
      } else {
        spriteSkin = null
        console.log('[skin] 未找到图像皮肤,使用程序化猫')
      }
    } catch (e) {
      spriteSkin = null
      console.warn('[skin] 加载失败,回退程序化猫', e)
    }
  }

  // ---------- 主进程命令 ----------
  window.api.onCmd((d) => {
    if (d.type === 'layout') {
      layout = d.layout
      px = clamp(px || layout.x + layout.w / 2 - W / 2, walkMin(), walkMax())
      py = Math.min(py || layout.groundY, layout.groundY)
    } else if (d.type === 'keystatus') {
      if (!d.ok && !keyWarned) {
        keyWarned = true
        setTimeout(() => bubble('右键我可以开敲键权限,就能陪你打字啦', 3200), 1500)
      }
      if (d.ok && keyWarned) bubble('听到键盘啦!', 1400)
    } else if (d.type === 'pause') { paused = true; bubble('暂停中~', 1200) }
    else if (d.type === 'resume') { paused = false; lastAct = performance.now(); bubble('回来啦!') }
    else if (d.type === 'sleep-now') { set('sleep'); bubble('zzz') }
    else if (d.type === 'skins-updated') { loadSkin() }
    else if (d.type === 'ledges') {
      ledges = Array.isArray(d.ledges) ? d.ledges : []
      if (surface && !ledgeById(surface.id)) startFall()
      if (climb && !ledgeById(climb.id)) { climb = null; startFall() }
    } else if (d.type === 'ledge-gone') {
      if (surface && surface.id === d.id) startFall()
      else if (climb && climb.id === d.id) { climb = null; startFall() }
    }
  })

  // ---------- 主循环 ----------
  function syncWindow() {
    const X = Math.round(px)
    const Y = Math.round(py)
    if (X !== lastX || Y !== lastY) {
      window.api.moveWindow(X, Y)
      lastX = X; lastY = Y
    }
  }

  let last = 0
  function frame(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016)
    last = ts
    update(dt)
    ctx.clearRect(0, 0, W, H)
    const pose = computePose()
    if (spriteSkin) {
      try {
        spriteSkin.draw(pose, t, {
          state: st,
          stateT: stT,
          dt,
          squashT,
          air: clamp((layout.groundY - py) / 500, 0, 1),
        })
      } catch (e) {
        // 皮肤异常时回退程序化猫,保证循环不断
        console.warn('[skin] 渲染异常,回退程序化猫', e)
        spriteSkin = null
        drawCat(pose)
      }
    } else {
      drawCat(pose)
    }
    syncWindow()
    requestAnimationFrame(frame)
  }

  window.api.getLayout().then((l) => {
    layout = l
    px = l.x + l.w / 2 - W / 2
    py = l.groundY
    window.api.setIgnoreMouse(true, true)
    window.api.ready()
    loadSkin()
    requestAnimationFrame(frame)
    setTimeout(() => bubble('喵~ 拖我甩我点点我', 2600), 800)
  })
})()
