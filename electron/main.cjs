const { app, BrowserWindow, shell, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const isDev = !app.isPackaged;
const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
const DIST_DIR = path.join(__dirname, '..', 'dist');

// The packaged renderer is served from app://bundle/ instead of file://. A
// real (privileged, secure) origin is required so absolute asset paths resolve
// and the renderer's fetch() works — onnxruntime-web fetches its WASM from
// "/ort/" and the SAM models from "/models/…", both of which file:// blocks.
// Must be declared before app `ready`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** Map app://bundle/<path> → dist/<path>, defaulting to index.html. Confined to
 *  DIST_DIR so a crafted path can't escape the bundle. */
function handleAppProtocol(request) {
  const { pathname } = new URL(request.url);
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  const resolved = path.join(DIST_DIR, rel);
  if (resolved !== DIST_DIR && !resolved.startsWith(DIST_DIR + path.sep)) {
    return new Response('Forbidden', { status: 403 });
  }
  return net.fetch(pathToFileURL(resolved).toString());
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    // macOS: keep the inset traffic lights (top-left). Windows: hide the native
    // title bar but overlay the caption buttons (min/max/close, top-right) so
    // the renderer can reserve space for them (see MenuBar.tsx insets). Linux:
    // keep the standard WM-drawn frame. Height matches the 24px top bar.
    titleBarStyle: isMac ? 'hiddenInset' : isWin ? 'hidden' : 'default',
    ...(isWin
      ? { titleBarOverlay: { color: '#0a0a0a', symbolColor: '#a1a1aa', height: 24 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadURL('app://bundle/index.html');
  }
}

app.whenReady().then(() => {
  protocol.handle('app', handleAppProtocol);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
