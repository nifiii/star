import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  // Fix: Use path.resolve() instead of process.cwd() to avoid TS error
  const env = loadEnv(mode, path.resolve(), '');
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './'),
      },
    },
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      // Polyfill process.env for other libraries if needed
      'process.env': {}
    },
  };
});