import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'node:fs'

// onnxruntime-web loads its glue with `import('/ort/…jsep.mjs')` at runtime.
// Vite's import analysis appends `?import` and tries to transform the
// precompiled ESM — that 500s. This middleware intercepts /ort/* requests
// before Vite's pipeline and streams the file from public/ort/ with the
// right Content-Type. public/ort/ is populated by scripts/download_mobile_sam.sh.
function ortStaticPassthrough() {
  return {
    name: 'ort-static-passthrough',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const url = req.url.split('?')[0];
        if (!url.startsWith('/ort/')) return next();
        const filePath = path.join(__dirname, 'public', url);
        if (!fs.existsSync(filePath)) return next();
        const ct = url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
        res.setHeader('Content-Type', ct);
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ortStaticPassthrough()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  worker: {
    format: 'es',
  },
  // onnxruntime-web ships pre-bundled ESM glue (.mjs) + .wasm assets in
  // dist/. Pre-bundling via esbuild breaks the runtime's dynamic
  // import('…ort-wasm-simd-threaded.jsep.mjs') path — Vite rewrites the URL
  // with `?import` and tries to transform the precompiled glue, which 500s.
  // Excluding it lets the browser ESM import resolve against the served
  // public/ort/ mirror untouched. See scripts/download_mobile_sam.sh.
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  assetsInclude: ['**/*.onnx'],
})
