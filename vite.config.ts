import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, '.', '');
    // 打包進前端的金鑰任何人都能從網頁原始碼取得，所以正式版預設不打包；
    // 已在 Google Cloud 限制金鑰可用網域時，可設定 GEMINI_EMBED_KEY=true 仍打包進去。
    const embedGeminiKey = command === 'serve' || env.GEMINI_EMBED_KEY === 'true';
    const geminiKey = embedGeminiKey ? env.GEMINI_API_KEY || '' : '';
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
        'process.env.API_KEY': JSON.stringify(geminiKey),
        'process.env.GEMINI_API_KEY': JSON.stringify(geminiKey)
      },
      resolve: {
        alias: {
          '@': fileURLToPath(new URL('.', import.meta.url)),
        }
      }
    };
});
