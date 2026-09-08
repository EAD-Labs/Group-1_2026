import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API sets its CORS origin from FRONTEND_URL. If this port moves, that
    // value has to move with it or every request is blocked.
    strictPort: true,
  },
});
