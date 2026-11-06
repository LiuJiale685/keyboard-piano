# 🎹 键盘模拟钢琴

面向儿童（1–10 岁）的 Windows 桌面钢琴模拟器。把电脑键盘变成一台真正的钢琴——内置 **真钢琴采样音源**（Salamander Grand Piano），全键盘任意按键发声，支持录音回放与儿歌自动演奏，Kiosk 全屏模式防止儿童误触退出。

## ✨ 功能特性

| 特性 | 说明 |
|---|---|
| 🎼 真钢琴音色 | Salamander Grand Piano 采样：30 个音符 × 3 力度层（90 个 FLAC），其余音由变速变形生成 |
| ⌨️ 全键盘发声 | 同一套指法 + 顶栏「音区 −/+」滚动覆盖全部 **88 键（A0–C8）** |
| 🎚️ 力度分层 | 轻触 / 中击 / 重击自动切换三档真实采样，击键力度越强声音越亮 |
| 🎵 儿歌自动演奏 | 内置 10 首经典儿歌（小星星、两只老虎、铃儿响叮当…），顶栏按钮或 Enter 即弹 |
| 📼 录音与回放 | 顶栏「● 录音 / ■ 停止」录制，「▶ 回放」重听，录音保存在本机，重启不丢失 |
| 🎯 MIDI 导出 | 任意录音可一键导出为标准 .mid 文件 |
| 🎹 四模式（第二批） | 顶栏 chips（或 `F1`…详见下）循环切换：**弹奏**（虚拟键盘+音名气泡）→ **欣赏**（音符瀑布+播放条+键盘点亮）→ **练谱**（跟弹判定+连击+三档速度+星级）→ **挑战**（随机亮键+倒计时圆环+连击关卡+星级） |
| 📜 简谱字幕带 | 儿歌/回放时卡拉OK式简谱（1–7）高亮推进，自由弹奏即时显示当前音名 |
| 🎚️ 录音室卷帘 | 欣赏模式回放录音时切换钢琴卷帘视图 + 播放头 |
| 🛡️ Kiosk 防退出 | 全屏 + 任务栏隐藏 + 关闭拦截，仅 `Ctrl+Alt+Shift+Q` 可退出 |

## 📦 快速开始

### 硬件要求

- Windows 10 / 11（x64）
- 约 300 MB 磁盘空间（含采样音源）

### 方式一：安装包（推荐）

1. 下载 [键盘模拟钢琴 Setup 0.1.0.exe](dist/键盘模拟钢琴%20Setup%200.1.0.exe)
2. 双击安装（可自定义安装目录），桌面会自动创建快捷方式
3. 启动后自动全屏进入钢琴界面，等待音源加载完成即可弹奏

### 方式二：源码运行（开发）

```bash
# 安装依赖（需 Node.js 18+）
npm install

# 开发模式运行（带日志输出）
npm run dev

# 或普通启动
npm start
```

> 开发模式需要 `src/renderer/samples/` 下有完整的 90 个 FLAC 采样文件。首次克隆仓库后请运行 `node tools/download-samples.mjs` 获取音源（见下文）。

### 从源码打包安装包

```bash
npm run dist        # 生成 NSIS 安装包（dist/ 目录）
```

> 打包细节与踩坑（`npmRebuild:false`、镜像变量、PowerShell 下 `set` 失效）见 [Wiki 构建与打包](docs/wiki/build.md)。

## 🎹 使用指南

### 弹琴

字母区中央三行即「白键」：`A S D F G H J K L`；上方 `W E T Y U` 等即「黑键」。右侧数字行、`；`、`[]`、小键盘也都是琴键。

提示：先把手指放中间行 `A S D`——它们对应中央 C 附近的 `do re mi`，像真实钢琴的位置一样。

第三期起，**F 行（F1~F12）不再绑定任何功能**，全部功能由顶栏鼠标按钮完成：

| 功能 | 顶栏按钮 |
|---|---|
| 切换模式（弹奏/欣赏/练谱/挑战） | 顶部模式 chips（点击即可） |
| 录音 / 停止录音 | `● 录音` / `■ 停止` |
| 回放最近的录音 / 停止回放 | `▶ 回放` / `■ 停止` |
| 打开儿歌面板 / 播放选中曲 / 停止 | `🎵 儿歌` / `▶ 播放` / `■ 停止` |
| 音量减小 / 增大 | `音量 −` / `音量 +` |
| 音区（八度）下移 / 上移 | `音区 −` / `音区 +`（±1 八度，滚动覆盖 88 键） |
| 儿歌面板选曲 | `↑` / `↓`（`Enter` 播放，保留键盘操作） |
| 关闭弹出面板 | `Esc` |
| **退出应用** | `Ctrl + Alt + Shift + Q` |

### 录音与回放

1. 点击顶栏 `● 录音` 开始录制（状态栏显示 ● 录音中…）
2. 弹一段旋律，点击 `■ 停止` 自动保存
3. 点击 `▶ 回放` 重听；在主界面右侧「我的录音」面板中可回放 / 导出 MIDI / 删除任意历史录音

### 内置儿歌

点击顶栏 `🎵 儿歌` 打开儿歌面板，`↑`/`↓` 选曲，点击 `▶ 播放`（或按 `Enter`）自动演奏。演奏中按下任意琴键即可打断，直接开始自己弹。

## 🏗️ 技术架构

```
┌────────────────────────────────────────────────┐
│                   主进程 (Main)                  │
│  Kiosk 全屏 · 单实例锁 · 防退出快捷键 · 录音持久化 │
│  IPC: 录音增删查 / MIDI 导出 / 采样目录暴露        │
└───────────────┬────────────────────────────────┘
                │ contextBridge (preload, 沙箱开启)
┌───────────────▼────────────────────────────────┐
│                渲染进程 (Renderer)               │
│  app.js       主控制器：状态、路由、模式分发       │
│  keymap/      键位表 JSON + 物理键路由             │
│  audio/       Web Audio 发声/录制/回放/MIDI 导出  │
│  ui/          视觉层：虚拟键盘/模式×4/字幕带/卷帘   │
│  songs/       10 首内置儿歌                       │
│  samples/     Salamander 采样（打包时外置）        │
└────────────────────────────────────────────────┘
```

- **技术栈**：Electron 45 + Web Audio API + electron-builder（NSIS）
- **音源**：[Salamander Grand Piano V3](https://github.com/sfzinstruments/SalamanderGrandPiano)（CC-BY 3.0），30 keycenter × 3 力度层 FLAC，其余音符通过 `playbackRate` 变速变形获得
- **发声引擎**：`PianoSampler` 状态机（idle → loading → ready），批量解码，复音上限 64（超出自动偷音），按力度切层
- **键位设计**：`event.code` 物理键定位（不依赖输入法/键盘布局），键位表为 JSON，可替换；**同一套指法 + 音区偏移（`applyOffset`）滚动覆盖 88 键（A0–C8）**
- **安全**：`contextIsolation + sandbox`，渲染层无 Node 集成，全部经 preload 桥

> 详细设计见 [Wiki](docs/wiki/README.md)。

## 📁 目录结构

```
piano/
├── src/
│   ├── main/           # 主进程：窗口/Kiosk/防退出/IPC
│   │   ├── index.js
│   │   └── preload.js  # contextBridge 桥
│   └── renderer/
│       ├── index.html  # 主界面（三段布局：顶栏/可视化区/虚拟键盘）
│       ├── app.js      # 主控制器
│       ├── audio/      # sampler / recorder / playback / midi
│       ├── keymap/     # default.json + 键位加载与路由
│       ├── ui/         # 视觉层：virtual-keyboard / mode-manager
│       │               #  mode-play/enjoy/practice/challenge / subtitle / mode-roll
│       ├── songs/      # songs.js 儿歌曲目
│       └── samples/    # manifest.json + 90 个 FLAC 采样
├── tools/              # 采样下载/清单生成/CDP 端到端测试/模式验证
├── docs/wiki/          # 项目 Wiki
├── build/              # 打包图标等资源
├── dist/               # 打包产物（安装包 / win-unpacked）
├── PRD-键盘模拟钢琴.md  # 产品需求文档
├── TODO-第一批开发.md   # 第一批任务清单
├── TODO-第二批开发.md   # 第二批任务清单（模式/视觉系统）
└── package.json
```

## 🧰 开发工具

| 工具 | 用途 |
|---|---|
| `tools/download-samples.mjs` | 下载 Salamander 90 个采样 FLAC 到 `samples/`（约 127 MB） |
| `tools/make-manifest.mjs` | 扫描 `samples/` 生成 `manifest.json` |
| `tools/cdp-test.mjs` | 启动应用后通过 CDP 端口做端到端回归（含四模式/瀑布/字幕带/键盘点亮/88 键/顶栏按钮） |
| `tools/vkb-test.mjs` | 视觉层专项验证（V0/V1 模式循环 + 弹奏动画） |
| `tools/enjoy-test.mjs` | 欣赏模式验证（瀑布/播放条/点亮） |
| `tools/practice-test.mjs` | 练谱模式验证（判定/连击/星级） |
| `tools/challenge-test.mjs` | 挑战模式验证（亮键/圆环/连击/结算） |
| `tools/subtitle-test.mjs` | 简谱字幕带验证 |
| `tools/roll-test.mjs` | 录音室卷帘验证 |
| `tools/make-icon.ps1` | 生成 `build/icon.png` 应用图标 |

```bash
# 示例：抓取采样并生成清单
node tools/download-samples.mjs
node tools/make-manifest.mjs
```

## 🧪 测试

```bash
# 以带调试端口的方式启动应用
npm run dev -- --remote-debugging-port=9222

# 另开一个终端运行端到端回归（覆盖：加载、儿歌播放、录音回放、持久化、音量、面板、四模式、瀑布、字幕带、键盘点亮、88 键、音区偏移、F 键无动作）
node tools/cdp-test.mjs

# 模式专项验证（可选，无需重启应用）
node tools/vkb-test.mjs      # V0/V1 弹奏
node tools/enjoy-test.mjs    # V2 欣赏
node tools/practice-test.mjs # V3 练谱
node tools/subtitle-test.mjs # V4 字幕带
node tools/challenge-test.mjs# V5 挑战
node tools/roll-test.mjs     # V6 卷帘
```

CDP 回归覆盖关键链路（含第二批四模式视觉系统与第三期 88 键/按钮化/音区偏移），全部通过后可放心打包发布。

## 📄 文档

- [产品需求文档](docs/../PRD-键盘模拟钢琴.md)（PRD v1.2，含第二期前端方案 / 第三期 88 键 + 顶栏按钮化）
- [第一批开发任务清单](docs/../TODO-第一批开发.md)
- [第二批开发任务清单](docs/../TODO-第二批开发.md)（模式/视觉系统）
- [第三批开发任务清单](docs/../TODO-第三批开发.md)（88 键音域 + 顶栏功能按钮化）
- [项目 Wiki — 架构 / 模块 / 打包 / 常见问题](docs/wiki/README.md)

## ⚖️ 许可证

- 应用代码：`UNLICENSED`（私有）
- 采样音源：Salamander Grand Piano V3，[CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/)

## 🚀 路线图

- **第一期（已完成）**：全键盘发声、真钢琴采样、录音回放、MIDI 导出、儿歌、Kiosk 防退出、NSIS 打包
- **第二期（已完成）**：四模式视觉系统（弹奏/欣赏/练谱/挑战）、简谱字幕带、录音室卷帘、CDP 端到端回归扩展
- **第三期（已完成）**：88 键音域（A0–C8）虚拟键盘、F 区删除、顶栏功能按钮化、音区偏移滚动覆盖
- **未来（计划）**：更多曲子与音色、力度曲线可调、成绩存档
