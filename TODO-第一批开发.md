# 键盘模拟钢琴 · 第一批开发 TODO 清单

> 依据：`PRD-键盘模拟钢琴.md`（评审通过 v1.0）。目标 Windows EXE（Electron）。
> 范围：P0-1~P0-7 + P1（时间允许）。视觉反馈（P2 虚拟键盘/音节飘起）**本期不做**，但架构预留事件管线。

## 已完成（脚手架骨架）

- [x] Electron 工程初始化（`package.json`，`npm start` 可跑）
- [x] 主进程 `src/main/index.js`：Kiosk 全屏、无菜单/任务栏、单实例锁、关闭事件拦截、`Ctrl+Alt+Shift+Q` 全局快捷键 → 弹退出面板、`will-quit` 反注册
- [x] 预加载 `src/main/preload.js`：`window.pianoAPI`（退出面板事件/确认/通知）
- [x] 渲染加载页 `src/renderer/loading.html` + `app.js`：进度条（骨架期假进度）、应用内退出确认面板、10s 超时自动关

> ⚠️ 骨架期注意点（已在主进程处理）：
> - `BrowserWindow({kiosk:false})` 再 `setKiosk(true)`，避免启动闪烁；`setAlwaysOnTop('screen-saver')` 尽力防 Alt+Tab 遮挡（防不了系统级，符合 PRD FR-07）。
> - IPC 用了 `contextIsolation + sandbox`，后续引擎代码一律走 preload 桥，不直接开 nodeIntegration。

---

## TODO（开发实施顺序）

### T1 音源数据准备
- [ ] 选定真钢琴采样源（88 键 / 多力度层，约 300MB，授权 CC0/公共领域，如 Salamander 系）
- [ ] 采样处理管线：转换/裁剪为各键触发可用的音频文件（WAV/OGG），命名 `note{pitch}.{ext}`（如 `note60.ogg` = C4）
- [ ] 采样文件放入 `src/renderer/samples/`（或 asar 外层目录，评估体积与加载顺序）
- [ ] 输出采样清单 `manifest.json`（键位→文件、力度层数）供加载器读取

### T2 发声引擎（FR-02 / §5.1 共享规则）
- [ ] `src/renderer/audio/sampler.js`：AudioContext 单例、全量 `decodeAudioData` 预加载、进度派发
- [ ] 复音管理：上限 64、最旧偷占（voice stealing）、`AudioBufferSourceNode` 即建即用
- [ ] note-off 释放包络（5~50ms 指数衰减）防爆音；`e.repeat` 忽略
- [ ] 统一入口 `Engine.play(note, velocity) / release(note)`（演奏/回放/儿歌共用）

### T3 键位映射（FR-03、功能键位表唯一出处）
- [ ] `src/renderer/keymap/default.json`：`event.code` → {type: note|func|none, note, func}
  - 主键区/顶行/底行/数字行/小键盘 → 音符；F2~F10 → 功能；Ctrl/Alt/Shift 辅助（延音/八度，P1）；Win 不映射；PrintScreen/媒体键 [TBD] 全局钩子评估
  - 音域 C3~C6 一带（约 3~4 个八度，含黑键）
- [ ] `keymap` 加载器：读取 JSON → 查表函数 `lookup(event.code)`
- [ ] 键盘监听器：keydown/keyup → 查表 → 路由（发声/功能键/忽略）

### T4 录制与回放（FR-04，本地持久化）
- [ ] `recorder.js`：NoteEvent（down/up + 时间戳）序列录制，F2 开始 / F3 停止
- [ ] `playback.js`：按时间线调度回放（同一引擎），F4 回放最新 / F5 停止；录制回放互斥（§3.3）；回放中敲键打断
- [ ] 持久化：序列存本地（Electron `userData`，JSON/.mid），重启可回放；保留最近 10 条、可删除
- [ ] P1-1：导出 MIDI（MidiWriterJS）

### T5 儿歌（FR-05）
- [ ] `songs/` 曲目数据：约 10 首（小星星、两只老虎、数鸭子、粉刷匠、铃儿响叮当…）音符序列（音高+时长）
- [ ] 儿歌面板 UI：F6 开关、↑/↓ 或数字选曲、Enter 播放、F7 直接播、F8 停止；3 档力度起伏
- [ ] 复用回放引擎调度，琴键随时打断

### T6 UI 整合（纯功能面，P2 视觉虚拟键盘不做）
- [ ] 主界面：加载进度 → 就绪状态区；功能提示（顶部状态条示意 F2~F8 用途）
- [ ] 状态提示（录音中/回放中/儿歌播放中/暂无录音等）
- [ ] 退出面板：已由骨架提供，接入真实引擎后回归自测

### T7 收尾
- [ ] 打包配置（electron-builder）：NSIS 安装包，含 300MB 采样进 asar/extraResources
- [ ] 自测清单：Kiosk 全屏、防退出四键、全键发声抽样、多复音（锤和弦）、录制回放持久化、儿歌播放、Alt+F4 拦截
- [ ] 回归 PRD 边界异常表（§6）逐项过

---

## 关键约束（实现勿偏离）

1. **组合键固定 `Ctrl+Alt+Shift+Q`**（主进程 globalShortcut；渲染层收不到该组合，天然不发声）
2. **全键盘发声**：除 F 行功能键、方向/编辑功能键、修饰键、Win、PrintScreen/媒体键外，其余物理键全部映射音符
3. **Node 集成关闭**：渲染层一律走 preload `/window.pianoAPI` 桥
4. **时间基准**：录制/回放/儿歌统一事件管线（FR §5.1/§5.2）
5. **持久化**落 `app.getPath('userData')`
