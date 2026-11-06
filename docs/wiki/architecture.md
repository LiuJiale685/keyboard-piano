# 🏗️ 架构概览

## 进程模型

Electron 双进程架构，主进程 + 单个渲染进程。

```
┌──────────────────────────────────────────────────────┐
│  主进程 src/main/index.js                              │
│  ─ Kiosk 窗口：全屏 / 无边框 / 置顶 / 隐藏任务栏        │
│  ─ 单实例锁（重复启动激活已有窗口）                     │
│  ─ globalShortcut: Ctrl+Alt+Shift+Q 全局防退出        │
│  ─ Win 键屏蔽：低级键盘钩子吞 Win 键及其组合             │
│    (@fainthit/uiohook-napi-suppress)                 │
│  ─ close 事件拦截 → 渲染层退出确认面板                  │
│  ─ IPC handlers:                                       │
│      rec:list / rec:save / rec:load / rec:delete       │
│      midi:export（另存对话框）                          │
│      app:get-samples-dir（采样目录暴露）                │
└───────────────┬──────────────────────────────────────┘
                │ contextBridge（preload.js，sandbox 开启）
┌───────────────▼──────────────────────────────────────┐
│  渲染进程 src/renderer/                                │
│  index.html（加载层 → 就绪主界面 → 各弹出面板）          │
│  app.js ── 主控制器：状态 / 键盘路由接线 / 模式分发 / 面板 / 状态条 │
│    ├─ keymap/   KeymapRegistry(加载JSON) + KeyboardRouter(keydown路由)
│    ├─ audio/    PianoSampler(发声) · Recorder(录制) · Playback(回放) · midi(导出)
│    ├─ ui/       视觉层：virtual-keyboard / mode-manager / mode-play(弹奏)
│    │            mode-enjoy(欣赏) / mode-practice(练谱) / mode-challenge(挑战)
│    │            subtitle(简谱字幕带) / mode-roll(录音室卷帘) — 纯订阅者
│    ├─ songs/    SONGS 数组 + SongToEvents(曲谱→事件序列)
│    └─ samples/  manifest.json + 90 FLAC（开发目录；打包时外置）
└──────────────────────────────────────────────────────┘
```

## 核心数据流

### 弹奏链路（按键 → 声音）

```
keydown(物理键 event.code)
  → KeyboardRouter 查键位表
  ├─ type=note → onNoteDown(midi) → app.js
  │     ├─ 回放中？→ 打断回放（§3.3 回放优先）
  │     ├─ 音区偏移：midi = keymap.applyOffset(baseMidi)（钳制 21~108，P3）
  │     ├─ 录音中？→ recorder.noteOn(note)（记录偏移后绝对音高）
  │     └─ sampler.play(note, velocity=100) → Web Audio 发声
  └─ type=func → onFunc(func) → app.js handleFunc 功能表（唯一出处；P3 起由顶栏按钮驱动）
keyup → keymap.applyOffset(midi)（与 keydown 同偏移，保证配对）→ sampler.release(note)
```

### 音区偏移（第三期）

物理键指法固定（同一套 `event.code` → 基础 midi），顶栏「音区 −/+」把 `keymap.octaveShift` 整体平移 ±12 半音，`applyOffset(midi)` 原子钳制在采样覆盖区 21~108 之间：

```
基础 midi 48~93 ──＋octaveShift──→ 绝对发声/点亮音高 21~108
```

- 弹奏链路：`onNoteDown/onNoteUp` 统一走 `applyOffset`，录音 NoteEvent 记录**偏移后**音高
- 练谱/挑战：音符标注 = 当前音区下反查物理键（`base = 绝对midi − octaveShift`）；判定比较绝对值，天然一致
- 回放/儿歌：事件音高即绝对 midi，直接点亮对应 88 键，**不受音区影响**

### 事件基元 NoteEvent

录制 / 回放 / 儿歌统一使用同一种事件序列，时间轴为 `performance.now()` 相对秒：

```js
{ a: 'down' | 'up',   // 动作：按下 / 抬起
  n: 21~108,          // MIDI 音高（绝对，音区偏移后）
  v: 0~127,           // 力度（回放/儿歌默认力度档）
  t: 123.45 }         // 相对时间（秒）
```

- **录制**：键盘路由实时产生产生 down/up 事件 → `recorder.noteOn/noteOff`
- **回放**：`Playback.play(events)` 用 **`requestAnimationFrame` 统一时钟**按时间轴调度，逐条调 sampler，同时 `onEvent/onBar` 向视觉层广播（瀑布 / 键盘点亮 / 字幕 / 曲名播放条共用同一时间基准，杜绝 setTimeout 漂移）
- **儿歌**：曲谱（简谱数组）→ `SongToEvents` 静态转成事件序列 → 复用同一 Playback 调度

### 视觉层订阅（第二批）

四模式为**纯订阅者**（PRD §5.1）：发声 / 录音 / 儿歌逻辑零改动，事件总线把三来源（物理键 / 儿歌 / 回放）统一汇入 `onNoteDown / onNoteUp / onEvent / onBar` 回调：

```
物理键 keydown ──KeyboardRouter──┬─ sampler.play（发声）
                                 ├─ recorder.noteOn（录音中）
                                 └─ 视觉层: vkb点亮 / 气泡 / 瀑布 / 判定 / 亮键
儿歌 / 回放 Playback(rAF时钟) ────┬─ sampler.play（发声）
                                 └─ onEvent/onBar → 瀑布 / 字幕 / 键盘点亮 / 播放条 / 卷帘播放头
```

- 模式切换：顶栏模式 chips 点击（无键盘快捷键，F1 已删除）弹奏 → 欣赏 → 练谱 → 挑战，模块契约 `enter()/exit()`，`exit()` 内清理 rAF 与 DOM
- 虚拟键盘：按 `keymap.range`（A0~C8，21~108）渲染 **88 键**，白键标键位字母（跟随音区偏移），中央 C 徽标；仅响应物理键盘（无鼠标/触摸弹琴）；音区窗口外键降透明
- **顶栏功能按钮化（P3）**：录音/回放/儿歌/音量/音区/模式全部由顶栏鼠标按钮驱动（`e.code` 路由的 `func` 分支仅保留方向键选曲 / Enter 播放 / Esc 关面板）；F1~F12 映射为 `none`，按下无动作

## 状态机

### PianoSampler

```
idle ── init() ──→ loading ── loadAll() ──→ ready
                    │  (批量解码 90 FLAC, BATCH=6)
                    └─ 失败 → onError 回调 → 加载层展示错误
```

### Recorder

```
idle ⇄ recording ── stop() ──→ idle(产生片段)
```

### Playback

```
idle ── play() ──→ playing ── 播完/stop() ──→ idle
```

## 安全模型

| 项 | 配置 | 说明 |
|---|---|---|
| contextIsolation | `true` | preload 与页面隔离 |
| sandbox | `true` | 渲染进程沙箱化，无 Node |
| nodeIntegration | `false` | 页面不可直接 require |
| CSP | `default-src 'self'; script-src 'self'` | 无内联脚本 |
| 桥对象 | `window.pianoAPI` | 仅暴露 `invoke` 白名单方法 |

渲染层获取能力全部经过 preload 的 `ipcRenderer.invoke`，主进程侧逐方法校验，不做任意路径转发。

## Win 键系统级屏蔽

网页层的 `keydown.preventDefault()` 拦不住 Win 键——Windows 在内核收到扫描码时就弹开始菜单，
焦点切走后后续按键落入搜索框，钢琴失声。对策是**主进程低级键盘钩子**：

- 依赖：`@fainthit/uiohook-napi-suppress`（uiohook 的 fork，含预编译 N-API 二进制，无需编译工具链）
- 时机：`app.whenReady` 中 `registerSuppress` + `start()`，`will-quit` 中 `unregisterSuppress` + `stop()`
- 规则：
  - `{ keycode: Meta }` / `{ keycode: MetaRight }`：吞掉左/右 Win 键本体
  - `{ metaKey: true }`：兜底吞掉 Win+任意键全部组合（含 Win+L 锁屏等破坏性组合）
- 效果：与游戏内屏蔽一致，按 Win 无任何系统反应，其他按键照常弹奏

> ⚠️ 该钩子为系统级全局钩子：应用运行期间整机的 Win 键都会被抑制,退出后自动恢复。

## 采样资源的两套路径

FLAC 体积过大（127 MB）不进 asar，因此**文件读取用 XHR + `file://` 真实路径**，而非打包内的相对资源：

- **开发模式**：`src/renderer/samples/`（相对路径加载）
- **打包模式**：`resources/samples/`（`app.isPackaged` 分支，经 IPC 返回 `file:///` 绝对路径）

```js
// 主进程
ipcMain.handle('app:get-samples-dir', () => {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'samples')
    : path.join(__dirname, '../renderer/samples');
  return { dir, url: 'file:///' + dir.replace(/\\/g, '/') + '/' };
});
```

详见 [📦 构建与打包](build.md)。
