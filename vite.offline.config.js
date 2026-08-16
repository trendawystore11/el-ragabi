import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Offline/local build: single classic <script> (IIFE) + relative paths so the
// resulting dist-local/index.html can be opened by double-click via file://
// (ES module builds are blocked from file:// by the browser CORS policy).
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist-local',
    rollupOptions: {
      output: {
        format: 'iife',
      },
    },
  },
  plugins: [
    react(),
    {
      name: 'classic-script',
      transformIndexHtml(html) {
        return html.replace(
          /<script type="module" crossorigin src="([^"]+)"><\/script>/,
          '<script defer src="$1"></script>',
        )
      },
    },
  ],
})
