# ⚙️ 模块详解

## 音源（T1）：Salamander 精简采样

- **来源**：[Salamander Grand Piano V3](https://github.com/sfzinstruments/SalamanderGrandPiano)（CC-BY 3.0）
- **结构**：30 个关键音符 × 3 力度层（`v1` 轻 / `v8` 中 / `v16` 重），共 90 个 FLAC（约 127 MB）
- **非关键音符**：由最近关键音符采样经 `playbackRate = 2^((midi−center)/12)` 变速变形得到
- **清单**：`samples/manifest.json`，由 `tools/make-manifest.mjs` 扫描生成，字段含 keycenter、力度层、URL

> `sampler.js` 中 URL 必须将 `#` 编码为 `%23`（D#/F# 采样文件名），否则被当作 URL fragment 导致 404 —— 曾踩坑。

## 发声引擎（T2）：PianoSampler

[`src/renderer/audio/sampler.js`](../src/renderer/audio/sampler.js)

| 能力 | 实现 |
|---|---|
| 加载 | `AudioContext.decodeAudioData` 批量解码（BATCH=6），进度回调 |
| 力度分层 | `velocity≤42→v1`，`≤85→v8`，否则 `→v16` |
| 变形 | `source.playbackRate` 变速变调 |
| 多复音 | `AudioBufferSourceNode[]` 池，上限 64，超出偷掉最旧音（voice stealing） |
| 释放 | 30ms 快速释放包络，避免按键抬起后的长尾糊音 |
| 音量 | 统一 `GainNode`，`setVolume(0.1~1.0)` |
| 自动播放策略 | AudioContext 创建后先 `suspend()`，首次用户手势 `resume()` |

## 键位映射（T3）

### 键位表 `keymap/default.json`

`event.code`（物理键位，不依赖键盘布局/输入法）→ `{type}`：

- `note`：弹奏音符（`midi` 字段，基础音高窗口 48~93 / C3~A6，**经音区偏移滚动到采样覆盖区 21~108**）
- `func`：功能键（方向键 / Enter / Esc 保留；P3 起 F 行全部移除功能）
- `none`：屏蔽（F1~F12、修饰键、Tab、PrintScreen、媒体键…）

### 路由 `KeyboardRouter`

- `keydown` 匹配 `event.code`，忽略 `e.repeat`（防止按住连击破音）
- 注：CapsLock 等会导致 keydown 被吞的键已在键位表显式 `none`

### 重要键盘映射

| 区域 | 键 | 说明 |
|---|---|---|
| 中央行 `ASDFGHJKL;` | C4~B4 | 主音区（do re mi…） |
| 上方 `QWERTYU IOP` | C#4~C#5 | 黑键 |
| 底行 `ZXCVBNM,./` | C3~E4 | 低音区 |
| 数字行 `1~6` | C5~A5 | 高音区 |
| 小键盘 | 多个 | 区域键 |
| `[] \ - =` | 高音黑键区 | 补全音域 |
| ~~F1~F12~~ | ~~功能~~ | **P3 起映射 `none`**；功能全部改顶栏按钮 |
| 方向键 ↑/↓ →/Enter | 儿歌操作 | 选曲 / 播放（保留键盘操作） |
| Esc | 关面板 | 关闭弹出面板 |

### 音区偏移（第三期）

`keymap.js` 持有 `octaveShift`（半音，默认 0），顶栏「音区 −/+」调 `shift(±12)`：

- `applyOffset(midi)`：`clamp(21, 108, midi + octaveShift)`——弹奏/录音/点亮统一走它
- **边界守卫**：`shift()` 校验整个物理键盘窗口仍在 21~108 内，越界拒绝并提示（不会无限累加）
- 全局影响：发声、录音，以及练谱/挑战的键位标注与命中判定（`绝对midi = 基础midi + shift`）

## 录音与回放（T4）

[`recorder.js`](../src/renderer/audio/recorder.js) · [`playback.js`](../src/renderer/audio/playback.js) · [`midi.js`](../src/renderer/audio/midi.js)

- **录制**：`noteOn/noteOff` 产出 NoteEvent 序列，`stop()` 返回 `{title, events, createdAt, duration, noteCount}`
- **持久化**：经 `window.pianoAPI` → 主进程 IPC → `userData/recordings/*.json`，保留最近 **10** 条
- **回放**：`Playback.play(events)`，**`requestAnimationFrame` 统一时钟调度**（视觉层/判定/字幕/卷帘共用同一时间基准），`stop()` 可随时打断（按键弹奏会打断回放）
- **视觉订阅**：`Playback.onEvent` 向视觉层逐事件广播（瀑布/键盘点亮），`onBar` 广播播放头位置
- **MIDI 导出**：`NoteEventsToMidi(events, bpm)` 手写 SMF 格式 1（vlv 变长编码 + tempo meta + 480 分割），`MidiToBase64` → IPC 另存对话框落盘 `.mid`

## 视觉层（T8）：四模式 + 虚拟键盘（第二批 / 第三期）

[`ui/`](../src/renderer/ui/）：`virtual-keyboard.js` · `mode-manager.js` · `mode-play.js` · `mode-enjoy.js` · `mode-practice.js` · `mode-challenge.js` · `subtitle.js` · `mode-roll.js`

- **布局**：三段 flex column — 顶栏（模式 chips + 功能按钮 + 状态/字幕带）/ `#modeStage` 可视化区 / 底部 `#vkbWrap` 虚拟键盘
- **虚拟键盘**：`VirtualKeyboard({container, keymap})` 按 `keymap.range`(21~108) 渲染 **88 键**（白 52 / 黑 36），`onNoteDown/Up` 按 `.on` class 点亮，`light(midi,on)` 供回放点亮，`clearAll()` 复位；`refreshOctave()` 刷新音区高亮与键位字母、中央 C（midi 60）徽标
- **模式管理器**：`register(module)` / `cycle()`（循环 弹奏→欣赏→练谱→挑战），模块契约 `enter()/exit()`，`onNoteDown/onEvent` 由事件总线注入
- **弹奏**：音名气泡（`.sky-bubble`，HSL 随机色上浮动画）+ 中央 C 徽标
- **欣赏**：音符瀑布（`.wf-note` 预建下落）+ 播放条 + 回放点亮虚拟键
- **练谱**：音符方块落向判定线，`+10`/连击+1/错键·超时 miss，三档速度（0.5x/0.75x/1x），结算星级；**键位字母 = 当前音区下反查物理键**
- **挑战**：随机亮键打地鼠 + 倒计时圆环 + 连击≥10 双键 + 星级结算；**出题池 = 当前音区窗口内物理可达键**
- **字幕带**：卡拉OK简谱（1–7）事件驱动高亮；`setFree` 自由弹奏即时显示音名
- **卷帘**：欣赏模式回放录音时切入钢琴卷帘（音高车道 21~108 + 播放头）

## 儿歌（T5）

[`src/renderer/songs/songs.js`](../src/renderer/songs/songs.js)

- **10 首**：小星星 / 两只老虎 / 铃儿响叮当 / 欢乐颂 / 生日快乐 / 粉刷匠 / 小毛驴 / 世上只有妈妈好 / 找朋友 / 丢手绢
- **曲谱**：简谱节奏数组（音符 + 时值），`SongToEvents`（[songs.js](../src/renderer/songs/songs.js#L186-L187)）转 NoteEvent 序列
- **播放**：复用 Playback 调度，演奏中按任意琴键立即打断

## 主进程（T6/T7）

[`src/main/index.js`](../src/main/index.js)

| 职责 | 实现 |
|---|---|
| Kiosk | `fullscreen + frame:false + setKiosk(true) + skipTaskbar + alwaysOnTop` |
| 单实例 | `requestSingleInstanceLock()`，二次启动聚焦已有窗口 |
| 防退出 | `globalShortcut.register('Ctrl+Alt+Shift+Q')` → 渲染层弹确认面板 |
| Win 键屏蔽 | `@fainthit/uiohook-napi-suppress` 低级钩子吞 Win 键及组合（详见架构页） |
| 关闭拦截 | `close` 事件 `preventDefault`，除非 `global.__exiting` 置位 |
| 退出确认 | 唯一真退出路径：渲染层「确认退出」→ IPC `app:confirm-exit` |
| 日志转发 | `console-message` 转发，无 DevTools 环境可排障 |
| 采样目录 | `app:get-samples-dir`（打包/开发双分支，见架构页） |

## preload 桥（安全）

[`src/main/preload.js`](../src/main/preload.js)

`window.pianoAPI` 暴露白名单：`recordingSave/List/Load/Delete`、`exportMidi`、`getSamplesDir`、退出确认监听 `onRequestExit`。
