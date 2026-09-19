import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: '/smart-invoice/',
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          // The official RSS does not allow browser cross-origin requests.
          // During local development, Vite fetches it server-side instead.
          '/smart-invoice/api/invoice.xml': {
            target: 'https://invoice.etax.nat.gov.tw',
            changeOrigin: true,
            rewrite: () => '/invoice.xml',
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
