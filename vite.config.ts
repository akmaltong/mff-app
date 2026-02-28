import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  optimizeDeps: {
    include: ['three'],
    // js-aruco2 is CommonJS; exclude from pre-bundling so Rollup's CJS plugin
    // handles the require() chain between aruco.js and the dictionary files.
    exclude: ['js-aruco2']
  }
})
