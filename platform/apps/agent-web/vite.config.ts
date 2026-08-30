import { defineConfig, type Plugin, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import { proxyOptions } from './src/api-proxy.js';

export default defineConfig({
  plugins: [react(), previewCacheHeaders()],
  // host: true 绑定 0.0.0.0，供局域网/其他主机访问 dev server。
  server: { host: true, port: 9612, strictPort: true, proxy: { '/v1': proxyOptions() } },
  preview: { proxy: { '/v1': proxyOptions() } }
});

/** 仅对 /assets/ 下带内容哈希的构建产物设 immutable 强缓存；index.html 与 /v1 代理（含 SSE）保持 ETag/304。 */
function previewCacheHeaders(): Plugin {
  return {
    name: 'sage-preview-cache-headers',
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use((req, res, next) => {
        if (req.url === undefined || !req.url.startsWith('/assets/')) { next(); return; }
        const pathname = req.url.split('?')[0];
        if (!pathname.includes('.')) { next(); return; }
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        next();
      });
    }
  };
}
