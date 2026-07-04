import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Don't file-watch large binary media in public/ — watching a 22MB gif
    // throws EBUSY on Windows and crashes the dev server.
    watch: { ignored: ['**/public/**', '**/release/**'] },
  },
})
