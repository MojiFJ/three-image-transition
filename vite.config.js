import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/three-image-transition/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
