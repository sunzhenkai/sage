import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.AGENT_API_URL ?? 'http://127.0.0.1:9610';
  const proxy = Object.fromEntries(['/v1', '/livez', '/readyz', '/mcp'].map((path) => [path, { target, changeOrigin: true }]));
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { host: '0.0.0.0', port: Number(env.AGENT_WEB_PORT ?? 9620), strictPort: true, proxy },
    preview: { host: '0.0.0.0', port: Number(env.AGENT_WEB_PORT ?? 9620), proxy }
  };
});
