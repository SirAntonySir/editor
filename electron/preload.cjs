const { contextBridge } = require('electron');

// Backend URL injected by the main process (see resolveBackendUrl in main.cjs).
// Empty string when no override is set, so the renderer falls back to its baked
// VITE_AI_BACKEND_URL / localhost default.
const backendArg = process.argv.find((a) => a.startsWith('--backend-url='));
const backendUrl = backendArg ? backendArg.slice('--backend-url='.length) : '';

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  backendUrl,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
