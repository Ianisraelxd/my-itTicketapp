import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Keep the big libraries in their own files so they are cached between releases.
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-') || id.includes('node_modules/victory-vendor')) return 'charts'
          if (id.includes('node_modules/react')) return 'react'
        },
      },
    },
  },
  server: {
    proxy: {
      // Forward API calls to the Express backend during development.
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
