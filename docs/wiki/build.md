# 📦 构建与打包

## 环境要求

- Node.js 18+、npm
- Windows 10/11（目标平台 x64）

## 安装依赖

```bash
npm install
```

- devDependencies：`electron` 与 `electron-builder`
- dependencies（进发布包）：`@fainthit/uiohook-napi-suppress`（Win 键屏蔽用低级键盘钩子，**预编译 N-API 二进制**，与 Electron ABI 无关，所以无需随 Electron rebuild）

## 采样音源获取

打包与开发都依赖 `src/renderer/samples/` 下的 90 个 FLAC。克隆后为空目录时：

```bash
# 1) 从镜像下载 30×3 = 90 个 FLAC（约 127 MB）
node tools/download-samples.mjs

# 2) 扫描生成 manifest.json（如缺失）
node tools/make-manifest.mjs
```

## 应用图标

`build/icon.png`（256×256）会被 electron-builder 自动识别为应用图标，无需在 `package.json` 显式引用。

- 重新生成：`powershell -ExecutionPolicy Bypass -File tools/make-icon.ps1`
- 注：脚本生成的 `icon.ico` 部分存在历史 bug（ICO 头手写失败），**当前 icon 方案只依赖 PNG**，请勿删除 `build/icon.png`。

## 打包安装包

```bash
npm run dist          # 产出 dist/ NSIS 安装包
npm run dist:clean    # 清空 dist/ 后重新打包
```

### 产物

```
dist/
├── 键盘模拟钢琴 Setup 0.1.0.exe   # NSIS 安装包（自动带卸载器）
├── 键盘模拟钢琴 Setup 0.1.0.exe.blockmap
├── win-unpacked/                  # 免安装版（绿色运行）
│   ├── 键盘模拟钢琴.exe
│   └── resources/
│       ├── app.asar               # 应用代码
│       └── samples/               # 90 个 FLAC 采样（extraResources 外置）
└── builder-effective-config.yaml
```

## 打包配置要点（package.json `build`）

| 项 | 值 | 说明 |
|---|---|---|
| `appId` | `com.kidspiano.keyboard` | |
| `productName` | `键盘模拟钢琴` | 安装包 / EXE / 快捷方式名 |
| `npmRebuild` | `false` | 见下文「native 依赖 rebuild 坑」 |
| `extraResources` | `src/renderer/samples → samples` | **采样不进 asar**，否则 XHR 读不了 FLAC |
| `files` | `!src/renderer/samples` | 排除重复打包采样进 asar |
| `nsis` | oneClick=false 等 | 可选手动安装、可选目录、建桌面快捷方式 |
| target | `win x64 nsis` | 输出 x64 安装包 |

## ⚠️ 踩坑一：native 依赖 rebuild 失败（无 VS 工具链）

`electron-builder` 会对所有 dependencies 执行 `@electron/rebuild`（重新编译原生模块）。本机**未装 Visual Studio C++ 工具链**时，若依赖里有需从源码编译的模块会直接失败：

```
⨯ node-gyp failed to rebuild '...' 
Error: Could not find any Visual Studio installation to use
```

**解法**：`npmRebuild: false`。前提：所有生产依赖均为**预编译二进制**（N-API，不绑定具体 Electron ABI），本项目即此情形，跳过 rebuild 安全。

> 若未来引入需 ABI 重编译的原生模块，则不能关 rebuild，需安装 VS Build Tools。

**验证**：打包后确认 `.node` 被正确外置（electron-builder 自动 unpack native 二进制）：

```
dist/win-unpacked/resources/app.asar.unpacked/node_modules/@fainthit/uiohook-napi-suppress/...
```

## ⚠️ 踩坑二：PowerShell 下 `set` 不生效 + `ELECTRON_MIRROR`

`package.json` 的 `dist` 脚本里 `set X=...&& electron-builder` 是 **cmd 语法**，PowerShell 中不生效（`set` 只是静态文本，变量不会进子进程），镜像变量实际丢失 → Electron 本体走 github 官方下载，被代理劫持报 `ECONNREFUSED 127.0.0.1:443`。

**PowerShell 下单次打包的正确姿势**：

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"   # Electron 本体走镜像
Remove-Item Env:ICUBE_PROXY_HOST -ErrorAction SilentlyContinue    # 移除 IDE 注入的代理，避免劫持
npx electron-builder --win --publish never
```

> 注意 `ELECTRON_MIRROR` 控制的是 **Electron 安装包本体**（约 150 MB / zip），与 `ELECTRON_BUILDER_BINARIES_MIRROR`（NSIS/winCodeSign）是两回事，缺一可能仍失败；下载器命中 `%LOCALAPPDATA%\electron\Cache` 后无需外网。
>
> 建议：把上述三条写入 `<项目>/.env.pwsh` 或改用 `npm run dist`（cmd 语法仅在 cmd 里有效）。

## ⚠️ 打包二进制下载排障（重要）

`electron-builder` 构建时需要额外下载 winCodeSign / NSIS 等二进制。**常见症状**：

```
⨯ connect ECONNREFUSED 127.0.0.1:443 failedTask=build
```

### 根因

本机存在代理/加速软件，在 **DNS 层面**将 `github.com` 等域名解析劫持到 `127.0.0.1`（hosts 文件正常、标准 `HTTP_PROXY` 变量为空，但 `ICUBE_PROXY_HOST=127.0.0.1` 由 IDE/加速器注入）。electron-builder 的 got 库查到该代理便向 `127.0.0.1:443` 请求 → 连接被拒。

### 解决办法

通过 `ELECTRON_BUILDER_BINARIES_MIRROR` 指向 npmmirror 镜像（`dist` 脚本已内置）：

```
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/&& electron-builder --win --publish never
```

**关键**：npmmirror 的 `electron-builder-binaries` 目录是**平铺结构**（`winCodeSign-2.6.0/winCodeSign-2.6.0.7z` 直接挂在根下），**不要**在 URL 里加 `winCodeSign/` 或 `nsis/` 前缀子目录，否则会 404：

```bash
# ✅ 正确
https://npmmirror.com/mirrors/electron-builder-binaries/winCodeSign-2.6.0/winCodeSign-2.6.0.7z

# ❌ 错误（404）
https://npmmirror.com/mirrors/electron-builder-binaries/winCodeSign/winCodeSign-2.6.0/winCodeSign-2.6.0.7z
```

> 若仍失败：确认环境变量 `ICUBE_PROXY_HOST` 是否存在并临时移除（`Remove-Item Env:ICUBE_PROXY_HOST`）；次要镜像 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 可同时设置。

## 打包后自测

打包完成后务必对 `dist/win-unpacked/键盘模拟钢琴.exe` 做回归，重点验证**打包分支**：

1. 采样加载：`[app] ready, samples=90/90`（日志中 `resources/samples/` 路径生效）
2. `window.pianoAPI.getSamplesDir()` 返回 `file:///.../resources/samples/`

```bash
# 带 CDP 端口启动打包版
dist\win-unpacked\键盘模拟钢琴.exe --remote-debugging-port=9222
# 另开终端跑端到端回归
node tools/cdp-test.mjs
```

详见 [🧪 测试与验证](testing.md)。
