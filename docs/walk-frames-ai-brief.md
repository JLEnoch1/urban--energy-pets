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

