/**
 * /v1 同源代理选项（dev server 与 preview 共用）。
 * P8：schedule 管理链路的 service token 由同源代理在服务端注入（浏览器不持有凭据）；
 * 未配置时不注入任何凭据，管理请求按未认证被 agent-api 拒绝（fail closed）。
 */
import type { ProxyOptions } from 'vite';

// 默认值与本机 dev 模式下 agent-api 的监听端口（9610）保持一致；可通过 SAGE_API_PROXY_TARGET 覆盖到容器内或 compose 暴露的端口。
export function apiProxyTarget(): string {
  return process.env.SAGE_API_PROXY_TARGET ?? 'http://127.0.0.1:9610';
}

export function proxyOptions(): ProxyOptions {
  // env 在调用时读取，dev/preview 与注入链路集成测试共用同一实现。
  const serviceToken = process.env.SAGE_SERVICE_TOKEN?.trim() || undefined;
  return {
    target: apiProxyTarget(),
    // vite 内置的 http-proxy 收到上游响应头后仅 setHeader 暂存，等到首个 data 才真正向浏览器发头；
    // agent-api 的 SSE（/v1/.../timeline）建连后只 flush 头、没有初始事件，EventSource 会永远停在 connecting。
    // proxyRes 事件早于 outgoing passes（同步 setHeader）触发，故用 setImmediate 推迟到头设置完成后强制 flush。
    configure(proxy) {
      proxy.on('proxyReq', (proxyRequest) => {
        if (serviceToken !== undefined) proxyRequest.setHeader('authorization', `Bearer ${serviceToken}`);
      });
      proxy.on('proxyRes', (_proxyRes, _req, res) => {
        setImmediate(() => res.flushHeaders());
      });
    }
  };
}
