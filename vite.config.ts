import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // Relative base so the build works from any static host path (e.g. GitHub Pages subfolder).
  base: './',
  plugins: [vue()],
})
