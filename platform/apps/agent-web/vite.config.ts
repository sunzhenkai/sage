import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 默认值与本机 dev 模式下 agent-api 的监听端口（9610）保持一致；可通过 SAGE_API_PROXY_TARGET 覆盖到容器内或 compose 暴露的端口。
const apiProxyTarget = process.env.SAGE_API_PROXY_TARGET ?? 'http://127.0.0.1:9610';

export default defineConfig({
  plugins: [react()],
  // host: true 绑定 0.0.0.0，供局域网/其他主机访问 dev server。
  server: { host: true, port: 9612, strictPort: true, proxy: { '/v1': proxyOptions() } },
  preview: { proxy: { '/v1': proxyOptions() } }
});

function proxyOptions() {
  return {
    target: apiProxyTarget,
    // vite 内置的 http-proxy 收到上游响应头后仅 setHeader 暂存，等到首个 data 才真正向浏览器发头；
    // agent-api 的 SSE（/v1/.../timeline）建连后只 flush 头、没有初始事件，EventSource 会永远停在 connecting。
    // proxyRes 事件早于 outgoing passes（同步 setHeader）触发，故用 setImmediate 推迟到头设置完成后强制 flush。
    configure(proxy: { on: (event: string, handler: (...args: unknown[]) => void) => void }) {
      proxy.on('proxyRes', (_proxyRes: unknown, _req: unknown, res: { flushHeaders: () => void }) => {
        setImmediate(() => res.flushHeaders());
      });
    }
  };
}
