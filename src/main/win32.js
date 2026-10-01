// Thin Win32 bindings used for cheap polling (no PowerShell round-trips).
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const shell32 = koffi.load('shell32.dll');

const SYSTEM_POWER_STATUS = koffi.struct('SYSTEM_POWER_STATUS', {
  ACLineStatus: 'uint8',
  BatteryFlag: 'uint8',
  BatteryLifePercent: 'uint8',
  SystemStatusFlag: 'uint8',
  BatteryLifeTime: 'uint32',
  BatteryFullLifeTime: 'uint32',
});
const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const MONITORINFO = koffi.struct('MONITORINFO', { cbSize: 'uint32', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32' });
const HANDLE = koffi.pointer('HANDLE', koffi.opaque());

const GetClipboardSequenceNumber = user32.func('uint32 __stdcall GetClipboardSequenceNumber()');
const GetSystemPowerStatus = kernel32.func('bool __stdcall GetSystemPowerStatus(_Out_ SYSTEM_POWER_STATUS *status)');
const GetForegroundWindow = user32.func('HANDLE __stdcall GetForegroundWindow()');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(HANDLE hwnd, _Out_ RECT *rect)');
const GetWindowLongW = user32.func('int32 __stdcall GetWindowLongW(HANDLE hwnd, int index)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(HANDLE hwnd, _Out_ uint8_t *name, int max)');
const IsIconic = user32.func('bool __stdcall IsIconic(HANDLE hwnd)');
const MonitorFromWindow = user32.func('HANDLE __stdcall MonitorFromWindow(HANDLE hwnd, uint32 flags)');
const GetMonitorInfoW = user32.func('bool __stdcall GetMonitorInfoW(HANDLE monitor, _Inout_ MONITORINFO *info)');
const SHQueryUserNotificationState = shell32.func('int32 __stdcall SHQueryUserNotificationState(_Out_ int32 *state)');
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int key)');

const MOUSE_BUTTONS = [0x01, 0x02, 0x04]; // left, right, middle

// True while any mouse button is held — lets us notice clicks that pass through the window.
function mouseButtonDown() {
  return MOUSE_BUTTONS.some((vk) => (GetAsyncKeyState(vk) & 0x8000) !== 0);
}

function clipboardSequence() {
  return GetClipboardSequenceNumber();
}

function powerStatus() {
  const s = {};
  if (!GetSystemPowerStatus(s)) return null;
  const noBattery = s.BatteryFlag === 128 || s.BatteryFlag === 255;
  return {
    present: !noBattery,
    ac: s.ACLineStatus === 1,
    charging: !noBattery && (s.BatteryFlag & 8) !== 0,
    percent: s.BatteryLifePercent <= 100 ? s.BatteryLifePercent : null,
    saver: s.SystemStatusFlag === 1,
  };
}

const WS_CAPTION = 0x00c00000;
const MONITOR_DEFAULTTONEAREST = 2;
const MONITORINFOF_PRIMARY = 1;
const QUNS_RUNNING_D3D_FULL_SCREEN = 3;
const QUNS_PRESENTATION_MODE = 4;
// The desktop and taskbar cover the monitor too, but they are not "apps".
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

// True when a game, full-screen video or slideshow owns the primary monitor.
// Borderless games and F11 browsers are caught by geometry (window covers the
// whole monitor and has no caption — a maximized window keeps its caption, which
// matters with an auto-hide taskbar); exclusive D3D and presentations by the shell.
function fullscreenOnPrimary(ownHwnd) {
  try {
    const state = [0];
    if (SHQueryUserNotificationState(state) === 0 && (state[0] === QUNS_RUNNING_D3D_FULL_SCREEN || state[0] === QUNS_PRESENTATION_MODE)) {
      return true;
    }
  } catch {}

  const hwnd = GetForegroundWindow();
  if (!hwnd || koffi.address(hwnd) === ownHwnd || IsIconic(hwnd)) return false;

  const name = Buffer.alloc(512);
  const len = GetClassNameW(hwnd, name, 256);
  if (SHELL_CLASSES.has(name.toString('utf16le', 0, len * 2))) return false;
  if ((GetWindowLongW(hwnd, -16) & WS_CAPTION) === WS_CAPTION) return false;

  const rect = {};
  if (!GetWindowRect(hwnd, rect)) return false;
  const info = { cbSize: koffi.sizeof(MONITORINFO) };
  if (!GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), info)) return false;
  if (!(info.dwFlags & MONITORINFOF_PRIMARY)) return false;

  const m = info.rcMonitor;
  return rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom;
}

module.exports = { clipboardSequence, powerStatus, fullscreenOnPrimary, mouseButtonDown };
