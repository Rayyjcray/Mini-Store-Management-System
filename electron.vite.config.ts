import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('electron/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve('electron/preload.ts'),
        output: { entryFileNames: 'index.js' },
      },
    },
  },
  renderer: {
    root: resolve('src'),
    resolve: { alias: { '@': resolve('src') } },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'development-csp',
        apply: 'serve',
        transformIndexHtml: (html) =>
          html
            .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
            .replace(
              "connect-src 'none'",
              "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*",
            ),
      },
    ],
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: resolve('src/index.html'),
        output: { manualChunks: { charts: ['recharts'] } },
      },
    },
    server: { host: '127.0.0.1' },
  },
})
