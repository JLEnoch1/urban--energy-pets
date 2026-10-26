#!/usr/bin/env node
// 把 dist/ 里最新的安装包同步成官网固定下载名
// 用法: node scripts/sync-downloads.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const out = path.join(root, 'site', 'downloads')

const targets = [
  { match: /^DesktopPet-macOS-.*\.dmg$/, name: 'DesktopPet-macOS.dmg' },
  { match: /^DesktopPet-Windows-.*\.exe$/, name: 'DesktopPet-Windows.exe' },
]

if (!fs.existsSync(dist)) {
  console.error(`没有 ${path.relative(root, dist)}/,先执行 npm run build:mac / build:win`)
  process.exit(1)
}

fs.mkdirSync(out, { recursive: true })
const files = fs.readdirSync(dist)

let copied = 0
for (const t of targets) {
  const hits = files
    .filter((f) => t.match.test(f))
    .map((f) => ({ f, m: fs.statSync(path.join(dist, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  if (!hits.length) {
    console.warn(`⚠️  未找到 ${t.name} 的构件,跳过`)
    continue
  }
  const src = path.join(dist, hits[0].f)
  const dst = path.join(out, t.name)
  fs.copyFileSync(src, dst)
  const mb = (fs.statSync(dst).size / 1024 / 1024).toFixed(1)
  console.log(`✅ ${hits[0].f} → site/downloads/${t.name} (${mb} MB)`)
  copied++
}

if (!copied) {
  console.error('没有可同步的安装包')
  process.exit(1)
}
console.log('下载页已就绪:site/ 整个目录可直接部署到任意静态托管')
