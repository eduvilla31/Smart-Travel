import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps every asset path relative, so the same build works at
// https://<user>.github.io/<repo>/ and on a local preview server.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
} as any);
