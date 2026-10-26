# 视频皮肤方案设计：即梦/可灵 image-to-video → 抠像透明 WebM → 皮肤层替换

> 版本 v1.0 · 2026-10-26
> 目标：在不改动 `renderer/cat.js` 行为 FSM 的前提下，用 AI 生成的透明视频片段替换现有静态图皮肤，
> 得到"真猫动起来"的桌宠，且方案可在多角色、多套皮肤之间复用。

---

## 0. 现状与总体架构

### 0.1 现有代码里已经预留的接缝

| 现有事实 | 对本方案的意义 |
| --- | --- |
| `cat.js` 的 FSM 只产出状态名（`idle/walk/groom/pet/thrown/sleep/drag`）+ `pose` 对象，经 `info` 传给皮肤 | 皮肤层是纯渲染插件，换皮肤零 FSM 改动 |
| 皮肤契约是 `{ draw(p, now, info) }`（见 `sprite-skin.js`） | 新视频皮肤实现同一契约即可即插即用 |
| `cat.js loadSkin()` 已有 try/catch：皮肤异常 → 回退程序化猫 | 整层降级兜底已存在，只需在其下再补"单状态降级" |
| `main.js resolveSkin()` 读 `skin.json` 返回 file:// URL 资产表 | 只需增量扩展一个 `clips` 字段，向后兼容 |
| 渲染画布 360×380，角色目标高度 250px，DPR 1–2 | 决定交付分辨率上限 ≈ 512px（250×2） |
| FSM 状态时长：`groom 1.5s`、`pet 1.1s`、`walk 1.8–4.2s`、`tap` 抬爪 0.13s | **素材时长必须适配 FSM，而不是反过来**（见 §1.3） |

已知小问题顺带记录：`sprite-skin.js` 的 `pick()` 有 `case 'tap'`，但 FSM 从不 `set('tap')`（敲键只是
`pawTapT` 叠加姿态）。视频皮肤同样把 `tap` 定义为"可选叠加片段"，不作为 FSM 状态绑定。

### 0.2 三段式管线总览

```
┌─────────────── 素材侧（离线·人工+AI） ───────────────┐
│ skins/<id>/raw/<state>.mp4                            │
│ 即梦/可灵 图生视频：首帧=尾帧=现有静态图               │
│ 统一规格：720×720 / 24fps / 时长档位 / 命名 / 白底     │
└──────────────────────┬────────────────────────────────┘
                       ▼
┌─────────────── 抠像侧（离线·全自动批处理） ───────────┐
│ tools/matting/：归一化 → 防抖 → RVM抠像 → 去溢色      │
│ → alpha时域平滑 → VP9 yuva420p 编码                   │
│ → qc.py 自动质检（α有效性/角落残留/接缝PSNR/闪烁指数） │
│ 产出 skins/<id>/clips/<state>.webm + preview + qc.json│
└──────────────────────┬────────────────────────────────┘
                       ▼  QC PASS 才允许进包
┌─────────────── 播放侧（运行时·Electron） ─────────────┐
│ main.js resolveSkin() 扩展 clips 资产表               │
│ renderer/video-skin.js：与 sprite-skin 同契约          │
│ 双通道 video 乒乓 + crossfade；P0/P1/P2 预加载         │
│ 降级链：视频片段 → 静态图 → 程序化猫                   │
└───────────────────────────────────────────────────────┘
```

---

## 1. 素材侧：生成规范

### 1.1 状态 → 片段映射表（唯一权威定义）

| 片段名 | FSM 状态 | 播放模式 | 时长档位 | 画面要求 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| `idle` | idle | loop | 2–4s | 原地呼吸、眨眼、尾巴慢摆、偶尔抖耳 | P0 |
| `walk` | walk | loop | 2–3s | **原地侧身小跑**（位移由窗口移动实现，素材禁止横移出画） | P0 |
| `sleep` | sleep | loop | 3–4s | 蜷卧起伏，幅度要小 | P1 |
| `groom` | groom | once | **≤1.5s** | 舔爪/蹭脸一次，收尾回到中性站姿 | P1 |
| `pet` | pet | once | **≤1.1s** | 被摸头开心反应（眯眼/蹭手），爆发式短动作 | P1 |
| `drag` | drag | loop | 2–3s | 被拎起四肢悬空挣扎，可夸张 | P2 |
| `thrown` | thrown | once | ≤1.0s | 空中惊慌姿态（旋转/压扁由 pose 叠加，素材只做姿态） | P2 |
| `tap` | （叠加，非状态） | once | ≤0.6s | 可选：抬爪拍键。缺省由 pose `pawTapT` 变换近似 | P3 |

规则：
- `loop` 类首尾帧必须像素级一致（见 §1.4）；`once` 类尾帧应回到**中性站姿**，方便与 `idle` 首帧硬衔接。
- 一个动作可生成多套变体 `idle_a / idle_b`，manifest 里声明随机池，避免长时间挂机看腻（见 §4）。
- 所有片段角色**面朝右**，运行时用 `pose.face` 镜像；不要生成左右两个方向。

### 1.2 统一生成参数

| 参数 | 规范值 | 理由 |
| --- | --- | --- |
| 生成工具 | 可灵 2.1+（首选）/ 即梦 | 可灵有原生「首尾帧」+「循环优化」开关；即梦做备选与风格 A/B |
| 输入首帧 | `skins/<id>/.cache/<state>.png`（现有抠好的透明 PNG，合成到统一底板） | 保证各片段角色身份、比例、笔触完全一致 |
| 画布 | 1:1，角色占画面高度 ~70%，**脚底贴画面下 1/6 线**，四周留白 ≥12% | 给动作位移留余量，避免出画；锚点与现有 sprite 对齐 |
| 背景 | 纯白 `#FFFFFF`（推荐）或中性浅灰 | 与现有静态图底板一致；**不用绿幕**（奶油色/白色毛发溢色难处理，AI 生成绿幕本身带渐变噪声） |
| 分辨率 | 平台最高档（≥720p） | 后期缩到 512 交付，超采样抗噪 |
| 帧率 | 24fps（若平台只出 30fps，管线统一重采样到 24） | 交付帧率 |
| 时长 | 按 §1.1 档位；可灵循环模式固定 5s 时，生成后裁剪 | 循环模式短时长更易收敛 |
| 种子 | 固定并记录（写进 manifest `gen` 字段） | 可复现、可增量补生成 |
| 运镜 | 锁死：无推拉摇移、无变焦 | 任何运镜都会破坏抠像与循环 |

**底板合成命令**（把透明 PNG 放到纯白 1:1 底板，作为图生视频的首帧输入）：

```bash
ffmpeg -i .cache/idle.png -vf "scale=720:-2:flags=lanczos,\
  pad=720:720:(ow-iw)/2:oh-ih*5/6:white" -frames:v 1 raw_in/idle.png
```

### 1.3 时长与 FSM 的适配原则

FSM 不改，所以 `groom(1.5s)/pet(1.1s)` 的片段**必须按档位生成短素材**，而不是生成 4s 再加速。
兜底机制：manifest 每个片段可声明 `targetDur`，播放器加载时一次性设置
`playbackRate = clipDur / targetDur`（clamp 到 0.75–1.6，超出则宁可截断播放）。禁止运行时逐帧 seek 对齐。

### 1.4 无缝循环三保险

1. **首尾帧模式**：可灵「首尾帧」上传**同一张图**作为首帧和尾帧 → 像素级闭环（最强保险）。
2. **循环开关**：可灵 2.1+ 勾选「循环优化/循环视频」；提示词必须包含闭环语义。
3. **提示词三段式**（起始-过程-回归）：

```text
（idle 模板）
起始：猫咪四足站立，面朝右侧，尾巴自然下垂。
过程：原地轻微呼吸起伏，缓慢眨眼一次，尾巴柔和地左右摆动两次，耳朵偶尔抖动。
回归：动作结束时姿态与起始帧完全一致，四足位置不变，支持无限循环播放。
镜头完全固定，无任何推拉摇移。纯白色背景，无阴影投射到背景，无其他物体。
角色不得走出画面，不得出现肢体畸变或额外肢体。
```

```text
（walk 模板）
起始：猫咪侧身站立面朝右。
过程：原地小跑，四肢交替迈步两个完整步态周期，身体轻微上下起伏，尾巴上扬摆动。
回归：结束时四肢与身体回到与起始帧完全相同的位置，支持无限循环。
角色保持在画面中央，不向任何方向位移。镜头固定。纯白背景。
```

生成后**人工验收 30 秒**（循环预览 3 遍）：无跳变、无肢体畸变、无身份漂移（花色/瞳色/笔触一致）、
背景干净无残影，才进 `raw/`。每状态建议生成 2–3 个候选，按 QC 分数择优。

### 1.5 目录与命名规范

```
skins/<skin_id>/
├── skin.json                 # v2 清单（§4.1）
├── raw/                      # AI 生成原始产物（不进安装包）
│   ├── idle.mp4
│   ├── idle@2.mp4            # 变体用 @N 后缀
│   └── walk.mp4
├── clips/                    # 抠像交付产物（进安装包）
│   ├── idle.webm
│   ├── idle.thumb.png        # 首帧缩略图（降级占位/预览）
│   └── _qc.json              # 全片 QC 报告
├── idle.jpg …                # 现有静态图保留：降级链第二级
└── .cache/                   # 现有 PNG 缓存保留
```

命名：`<state>[_<variant>].webm`，state 仅限 §1.1 表中的 8 个键；全小写下划线。
管线按文件名自动路由（`raw/walk.mp4 → clips/walk.webm`），**不允许自由命名**。

---

## 2. 抠像侧：批量透明化管线

### 2.1 路线选择

| 路线 | 工具 | 适用 | 结论 |
| --- | --- | --- | --- |
| A. 色度/色键 | ffmpeg `colorkey/chromakey + despill` | 背景纯且平、角色无白/奶油色 | 只做**快速通道**与失败兜底；对白底奶油猫易啃掉浅色毛发 |
| B. AI 时序抠像 | **RVM（RobustVideoMatting）** | 任意背景、发丝级 alpha、帧间传播抗闪烁 | **主路线**：批量、半透明发丝、时域稳定三项全占 |
| C. 逐帧图像抠像 | rembg/MODNet 每帧独立 | — | 禁用：帧间独立必然闪烁 |

主流程 = B，A 作为 RVM 环境不可用时的降级。以下命令均基于本机 ffmpeg 9.0（已确认安装）。

### 2.2 批处理管线（`tools/matting/`）

```
raw/<state>.mp4
  ①归一化  scale/pad 720×720, 24fps, yuv420p
  ②防抖    vidstabdetect → vidstabtransform（生成画面漂移时启用）
  ③抠像    RVM: foreground(FGA) + alpha 序列输出（16bit png）
  ④修边    alpha: 高斯羽化0.5px → 电平重映射(去灰雾) → 时域EMA平滑(残差闪烁)
  ⑤去溢色  despill：白底路线做亮度守恒合成校正；绿幕路线做绿色抑制
  ⑥编码    libvpx-vp9 yuva420p, crf 30, auto-alt-ref 0
  ⑦质检    qc.py（§2.4）→ PASS 落 clips/，FAIL 落 rejected/ + 诊断预览
```

关键命令：

```bash
# ① 归一化（同时把 30fps 平台产物统一到 24fps）
ffmpeg -y -i raw/walk.mp4 -vf "fps=24,scale=720:720:force_original_aspect_ratio=decrease,\
  pad=720:720:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p" -an work/walk.norm.mp4

# ② 防抖（仅当 QC 检出全局漂移）
ffmpeg -i work/walk.norm.mp4 -vf vidstabdetect=shakiness=5:accuracy=15 -f null -
ffmpeg -y -i work/walk.norm.mp4 -vf vidstabtransform=smoothing=30:zoom=2,\
  crop=720:720,format=yuv420p -an work/walk.stab.mp4

# ③ RVM 抠像（PyTorch，MobileNetV3 骨干，CPU 即可跑 720p×3s）
python rvm_infer.py --src work/walk.stab.mp4 --dst work/walk --format png_sequence \
  --model mobilenetv3 --downsample-ratio 1 --seq-chunk 16

# ⑤+⑥ 合成透明 WebM：先 720 处理、交付尺寸 512 编码
ffmpeg -y -framerate 24 -i work/walk/fga/%05d.png -i work/walk/pha/%05d.png \
  -filter_complex "[0:v][1:v]alphamerge,\
    scale=512:512:flags=lanczos,\
    geq=lum='(1-1.15*(1-alpha(X,Y)))*p(X,Y)':cr='(1-1.15*(1-alpha(X,Y)))*p(X,Y)':cb='(1-1.15*(1-alpha(X,Y)))*p(X,Y)',\
    format=yuva420p" \
  -c:v libvpx-vp9 -pix_fmt yuva420p -crf 30 -b:v 0 -deadline good -cpu-used 2 \
  -row-mt 1 -auto-alt-ref 0 -metadata:s:v:0 alpha_mode=1 -an clips/walk.webm
```

要点（每一条都是踩坑结论）：
- `-auto-alt-ref 0` **必选**：VP9 的 alternate reference frame 不携带 alpha side-stream，开着会静默产出透明损坏的文件（不报错）。
- `-pix_fmt yuva420p` 必须显式指定，否则 ffmpeg 默认丢弃 alpha。
- `geq` 一项是**白底合成校正**：白底抠像的半透明边缘像素 = α·角色 + (1−α)·白，直接当 premultiplied 用会发白边；按 α 反推把白色贡献除掉（系数 1.15 略过补偿，吃掉溢色亮边）。绿幕路线换成 despill（限制 G ≤ max(R,B)）。
- 交付 512×512：250px 目标高 × DPR2 = 500，512 是覆盖上限的最小档；比 720 省 ~55% 码率与解码开销。
- 不加 `-g 1`：loop 播放不需要全关键帧，加了体积翻倍。

### 2.3 三类质量问题的针对性处理

| 问题 | 现象 | 处理 |
| --- | --- | --- |
| 边缘溢色 | 毛发外圈白边/彩边 | §2.2 的 α 反推去底 + alpha 腐蚀 1px 后再羽化 0.5px（`erosion` 或形态学），QC 用角落/边缘采样把关 |
| 发丝半透明 | 抠像把细毛啃成硬边，或整体灰雾 | 只用 RVM 输出的连续 alpha（不二值化）；alpha 电平重映射 `input_low=0.02, input_high=0.92` 去灰雾但保留渐变；VP9 crf 不高于 30（alpha 平面同样吃压缩噪声） |
| 画面闪烁 | alpha 边缘逐帧抖动（呼吸感） | 三层：生成端固定种子+锁运镜（源头）；抠像端 RVM 时域传播（模型自带）；后处理对 alpha 做时域 EMA `α' = 0.7·α_t + 0.3·α'_{t-1}`（只作用于 0<α<1 的边缘带，实心区不动，避免拖影） |
| 画面抖动 | 角色整体漂移/缩放呼吸 | 生成端提示词锁角色位置；后处理 vidstab；QC 用相邻帧主体质心偏移量把关（>2px 判 FAIL） |

### 2.4 自动质检（`tools/matting/qc.py`）

对每个产出 webm 跑全量指标，写 `clips/_qc.json`，任何 FAIL 不落 `clips/`：

| # | 检查项 | 方法 | 阈值 |
| --- | --- | --- | --- |
| 1 | 容器合规 | ffprobe：codec=vp9, pix_fmt 含 alpha（用 `-c:v libvpx-vp9` 解码验证，**不信 metadata**）, 512×512, 24fps | 全等于 |
| 2 | alpha 有效性 | 解码首/中/尾三帧，读 alpha 平面 min/max | min ≤ 8 且 max ≥ 247 |
| 3 | 背景残留 | 四角 16×16 区域 alpha 最大值 | ≤ 6 |
| 4 | 主体完整 | alpha>128 像素占比 | 8%–60%（防空帧/满帧） |
| 5 | 循环接缝 | `last_frame vs first_frame` PSNR / SSIM（loop 类片段） | PSNR ≥ 35dB 且 SSIM ≥ 0.97 |
| 6 | 时域闪烁 | 逐帧 alpha 平面差值均值序列，`FI = mean|Δ²| / mean|Δ|` | FI ≤ 0.35（经验值，首批素材标定后固化） |
| 7 | 主体漂移 | 相邻帧 alpha 质心位移 | ≤ 2px/帧，全片累计 ≤ 6px |
| 8 | 体积 | 文件大小 | ≤ 1.2MB/片段（整包 8 片段 ≤ 8MB） |
| 9 | 可播性 | headless Chromium（Playwright）加载 `<video>` seek 到中段取一帧，验证非黑非透 | 有有效像素 |

FAIL 时自动产出 `rejected/<state>.diag.mp4`：左=原片、中=alpha 灰度、右=棋盘格合成，三联对比供人工定位。

---

## 3. 播放侧：皮肤层替换

### 3.1 模块与改动面

```
renderer/video-skin.js   【新增】与 sprite-skin.js 平级、同契约
renderer/cat.js          【改 ~12 行】仅 loadSkin() 的分发逻辑
main.js resolveSkin()    【改 ~30 行】skin.json v2 解析，返回 clips 资产表
preload.js               【不改】
sprite-skin.js           【不改】保留为降级链第二级
FSM（update/computePose）【零改动】
```

`cat.js` 的唯一改动（保持现有降级语义）：

```js
async function loadSkin() {
  try {
    const s = await window.api.getSkin()
    if (s?.assets?.clips) {
      spriteSkin = await window.createVideoSkin(s, { ctx, cx: CX, ground: GROUND, targetHeight: 250,
        fallbackFactory: () => window.createSpriteSkin(s.assets, { fps: s.fps, ctx, cx: CX, ground: GROUND }) })
    } else if (s?.assets?.idle) {
      spriteSkin = await window.createSpriteSkin(s.assets, { /* 现有代码不变 */ })
    } else spriteSkin = null
  } catch (e) { spriteSkin = null }   // → 程序化猫（现有兜底）
}
```

### 3.2 播放器核心设计

**双通道乒乓 + crossfade**（状态切换过渡的全部机制）：

- 维护 A/B 两个隐藏 `<video>`（`muted playsinline preload="auto"`，不挂 DOM，直接 `drawImage` 进画布）。
- 每个 `ClipInstance` 绑定一个 state 的 webm；同一时刻至多 2 个 video 在解码。
- 切换状态时：B 通道起播目标片段，120ms 内 A 通道 `globalAlpha 1→0`、B 通道 `0→1`，完成后 A 释放。
- **禁止运行时 seek**：`video.currentTime` 赋值会触发解码器 flush，产生 100ms+ 黑帧/停顿。循环全靠 `loop=true` + rVFC 校准；once 片段靠 `ended` 事件 + 尾帧静画（`drawImage` 最后一帧或 thumb.png）。
- 时钟同步：优先 `requestVideoFrameCallback` 拿精确媒体时间；不可用时退化为 rAF 累加 `dt × playbackRate`，误差 <1 帧/秒，循环点由 `loop` 事件兜底重置累加器。

**每帧 draw 流程**（契约与 sprite-skin 完全一致）：

```
draw(pose, now, info):
  1. 由 info.state 查绑定表 → 决定当前应播片段（缺失则走降级链）
  2. 状态变化 → 触发过渡（§3.4 过渡矩阵）
  3. loop 片段：相位 = (now % clipDur)；once 片段：相位 = info.stateT × rate
  4. ctx.save → translate(CX, GROUND+bob) → rotate(p.rot) → scale(p.face×p.sx, p.sy)
     → drawImage(videoA, -w/2, -h, w, h)（+crossfade 时叠 drawImage(videoB)）
  5. 阴影椭圆、squash 压扁、sleep zzz、pet 爱心粒子 —— 原样沿用 sprite-skin 的代码
```

pose 叠加（镜像 `p.face`、落地压扁 `squashT`、drag/thrown 旋转）**全部继续生效**——视频皮肤不是
"播片"，而是"把视频当贴图"参与现有变换体系，物理手感与静态图皮肤完全一致。

### 3.3 预加载与降级

**预加载分级**（避免启动卡、避免 8 个解码器常驻）：

| 级别 | 片段 | 时机 |
| --- | --- | --- |
| P0 | `idle` | 启动阻塞项：就绪前用静态图/程序化猫顶替，就绪后热切换 |
| P1 | `walk` `sleep` `pet` `groom` | `idle` 首帧渲染后的下一个空闲帧起，逐个 `load()` 预热解码器 |
| P2 | `drag` `thrown` `tap` | 首次进入对应状态时懒加载；未就绪期间播静态图 |

内存策略：常驻 READY 的 video 上限 4 个，LRU 释放 P2 片段（`src='' + load()` 释放解码器）。

**三级降级链**（每状态独立生效，比现有"整层降级"细一级）：

```
state → ①clips/<state>.webm（READY）
      → ②该状态静态图（.cache/<state>.png，即现有 sprite 行为）+ thumb.png 兜底
      → ③全皮肤不可用 → cat.js 现有 catch → 程序化线稿猫
```

视频 `error`/`stalled` 事件、3s 加载超时、`readyState` 长期 <2 都触发 ①→②，并上报
`onClipFallback(state, reason)` 供调试气泡提示（如"walk 片段加载失败，用静态图"）。

### 3.4 状态切换过渡矩阵

| from → to | 策略 | 时长 |
| --- | --- | --- |
| loop → loop（idle↔walk↔sleep） | crossfade | 120ms |
| once 进行中 → loop（pet→idle） | 优先等 once 播完（≤300ms 内）再 crossfade；超时硬切 | ≤120ms |
| loop → once（idle→pet/thrown） | **硬切**（爆发动作，淡入反而拖沓） | 0 |
| drag/thrown 特殊 | 硬切进入；thrown 落地 `squashT` 压扁由 pose 叠加承担 | 0 |
| 同片段变体轮换（idle_a→idle_b） | 在循环接缝点（相位≈0）硬切，视觉无缝 | 0 |

---

## 4. 数据结构与接口定义（多角色/多皮肤复用的核心）

### 4.1 `skin.json` v2（向后兼容 v1）

```jsonc
{
  "manifest": 2,
  "id": "cream-cat",
  "name": "奶油猫 · 视频",
  "character": "cat",                    // 角色族：跨皮肤借片段的键
  "canvas": { "w": 360, "h": 380 },
  "anchor": { "cx": 180, "ground": 374 },// 与 cat.js 的 CX/GROUND 对应
  "targetHeight": 250,
  "fps": 24,
  "clips": {                             // ← 新增：视频片段绑定表
    "idle":   { "src": "clips/idle.webm",  "mode": "loop", "dur": 3.0,
                "variants": ["clips/idle_b.webm"], "rotateMin": 45 },
    "walk":   { "src": "clips/walk.webm",  "mode": "loop", "dur": 2.0, "targetDur": null },
    "sleep":  { "src": "clips/sleep.webm", "mode": "loop", "dur": 4.0 },
    "groom":  { "src": "clips/groom.webm", "mode": "once", "dur": 1.4, "targetDur": 1.5 },
    "pet":    { "src": "clips/pet.webm",   "mode": "once", "dur": 1.0, "targetDur": 1.1 },
    "drag":   { "src": "clips/drag.webm",  "mode": "loop", "dur": 2.5 },
    "thrown": { "src": "clips/thrown.webm","mode": "once", "dur": 0.9 }
  },
  "fallback": { "idle": "idle.jpg", "walk": ["walk1.jpg", "walk2.jpg"], "...": "现有 v1 字段原样保留" },
  "gen": { "tool": "kling-2.1", "seed": 42, "promptSet": "v1" }   // 可复现性元数据
}
```

### 4.2 TypeScript 风格类型定义（实现参照）

```ts
/** 片段播放模式 */
type ClipMode = 'loop' | 'once'

interface ClipDef {
  src: string                 // clips/ 下相对路径 → main 进程转 file:// URL
  mode: ClipMode
  dur: number                 // 秒，QC 时从容器读出回填，播放相位以此为准
  targetDur?: number | null   // 期望时长：playbackRate = dur/targetDur (clamp 0.75–1.6)
  variants?: string[]         // 同动作变体池，rotateMin 秒后在接缝点轮换
  rotateMin?: number
  thumb?: string              // 首帧缩略图，降级/预热期占位
}

interface CanvasSpec { w: number; h: number }
interface AnchorSpec { cx: number; ground: number }

interface SkinManifest {
  manifest: 2
  id: string
  name: string
  character: string           // 角色族 id："cat" / "dog" / "custom"
  canvas: CanvasSpec
  anchor: AnchorSpec
  targetHeight: number        // 角色渲染高度（px，画布坐标系）
  fps: number
  clips: Partial<Record<PetState, ClipDef>>   // 允许缺状态 → 走降级
  fallback: Record<string, string | string[]> // v1 静态图表，降级链第二级
  gen?: { tool: string; seed?: number; promptSet?: string }
}

type PetState = 'idle' | 'walk' | 'groom' | 'pet' | 'thrown' | 'sleep' | 'drag'

/** 皮肤实例契约（sprite-skin / video-skin 共同实现，cat.js 只认这个） */
interface Skin {
  draw(pose: Pose, now: number, info: DrawInfo): void
  onStateChange?(from: PetState, to: PetState): void   // 视频皮肤用于调度过渡
  dispose?(): void                                      // 热重载/退出时释放 video 与解码器
}

interface DrawInfo {              // 与现有 cat.js 传参逐字段一致
  state: PetState
  stateT: number                  // 当前状态已持续时间(s)
  dt: number
  squashT: number                 // 落地压扁剩余时间
  air: number                     // 0(地面)–1(高空)
}

/** video-skin 工厂（与 createSpriteSkin 对称） */
declare function createVideoSkin(
  skin: { id: string; name: string; fps: number; assets: ResolvedAssets },
  opts: {
    ctx: CanvasRenderingContext2D
    cx: number; ground: number; targetHeight: number
    fallbackFactory?: () => Promise<Skin>          // 静态图皮肤工厂（降级链②）
    onClipFallback?: (state: PetState, reason: string) => void
  }
): Promise<Skin>

/** main 进程 resolveSkin() 的返回结构（IPC 序列化边界） */
interface ResolvedSkin {
  id: string; name: string; fps: number
  manifest: number                                  // 1 | 2
  assets: ResolvedAssets
}
interface ResolvedAssets {
  // v1 字段不动：idle/walk/tap/sleep/drag/pet/thrown/groom（file:// URL）
  idle: string | null; walk: string[]; /* ... */
  // v2 新增：clips 为 null 时 cat.js 走老路径
  clips?: Partial<Record<PetState, ResolvedClip>> | null
}
interface ResolvedClip extends ClipDef { src: string; thumb: string | null }  // src 已转 file:// URL
```

### 4.3 QC 报告结构（`clips/_qc.json`）

```ts
interface QcReport {
  skin: string; tool: string; ts: string
  clips: Record<string, {
    pass: boolean
    metrics: {
      codec: string; pixFmt: string; w: number; h: number; fps: number
      duration: number; bytes: number
      alphaMin: number; alphaMax: number        // 检查项2
      cornerAlphaMax: number                    // 检查项3
      fgRatio: number                           // 检查项4
      seamPsnr: number | null; seamSsim: number | null   // 检查项5，once 为 null
      flickerIndex: number; driftMaxPx: number  // 检查项6/7
      chromiumFrameOk: boolean                  // 检查项9
    }
    failures: string[]                          // 未过阈值的检查项 id
    diag?: string                               // rejected 三联预览路径
  }>
}
```

### 4.4 多角色 / 多皮肤复用规则

- **解析顺序**：`skins/<当前皮肤>/clips` → `skins/_shared/<character>/clips`（角色族公共池）→ 内置默认。
  例：做了 3 套猫皮肤但 `thrown` 只生成过一套，其余两套自动借用 `_shared/cat/thrown.webm`。
- **manifest 与播放器解耦**：`video-skin.js` 不认识"猫"，只认识 `PetState → ClipDef` 映射 +
  `anchor/targetHeight`。新角色（狗、企鹅）只要 FSM 状态集不变，换 manifest 即换角色；
  若未来 FSM 增加状态，manifest 的 `clips` 表加键即可，播放器无感。
- **皮肤热重载**：沿用现有 `fs.watch(skins) → skins-updated` 通道；`loadSkin()` 重入时先
  `oldSkin.dispose?.()` 释放全部 video 元素，防止解码器泄漏。
- **打包**：`package.json build.files` 增加 `skins/**/clips/**`，继续排除 `raw/` 与 `.cache/`。

---

## 5. 性能瓶颈与功耗

| # | 瓶颈 | 量级估计 | 对策 |
| --- | --- | --- | --- |
| 1 | **VP9 alpha 软解**（最大头） | 512×512@24fps 单片段约占 5–15% 单核；crossfade 瞬间双解码 ×2 | 交付尺寸锁 512（拒绝 720 进包）；fps 24；过渡窗 120ms 内才允许双通道；常驻 READY ≤4 |
| 2 | 桌宠常驻功耗 | 24×7 挂机场景，video 解码 + rAF + 透明窗口合成叠加 | `paused`/睡眠状态可把 video `pause()`（sleep 片段本身低频）；未来加"低功耗模式"：idle 降为静态图+呼吸变换 |
| 3 | 透明窗口合成 | Electron frameless transparent 全屏置顶，每帧 canvas → 窗口合成 | 现状已存在，非增量成本；保持 360×380 小窗，不放大 canvas |
| 4 | drawImage(video) 上传纹理 | 每帧 1–2 次 512² 位图上传 | 可接受（<1ms/帧）；禁止对 video 做 getImageData 逐帧处理 |
| 5 | 内存 | 4 常驻解码器 ≈ 40–80MB + webm 文件页缓存 | LRU 释放 P2；整包 ≤8MB 控总量 |
| 6 | 安装包体积 | 8 片段 × ~600KB ≈ 5MB，比静态图皮肤 +3MB | crf 30 与 512 尺寸已是最优平衡；`raw/` 不进包 |
| 7 | 启动时延 | P0 idle 片段解码器预热 ~200–500ms | 预热期显示静态图（现有皮肤），就绪后硬切，用户无感 |

**红线**：任何单片段 >1.2MB、>512px、>24fps 的产物一律 QC FAIL——桌宠是常驻进程，功耗优先级高于画质。

---

## 6. 常见风险点

| # | 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- | --- |
| 1 | AI 生成肢体畸变/多爪/身份漂移 | 高 | 素材报废 | 首帧锁身份（用 .cache PNG 合成底板）；固定种子；每状态生成 2–3 候选择优；人工 30s 验收 gate |
| 2 | 白底抠像啃掉奶油色/白色毛发 | 中 | 边缘缺损 | 用 RVM 而非 colorkey；alpha 电平重映射保守；QC 主体完整率把关；必要时改浅灰底重生成 |
| 3 | 循环接缝跳变（模型未收敛） | 中 | idle/walk 观感差 | 首尾同图三保险（§1.4）；QC 接缝 PSNR 硬门槛；不过关的片段尾部 6 帧与头部 6 帧做交叉溶解补救 |
| 4 | `-auto-alt-ref` 遗漏 → alpha 静默损坏 | 低（管线固化后） | 播放黑块 | 编码参数写死在脚本常量里；QC 检查项 2 用**解码验证**而非 metadata |
| 5 | `video.loop` 回绕处 1–2 帧停顿（Chromium 行为） | 中 | 循环卡顿感 | rVFC 监测回绕间隔，超阈值时提前 80ms 用第二个同源 video 接力（乒乓循环）；素材本身接缝达标可容忍 |
| 6 | 运行时 seek 冲动（once 片段重播） | — | 黑帧/停顿 | 设计层面禁止：once 重播 = `load()` 重置而非 `currentTime=0`；由 §3.2 时钟规则约束 |
| 7 | 用户自装第三方皮肤带恶意/超大 webm | 低 | 体积/安全 | 加载前 main 进程校验：尺寸/时长/体积上限 + 仅允许 `skins/*/clips/` 路径（file:// URL 白名单） |
| 8 | 平台功能漂移（可灵/即梦开关改名、时长档位变化） | 高 | 规范失效 | manifest `gen` 字段记录工具+参数版本；规范文档标注"以平台当期能力为准"的浮动项 |
| 9 | Windows 低端机 VP9 软解吃力 | 中 | 掉帧 | 运行时探测：连续 3s 帧间隔 >50ms → 自动降到静态图皮肤并气泡告知 |
| 10 | 双 video crossfade 时显存/CPU 尖峰 | 低 | 过渡瞬间掉帧 | 过渡窗压缩到 120ms；同刻最多 2 解码器的硬约束 |

---

## 7. 实施计划与验收

| 阶段 | 内容 | 验收标准 |
| --- | --- | --- |
| M1 最小闭环 | 只做 `idle` 一个状态：手工生成 → 手工抠像 → 手写命令出 webm → video-skin 骨架播起来 | 桌宠上 idle 视频循环 ≥10 分钟无闪烁、无接缝跳变、CPU 增量 <10% |
| M2 管线化 | `tools/matting/` 批处理 + `qc.py` 全指标；8 状态素材齐 | `npm run skin:matte` 一键出全包；`_qc.json` 全 PASS |
| M3 播放器完整 | 双通道 crossfade、预加载分级、三级降级、过渡矩阵、热重载 dispose | 拔走任意 webm 文件 → 对应状态静默降级静态图，无异常无卡死 |
| M4 复用与打磨 | `_shared` 角色族借片段、变体轮换、低功耗模式、第二套皮肤验证复用 | 新建一套皮肤只写 manifest + 丢 clips，零代码改动跑通 |

**预期效果**：静态插画猫 → 会呼吸、眨眼、摆尾、原地小跑的"活"猫；拖拽甩飞的物理手感不变
（pose 叠加保留）；单套皮肤包 ≤8MB；老皮肤与程序化猫作为降级链完整保留，任何素材缺失都不白屏。

---

## 附录 A：ffmpeg 环境事实（本机已验证）

- ffmpeg 9.0（homebrew，含 libvpx-vp9）；ffprobe 可用；Node 22。
- alpha 验证命令：`ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt:stream_tags=alpha_mode -of default out.webm`，
  注意 ffprobe 直接读会报 `yuv420p`，必须加 `-c:v libvpx-vp9` 强制解码器才见 `yuva420p`——QC 因此以解码为准。

## 附录 B：可灵操作路径速记

图生视频 → 首尾帧（两槽传同一张底板图）→ 模型选 2.1+ → 勾选「循环优化」→ 时长按档位 →
提示词用 §1.4 三段式模板 → 预览循环播放 3 遍无跳变再下载。
