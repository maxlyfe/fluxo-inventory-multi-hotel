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
      // Netlify Functions proxy — necessário quando rodando `vite dev` (porta 5173).
      // O `netlify dev` (porta 8888) serve as functions e o Vite proxy encaminha para lá.
      // Usar `npm run dev:netlify` para ter as functions disponíveis.
      '/.netlify/functions': {
        target: 'http://localhost:8888',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
