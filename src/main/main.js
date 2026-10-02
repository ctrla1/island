const { app, BrowserWindow, screen, ipcMain, globalShortcut, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { SystemBridge } = require('./bridge');
const { ClipboardHistory } = require('./clipboard');
const { SystemMonitor } = require('./system');
const { startNotifyServer } = require('./notify-server');
const { trayIcon } = require('./tray');
const { SnippetStore } = require('./snippets');
const {
  fullscreenOnPrimary,
  mouseButtonDown,
  appWindowAt,
  modifiersDown,
  sendPaste,
  foregroundWindow,
  focusWindow,
  ignoresMouse,
  windowAt,
  describeWindow,
} = require('./win32');

// ── Diagnostics ─────────────────────────────────────────────────────────────
// A small rolling log in %APPDATA%\Island\island.log, so a hard-to-reproduce
// problem on someone's machine leaves a trail.
const LOG_LIMIT = 256 * 1024;
function diag(...parts) {
  try {
    const file = path.join(app.getPath('userData'), 'island.log');
    const line = `${new Date().toISOString()} ${parts.join(' ')}\n`;
    let size = 0;
    try { size = fs.statSync(file).size; } catch {}
    if (size > LOG_LIMIT) {
      const tail = fs.readFileSync(file, 'utf8').slice(-LOG_LIMIT / 2);
      fs.writeFileSync(file, tail.slice(tail.indexOf('\n') + 1));
    }
    fs.appendFileSync(file, line);
  } catch {}
}
process.on('uncaughtException', (err) => diag('uncaught', err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : String(err)));

// The window is a fixed transparent canvas; the island morphs inside it and
// everything outside the island is click-through. Tall enough for the snippet editor.
const WIN_W = 840;
const WIN_H = 580;

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId('dev.island.desktop');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = {
  demoMedia: false,
  copyIndicator: true,
  volumeHud: true,
  hideInFullscreen: true,
  passThrough: true,
  snippetPaste: true,
};

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
    snippetPaste: 'Вставлять шаблон сразу при клике',
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
    snippetPaste: 'Paste snippets on click',
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
let wantInteractive = false;
let lastCover = '';
let fullscreen = false;
let appBelow = true;
let mediaState = { type: 'media', active: false };
let volumeState = null;
let islandExpanded = false;
let editing = false;
let editingReturnTo = null;
let snippets = null;
let snippetAccels = [];
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
    islandExpanded = false;
    if (editing) setEditing(false);
    syncEscape();
  });
  // Clicking away mid-edit: the editor folds up (keeping a draft) instead of
  // holding the island open over the user's work.
  win.on('blur', () => {
    if (editing) send('editor:blur');
  });
  win.webContents.on('unresponsive', () => diag('renderer unresponsive'));
  win.webContents.on('responsive', () => diag('renderer responsive again'));
  // If the interface process dies, bring it back instead of leaving a dead pill.
  win.webContents.on('render-process-gone', (_e, details) => {
    diag('renderer gone:', details.reason, details.exitCode);
    setTimeout(() => win && !win.isDestroyed() && win.reload(), 500);
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
    { label: t('snippetPaste'), type: 'checkbox', checked: settings.snippetPaste, click: toggle('snippetPaste') },
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

// Is an app window (browser, editor…) sitting under the pill right now? Only
// then does the pill need to get out of the way; over a bare desktop it opens
// on hover straight away. Sample its centre and both ends (top 7 + half of 34 px).
function updateAppBelow() {
  if (!win) return;
  const b = win.getBounds();
  const y = b.y + 24;
  const points = [-60, 0, 60].map((dx) => screen.dipToScreenPoint({ x: b.x + WIN_W / 2 + dx, y }));
  let below = appBelow;
  try {
    below = appWindowAt(points);
  } catch (err) {
    console.log('app-below check failed:', err.message);
  }
  if (below !== appBelow) {
    appBelow = below;
    diag('app under pill:', below);
    send('appBelow', below);
  }
}

// While the cursor is over the open island, make sure a click would really land
// on it: the window must not be click-through, and no other always-on-top window
// (an invisible overlay of a game launcher, recorder, chat app…) may sit above it.
// Hover is tracked by a global mouse hook, so the island opens even under such an
// overlay — and then its buttons silently stop working. Repair it and log who it was.
function guardClicks(press) {
  if (!win || !wantInteractive || !pointerInside || fullscreen) return;
  const own = win.getNativeWindowHandle().readBigUInt64LE(0);
  try {
    if (ignoresMouse(own)) {
      diag('guard: open island was click-through, repaired');
      win.setIgnoreMouseEvents(false, { forward: true });
    }
  } catch {}
  let top = null;
  try {
    const p = screen.dipToScreenPoint(screen.getCursorScreenPoint());
    top = windowAt(p.x, p.y);
  } catch {
    return;
  }
  if (top === null || top === own) {
    lastCover = '';
    return;
  }
  let who = { cls: '?', exe: '?' };
  try { who = describeWindow(top); } catch {}
  const key = `${who.cls} ${who.exe}`;
  if (press || key !== lastCover) diag(press ? 'guard: a click went to' : 'guard: island covered by', key);
  lastCover = key;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
}

// Forwarded mouse events stop once the cursor leaves the window entirely,
// so poll the cursor to tell the renderer about that edge. While the cursor is
// inside, also watch the mouse buttons: clicks that pass through the pill to
// the app underneath never reach the renderer, but they tell it "not for me".
function watchPointer() {
  let buttonDown = false;
  let tick = 0;
  let lastX = null;
  let lastY = null;
  setInterval(() => {
    if (!win) return;
    if (tick++ % 10 === 0) updateAppBelow();
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    if (inside !== pointerInside) {
      pointerInside = inside;
      // Fresh answer the moment the cursor arrives, before the renderer decides.
      if (inside) updateAppBelow();
      send('pointer', { inside });
      lastX = lastY = null;
    }
    // Where the cursor is, in page coordinates — independent of forwarded mouse events.
    if (inside && (p.x !== lastX || p.y !== lastY)) {
      lastX = p.x;
      lastY = p.y;
      send('pointer', { inside, x: p.x - b.x, y: p.y - b.y });
    }
    const down = inside && mouseButtonDown();
    if (down && !buttonDown) {
      send('pointer', { inside, press: true });
      guardClicks(true);
    } else if (tick % 4 === 0) {
      guardClicks(false);
    }
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
    diag('fullscreen app', active ? 'on top: hiding' : 'gone: showing');
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

// ── Shortcuts ───────────────────────────────────────────────────────────────
// Our own combos; a snippet cannot take these.
const APP_SHORTCUTS = { 'Ctrl+Alt+N': () => send('demo', 'notification'), 'Ctrl+Alt+I': () => setPinned(!pinned) };

function registerAppShortcuts() {
  for (const [accel, fn] of Object.entries(APP_SHORTCUTS)) {
    if (!globalShortcut.isRegistered(accel)) globalShortcut.register(accel, fn);
  }
}

function registerSnippetShortcuts() {
  for (const accel of snippetAccels) globalShortcut.unregister(accel);
  snippetAccels = [];
  if (editing || !snippets) return;
  for (const s of snippets.items) {
    if (!s.hotkey) continue;
    const id = s.id;
    try {
      if (globalShortcut.register(s.hotkey, () => pasteSnippet(id, 'hotkey'))) snippetAccels.push(s.hotkey);
    } catch (err) {
      console.log(`snippet hotkey ${s.hotkey}: ${err.message}`);
    }
  }
}

// Escape folds the island only while it is open — and never while the user is
// typing in the snippet editor, where Escape belongs to the editor.
function syncEscape() {
  const want = islandExpanded && !editing;
  if (want && !globalShortcut.isRegistered('Escape')) globalShortcut.register('Escape', () => send('escape'));
  else if (!want && globalShortcut.isRegistered('Escape')) globalShortcut.unregister('Escape');
}

// ── Snippets ────────────────────────────────────────────────────────────────
function saveSnippet(data) {
  const hotkey = typeof data.hotkey === 'string' && data.hotkey ? data.hotkey : null;
  if (hotkey) {
    if (APP_SHORTCUTS[hotkey]) return { ok: false, error: 'reserved' };
    const clash = snippets.items.find((s) => s.hotkey === hotkey && s.id !== data.id);
    if (clash) return { ok: false, error: 'taken-snippet', title: clash.title };
    const current = data.id && snippets.get(data.id);
    if (!current || current.hotkey !== hotkey) {
      // Probe whether another program already owns this combo system-wide.
      let free = false;
      try {
        free = globalShortcut.register(hotkey, () => {});
      } catch {
        return { ok: false, error: 'invalid' };
      }
      if (!free) return { ok: false, error: 'taken-system' };
      globalShortcut.unregister(hotkey);
    }
  }
  try {
    const s = snippets.upsert({ ...data, hotkey });
    registerSnippetShortcuts();
    return { ok: true, id: s.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Puts the snippet on the clipboard and, unless the user prefers plain copying,
// presses Ctrl+V in the app they are working in. After a hotkey we wait for the
// user to let go of Ctrl/Alt first — otherwise our Ctrl+V would arrive as Ctrl+Alt+V.
async function pasteSnippet(id, via) {
  const s = snippets && snippets.get(id);
  if (!s) return { ok: false };
  await clips.writeQuiet(s.text);
  snippets.use(id);
  const paste = via === 'hotkey' || settings.snippetPaste;
  if (paste) {
    const deadline = Date.now() + 1500;
    while (modifiersDown() && Date.now() < deadline) await sleep(15);
    if (modifiersDown()) return { ok: true, pasted: false };
    sendPaste();
  }
  if (via === 'hotkey') send('snippet:used', { id, title: s.title, pasted: paste });
  return { ok: true, pasted: paste };
}

// The island never takes focus — except while the snippet editor is open,
// because text fields need a keyboard. Remember who had focus and hand it back.
function setEditing(on) {
  if (!win || on === editing) return;
  editing = on;
  diag('snippet editor', on ? 'open' : 'closed');
  if (on) {
    editingReturnTo = foregroundWindow();
    globalShortcut.unregisterAll();
    snippetAccels = [];
    win.setFocusable(true);
    win.setSkipTaskbar(true);
    win.focus();
    return;
  }
  const stillOurs = win.isFocused();
  win.setFocusable(false);
  win.setSkipTaskbar(true);
  if (stillOurs) focusWindow(editingReturnTo);
  editingReturnTo = null;
  registerAppShortcuts();
  registerSnippetShortcuts();
  syncEscape();
}

function wireIpc() {
  ipcMain.handle('init', () => ({
    locale: locale(),
    settings,
    pinned,
    fullscreen,
    appBelow,
    forceDemo,
    clips: clips.list(),
    snippets: snippets ? snippets.list() : [],
    system: system.state,
    media: mediaState,
    volume: volumeState,
  }));

  // The renderer decides whether the window takes clicks. It re-sends its
  // wish while the cursor is over the island; if Windows' actual window flags
  // have drifted from it, put them back and note it.
  ipcMain.on('interactive', (_e, interactive, reassert) => {
    if (!win) return;
    wantInteractive = !!interactive;
    const wantIgnore = !interactive;
    let actualIgnore = wantIgnore;
    try { actualIgnore = ignoresMouse(win.getNativeWindowHandle().readBigUInt64LE(0)); } catch {}
    if (reassert && actualIgnore === wantIgnore) return;
    if (reassert) diag('desync: window', actualIgnore ? 'ignored' : 'took', 'clicks; renderer wants interactive =', interactive);
    else diag('interactive =', interactive);
    win.setIgnoreMouseEvents(wantIgnore, { forward: true });
  });
  ipcMain.on('diag', (_e, ...parts) => diag('renderer:', ...parts.map(String)));

  ipcMain.on('expanded', (_e, expanded) => {
    islandExpanded = expanded;
    syncEscape();
  });

  ipcMain.handle('snippet:save', (_e, data) => saveSnippet(data || {}));
  ipcMain.handle('snippet:delete', (_e, id) => {
    const ok = snippets.remove(id);
    registerSnippetShortcuts();
    return ok;
  });
  ipcMain.handle('snippet:use', (_e, id) => pasteSnippet(id, 'click'));
  ipcMain.handle('snippet:fromClip', (_e, clipId) => {
    const text = clips.textOf(clipId);
    if (!text) return { ok: false };
    const existing = snippets.findByText(text);
    if (existing) return { ok: true, id: existing.id };
    return saveSnippet({ text });
  });
  ipcMain.on('editing', (_e, on) => setEditing(!!on));

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
  bridge.on('hung', (ms) => diag('system bridge silent for', ms, 'ms: restarting'));
  bridge.on('down', (code) => {
    diag('system bridge exited:', code);
    send('media', { type: 'media', active: false, bridgeDown: true });
  });

  clips.on('log', (line) => console.log(line));
  clips.on('change', (list) => send('clips', list));
  clips.on('captured', (item) => send('clip:captured', item));

  system.on('update', (state) => send('system', state));
  system.on('plugged', (power) => send('charging', power));
}

app.whenReady().then(() => {
  diag('start', app.getVersion(), app.isPackaged ? 'installed' : 'dev');
  const firstRun = !fs.existsSync(SETTINGS_FILE());
  settings = loadSettings();
  // A freshly installed utility should come back after a reboot; the tray toggle turns it off.
  if (firstRun && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: loginArgs() });
    saveSettings();
  }
  snippets = new SnippetStore(app.getPath('userData'));
  snippets.on('log', (line) => console.log(line));
  snippets.load();
  snippets.on('change', (reason) => send('snippets', { list: snippets.list(), reason }));

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

  registerAppShortcuts();
  registerSnippetShortcuts();

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
