import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Explicit offline launch; ordinary development/production default to the API.
  ...(mode === 'fixture' ? { define: { 'import.meta.env.VITE_DATA_MODE': JSON.stringify('fixture') } } : {}),
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
  test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'], restoreMocks: true }
}));
