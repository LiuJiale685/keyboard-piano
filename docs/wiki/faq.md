# ❓ 常见问题（FAQ）

## 使用类

### Q1 安装后双击没反应 / 白屏？

1. 检查是否已有实例在运行（单实例锁会聚焦已有窗口而非新开）
2. 全屏窗口可能被其他程序遮挡——按 `Ctrl+Alt+Shift+Q` 若弹出「确认退出」面板则正常，按 Esc 取消
3. 采样加载需要十几秒，期间是加载界面，请等待（90 个 FLAC 解码）

### Q2 为什么某些键不发声？

- 功能键（F1~F12）、修饰键（Ctrl/Alt/Win）、方向/编辑键、PrintScreen/媒体键按设计被屏蔽，不发声
- 第三期起 F 行已无功能，录音/回放/儿歌/音量/音区全部改由顶栏按钮操作
- 某键无声音时，请看键位表 `keymap/default.json` 确认

### Q3 如何退出？

唯一方式：`Ctrl + Alt + Shift + Q` → 弹出「确认退出」→ 确认。Alt+F4、任务管理器强杀之外的所有关闭动作都会被拦截。

### Q4 录音存在哪里？能导出吗？

- 录音存于本机 `userData/recordings/`（`%APPDATA%/键盘模拟钢琴/recordings/`，保留最近 10 条）
- 主界面「我的录音」面板中每条可回放 / 导出 MIDI / 删除

### Q4.1 按 Win 键会弹开始菜单吗？

不会。应用运行期间主进程的低级键盘钩子会在系统层面直接吞掉左/右 Win 键及所有 Win+组合键，
Web 层的 `preventDefault` 拦不住的开始菜单在这里被拦下，效果与游戏内屏蔽一致——儿童乱按 Win 键
不会切走焦点、之后的按键依然正常发声。退出应用后钩子自动卸载，Win 键恢复正常。

## 开发类

### Q5 采样 404，日志出现 `#` 相关问题？

D#/F# 采样文件名含 `#`，在 `file://` URL 中必须编码为 `%23`。若自行改过 sampler.js 的 URL 拼接，务必保留该编码。

### Q6 怎样自己加儿歌？

编辑 `src/renderer/songs/songs.js`：

1. 在 `SONGS` 数组追加一项：`{ id, title, tempo, tracks: [...] }`
2. 音高用简谱数字（或 MIDI 音高），时值用拍数；`SongToEvents` 会自动转成事件序列
3. 无需改动其他代码，面板与播放自动生效

### Q7 想换键位主题？

复制 `src/renderer/keymap/default.json` 为新 JSON 文件（改 `name`），在 `keymap.js` 的加载逻辑切换即可。字段格式见 [modules.md](modules.md#键位表-defaultjson)。

### Q8 为什么代码里用 XHR 而不是 fetch？

打包后页面通过 `file://` 协议加载，`fetch` 在 file 协议下不可用，XHR + `file://` 绝对路径是可靠方案。这也是采样必须经 `extraResources` 外置、经 IPC 拿真实路径的原因。

## 打包类

### Q9 `npm run dist` 报 `ECONNREFUSED 127.0.0.1:443`？

本机 DNS 劫持 + 代理注入导致 electron-builder 向本地 443 端口取二进制。直接使用 `dist` 脚本（已切 npmmirror 镜像），**勿**手动追加 kk 子目录前缀。详见 [build.md](build.md#打包二进制下载排障)。

### Q10 打包后没声音？

- 确认 `dist/win-unpacked/resources/samples/` 下有 90 个 FLAC（不应在 asar 里）
- 安装版装到自定义目录后，采样目录为 `<安装目录>/resources/samples/`
- 运行打包版时看日志是否 `samples=90/90`

### Q11 能跨平台吗？

当前仅打包 Windows（NSIS, x64）。代码本身用 Electron + 标准 Web API，理论上可加 mac/linux target，但未验证，不做承诺。

## 资源类

### Q12 采样音源版权？

Salamander Grand Piano V3，[CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/)。分发请保留署名（本项目 README 已注明来源）。

### Q13 采样太大，能精简吗？

可以。`samples/manifest.json` 是唯一清单来源，删掉部分力度层（如只留 v1/v16）后重新 `node tools/make-manifest.mjs` 即可，加载更快但音色层次减少。应用本身不强依赖固定数量。
