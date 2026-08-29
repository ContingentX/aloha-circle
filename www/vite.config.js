import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Dev: forward API calls to the local agentharness.
      // Prod (S3 static site): set VITE_API_BASE to the hosted harness URL.
      '/api': 'http://localhost:8787',
    },
  },
});
