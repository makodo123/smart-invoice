import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const proxyConfig = {
      '^(/smart-invoice)?/api/invoice.xml': {
        target: 'https://invoice.etax.nat.gov.tw',
        changeOrigin: true,
        rewrite: () => '/invoice.xml',
      },
    };

    return {
      base: '/smart-invoice/',
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: proxyConfig,
      },
      preview: {
        port: 3000,
        host: '0.0.0.0',
        proxy: proxyConfig,
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': fileURLToPath(new URL('.', import.meta.url)),
        }
      }
    };
});
