import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4207,
    proxy: {
      // forward API calls to the .NET backend during dev
      '/api': {
        target: 'http://localhost:3007',
        changeOrigin: true,
      },
    },
  },
})
