'use strict'
// 桌宠主进程:透明置顶窗口 + 键位 helper 生命周期 + 窗口移动/点击穿透/菜单
const { app, BrowserWindow, screen, Menu, ipcMain, shell, nativeImage } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const fs = require('node:fs')
const { spawn, execFileSync } = require('node:child_process')
const readline = require('node:readline')
const { splitCells, splitGrid } = require('./lib/cell-split.js')
const { filterLedges, screenTopLedge } = require('./lib/ledges.js')

const WIN_W = 360
const WIN_H = 380
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'
const APP_ID = 'com.desktoppet.app' // 与 package.json build.appId 保持一致(Windows AUMID)

let win = null
let helperProc = null
let keyAccess = 'unknown' // ok | no-access | unavailable
let paused = false

// 打包后应用目录位于只读的 app.asar 内:皮肤缓存与用户皮肤改放 userData
const SKINS_DIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'skins')
  : path.join(__dirname, 'skins')
// 键位 helper 是原生二进制,打包后随 extraResources 落到 resources/native
const helperBin = app.isPackaged
  ? path.join(process.resourcesPath, 'native', 'keytap')
  : path.join(__dirname, 'native', 'keytap')
const helperSrc = path.join(__dirname, 'native', 'keytap.swift')
// 窗口列表采集 helper(无需任何 TCC 权限):开发态 swiftc 编译,打包后随 extraResources
const winlistBin = app.isPackaged
  ? path.join(process.resourcesPath, 'native', 'winlist')
  : path.join(__dirname, 'native', 'winlist')
const winlistSrc = path.join(__dirname, 'native', 'winlist.swift')

// 首次运行标记:只在首次运行时打开开机自启,之后完全尊重用户的手动开关
const AUTOLAUNCH_MARKER = path.join(app.getPath('userData'), '.autolaunch-initialized')

function autoLaunchOn() {
  try { return !!app.getLoginItemSettings().openAtLogin } catch { return false }
}

function setAutoLaunch(enabled) {
  try {
    app.setLoginItemSettings(
      isMac
        ? { openAtLogin: enabled, openAsHidden: true }
        : { openAtLogin: enabled, path: process.execPath, args: [] }
    )
    fs.mkdirSync(path.dirname(AUTOLAUNCH_MARKER), { recursive: true })
    fs.writeFileSync(AUTOLAUNCH_MARKER, `${enabled ? 'on' : 'off'} ${new Date().toISOString()}\n`)
    console.log(`[boot] 开机自启 → ${enabled ? '开' : '关'}`)
    return true
  } catch (e) {
    console.error('[boot] 设置开机自启失败:', e.message)
    return false
  }
}

// 安装后首次启动:默认开机自启(无任何引导弹窗);开发态不碰本机登录项
function bootstrapAutoLaunch() {
  if (!app.isPackaged) return
  try {
    if (fs.existsSync(AUTOLAUNCH_MARKER)) return
    if (!autoLaunchOn()) setAutoLaunch(true)
    else fs.writeFileSync(AUTOLAUNCH_MARKER, `on ${new Date().toISOString()}\n`)
  } catch (e) {
    console.error('[boot] 初始化开机自启失败:', e.message)
  }
}

// 打包后首次运行把内置皮肤拷到 userData,让用户可自由替换
function ensureUserSkins() {
  if (!app.isPackaged) return
  try {
    fs.mkdirSync(SKINS_DIR, { recursive: true })
    if (fs.readdirSync(SKINS_DIR).some((f) => !f.startsWith('.'))) return
    const src = path.join(__dirname, 'skins')
    if (!fs.existsSync(src)) return
    for (const d of fs.readdirSync(src, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('.')) continue
      fs.cpSync(path.join(src, d.name), path.join(SKINS_DIR, d.name), { recursive: true })
    }
    console.log('[skin] 已释放内置皮肤到', SKINS_DIR)
  } catch (e) {
    console.error('[skin] 释放内置皮肤失败:', e.message)
  }
}

// 首次启动或源码更新时用 swiftc 编译键位监听 helper(CGEventTap,需辅助功能权限)
function ensureHelper() {
  if (!isMac) { keyAccess = 'unavailable'; return false }
  if (app.isPackaged) {
    try {
      if (!fs.existsSync(helperBin)) throw new Error('缺少 native/keytap')
      fs.chmodSync(helperBin, 0o755)
      return true
    } catch (e) {
      console.error('[helper] 不可用:', e.message)
      keyAccess = 'unavailable'
      return false
    }
  }
  try {
    const stale =
      !fs.existsSync(helperBin) ||
      fs.statSync(helperSrc).mtimeMs > fs.statSync(helperBin).mtimeMs
    if (stale) execFileSync('swiftc', ['-O', helperSrc, '-o', helperBin], { stdio: 'pipe' })
    return true
  } catch (e) {
    console.error('[helper] 编译失败:', e.message)
    keyAccess = 'unavailable'
    return false
  }
}

function startHelper() {
  if (!isMac) return
  if (helperProc || !fs.existsSync(helperBin)) return
  helperProc = spawn(helperBin, [], { stdio: ['ignore', 'pipe', 'inherit'] })
  const rl = readline.createInterface({ input: helperProc.stdout })
  rl.on('line', (line) => {
    if (!win) return
    if (line === 'STATUS ok') {
      keyAccess = 'ok'
      win.webContents.send('cmd', { type: 'keystatus', ok: true })
    } else if (line === 'STATUS no-access') {
      keyAccess = 'no-access'
      win.webContents.send('cmd', { type: 'keystatus', ok: false })
    } else if (line.startsWith('K ')) {
      win.webContents.send('key', { code: Number(line.slice(2)), down: true })
    } else if (line.startsWith('U ')) {
      win.webContents.send('key', { code: Number(line.slice(2)), down: false })
    }
  })
  helperProc.on('exit', () => { helperProc = null })
}

// ---------- 窗口顶边(ledge)采集 ----------
// winlist 每 500ms 输出窗口矩形 JSON 行;主进程过滤 + id diff,变化才推送渲染层。
// 失败语义:二进制缺失/编译失败/启动崩溃 → ledgeWalk 自动关(菜单置灰),不影响其他功能。
let winlistProc = null
let ledgeWalk = true // 菜单开关,默认开
let ledges = [] // 最近一次推送的 ledge 列表(含 screen-top)
let lastWinsJson = ''

function ensureWinlist() {
  if (!isMac) return false
  if (app.isPackaged) {
    try {
      if (!fs.existsSync(winlistBin)) throw new Error('缺少 native/winlist')
      fs.chmodSync(winlistBin, 0o755)
      return true
    } catch (e) {
      console.error('[ledge] winlist 不可用:', e.message)
      return false
    }
  }
  try {
    const stale =
      !fs.existsSync(winlistBin) ||
      fs.statSync(winlistSrc).mtimeMs > fs.statSync(winlistBin).mtimeMs
    if (stale) execFileSync('swiftc', ['-O', winlistSrc, '-o', winlistBin], { stdio: 'pipe' })
    return true
  } catch (e) {
    console.error('[ledge] winlist 编译失败:', e.message)
    return false
  }
}

function computeLedges(wins) {
  const wa = screen.getPrimaryDisplay().workArea
  const ctx = { workArea: wa, selfPid: process.pid }
  const list = filterLedges(wins, ctx)
  list.push(screenTopLedge(ctx))
  return list
}

function pushLedges(next) {
  const key = (l) => `${l.id}:${l.x},${l.y},${l.w},${l.h}`
  const a = ledges.map(key).join('|')
  const b = next.map(key).join('|')
  if (a === b) return
  const gone = ledges.filter((o) => !next.some((n) => n.id === o.id)).map((o) => o.id)
  ledges = next
  console.log(`[ledge] push ${next.length} 条 (gone ${gone.length})`)
  if (win) {
    win.webContents.send('cmd', { type: 'ledges', ledges: next })
    for (const id of gone) win.webContents.send('cmd', { type: 'ledge-gone', id })
  }
}

function startWinlist() {
  if (!isMac || winlistProc || !ledgeWalk) return
  if (!ensureWinlist()) { ledgeWalk = false; return }
  winlistProc = spawn(winlistBin, [], { stdio: ['ignore', 'pipe', 'inherit'] })
  const rl = readline.createInterface({ input: winlistProc.stdout })
  rl.on('line', (line) => {
    if (!ledgeWalk) return
    let wins = null
    try { wins = JSON.parse(line) } catch { return }
    const json = JSON.stringify(wins)
    if (json === lastWinsJson) return // 窗口没动就不重算不推送
    lastWinsJson = json
    pushLedges(computeLedges(wins))
  })
  winlistProc.on('exit', () => {
    winlistProc = null
    console.error('[ledge] winlist 退出,顶边散步关闭')
    ledgeWalk = false
    pushLedges([])
  })
}

function stopWinlist() {
  if (winlistProc) {
    winlistProc.kill()
    winlistProc = null
  }
  lastWinsJson = ''
  pushLedges([])
}

function setLedgeWalk(on) {
  ledgeWalk = !!on
  if (ledgeWalk) startWinlist()
  else stopWinlist()
}

// 主屏工作区 + 猫站立交面(窗口底边贴工作区底边)
function layout() {
  const wa = screen.getPrimaryDisplay().workArea
  return {
    x: wa.x, y: wa.y, w: wa.width, h: wa.height,
    winW: WIN_W, winH: WIN_H,
    groundY: wa.y + wa.height - WIN_H,
  }
}

// ---------- 皮肤资产:把"画出来的棋盘格背景"抠成真透明 PNG ----------
// 规则:从中性灰白(棋盘格/浅阴影)像素出发,从四边漫水,只吃连通区域,
// 不碰被描边包住的白色毛发,也不碰奶油色毛发(有色相)。
// matteImage 返回抠图后的 bitmap/alpha;sheet 素材再经 lib/cell-split 切帧。
function matteImage(src) {
  let img = nativeImage.createFromPath(src)
  if (img.isEmpty()) throw new Error('无法解码图片')
  const maxSide = 720
  const orig = img.getSize()
  if (Math.max(orig.width, orig.height) > maxSide) {
    const k = maxSide / Math.max(orig.width, orig.height)
    img = img.resize({ width: Math.max(1, Math.round(orig.width * k)), quality: 'best' })
  }
  const { width: w, height: h } = img.getSize()
  const buf = img.toBitmap() // 与 createFromBitmap 同格式的回环(alpha 在 +3)
  const n = w * h
  const bgLike = (p) => {
    const i = p * 4
    const c0 = buf[i], c1 = buf[i + 1], c2 = buf[i + 2]
    const mx = Math.max(c0, c1, c2)
    const mn = Math.min(c0, c1, c2)
    return mx - mn <= 14 && mn >= 190
  }
  const seen = new Uint8Array(n)
  const q = new Int32Array(n)
  let qh = 0, qt = 0
  const push = (x, y) => {
    const p = y * w + x
    if (!seen[p] && bgLike(p)) { seen[p] = 1; q[qt++] = p }
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y) }
  while (qh < qt) {
    const p = q[qh++]
    const x = p % w
    const y = (p / w) | 0
    if (x > 0) push(x - 1, y)
    if (x < w - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < h - 1) push(x, y + 1)
  }
  let bgCount = 0
  const alpha = new Uint8Array(n)
  let anyFg = false
  for (let p = 0; p < n; p++) {
    if (seen[p]) { buf[p * 4 + 3] = 0; bgCount++ }
    alpha[p] = buf[p * 4 + 3]
    if (alpha[p] > 8) anyFg = true
  }
  if (!anyFg) throw new Error('整张图都被判为背景')
  return { buf, alpha, w, h, bgCount, n }
}

// 按 cell 裁切 bitmap 为独立 PNG 图像;cell=null 时用全图 alpha 包围盒(单图行为)
function cropImage(m, cell) {
  const pad = 2
  let c = cell
  if (!c) {
    let minX = m.w, minY = m.h, maxX = -1, maxY = -1
    for (let p = 0; p < m.n; p++) {
      if (m.alpha[p] <= 8) continue
      const x = p % m.w
      const y = (p / m.w) | 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    c = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  }
  const x0 = Math.max(0, c.x - pad)
  const y0 = Math.max(0, c.y - pad)
  const x1 = Math.min(m.w, c.x + c.w + pad)
  const y1 = Math.min(m.h, c.y + c.h + pad)
  const cw = x1 - x0
  const ch = y1 - y0
  const out = new Uint8Array(cw * ch * 4)
  for (let y = 0; y < ch; y++) {
    out.set(m.buf.subarray(((y0 + y) * m.w + x0) * 4, ((y0 + y) * m.w + x1) * 4), y * cw * 4)
  }
  return nativeImage.createFromBitmap(Buffer.from(out.buffer), { width: cw, height: ch })
}

function matteToPng(src, dst) {
  const m = matteImage(src)
  fs.writeFileSync(dst, cropImage(m, null).toPNG())
  console.log(`[skin] matte ${path.basename(src)} ${m.w}x${m.h} 背景=${((m.bgCount / m.n) * 100).toFixed(1)}%`)
}

// 扫描皮肤目录:单图 → .cache/<base>.png;skin.json sheets 声明的宫格 → 切帧 .cache/<base>-cell-NN.png
// manifest.json 记录 src mtime 与切帧结果,源图未变且 cell 文件齐全时跳过重切(增量缓存)
function buildCacheForSkin(skinDir, cfg) {
  const cacheDir = path.join(skinDir, '.cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  const manifestPath = path.join(cacheDir, 'manifest.json')
  let manifest = {}
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch {}
  const files = fs
    .readdirSync(skinDir)
    .filter((f) => IMG_EXT.has(path.extname(f).toLowerCase()))
  const sheetSpecs = (cfg && cfg.sheets) || {}
  const built = {}
  const sheets = {}
  const nextManifest = {}
  for (const f of files) {
    const src = path.join(skinDir, f)
    const base = path.basename(f, path.extname(f))
    const mtime = fs.statSync(src).mtimeMs
    const spec = sheetSpecs[f] || sheetSpecs[base]
    const cached = manifest[f]
    const cachedPaths = cached && Array.isArray(cached.cells)
      ? cached.cells.map((c) => path.join(cacheDir, c.file))
      : null
    const freshCells = !!(cachedPaths && cached.mtime === mtime && cachedPaths.every((p) => fs.existsSync(p)))
    try {
      if (spec) {
        if (freshCells) {
          sheets[f] = { cells: cachedPaths, overflow: !!cached.overflow }
          nextManifest[f] = cached // 必须回填,否则 manifest 丢 sheet 条目导致下轮重切
        } else {
          const m = matteImage(src)
          const r = spec.grid
            ? splitGrid(m.alpha, m.w, m.h, spec.grid)
            : splitCells(m.alpha, m.w, m.h)
          if (r.overflow || !r.cells.length) {
            const out = path.join(cacheDir, base + '.png')
            fs.writeFileSync(out, cropImage(m, null).toPNG())
            sheets[f] = { cells: [out], overflow: true }
            nextManifest[f] = { mtime, cells: [{ file: path.basename(out) }], overflow: true, warnings: r.warnings }
            console.error(`[skin] sheet ${f} 切帧失败/组件过多,回退整图单帧`)
          } else {
            const cells = r.cells.map((c, i) => {
              const file = `${base}-cell-${String(i).padStart(2, '0')}.png`
              fs.writeFileSync(path.join(cacheDir, file), cropImage(m, c).toPNG())
              return { file, x: c.x, y: c.y, w: c.w, h: c.h }
            })
            sheets[f] = { cells: cells.map((c) => path.join(cacheDir, c.file)), overflow: false }
            nextManifest[f] = { mtime, cells, warnings: r.warnings }
            console.log(`[skin] sheet ${f} → ${cells.length} 帧`, r.warnings.join(' | '))
          }
        }
        continue
      }
      const out = path.join(cacheDir, base + '.png')
      const fresh = fs.existsSync(out) && fs.statSync(out).mtimeMs >= mtime
      if (!fresh) matteToPng(src, out)
      built[f] = out
      nextManifest[f] = { mtime, cells: [{ file: path.basename(out) }] }
    } catch (e) {
      console.error('[skin] 处理失败', f, e.message)
    }
  }
  try {
    // 内容不变不重写:manifest 写入会触发 watchSkins 自循环重载
    const json = JSON.stringify(nextManifest, null, 1)
    let prev = null
    try { prev = fs.readFileSync(manifestPath, 'utf8') } catch {}
    if (prev !== json) fs.writeFileSync(manifestPath, json)
  } catch (e) {
    console.error('[skin] manifest 写入失败', e.message)
  }
  return { built, sheets }
}

// skin.json v1/v2 → 统一 v2 assets:{ states:{name:{frames[],fps?}}, expressions:{...} }
// frames 取值:string(单图/整表 sheet) | string[](单图序列) | {sheet,cells[],frames[],fps}
function resolveSkin() {
  if (!fs.existsSync(SKINS_DIR)) return null
  const ids = fs
    .readdirSync(SKINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
  for (const id of ids) {
    const dir = path.join(SKINS_DIR, id)
    let cfg = {}
    try { cfg = JSON.parse(fs.readFileSync(path.join(dir, 'skin.json'), 'utf8')) } catch {}
    const { built, sheets } = buildCacheForSkin(dir, cfg)
    const names = Object.keys(built)
    if (!names.length && !Object.keys(sheets).length) continue
    const url = (p) => (p ? pathToFileURL(p).href : null)
    const findSingle = (name) => {
      if (!name) return null
      if (built[name]) return built[name]
      const hit = names.find((f) => f.toLowerCase() === String(name).toLowerCase())
      return hit ? built[hit] : null
    }
    const framesOf = (v) => {
      if (!v) return null
      if (typeof v === 'string') {
        if (sheets[v]) return { frames: sheets[v].cells.map(url) }
        const p = findSingle(v)
        return p ? { frames: [url(p)] } : null
      }
      if (Array.isArray(v)) {
        const frames = []
        for (const item of v) {
          if (typeof item === 'string' && sheets[item]) frames.push(...sheets[item].cells.map(url))
          else {
            const p = findSingle(item)
            if (p) frames.push(url(p))
          }
        }
        return frames.length ? { frames } : null
      }
      if (typeof v === 'object') {
        let frames = []
        if (v.sheet && sheets[v.sheet]) {
          const all = sheets[v.sheet].cells
          frames = Array.isArray(v.cells) && v.cells.length
            ? v.cells.filter((i) => i >= 0 && i < all.length).map((i) => url(all[i]))
            : all.map(url)
        }
        if (Array.isArray(v.frames)) {
          for (const item of v.frames) {
            if (typeof item === 'string' && sheets[item]) frames.push(...sheets[item].cells.map(url))
            else {
              const p = findSingle(item)
              if (p) frames.push(url(p))
            }
          }
        }
        return frames.length ? { frames, fps: v.fps, anim: v.anim } : null
      }
      return null
    }
    const states = {}
    const put = (name, f) => {
      if (f && f.frames && f.frames.length) states[name] = { frames: f.frames, fps: f.fps, anim: f.anim }
    }
    if (cfg.version === 2 && cfg.states) {
      for (const [name, spec] of Object.entries(cfg.states)) put(name, framesOf(spec))
    } else {
      put('idle', framesOf(cfg.idle))
      put('walk', framesOf(cfg.walk))
      put('tap', framesOf(cfg.tap))
      put('sleep', framesOf(cfg.sleep))
      put('drag', framesOf(cfg.drag))
      put('pet', framesOf(cfg.pet))
      put('thrown', framesOf(cfg.thrown))
      put('groom', framesOf(cfg.groom || cfg.tap))
    }
    if (!states.idle && names.length) put('idle', framesOf(names.slice().sort()[0]))
    if (!states.idle) continue
    const expressions = {}
    if (cfg.version === 2 && cfg.expressions) {
      for (const [name, spec] of Object.entries(cfg.expressions)) {
        const f = framesOf(spec)
        if (!f) continue
        expressions[name] = {
          frames: f.frames,
          fps: (spec && spec.fps) || cfg.fps || 8,
          once: !spec || spec.once !== false,
          hold: (spec && spec.hold) || 0,
        }
      }
    }
    return {
      id,
      name: cfg.name || id,
      fps: cfg.fps || 8,
      assets: { states, expressions },
    }
  }
  return null
}

// 皮肤目录变化 → 通知渲染层热重载
function watchSkins() {
  try {
    if (!fs.existsSync(SKINS_DIR)) fs.mkdirSync(SKINS_DIR, { recursive: true })
    let t = null
    fs.watch(SKINS_DIR, { recursive: true }, () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        if (win) win.webContents.send('cmd', { type: 'skins-updated' })
      }, 700)
    })
  } catch (e) {
    console.error('[skin] 目录监听失败', e.message)
  }
}

function createWindow() {
  const l = layout()
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: Math.round(l.x + l.w / 2 - WIN_W / 2),
    y: l.groundY,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setAlwaysOnTop(true, isMac ? 'floating' : 'normal')
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.on('closed', () => { win = null })
}

function popupMenu() {
  const items = [
    {
      label: paused ? '唤醒' : '暂停',
      click: () => {
        paused = !paused
        if (win) win.webContents.send('cmd', { type: paused ? 'pause' : 'resume' })
      },
    },
    { label: '现在睡觉', click: () => win && win.webContents.send('cmd', { type: 'sleep-now' }) },
    {
      label: '窗口顶边散步',
      type: 'checkbox',
      checked: ledgeWalk,
      enabled: isMac,
      click: (item) => setLedgeWalk(item.checked),
    },
    { label: '重新加载皮肤', click: () => win && win.webContents.send('cmd', { type: 'skins-updated' }) },
    { label: '打开皮肤文件夹', click: () => shell.openPath(SKINS_DIR) },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: autoLaunchOn(),
      click: (item) => setAutoLaunch(item.checked),
    },
  ]
  if (isMac) {
    items.push(
      { type: 'separator' },
      { label: keyAccess === 'ok' ? '敲键监听:开' : '敲键监听:关(无辅助功能权限)', enabled: false },
      {
        label: '打开敲键权限设置…',
        click: () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'),
      }
    )
  }
  items.push({ type: 'separator' }, { label: '退出', click: () => app.quit() })
  Menu.buildFromTemplate(items).popup()
}

ipcMain.on('renderer-ready', () => {
  if (!win) return
  win.webContents.send('cmd', { type: 'layout', layout: layout() })
  win.webContents.send('cmd', { type: 'keystatus', ok: keyAccess === 'ok' })
  if (ledges.length) win.webContents.send('cmd', { type: 'ledges', ledges })
  startHelper()
  if (ledgeWalk) startWinlist()
})
ipcMain.on('ignore-mouse', (_e, ignore, forward) => {
  if (win) win.setIgnoreMouseEvents(!!ignore, { forward: !!forward })
})
ipcMain.on('move-window', (_e, x, y) => {
  if (win) win.setPosition(Math.round(x), Math.round(y), false)
})
ipcMain.handle('get-layout', () => layout())
ipcMain.handle('skins:get', () => resolveSkin())
ipcMain.on('show-menu', () => popupMenu())
ipcMain.on('open-accessibility', () => {
  if (!isMac) return
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // 安装后自启/重复点击图标:不新开窗口,只把已有窗口提到眼前
  app.on('second-instance', () => {
    if (!win) return
    win.showInactive()
    win.focus()
  })
}

if (isWin) app.setAppUserModelId(APP_ID)

app.whenReady().then(() => {
  ensureUserSkins()
  bootstrapAutoLaunch()
  ensureHelper()
  createWindow()
  watchSkins()
  if (isMac && app.dock) app.dock.hide()
  screen.on('display-metrics-changed', () => {
    lastWinsJson = '' // 工作区变化:强制下一行窗口数据重算 ledge
    if (win) win.webContents.send('cmd', { type: 'layout', layout: layout() })
  })
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  if (helperProc) helperProc.kill()
  if (winlistProc) winlistProc.kill()
})
