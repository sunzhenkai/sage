import react from '@vitejs/plugin-react'
import type { Plugin, ProxyOptions } from 'vite'
import { defineConfig } from 'vite'

const API_PROXY_TARGET = process.env.SAGE_API_PROXY_TARGET ?? 'http://127.0.0.1:9610'
const SERVICE_TOKEN = process.env.SAGE_SERVICE_TOKEN ?? ''

// `/v1` 代理：服务端注入 service token（浏览器永不持有）；SSE 响应头到达后立即
// flush 并禁用压缩缓冲，避免 EventSource 长期停在 connecting。
function apiProxy(): ProxyOptions {
  return {
    target: API_PROXY_TARGET,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        if (SERVICE_TOKEN) proxyReq.setHeader('authorization', `Bearer ${SERVICE_TOKEN}`)
      })
      proxy.on('proxyRes', (proxyRes, _req, _res) => {
        const contentType = String(proxyRes.headers['content-type'] ?? '')
        if (contentType.includes('text/event-stream')) {
          // SSE 逐帧流式：摘掉压缩与缓存、禁止代理层缓冲。只在此刻改写
          // proxyRes.headers（http-proxy 随后统一写回并立即 pipe，逐帧到达）；
          // 不能自行 flushHeaders——那会先于 http-proxy 写出残缺头部，
          // 丢失 content-type，EventSource 无法建立。
          proxyRes.headers['content-encoding'] = 'identity'
          proxyRes.headers['cache-control'] = 'no-cache, no-transform'
          proxyRes.headers['x-accel-buffering'] = 'no'
        }
      })
    },
  }
}

// preview 缓存策略：只有带内容哈希的 `/assets` 产物使用 immutable 长缓存；
// `index.html` 与 `/v1` 维持默认 ETag/304 行为。
function previewAssetCache(): Plugin {
  return {
    name: 'sage-preview-asset-cache',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), previewAssetCache()],
  server: {
    host: '0.0.0.0',
    port: 9612,
    strictPort: true,
    proxy: { '/v1': apiProxy() },
  },
  preview: {
    host: '0.0.0.0',
    port: 9612,
    strictPort: true,
    proxy: { '/v1': apiProxy() },
  },
})
