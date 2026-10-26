# 设计方案：表情/多帧动画 & 沿窗口顶边行走

版本 v0.2-draft · 2026-10-26 · 范围 desktop-pet (Electron, macOS 优先)

## 0. 现状诊断

渲染链路：`main.js resolveSkin()` 读 skin.json → `matteToPng()` 漫水抠图 →
`renderer/cat.js` FSM 产出 pose/状态 → `renderer/sprite-skin.js pick(state)` 取单帧图绘制。

三个问题：

1. **walk 只有 2 帧且画风不一致**（walk1 半写实正面走、walk2 卡通侧面走），8fps 交替播放 =
   "两只猫交替闪烁"，不是走路循环。
2. **没有表情维度**：表情 baked 在动作图里；程序化猫有 blink/happy/wide/closed 等眼睛状态，
   但图像皮肤不接收 `pose.eyes`，图像猫"永不眨眼、永远一张脸"。
3. **素材浪费**：`skins/default` 25 张图仅 7 张被 skin.json 引用。未引用的 18 张里有现成多帧素材：
   - `88e22dcf….jpg`：宫格 sheet，同画风**侧面走 3 连续帧** + 正面站 + 正面走；
   - `767fb4cd….jpg`：宫格 sheet，正面走 ×2、趴卧（loaf）、被摸头眯眼、白猫走、木桌坐（废）；
   - `3361eb….jpg` 站立挥爪、`68f9fd….jpg` 坐抬爪、`a66384….jpg` 肉垫特写、`0279b0….jpg` 头部特写。

结论：不引新依赖，沿现有"FSM 与皮肤分离"架构升级两条线：
**皮肤协议 v2（多帧 + 表情 + 宫格自动切帧）** 与 **可行走面抽象（ground → ground + 窗口顶边）**。

---

## 1. 特性 A：表情 / 多帧

### 1.1 目标

- 任意状态可多帧循环（walk 3–4 帧、idle 呼吸 2 帧、groom 2 帧）。
- 表情与动作正交：表情 = 可打断的短帧序列（once 播放完回落到当前状态帧）。
- 宫格 sheet 零配置切帧：丢一张宫格图进皮肤目录即自动切好。
- 完全兼容 skin.json v1（无 `version` 字段按 v1 解析，`walk: []` 映射为 `states.walk.frames`）。

### 1.2 非目标（v1 不做）

- 骨骼/Live2D/Spine；透明视频皮肤；在图像上局部重绘五官（"贴眼睛"式表情）。
- (state × expression) 笛卡尔积素材表——素材压力太大，v1 表情只做独立短序列，接口预留。

### 1.3 skin.json v2 协议

```json
{
  "version": 2,
  "name": "奶油猫 · 插画",
  "fps": 8,
  "states": {
    "idle":   { "frames": ["idle.jpg"], "fps": 2 },
    "walk":   { "sheet": "walk_sheet.jpg", "fps": 8 },
    "sleep":  { "frames": ["sleep.jpg"] },
    "drag":   { "frames": ["drag.jpg"] },
    "thrown": { "frames": ["drag.jpg"] },
    "pet":    { "frames": ["pet.jpg"], "fps": 6 },
    "groom":  { "frames": ["tap.jpg", "groom2.jpg"], "fps": 6 },
    "tap":    { "frames": ["tap.jpg"] }
  },
  "expressions": {
    "happy":    { "frames": ["pet.jpg"],     "once": true, "fps": 6 },
    "surprise": { "frames": ["drag.jpg"],    "once": true, "fps": 8, "hold": 0.35 },
    "blink":    { "frames": ["idle_blink.jpg"], "once": true, "fps": 12 }
  }
}
```

- `sheet`：默认自动连通域切帧；可选 `"grid": {"cols":3,"rows":2,"cells":[0,1,2]}` 覆盖。
- 状态缺省回退链：`states.X` 缺 → v1 同名字段 → `idle`。
- 表情 `hold`：播完后额外停留秒数再回落（surprise 用）。

### 1.4 主进程切帧（matteToPng 扩展）

1. 现有四边漫水抠背景（不变）。
2. 对 alpha > 8 的像素做 8-邻接连通域 BFS。
3. 丢弃面积 < 总像素 0.5% 的碎块；丢弃"扁条"组件（bbox 宽高比 > 4:1 且高 < 图高 8%，防残影条）。
4. 排序：按 bbox 中心 y 聚行（行间隔阈值 = 0.5 × 组件高度中位数），行内按 x。
5. 逐组件裁切输出 `.cache/<src>-cell-NN.png`，并写 manifest（src mtime → cells bbox）做增量缓存。
6. 保护：组件数 = 1 视为普通单图；> 12 告警并回退整图（防误切）。

资产规范配合：宫格图间隙 ≥ 24px、阴影必须与主体相连或不画阴影（独立灰色阴影岛会被当碎块/扁条处理）。

### 1.5 渲染层改动（sprite-skin.js）

- assets v2 结构：`{ states: { name: { frames: Image[], fps } }, expressions: { name: { frames, fps, once, hold } } }`。
- **帧时钟**：每状态独立累加器 `frameT`；切状态时清零（防 walk 帧相位跳变）；
  `idx = floor(frameT * fps) % frames.length`。
- **表情队列** `exprQueue`：触发即 push；播放期间暂停状态帧时钟；`once` 播完（+hold）回落，
  循环型表情（如未来 look）持续到取消。
- 二级动画保留不变：呼吸 sy、walk bob、落地 squash、pet 爱心粒子。
- `draw(pose, t, info)` 的 info 增加 `eyes/mouth` 透传（为未来视频皮肤留接口），v1 图像皮肤不使用。

### 1.6 表情事件表

| 触发事件 | 表情 | 现有素材可配 | 缺素材回退 |
| --- | --- | --- | --- |
| 随机眨眼计时（2.2–4.5s） | blink | 否（需补 idle_blink 图） | 跳过（图像猫不眨） |
| 点击摸头起始 | happy | 是：`[pet.jpg]` once | 不播 |
| Esc / 连续猛敲键 | surprise | 是：`[drag.jpg]` hold 0.35 | 不播 |
| 窗口顶边探头看下方（特性 B） | look | 否（需补） | idle 帧 |
| 被拎起 / 甩出 | 直接切 state=drag/thrown | 是 | — |

### 1.7 素材制作规范（给 AI 生图 / 画师）

- 同动作多帧：**一次生成宫格 sheet**（保证画风/画布/基准线一致），脚底同一水平线。
- 背景：纯白或浅灰棋盘格（RGB 各通道 ≥ 190、低饱和）；禁止有色背景/有色投影（木桌类抠不掉）。
- 尺寸：单图 ≤ 1024px，sheet ≤ 2048px；jpg/png 均可（jpg 走漫水）。
- 文件名任意，一律由 skin.json 引用。

### 1.8 现有素材清点与处置

| 资产 | 处置 |
| --- | --- |
| `walk1/walk2` | 降级为"正面走"2 帧备选，或删除 |
| `88e22dcf`（5 宫格） | 切帧：侧面走 3 帧 → `states.walk`；正面站 → idle 备选帧 |
| `767fb4cd`（6 宫格） | 切帧：正面走 2 帧 → walk_front 备选；loaf → sleep 备选；被摸 → pet 备选；木桌坐帧废 |
| `3361eb` 站立挥爪 | `tap` / 打招呼表情 |
| `68f9fd` 坐抬爪 | tap 备选帧 |
| `a66384` 肉垫特写 | 击掌互动贴纸（v2+） |
| `0279b0` 头部特写 | peek/探头表情（v2+） |
| `0d8736` 像素风 | 独立彩蛋皮肤 `pixel` |
| `11d257` 眼睛残帧 | 删除 |
| 其余未引用单图 | 实施时逐张目检归入备选帧或删除 |

### 1.9 预期效果（验收）

- 侧面走 3–4 帧循环 @8fps：无闪烁、无画风跳变，前后爪交替迈步可见。
- 摸头瞬间猫"开心眼"0.4s 后回落；Esc 时惊一下；配置了 blink 素材后会随机眨眼。
- 新宫格 sheet 丢进皮肤目录 + skin.json 三行配置，热重载即生效（复用现有 watchSkins）。
- 帧切换仅换 drawImage 源，CPU 占用不增加。

---

## 2. 特性 B：沿窗口顶边行走

### 2.1 目标

- 可行走面从"仅地面"扩展为：地面 + 任意普通窗口顶边 + 屏幕顶沿（菜单栏下缘，常驻 ledge）。
- 猫可跳上/跳下、沿顶边踱步、坐边沿往下看；窗口被拖动时猫同偏移跟随；窗口关闭/最小化时猫落下。

### 2.2 非目标（v1 不做）

- 屏幕顶沿倒挂行走；跨屏 ledge；"推窗口"物理。
- Windows 平台 v1 仅地面（v2 补 EnumWindows 采集）；Linux 不在范围。

### 2.3 采集层（macOS）

- 新增 `native/winlist.swift`：**独立小进程**（不与 keytap 的辅助功能权限耦合），
  每 500ms 调 `CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID)`，
  stdout 输出 JSON 行：`{"id","pid","x","y","w","h","layer"}`。
- 权限说明：window bounds / ownerPID **不需要**屏幕录制权限；
  **不读 kCGWindowName**（该字段需屏幕录制权限，且本功能不需要标题）。
- 主进程过滤得 `ledges[]`：
  - 排除自身 PID 及 Electron 辅助窗口；
  - 仅 `layer == 0`（普通窗口层）；排除 WindowServer / Dock / SystemUIServer 属主（菜单栏、Dock）；
  - `w >= 240` 且露出屏幕宽度 ≥ 120；
  - 窗口顶边与屏幕顶沿齐平（fullscreen/最大化）→ 归并入"屏幕顶沿 ledge"，不重复计；
  - 屏幕顶沿 ledge 常驻：`y = menuBarBottom`，横跨主屏宽。
- Windows（v2）：`EnumWindows + GetWindowRect + IsWindowVisible`，排除 tool window；
  打包为 winlist.exe 或 PowerShell Add-Type 内联脚本（冷启动 ~800ms，1Hz 轮询可接受）。

### 2.4 ledge 生命周期（主进程 ledge manager）

- 1Hz 与上一帧按 window id diff：新增 → 候选；bounds 变化 → 更新并推送
  `cmd {type:'ledges', ledges:[...]}`；消失 → 推送 `cmd {type:'ledge-gone', id}`。
- 猫在 ledge 上时维护 `cat.ledgeOffset = catCenterX - ledge.x`；ledge 更新后按新 bounds clamp，
  超出范围 → 猫走到最近端点或 fall。
- z-order 变化不影响表现：猫窗口 alwaysOnTop(floating)，视觉恒在目标窗口之前。

### 2.5 FSM 扩展（cat.js）

- 新增 `surface`：`{type:'ground'}` 或 `{type:'ledge', id, offset}`。
- 新增状态：
  - `climb`：抛物线运动到目标 ledge 顶（初速按高度差解算，复用 thrown 积分器），到位 → `perch`；
  - `perch`：边沿站立；子行为 look（往下看，循环表情）/ sit（sleep 图备选）/ 继续 walk；
  - `fall`：零初速自由落体（复用 thrown，bounces=1），落地 squash → idle。
- 决策参数：地面 idle 每 20–40s 有 30% 概率"想上去"，选水平距 < 400、高度差 < 500 的最近 ledge；
  ledge 上 idle 15–30s：50% 跳相邻重叠 ledge / 30% 跳下 / 20% 继续 perch。
- **ledge 上的 walk 范围按猫体宽而非窗口宽**：引入 `CAT_W = 170`，
  约束猫中心 `cx ∈ [ledge.x + 30, ledge.x + ledge.w - 30]`；地面 walk 维持现状（窗口宽范围）。
- 走到边沿：停步 → look 2–4s → 转身或 fall。
- 拖拽吸附：mouseup 时若猫脚底 ±24px 内有 ledge 顶边 → snap 为 perch（否则走原落地/甩出逻辑）。
- 睡觉可在 ledge 上 perch-sleep（zzz 照旧）。

### 2.6 窗口层与穿透

- 不新增 IPC 通道语义：位置仍走 `move-window`；`py = ledgeY - (WIN_H - 6)`，
  允许 py 小于 workArea.y（窗口透明区盖到菜单栏区域无副作用，命中测试已按 alpha 穿透）。
- 点击穿透逻辑（ignore-mouse + forward 命中测试）不变。
- 功耗：winlist 1Hz 轮询 + JSON 行解析，CPU < 1%。

### 2.7 入口与回退

- 右键菜单新增「窗口顶边散步」checkbox（默认开）；关闭 → ledges 清空、猫 fall 回地面。
- winlist 启动失败 / 非 macOS → 功能自动关，菜单项置灰并注明原因。
- 打包：`build.mac.extraResources` 增加 `native/winlist`（随 `scripts/build-helper.sh` 一并 lipo universal）。

### 2.8 预期效果（验收）

- 猫从地面起跳抛物线落上浏览器顶边（起落无瞬移），沿顶边用侧面走帧踱步（与特性 A 联动）。
- 拖动窗口：猫同步迈步跟随，无"滑行"感；拖出屏幕再拖回，猫仍在其上。
- 关闭窗口/最小化：猫 fall + 落地压扁；多窗口时可从 A 顶边跳到 B 顶边。
- 坐在边沿 look 往下看 + 敲键抬爪 = "陪你打字"完整形态。
- 菜单关闭后行为完全回到 v0.1 地面模式，无残留状态。

---

## 3. 里程碑

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| M1 多帧与切帧 | main.js 连通域切帧 + skin.json v2 解析 + sprite-skin 帧时钟 | 侧面走 3 帧循环不闪 |
| M2 表情层 | exprQueue + 事件表 + happy/surprise 配置落地 | 摸头开心眼插播 |
| M3 ledge 采集 | winlist.swift + ledge manager + 菜单开关 | 菜单可见实时 ledge 列表（日志） |
| M4 FSM 登高 | climb/perch/fall + 拖拽吸附 + README/打包 | 2.8 全条验收 |

风险与对策：宫格误切 → manifest 人工 grid 覆盖；窗口列表抖动 → id diff + 连续 2 帧确认才增删；
菜单栏层级差异 → 真机实测 floating 与 menu bar 叠放。

## 4. 接口变更清单

- `preload.js`：不变（ledge 信息复用 cmd 通道：`ledges` / `ledge-gone`）。
- `main.js`：`resolveSkin()` 支持 v2 + sheet 切帧；新增 `pollLedges()`；菜单项；extraResources。
- `renderer/cat.js`：surface/climb/perch/fall、walk 范围函数、CAT_W、表情事件触发点。
- `renderer/sprite-skin.js`：assets v2、帧时钟、exprQueue。
- `native/winlist.swift`：新增；`scripts/build-helper.sh` 增加其 universal 编译。
