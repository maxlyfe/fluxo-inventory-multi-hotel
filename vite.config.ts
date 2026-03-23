import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/erbon-api': {
        target: 'https://api.erbonsoftware.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/erbon-api/, ''),
        secure: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
