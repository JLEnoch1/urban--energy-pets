# 散步循环补帧 · AI 素材生成简报

> 目标：在现有 walk1/walk2 两帧基础上，用 AI 生成补齐一个 **4 拍完整步行循环**，
> 消除帧间形态不一致导致的跳变，配合已落地的步态引擎（φ 相位 + 交叉溶解 + 包络）达到连贯步态。

## 1. 现状诊断（为什么必须补素材）

对现有素材的像素级取证：

| 指标 | 数值 | 说明 |
|---|---|---|
| walk1 vs walk2 像素差 | **30.4%** | 同角色同机位的两帧姿态差通常应 <15% |
| 抠图裁剪后宽度 | 552 vs **639** px | 两帧比例/构图不一致（高度均为 589） |
| 剪影 IoU（底边中心对齐） | **0.718** | 轮廓重合度低，溶解时也遮不住形态跳变 |
| walk2 特征 | 描边更重、斑纹更密、粉色肉垫面积大 3 倍 | 明显是另一次独立生成的产物 |

结论：两帧是"两次独立生成"而非"同一角色的两个节拍"。步态引擎能把**时间**上的跳变抹平
（溶解/包络），但**形态**上的不一致只能从素材层面解决 → 建议以 walk1 为风格锚点，
重新生成整组 4 帧（walk2 退役为风格参考）。

角色事实（取证还原）：**正面朝向观众的 chibi 奶油猫**，头占身高近半，粉桃色大面积腮红/口鼻区，
深暖棕圆点眼，尾巴粗短、垂向画面右下方；walk1 = 重心在左前腿、**右前爪抬起于胸前露肉垫**。

## 2. 帧规划：4 拍循环（与步态引擎的映射）

```
F1 右前爪抬起(重心左)  →  F2 过渡帧(全身最高,双爪近地)  →
F3 左前爪抬起(重心右)  →  F4 过渡帧(F2 镜像)  →  回到 F1
```

- 播放顺序 = skin.json `frames`/`cells` 数组顺序，引擎按 `idx` 循环并只溶解相邻帧。
- F1/F3 是"接触/负重"拍（身体略低、向负重侧微倾），F2/F4 是"过渡"拍（身体最高、直立居中）——
  垂直与侧向位移**画进帧里**，程序化 bob/sway 只承担残余微动，观感最稳。
- 节奏：一个完整循环 = 4 帧。当前 `interval [0.14, 0.22]` 语义是"每帧时长"，
  4 帧下总循环 0.56–0.88s（悠闲漫步）；想保持现有步频则减半为 `[0.07, 0.11]`。

### 接入路径（二选一）

| 路径 | 改动 | 参数建议 |
|---|---|---|
| **A. 零代码** | 只改 skin.json | `interval:[0.07,0.11]`（保持步频）或 `[0.14,0.22]`（慢踱步）；`bobAmp:1.2`、`swayAmp:0.008`、`squashAmp:0.006`（程序量减为残余）；`crossfade:0.4` |
| **B. 推荐（3 行改动）** | `anim` 增加 `"stepFrames": 2`；`gaitTransform` 中 `ph = (idx+φ)·π` 改为 `ph = (idx+φ)·π / stepFrames` | bob 一周期跨 2 帧（每步一次起伏、波谷恰在 F1/F3 接触帧），sway 一周期跨 4 帧（每跨步一次侧移）。`interval:[0.07,0.11]`，幅度参数可保留现值 |

## 3. 角色统一设定（所有帧共用前缀）

实测色板（从 walk1/walk2/idle 采样）：

| 部位 | 色值 |
|---|---|
| 毛发高光 / 中间调 / 暗部 | `#f2ede2` / `#e5d7c0` / `#dccab0` |
| 虎斑纹样（头顶、背部、四肢） | `#b8a48b`、`#968069` |
| 描边、眼睛（深暖棕，近黑） | `#261b12` |
| 腮红/口鼻（低饱和桃粉） | `#e0b098` 一带 |
| 肉垫、鼻头（灰玫瑰粉） | `#d3977a` |
| 背景 | 纯白 `#ffffff` |

### 中文提示词（共用前缀）

> 一只 Q 版卡通奶油色小猫，正面朝向观众，全身像，扁平插画风、柔和赛璐璐上色。
> 超大圆头约占全身高度一半，尖耳朵、耳内 dusty pink；脸颊与口鼻区域大面积柔和桃粉色腮红，
> 粉色小鼻头，深暖棕色圆点眼睛（#261b12），"w"形小嘴。
> 奶油白毛发：高光 #f2ede2、中间调 #e5d7c0、暗部 #dccab0；头顶与背部有浅暖棕色虎斑纹（#b8a48b、#968069）。
> 全身一圈细而柔和的暖棕色描边（不是纯黑硬线）。四条短粗小腿；抬起的爪子朝向观众，
> 露出灰玫瑰粉色肉垫（#d3977a）和小趾豆。粗短尾巴向画面右下方自然弯曲垂落。
> 纯白背景（#ffffff），无地面、无投影、无反射、无装饰、无文字、无闪光点。
> 角色居中，全身完整入画不贴边，猫高约占画面 75%，四脚落在同一条底部地平线上。

### English prompt (shared prefix)

> Chibi cartoon cream kitten facing the viewer, full body, flat kawaii illustration with soft
> cel shading. Oversized round head (about half of total height) with pointed ears and dusty-pink
> inner ears; large soft peach blush covering cheeks and muzzle; small pink nose; round dark
> warm-brown eyes (#261b12); tiny "w"-shaped mouth. Cream-white fur — highlight #f2ede2,
> midtone #e5d7c0, shadow #dccab0 — with light warm-tan tabby patches (#b8a48b, #968069) on head
> and back. Thin soft warm-brown outline (not pure black). Short stubby legs; a lifted paw reveals
> a dusty-rose pad (#d3977a) with tiny toe beans. Thick short tail curving down toward the
> viewer's right. Pure white background (#ffffff). No ground, no shadow, no props, no text, no
> sparkles. Character centered, fully inside the frame, feet on a single consistent bottom
> ground line, cat filling ~75% of canvas height.

## 4. 每帧姿态描绘（前缀 + 下列差异描述）

| 帧 | 中文 | English |
|---|---|---|
| **F1** | 重心落在左前腿；右前爪抬起、屈于胸前高度，肉垫朝向观众；身体向负重侧（观众左）极轻微倾斜；后腿自然站立、大部分被身体遮挡；表情放松，"w"嘴，双眼睁开 | Pose 1: weight on the left front leg; right front paw lifted and bent at chest height, dusty-rose pad facing the viewer; body leans barely toward the standing leg; hind legs mostly hidden behind the body; relaxed happy expression |
| **F2** | 过渡帧：右前爪下落、脚尖离地一线即将着地；左前爪刚离地一线；重心居中；身体完全直立、处于循环中最高点；尾巴略微上抬 | Pose 2 (passing): right front paw lowered with toes a hair above the ground; left front paw just lifting off; weight centered; body upright at its tallest in the cycle; tail slightly raised |
| **F3** | F1 的镜像：重心落在右前腿；左前爪抬起、屈于胸前高度露肉垫；身体向观众右侧极轻微倾斜；纹样位置与 F1 保持同一只猫的连续性（不要镜像翻转斑纹） | Pose 3: mirror of pose 1 — weight on the right front leg; left front paw lifted and bent at chest height showing the pad; body leans barely to the viewer's right; keep tabby patch placement consistent with pose 1 (do NOT mirror-flip the markings) |
| **F4** | F2 的镜像：左前爪下落即将着地，右前爪刚离地；身体直立最高点；尾巴略微上抬 | Pose 4 (passing, mirror of pose 2): left front paw lowering toward the ground; right front paw just lifting; body upright at its tallest; tail slightly raised |

负向提示词（SD 系工具用）：

> background color, gradient background, floor, ground shadow, drop shadow, reflection, extra
> characters, text, watermark, border, cropped limbs, pure black outline, realistic, 3d render,
> multiple cats, side view

## 5. 生成方式（按一致性优先排序）

1. **首选：一张 2×2 宫格图单次生成**（一次生成 = 天然同风格同比例）。
   在共用前缀后追加：

   > 2×2 精灵图宫格：同一只猫的四个连续步行姿态，按行排列——
   > 左上=F1 右前爪抬起，右上=F2 过渡最高点，左下=F3 左前爪抬起，右下=F4 过渡最高点。
   > 四格中角色大小完全一致、地平线完全一致，格间留干净的白色间距。

   > EN: 2×2 sprite sheet grid, the same cat in four sequential walking poses arranged by rows —
   > top-left = pose 1 (right paw lifted), top-right = pose 2 (passing, tallest),
   > bottom-left = pose 3 (left paw lifted), bottom-right = pose 4 (passing, tallest).
   > Identical character scale and identical ground line in all four cells, clean white gutters.

   切帧管线原生支持：`splitGrid` 按行优先编号（0=左上,1=右上,2=左下,3=右下），播放顺序正好是 F1→F4。
2. **次选：以 walk1.jpg 为参考图逐帧 img2img**。重绘幅度 0.35–0.55（低=风格稳但姿态难改，
   高=姿态准但风格漂），能固定 seed 就固定；每帧出 6–8 张候选人工挑选。
3. 工具映射：Midjourney 用 `--cref <walk1图链> --cw 80`；SD/ComfyUI 用 img2img +
   ControlNet(openpose/depth) 锁姿态；即梦/可灵/GPT-4o 直接上传 walk1 并声明"同一角色，只改姿态"。

## 6. 素材硬性规格（抠图管线约束，必须遵守）

管线事实：`main.js matteImage()` 从画布四边向内**漫水填充**"中性灰白像素"
（通道极差 ≤14 且最小通道 ≥190）判为背景抠成透明，再按前景包围盒裁剪。因此：

1. 画布正方形，**1280×1280**（管线按最长边 720 降采样，太小丢细节）。
2. 背景**纯白**；彩色/渐变/纹理背景会抠图失败或吃掉主体。
3. **轮廓线闭合连续**：近白色毛发（胸口、肚子、爪内）不得与白背景直接相连，
   否则漫水从缝隙渗入把身体咬出洞。
4. **禁止**地影、倒影、装饰物、游离色点：任何非白残留都会撑大裁剪包围盒 → 帧间漂移。
5. 四帧**同比例、同地平线、同居中**；全图最低点必须是着地脚掌，
   **尾巴不得低于地平线**（现有 walk1/walk2 最低点是尾尖，属隐患，新帧必须修正）。
6. jpg / png / webp 均可，放入 `skins/default/` 即被自动增量处理。

## 7. 接入配置与验收

### skin.json（宫格图方案）

```jsonc
"sheets": {
  "walkcycle.jpg": { "grid": { "cols": 2, "rows": 2 } }   // 或 1×4: {"cols":4,"rows":1}
},
"states": {
  "walk": {
    "sheet": "walkcycle.jpg",
    "cells": [0, 1, 2, 3],
    "anim": {
      "interval": [0.07, 0.11],   // 每帧时长;想慢踱步改回 [0.14,0.22]
      "stepFrames": 2,            // 仅路径 B(引擎加 3 行后生效);路径 A 删除此行并调低幅度
      "refSpeed": 46,
      "bobAmp": 3, "swayAmp": 0.02, "swayPhase": 1.57, "squashAmp": 0.012,
      "crossfade": 0.4, "entryT": 0.25, "exitT": 0.18, "stateXfade": 0.12
    }
  }
}
```

独立 4 图方案则把 `sheet/cells` 换成
`"frames": ["walkF1.jpg", "walkF2.jpg", "walkF3.jpg", "walkF4.jpg"]`。

### 验收清单

- [ ] 启动后控制台出现 `[skin] sheet walkcycle.jpg → 4 帧`（无 overflow/回退警告）
- [ ] `.cache/walkcycle-cell-00..03.png` 四帧裁剪高度差 ≤2%
- [ ] 行走观察：无大小跳变、无轮廓闪变、脚稳定踩在地平线
- [ ] devtools `petDebug` 面板/`gaitInfo()`：换帧点变换量连续
- [ ] idle↔walk 切换走 stateXfade 溶解，无姿态突跳
- [ ] `npm test` 全绿
- [ ] 回滚预案：skin.json 改回 `"frames": ["walk1.jpg","walk2.jpg"]` + 右键「重新加载皮肤」

---

## 8. 验收记录（2026-10-26 · 4 张 AI 生成帧）

素材来源：`~/Desktop/Cat/微信图片_2026102612190{0,1,3,5}*.jpg`（1280×1280，白底）。
检验方法：Python 复刻 `main.js matteImage`（720 降采样 + 四边漫水 + 包围盒）后量测。

| 帧 | 姿态（腿区放大取证） | 裁切高 | 与组内最差 IoU | 结论 |
|---|---|---|---|---|
| …1900_68 → **walkA.jpg** | 右前爪高抬露肉垫、左腿站立 | 585 | 0.711 | ✅ 负重帧 |
| …1901_69 | **双爪离地**、身体压低 | **566（矮 3.3%）** | **0.677** | ❌ 剔除（渲染会缩放弹跳；姿态脱拍。留作 tap/表情素材候选） |
| …1903_70 → **walkB.jpg** | 右爪中抬、左腿前迈 | 586 | 0.781 | ✅ 过渡帧 |
| …1905_71 → **walkC.jpg** | ≈ walk2 同姿态重生成（IoU 0.995） | 585 | 0.781 | ✅ 负重帧 |

- 风格一致性：四帧同族（walk2/idle 家族）；**旧 walk1 成为风格离群点**（与新帧 IoU 仅 0.72–0.78），一并退役。
- 最终帧序 **`["walkA","walkB","walkC","walkB"]`**（乒乓序，B 复用为两个过渡拍）：
  n=4 使引擎 `ph=(idx+φ)·2π/n` 精确对齐——波谷落 A/C 负重帧、波峰落 B 过渡帧；
  最差相邻 IoU 0.781，优于任何含 …1901 的四帧排序（0.711）；高度 585/586/585/586 → 零缩放弹跳。
- 参数改动：`interval [0.14,0.22]→[0.07,0.11]`（每帧时长，保持原步频）、`crossfade 0.3→0.35`（帧差小、加长混合）；其余保留（等高帧 → 起伏仍由引擎 `bobAmp:3` 承担）。
- 已知残留：四帧最低点仍是尾尖（与 idle/旧帧同族特性，全组一致故锚点稳定；脚线高于包围盒底 61–66px）。
- 已同步部署至运行目录 `~/Library/Application Support/DesktopPet/skins/default/`（watchSkins 热重载）。

---

## 9. 增补（2026-10-26 下午）：溶解调优 + 根治「四肢不协调」

### 9.1 引擎/参数调优（已上线）

- `sprite-skin.js`：溶解窗上限 0.5 → 1，即 `crossfade=2` 时**全步长连续变形**（任意时刻都在两帧间
  平滑插值，彻底消除「静止→突变」的切换感；`crossfade≤1` 的行为与旧版完全一致，单测不变）。
- `skin.json walk.anim`：`crossfade 2.0`（全程 morph）、`interval [0.10,0.13]`（节奏放缓、抖动从 ±22% 降到 ±13%）、
  `bobAmp 3.5`。
- 调参口诀：**残影/双爪太强 → crossfade 降到 1.0~1.4**；仍觉切换生硬 → 保持 2.0 并放慢 interval。

### 9.2 素材缺陷是「四肢不协调」的根因

已上线三帧 walkA/B/C **全部是「右前爪抬起」家族**：整个循环左前爪几乎不动、无左右交替负重，
任何溶解/相位数学都无法把不协调的肢体姿态混成真实步态（混合只会产生「双爪残影」）。
根治 = 补 2 张帧，凑成真 4 拍交替循环：**[walkC(右抬) → F2(过渡) → F3(左抬) → F2(过渡)]**。

生成方式：**逐帧单独生成**（不要 2×2 宫格，上次宫格提示词的肢体规格被忽略了），
以 `walkC.jpg` 作图生图/风格参考（已验证生成器能 1:1 复刻它，IoU 0.995）。

**F2 过渡帧（passing pose）**
- 中：同一只奶油色 Q 版小猫，正面，行走循环的过渡瞬间：四肢收拢于身体正下方，双前爪并排轻触地面，
  后腿收于腹下，**身体为全循环最高点（比参考图略高约 2%）**；尾巴仍垂在**右侧**、尾尖不低于脚掌；
  纯白背景，1280×1280，主体居中占 70%，与参考图同比例、同地平线、同色板、同描边粗细。
- EN: same chibi cream kitten, front view, passing pose: all four paws gathered under the body,
  both front paws lightly touching ground side by side, hind legs tucked, body at the TALLEST point
  of the cycle (~2% taller than reference), tail hanging on the RIGHT side, tip no lower than the feet,
  closed warm-brown outline, plain white background, 1280x1280, same scale/ground line as reference.
- 负向：tail on left side, mirrored image, extra limbs, both front paws raised in the air, crouching body,
  ground shadow, decorations, different character.

**F3 左前爪抬起帧（mirror limb, NOT mirrored image）**
- 中：同一只小猫，正面，**左前爪**抬至胸前露出粉色肉垫，**右前爪**踩地承重——肢体布局与参考图镜像，
  **但整图不镜像**：尾巴仍垂在右侧，头部斑纹/眼睛/鼻子/身体斑块保持同一只猫的连续性；
  后腿自然收拢；纯白背景，1280×1280，与参考图同比例、同地平线。
- EN: same chibi cream kitten, front view, LEFT front paw lifted to chest showing the pink pad,
  RIGHT front paw planted bearing weight — limb arrangement mirrored vs reference, but the image
  itself NOT flipped: tail still on the RIGHT, identical patch/eye/nose continuity, closed outline,
  plain white background, 1280x1280, same scale and ground line as reference.
- 负向：whole-image mirror flip, tail on left, right paw lifted, both paws lifted, height mismatch.

**验收（同 §6/§8）**：裁切高与 walkC 差 ≤1%；单一连通域；尾巴在右侧；爪垫/描边色板一致；
与 walkC 的 IoU 0.75–0.90（太像=没抬爪，太不像=换了只猫）。

**接入**：新图命名 `walkF2.jpg`/`walkF3.jpg` 放入 `skins/default/`，
`walk.frames` 改为 `["walkC.jpg","walkF2.jpg","walkF3.jpg","walkF2.jpg"]`（n=4：颠簸波谷自动落在
两张负重帧 C/F3，波峰落在过渡帧 F2），anim 其余参数不动。

### 9.3 不想再生成时的两个降级档

1. `frames: ["walkA.jpg","walkC.jpg"]` —— 两帧近同姿态（IoU 0.871），混合几乎零残影，
   动感全靠程序化颠簸/摇摆：最干净，但读作「原地小跑」。
2. 保留 `[A,B,C,B]` + `crossfade: 1.0`（半程溶解）—— 折中：切换感略回、残影减半。

### 9.4 增补 2 帧验收与接入记录（2026-10-26 14:10）

来源：`~/Desktop/Cat/2f02d288….jpg`、`b8397f15….jpg`（1280×1280）。

- **姿态**：仍是右前爪家族变体——2f02≈walkC（IoU 0.914）、b839≈walkB（0.909）；
  §9.2 的 F2 过渡/F3 左抬帧**没有生成出来**（图生图被 walkC 参考锚死了姿态）。
- **灰斑发现**：全部新旧帧右下角 y682–704 都有生成器带入的中性灰「地面阴影」斑（RGB≈150–195，
  低于漫水阈值故残留）。它们恰好齐平落在 y703±1，客观上充当了**一致的底边锚点**，予以保留；
  但 2f02 的灰斑达 1080px（其余帧 5–47px），会渲染成尾下灰点 → 已程序化修复：
  擦净后移植 walkC 同坐标区域（47px，肉眼不可见），产出 `walkD.jpg`；b839 原样转存 `walkE.jpg`。
- **几何**：五帧底边 y703/703/703/700/703，裁切高 584–586 → 零缩放弹跳、零垂直跳动。
- **接入**：`frames: ["walkC","walkD","walkE","walkB","walkA"]`（5 帧渐进环，最差相邻 IoU 0.851，
  较 4 帧环 0.781 提升 24%；n=5 为奇数，颠簸波谷不再对齐帧界，但全程 morph 下无感）。
  anim 参数不变（crossfade 2.0 / interval [0.10,0.13] / bobAmp 3.5）。已热重载生效。
- **遗留**：左右交替负重仍未解决（无左抬帧）。再生成 F3 时建议**降低参考图权重或纯文字生成**
  （提示词见 §9.2），先单独出「左前爪抬起」一张，验收通过后再补 F2。

### 9.5 第四轮增补 2 帧：全部拒收（2026-10-26 14:30）

来源：`~/Desktop/Cat/b6973a95….jpg`、`d8bdbb9b….jpg`（14:22）。

- **b697**：实为「双爪抬起作揖姿」（躯干两侧对称肉垫、竖身形 520×614、无明显垂尾）——
  粉色左右均衡系双爪同抬所致，并非过渡帧；IoU 0.53–0.67。尝试镜像+缩放+锚点移植修复，
  IoU 反跌至 0.53（几何可修、姿态/风格不可修）→ **拒收，入 tap/表情候选池**（与 …1901_69 同列）。
- **d8bd**：紧凑蹲坐姿（宽 445、深色粗尾=上色漂移）、锚点 y637（差 66px）、IoU 0.55–0.66 → **拒收**。
- **教训**：单图生成四轮不收敛——给参考图则姿态锁死（三次 walkC 克隆），不给则风格/比例/锚点全漂。
  多帧序列的唯一可靠来源是**图生视频抽帧**（首帧=walkC 白底合成图，风格被首帧锚定、动作由时序模型保证），
  操作路径见 §10。

## 10. 30 帧级循环的实现路径（视频抽帧管线）

1. `scripts/walk-preview.html` 选入 walkC → 导出「白底合成 PNG」作首帧；
2. 图生视频（即梦/可灵/海螺等，2–4s）：「小猫正面原地行走，四肢交替迈步，身体轻微起伏，
   镜头完全固定，纯白背景，主体居中不位移，动作循环连贯」；
3. 抽帧：`ffmpeg -i walk.mp4 -vf fps=15 f%02d.png`（15fps×2s≈30 帧；流畅源可 fps=30 抽 60 再筛）；
4. 帧序列交给验收管线：逐帧抠图质检 → 身高/锚点归一（灰斑锚点移植术，见 §9.4）→
   截取首尾姿态吻合的循环段（视频漂移下通常可得 15–24 干净帧）→ 命名 walkV01…N 接入；
5. 接入参数（N 帧视频档）：`interval [0.033,0.034]`（≈30fps、零抖动）、`crossfade 0~0.2`（帧间已连续）、
   `bobAmp 0.5~1`、`squashAmp 0`（起伏已画进帧，程序化只补残余）、`refSpeed` 调至爪底不打滑。
   引擎无需改动（N 帧泛化 + 每循环恒 2 次颠簸早已就位）。

### 10.1 首帧料已生成（2026-10-26 14:52）

`scripts/make-first-frame.py`（Python 复刻抠图管线，与 main.js / walk-preview.html 三方同公式）
产出 `walk-video/first-frame/` 三张，操作手册见 `walk-video/README.md`：

- **保真校验**：walkC 720 裁切 639×589、前景底边 y703、灰斑 47px（中位 RGB 188,188,188）——
  与 §8/§9.4 记录逐项一致（重采样核差异 ≤4px）。
- ★`walkC_video_first_frame.png`：1280² 纯白、主体 1057×932（73% 画布高）居中、
  四边余量 ≥111px、**灰斑已清除**。清除依据：防止视频模型把灰斑当阴影演绎（walkD 灰斑
  涨到 1080px 的教训，§9.4）；清除后底边上移 61px = §8 记录的脚线位置，主体零损伤
  （仅移除 211 原生像素，占前景 0.03%）。抽帧后锚点按 §9.4 移植术统一补回。
- 对照 `_spot.png`（保留灰斑，主体 78%）、存档 `walkC_white_tight.png`（预览页「白底下载」等效）。
- 抽帧脚本 `walk-video/extract.sh`（ffmpeg fps 可调）已就位；成片/帧序列到位后走 §10.4–10.5。

### 10.2 成片与抽帧（2026-10-26 14:42）

即梦图生视频 `jimeng-2026-10-26-3738….mp4`：960×960、121 实帧 ≈24fps、5.0s
（容器标称 60fps 系重复帧，`ffmpeg -fps_mode passthrough` 抽实帧；ffmpeg 9.0 已移除 `-vsync`）。
用户自备首帧（walkC 系），未用 §10.1 料——两条路线产出等价，料留作下条视频用。

### 10.3 质检

- 背景压缩噪声 → 「连通域白净化」：只把与画布边缘连通的 bgLike 像素置纯白，不伤体内白毛；
- 底边锚点全程 ±1px（比单图生成稳一个量级）；相邻 IoU min 0.921 / mean 0.964；
- 粉色爪左右信号随步态周期振荡 → **对角肢体交替确认**；身高 ±2% 周期振荡 = 内嵌起伏；
- 步态周期 ≈1.0s；最优循环段 **帧[28..52]**（首尾 IoU 0.991），取 V01..V24 = 视频帧 28..51；
- 腿部 ASCII 抽查 6 帧：收拢→张开→全开→收拢，无多余肢体/融化，尾巴恒右侧，风格同族。

### 10.4 归一化（三个错配的修复）

1. **体高**：视频中位 578@720 vs 家族 524 → 全局单系数 k=0.9074。**禁止逐帧身高归一**——
   ±2% 振荡是真实步态起伏，逐帧归一会把它抹掉；
2. **锚点约定**：视频脚线贴 bbox 底 vs 家族「脚 y642 + 灰斑锚 y703」→ 内容底对齐 y642 后
   移植 walkC 灰斑锚区（y655–720, x560–720），状态切换零沉降；
3. **水平晃动**：主体 cx 漂移 ±17px@480 → 内容按 bbox 中心中位对齐 + union 两端 3×3
   RGB(180) 锚点补丁（y702–704）→ 每帧 app-crop **三边恒定**（x0=111, x1=701, 底=704），
   顶 111–132 浮动即起伏。⚠️ 教训：锚点色必须 <190 才能在 `min≥190` 漫水判据下存活
   （首版用 RGB 205 画底线，被漫水当背景整个冲掉）。

成品 `walkV01..24.png`（720²，共 6.3MB）：相邻 IoU min 0.918 / mean 0.955，闭环 0.964，
vs walkC 0.741（idle↔walk 边界溶解观感与旧环同级）。

### 10.5 接入与回滚

- `walk.frames` = walkV01..24；**anim 视频档**：`interval [0.0417,0.0417]`（24fps 实时、零抖动）、
  `crossfade 0.2`、`bobAmp/swayAmp/squashAmp=0`（运动全内嵌，程序化变换归零防双重抖动）、
  `refSpeed 46`（地面巡航=实时播放；墙上 40 → 步频自动 ×1.15）；引擎零改动。
- 已热重载上线（14:58 首上；14:59 被并行会话旧缓冲回滚为 5 帧环——并发写冲突，非故意；
  15:07 重新应用并随本提交固化）。
- 回滚：`walk.frames` 改回 `["walkC.jpg","walkD.jpg","walkE.jpg","walkB.jpg","walkA.jpg"]`
  + anim 恢复 §9.4 值（A–E 素材均保留在库）。
- 与并行会话未提交的引擎升级（转身溶解/亚像素补偿/速度斜坡 walkV）正交兼容：
  速度斜坡期 k=clamp(46/speed,0.6,1.8) 自动放慢步频，起步更自然。




