const { app, BrowserWindow, screen, ipcMain, globalShortcut, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { SystemBridge } = require('./bridge');
const { ClipboardHistory } = require('./clipboard');
const { SystemMonitor } = require('./system');
const { startNotifyServer } = require('./notify-server');
const { trayIcon } = require('./tray');
const { fullscreenOnPrimary, mouseButtonDown } = require('./win32');

// The window is a fixed transparent canvas; the island morphs inside it and
// everything outside the island is click-through.
const WIN_W = 840;
const WIN_H = 520;

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId('dev.island.desktop');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = { demoMedia: false, copyIndicator: true, volumeHud: true, hideInFullscreen: true, passThrough: true };

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try { fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2)); } catch {}
}

const STRINGS = {
  ru: {
    title: 'Island',
    notify: 'Показать уведомление',
    charging: 'Сценарий: зарядка',
    pin: 'Закрепить раскрытым',
    demoMedia: 'Демо-трек, если ничего не играет',
    copyIndicator: 'Индикатор «Скопировано»',
    volumeHud: 'Индикатор громкости',
    hideInFullscreen: 'Скрывать в играх и полноэкранных приложениях',
    passThrough: 'Пропускать клики сквозь капсулу',
    login: 'Запускать при входе в Windows',
    reload: 'Перезапустить интерфейс',
    quit: 'Выйти',
  },
  en: {
    title: 'Island',
    notify: 'Show notification',
    charging: 'Scenario: charging',
    pin: 'Pin expanded',
    demoMedia: 'Demo track when nothing plays',
    copyIndicator: '“Copied” indicator',
    volumeHud: 'Volume indicator',
    hideInFullscreen: 'Hide over games and full-screen apps',
    passThrough: 'Let clicks pass through the pill',
    login: 'Launch at Windows sign-in',
    reload: 'Reload interface',
    quit: 'Quit',
  },
};

let win = null;
let tray = null;
let settings = DEFAULT_SETTINGS;
let pinned = false;
let pointerInside = false;
let fullscreen = false;
let mediaState = { type: 'media', active: false };
let volumeState = null;
const bridge = new SystemBridge();
const clips = new ClipboardHistory();
const system = new SystemMonitor();

// `--demo`: presentation mode for recording — demo track and sample clipboard entries
// regardless of what is really playing.
const forceDemo = process.argv.includes('--demo');

const locale = () => (app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en');
const t = (key) => STRINGS[locale()][key];

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function placeWindow() {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds({
    x: Math.round(workArea.x + (workArea.width - WIN_W) / 2),
    y: workArea.y,
    width: WIN_W,
    height: WIN_H,
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    thickFrame: false,
    title: 'Island',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  placeWindow();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!fullscreen) win.showInactive();
  });
  // A fresh renderer starts collapsed: make sure we are not left blocking clicks.
  win.webContents.on('did-finish-load', () => {
    win.setIgnoreMouseEvents(true, { forward: true });
    if (globalShortcut.isRegistered('Escape')) globalShortcut.unregister('Escape');
  });
  win.on('closed', () => { win = null; });
}

function setPinned(value) {
  pinned = value;
  send('pin', pinned);
  buildTrayMenu();
}

// From source, electron.exe needs the project path; an installed build is self-contained.
const loginArgs = () => (app.isPackaged ? [] : [app.getAppPath()]);

function buildTrayMenu() {
  if (!tray) return;
  const toggle = (key) => () => {
    settings[key] = !settings[key];
    saveSettings();
    send('settings', settings);
    buildTrayMenu();
  };
  const login = app.getLoginItemSettings({ path: process.execPath, args: loginArgs() }).openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('title'), enabled: false },
    { type: 'separator' },
    { label: t('notify'), accelerator: 'Ctrl+Alt+N', click: () => send('demo', 'notification') },
    { label: t('charging'), click: () => send('demo', 'charging') },
    { label: t('pin'), type: 'checkbox', checked: pinned, accelerator: 'Ctrl+Alt+I', click: () => setPinned(!pinned) },
    { type: 'separator' },
    { label: t('demoMedia'), type: 'checkbox', checked: settings.demoMedia, click: toggle('demoMedia') },
    { label: t('copyIndicator'), type: 'checkbox', checked: settings.copyIndicator, click: toggle('copyIndicator') },
    { label: t('volumeHud'), type: 'checkbox', checked: settings.volumeHud, click: toggle('volumeHud') },
    { label: t('passThrough'), type: 'checkbox', checked: settings.passThrough, click: toggle('passThrough') },
    { label: t('hideInFullscreen'), type: 'checkbox', checked: settings.hideInFullscreen, click: toggle('hideInFullscreen') },
    {
      label: t('login'),
      type: 'checkbox',
      checked: login,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath, args: loginArgs() });
      },
    },
    { type: 'separator' },
    { label: t('reload'), click: () => win && win.reload() },
    { label: t('quit'), click: () => app.quit() },
  ]));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Island');
  tray.on('click', () => setPinned(!pinned));
  buildTrayMenu();
}

// Forwarded mouse events stop once the cursor leaves the window entirely,
// so poll the cursor to tell the renderer about that edge. While the cursor is
// inside, also watch the mouse buttons: clicks that pass through the pill to
// the app underneath never reach the renderer, but they tell it "not for me".
function watchPointer() {
  let buttonDown = false;
  setInterval(() => {
    if (!win) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    if (inside !== pointerInside) {
      pointerInside = inside;
      send('pointer', { inside });
    }
    const down = inside && mouseButtonDown();
    if (down && !buttonDown) send('pointer', { inside, press: true });
    buttonDown = down;
  }, 25);
}

// Games, full-screen video and slideshows own the screen: step out of the way
// entirely — a hidden window is neither drawn nor hit by the cursor.
function watchFullscreen() {
  const own = win.getNativeWindowHandle().readBigUInt64LE(0);
  setInterval(() => {
    if (!win) return;
    let active = false;
    try {
      active = settings.hideInFullscreen && fullscreenOnPrimary(own);
    } catch (err) {
      console.log('fullscreen check failed:', err.message);
    }
    if (active === fullscreen) return;
    fullscreen = active;
    send('fullscreen', active);
    if (active) {
      win.setIgnoreMouseEvents(true, { forward: true });
      win.hide();
    } else {
      win.showInactive();
      win.setAlwaysOnTop(true, 'screen-saver');
    }
  }, 400);
}

function wireIpc() {
  ipcMain.handle('init', () => ({
    locale: locale(),
    settings,
    pinned,
    fullscreen,
    forceDemo,
    clips: clips.list(),
    system: system.state,
    media: mediaState,
    volume: volumeState,
  }));

  ipcMain.on('interactive', (_e, interactive) => {
    if (win) win.setIgnoreMouseEvents(!interactive, { forward: true });
  });

  ipcMain.on('expanded', (_e, expanded) => {
    if (expanded) {
      if (!globalShortcut.isRegistered('Escape')) globalShortcut.register('Escape', () => send('escape'));
    } else if (globalShortcut.isRegistered('Escape')) {
      globalShortcut.unregister('Escape');
    }
  });

  ipcMain.on('unpin', () => { if (pinned) setPinned(false); });

  ipcMain.on('media:cmd', (_e, cmd) => {
    if (cmd && typeof cmd.cmd === 'string') bridge.send(cmd);
  });

  ipcMain.handle('clip:copy', (_e, id) => clips.restore(id));
  ipcMain.on('clip:clear', () => clips.clear());
}

function wireSources() {
  bridge.on('media', (msg) => {
    // Artwork only travels when the track changes; keep the last one for late joiners.
    if (!msg.active) mediaState = { type: 'media', active: false };
    else mediaState = { ...msg, art: 'art' in msg ? msg.art : mediaState.art, artKey: msg.artKey || mediaState.artKey };
    send('media', msg);
  });
  bridge.on('volume', (msg) => {
    volumeState = msg;
    send('volume', msg);
  });
  bridge.on('network', (msg) => system.setNetwork(msg));
  bridge.on('log', (line) => console.log('[bridge]', line));
  bridge.on('down', () => send('media', { type: 'media', active: false, bridgeDown: true }));

  clips.on('log', (line) => console.log(line));
  clips.on('change', (list) => send('clips', list));
  clips.on('captured', (item) => send('clip:captured', item));

  system.on('update', (state) => send('system', state));
  system.on('plugged', (power) => send('charging', power));
}

app.whenReady().then(() => {
  const firstRun = !fs.existsSync(SETTINGS_FILE());
  settings = loadSettings();
  // A freshly installed utility should come back after a reboot; the tray toggle turns it off.
  if (firstRun && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: loginArgs() });
    saveSettings();
  }
  wireIpc();
  wireSources();
  createWindow();
  createTray();

  bridge.start();
  clips.start();
  system.start();
  watchPointer();
  watchFullscreen();
  startNotifyServer((payload) => send('notify', payload), (line) => console.log(line));

  globalShortcut.register('CommandOrControl+Alt+N', () => send('demo', 'notification'));
  globalShortcut.register('CommandOrControl+Alt+I', () => setPinned(!pinned));

  screen.on('display-metrics-changed', placeWindow);
  screen.on('display-added', placeWindow);
  screen.on('display-removed', placeWindow);
});

app.on('second-instance', () => setPinned(true));

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  bridge.stop();
  clips.stop();
  system.stop();
});

app.on('window-all-closed', () => app.quit());
