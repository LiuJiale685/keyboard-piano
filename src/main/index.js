// 键盘模拟钢琴 - 主进程入口
// 职责：Kiosk 窗口管理 / 全局退出快捷键(防退出) / 单实例锁 / 关闭事件拦截 / 录音持久化
const { app, BrowserWindow, globalShortcut, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const EXIT_SHORTCUT = 'Ctrl+Alt+Shift+Q'; // PRD D6 / FR-06，本期固定
const LOADING_HTML = path.join(__dirname, '../renderer/index.html');

let mainWindow = null;

// ---- Win 键屏蔽（儿童防误触）----
// 网页层 preventDefault 拦不住系统级的 Win 键：按下即弹开始菜单，后续按键落入搜索框，
// 钢琴无声。这里用低级键盘钩子（uiohook）在系统层面直接吞掉 Win 键及其组合，
// 达到"游戏内屏蔽"效果。uiohook 的注册表即插即用、预编译（N-API），无需编译工具链。
let hookSuppressId = null;
function setupWinKeyGuard() {
  try {
    const { uIOhook, UiohookKey } = require('@fainthit/uiohook-napi-suppress');
    // 吞掉左/右 Win 键本体；metaKey:true 兜底吞掉 Win+X 等所有组合
    hookSuppressId = uIOhook.registerSuppress
      ? uIOhook.registerSuppress([
          { keycode: UiohookKey.Meta },      // 左 Win（0x0E5B）
          { keycode: UiohookKey.MetaRight }, // 右 Win（0x0E5C）
          { metaKey: true },                  // Win + 任意键（如 Win+L 锁屏）
        ])
      : null;
    uIOhook.start();
    console.log('[Win键防护] 低级键盘钩子已启用');
  } catch (e) {
    console.warn('[Win键防护] 启动失败，Win 键仍会弹开始菜单:', e.message);
  }
}

function teardownWinKeyGuard() {
  try {
    const { uIOhook } = require('@fainthit/uiohook-napi-suppress');
    if (hookSuppressId != null) uIOhook.unregisterSuppress(hookSuppressId);
    uIOhook.stop();
  } catch (_) {}
}

// 单实例锁（FR-07：再双击激活现有窗口，不开新实例）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: true,
    autoHideMenuBar: true,
    frame: false,
    kiosk: false,            // 用 setKiosk 动态控制，避免启动闪烁
    backgroundColor: '#101418',
    skipTaskbar: true,       // 隐藏任务栏图标（FR-01）
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenu(null);
  mainWindow.setKiosk(true);
  mainWindow.setSkipTaskbar(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver'); // 尽力防遮挡切换

  // 渲染层日志转发（info 起，便于无 DevTools 环境排障）
  mainWindow.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 1) console.log('[renderer]', msg);
  });

  // FR-08：关闭事件一律拦截，走退出确认（唯一路径）
  mainWindow.on('close', (ev) => {
    if (!global.__exiting) {
      ev.preventDefault();
      mainWindow.webContents.send('app:request-exit-panel');
    }
  });

  // 加载欢迎页（渲染进程真正界面在第一批后续接线，先保证 Kiosk+防退出骨架可跑）
  mainWindow.loadFile(LOADING_HTML);
}

// FR-06 全局退出快捷键：触发后由渲染层弹应用内确认面板
function registerExitShortcut() {
  const ok = globalShortcut.register(EXIT_SHORTCUT, () => {
    if (mainWindow) mainWindow.webContents.send('app:request-exit-panel');
  });
  if (!ok) {
    console.warn(`[退出快捷键] 注册失败(可能被占用): ${EXIT_SHORTCUT}`);
    mainWindow?.webContents.send('app:notice', { type: 'warn', text: '退出快捷键注册失败，详见日志' });
  }
}

app.whenReady().then(() => {
  createWindow();
  registerExitShortcut();
  setupWinKeyGuard(); // Win 键屏蔽：吞掉系统开始菜单，儿童乱按不会丢声音

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 渲染层确认退出 -> 真正退出
ipcMain.on('app:confirm-exit', () => {
  global.__exiting = true;
  app.quit();
});

// ---- 录音持久化（FR-04：userData 目录，重启可回放）----
const recordingsDir = () => path.join(app.getPath('userData'), 'recordings');
const MAX_RECORDINGS = 10; // 保留最近 N 条

function ensureRecordingsDir() {
  const dir = recordingsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle('rec:list', () => {
  try {
    const dir = ensureRecordingsDir();
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((name) => {
        try {
          const rec = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
          return {
            id: rec.id,
            title: rec.title || '未命名',
            createdAt: rec.createdAt,
            duration: rec.duration,
            noteCount: rec.noteCount,
          };
        } catch (_) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return files;
  } catch (e) {
    console.error('[rec] list error:', e);
    return [];
  }
});

ipcMain.handle('rec:save', (_e, rec) => {
  try {
    const dir = ensureRecordingsDir();
    const file = path.join(dir, `${rec.id}.json`);
    fs.writeFileSync(file, JSON.stringify(rec), 'utf8');
    // 清理超出上限的旧录音
    const all = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      .sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
    while (all.length > MAX_RECORDINGS) {
      const old = all.pop();
      try { fs.unlinkSync(path.join(dir, old)); } catch (_) {}
    }
    return { ok: true, id: rec.id };
  } catch (e) {
    console.error('[rec] save error:', e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('rec:load', (_e, id) => {
  try {
    const file = path.join(recordingsDir(), `${id}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('[rec] load error:', e);
    return null;
  }
});

ipcMain.handle('rec:delete', (_e, id) => {
  try {
    const file = path.join(recordingsDir(), `${id}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// P1-1 MIDI 导出：渲染层给 base64，主进程弹保存框写文件
ipcMain.handle('midi:export', async (_e, { base64, defaultName }) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow || undefined, {
      title: '导出 MIDI',
      defaultPath: defaultName || 'recording.mid',
      filters: [{ name: 'MIDI 文件', extensions: ['mid'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    const data = base64.replace(/^data:audio\/midi;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
    return { ok: true, filePath };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// 采样目录：打包读 resources/samples（FLAC 大文件不进 asar，XHR 需真实文件路径），
// 开发/目录缺失时回退源码 samples —— 以"目录实际存在"为准，不依赖 isPackaged 判定
ipcMain.handle('app:get-samples-dir', () => {
  const packaged = path.join(process.resourcesPath, 'samples');
  const devDir = path.join(__dirname, '../renderer/samples');
  const dir = fs.existsSync(packaged) ? packaged : devDir;
  return { dir, url: 'file:///' + dir.replace(/\\/g, '/') + '/' };
});

// 渲染层取消 -> 无操作

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  teardownWinKeyGuard(); // 卸载低级键盘钩子，避免残留
});

app.on('window-all-closed', () => {
  // 保持常驻：全屏应用不给系统"全部关闭即退出"的默认行为抢跑
  // （真正退出走 app:confirm-exit）
});
