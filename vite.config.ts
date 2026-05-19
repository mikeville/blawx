import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.vox'],
  server: {
    port: 5195,
    strictPort: false,
  },
});
