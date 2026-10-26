# desktop-pet · 桌面猫 MVP

透明置顶窗口里一只"活"的卡通猫:行为状态机驱动(待机/走路/舔毛/睡觉/被摸/被拎/被甩),
零图片素材(程序化 canvas 线稿猫),支持拖拽、甩出物理、点击摸头、全局敲键反应。

## 运行

```bash
npm install     # devDependency: electron / electron-builder
npm start       # 首次启动自动 swiftc 编译 native/keytap.swift
```

> 本机若在 Electron 系 IDE 的终端里启动,需要先 `unset ELECTRON_RUN_AS_NODE`,
> 否则 Electron 会以纯 Node 模式运行而拿不到 `app`。

- 猫站在主屏工作区底边,会自己散步、眨眼、抖耳、舔毛;45 秒无互动睡觉。
- **拖拽**:按住猫拖动;快速甩出松手 → 抛物线 + 落地弹跳压扁。
- **点击**:摸头,开心眼 + 脸红 + 气泡。
- **敲键**:任意键 → 交替抬爪拍键(Bongo Cat 模式)。首次需在
  系统设置 > 隐私与安全性 > 辅助功能 里授权承载进程(从终端启动则授权终端),
  右键猫 → 「打开敲键权限设置…」可直达。未授权时猫照常活,只是听不到键盘。
- **右键猫**:菜单(暂停 / 现在睡觉 / 权限 / 退出)。

## 分发:官网下载页 + 安装包

纯下载页,两个按钮,没有任何其他功能(零 JS、零后端、零鉴权)。

```
site/                 # 整个目录丢给任意静态托管即可
  index.html          # Windows / macOS 两个下载按钮
  style.css  favicon.svg
  downloads/          # 固定文件名,升级只换内容
    DesktopPet-macOS.dmg
    DesktopPet-Windows.exe
```

```bash
npm run icon        # 生成 build/icon.png + icon.icns(脚本画的猫头)
npm run build:mac   # macOS 通用包(Apple 芯片 + Intel),dmg
npm run build:win   # Windows 64 位 NSIS 安装包
npm run site:sync   # 把 dist/ 最新构件拷成上面的固定名称
npm run site:dev    # 本地预览 http://127.0.0.1:4321
# 或一步到位
bash scripts/release.sh        # mac + win + 同步
```

**所有用户下载同一个通用版本**,不做个性化、不需要登录。
macOS 用 `--universal`,Windows 用 `x64` 单包。

### 安装后自动启动

| 平台 | 机制 |
| --- | --- |
| Windows | NSIS `oneClick + runAfterFinish`:装完立即启动,无需点下一步 |
| Windows | 首次运行写 HKCU Run 启动项(`setLoginItemSettings`),开机自启 |
| macOS | 首次运行注册登录项(`openAtLogin`,LSUIElement 后台无 Dock 图标) |

- 首次运行落一个 `userData/.autolaunch-initialized` 标记,**之后不再强制**;
  用户关掉自启后不会被下次启动重新打开。
- 右键猫 → 「开机自启」可随时切换。无任何引导流程/弹窗。
- 二次启动只唤醒已有窗口(`requestSingleInstanceLock`),不会多开。

### 打包期注意

- `native/keytap` 必须是 universal 二进制,`npm run helper` 会 arm64 + x86_64 编译并
  lipo 合并(mac 打包前自动执行);打包后落在 `Contents/Resources/native/keytap`。
- 打包关了 asar(`asar: false`):资源以裸文件进 `Contents/Resources/app/`,皮肤可直接
  查看替换;应用目录仍在 `/Applications` 下只读,所以运行期皮肤缓存写 `userData/skins`
  (首次运行从内置皮肤释放一份副本)。
- 未配置签名证书时 `CSC_IDENTITY_AUTO_DISCOVERY=false` 出未签名包,
  macOS 首次打开需「右键 → 打开」,Windows SmartScreen 需「仍要运行」。
- 内网/受限网络打包可加 `ELECTRON_MIRROR` 指向镜像(如
  `https://npmmirror.com/mirrors/electron/`),否则会卡在下载 Electron 归档。

## 图像皮肤(当前默认)

`skins/<id>/skin.json` 把动作映射到图片;JPEG 里的"假棋盘格"背景会在主进程用
漫水抠图转成真透明 PNG(`.cache/`),目录改动自动热重载。

**skin.json v2**(多帧 + 表情 + 宫格自动切帧,v1 旧格式仍兼容):

```json
{
  "version": 2,
  "name": "奶油猫 · 插画",
  "fps": 8,
  "sheets": { "walk_sheet.jpg": {} },
  "states": {
    "idle": { "frames": ["idle.jpg"] },
    "walk": { "sheet": "walk_sheet.jpg", "cells": [2, 3, 4], "fps": 6 }
  },
  "expressions": {
    "happy": { "frames": ["pet.jpg"], "once": true, "fps": 6, "hold": 0.6 }
  }
}
```

- `sheets`:声明宫格大图,主进程抠图后按 **alpha 连通域自动切帧**(行优先),
  产物 `.cache/<base>-cell-NN.png`;可选 `"grid": {"cols":3,"rows":2,"cells":[0,1,2]}` 等分切。
  组件过多(>12)或切帧失败自动回退整图单帧;`manifest.json` 增量缓存,源图不变不重切。
- `states.<name>.frames`:单图文件名 / 文件名数组 / `{sheet,cells,fps}`;缺失回退 idle。
- `expressions`:可打断短序列(摸头 happy、Esc surprise、敲键 tap),`once` 播完(+hold)
  自动回落到当前状态帧;无素材静默跳过。
- 换动作图:替换同名文件即可;加新皮肤:复制 `skins/default` 改 `skin.json`。
- 没有可用皮肤时自动回退为程序化线稿猫。

### 散步动画调参(N 帧步态引擎)

`states.walk.anim`(可省略,省略则用旧版墙上时钟颠簸逻辑):

```json
"walk": {
  "frames": ["walk1.jpg", "walk2.jpg"],
  "anim": {
    "interval": [0.14, 0.22],  // 每步时长随机范围(秒),每步独立抽取
    "refSpeed": 46,            // 参考移速 px/s,速度同步基准
    "bobAmp": 3,               // 颠簸幅度 px
    "swayAmp": 0.02,           // 摇摆幅度 rad
    "swayPhase": 1.57,         // 摇摆相位差(π/2=换帧时摆幅最大、换帧点连续)
    "squashAmp": 0.012,        // 落地压扁幅度
    "crossfade": 0.3,          // 步内两帧交叉溶解占比(0=硬切)
    "entryT": 0.25,            // 起步幅度渐入时长
    "stateXfade": 0.12         // 状态边界交叉溶解时长(消除姿态突跳)
  }
}
```

原理:帧切换不用墙上时钟,而用**步相位** φ——每步时长在 `interval` 内随机、并可按
`refSpeed/实际移速` 缩放(钳制 0.6–1.8 倍);颠簸/摇摆/压扁都是 φ 的连续函数且在换帧点
(φ=0)归零,所以换帧瞬间变换量连续、不跳;步内临近换帧点把下一帧交叉溶解淡入消除硬切;
进入/离开 walk 时旧帧做短时交叉溶解,起步幅度 smoothstep 渐入。
**速度同步**:FSM 把当前移速经 `info.speed` 传给皮肤,步频随移速加快/放慢,
颠簸幅度不变(幅度跟步长走、频率跟速度走,观感才自然);改 `refSpeed` 即改同步基准。
调参可在 devtools 用 `petDebug` 观察,或改 skin.json 后右键「重新加载皮肤」热生效。

**帧数任意**(偶数最佳,2/4/8):帧序按循环排「负重帧 → 过渡帧(最高点) → 对侧负重帧 → 过渡帧」,
颠簸频率锁定为每循环 2 次(与帧数无关,波谷自动对齐负重帧);`interval` 是**每次帧前进**的时长——
2 帧换 4 帧时减半(如 `[0.07,0.11]`),步频才不变;4 帧帧差小,`crossfade` 常用 0.3–0.4;
若起伏已画进帧里,程序化 `bobAmp` 要降到 1–1.5 只补残余(否则双倍颠簸)。
顶边踱步(perch/walk 子模式)也映射到同一套 walk 帧与步态引擎。

**AI 补帧**(两帧素材 → 4 帧循环):像素取证与正面 4 拍全套提示词见
[docs/walk-frames-ai-brief.md](docs/walk-frames-ai-brief.md),引擎行为/硬规格/备选路线/验收见
[docs/walk-frames-ai-prompts.md](docs/walk-frames-ai-prompts.md);
`open scripts/walk-preview.html` 可在浏览器里用**同一套公式**预览循环、复刻抠图管线验收素材
(深色背景查白块/灰边)、调参并一键导出 anim JSON。

## 窗口顶边散步(macOS)

猫不只会站地面:会自己跳上普通窗口的顶边踱步、坐下、探头往下看;
窗口被拖动时猫同步跟随,窗口关闭/最小化时猫落回地面;把猫拖到窗口顶边松手会吸附站稳。
屏幕顶沿(菜单栏下缘)是常驻可站面。

- 采集:`native/winlist.swift` 每 500ms 输出窗口矩形 JSON 行
  (只读 bounds,**不读窗口标题**,无需屏幕录制/辅助功能权限);
  主进程 `lib/ledges.js` 过滤(layer==0、排除自身与过窄/过矮/全屏窗口)后推送渲染层。
- 行为:FSM 新增 `climb`(抛物线跳上)/`perch`(stand/walk/look 子行为)/`fall`(落下+压扁);
  顶边行走范围按猫体宽 170px 约束;右键菜单「窗口顶边散步」可开关(默认开),
  采集失败自动回退纯地面模式。Windows 版暂未启用(计划 EnumWindows)。

## 测试

```bash
node test/cell-split.test.js      # 切帧纯函数(合成用例)
node test/sprite-skin.test.js     # 帧时钟/表情队列(桩 Image/ctx)
node test/ledges.test.js          # ledge 过滤纯函数
npx electron test/cell-split.test.js   # 追加真实素材切帧用例
npm start                         # 端到端;devtools 里 petDebug 可手动触发状态/表情
```

## 架构(为换皮肤而设计)

```
输入总线(键位 helper / 鼠标 / winlist 窗口列表 / 未来:LifeOS 事件)
   → 行为 FSM(renderer/cat.js update())   ← 与皮肤无关
   → pose 参数对象(computePose())          ← 皮肤接口
   → 渲染(renderer/sprite-skin.js 图像多帧 / cat.js drawCat() 程序化猫)
窗口层(main.js):透明 frameless alwaysOnTop + 点击穿透(alpha 命中测试) + 位置 IPC
键位层(native/keytap.swift):CGEventTap listen-only,stdout 行协议 K/U <keycode>
窗口层(native/winlist.swift):CGWindowListCopyWindowInfo,stdout JSON 行(1Hz diff 推送)
```

换"真猫"皮肤时:FSM 与窗口层不动,把 sprite-skin 换成透明视频片段播放器
(WebM VP9 alpha / HEVC alpha),状态名映射到片段名即可(见 docs/video-skin-design.md)。

## 路线图

- [ ] 真猫视频皮肤包(绿幕/AI 生成 → 抠像 → 透明视频片段库)
- [ ] 骨骼皮肤(Live2D/Spine)作为卡通路线天花板
- [ ] 与 energy-pet / LifeOS 打通:精力值→猫的心情事件源;TTS 让猫出声
- [x] 沿窗口顶边行走(macOS;Windows EnumWindows 待补)、多屏行走待补
- [ ] 迁 Tauri 或 Swift 原生以降低功耗(行为层可整体移植)
