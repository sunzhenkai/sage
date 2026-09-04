import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { ProxyOptions, Plugin } from "vite";
import { defineConfig } from "vitest/config";

const apiTarget = process.env.SAGE_API_PROXY_TARGET ?? "http://127.0.0.1:9610";
const serviceToken = process.env.SAGE_SERVICE_TOKEN?.trim();

/**
 * /v1 proxy options shared by dev and preview servers.
 *
 * - Service token (if configured) is injected server-side; the browser never holds it.
 * - SSE responses are self-handled so upstream headers flush immediately, keeping
 *   EventSource out of a permanently-connecting state behind proxy buffering.
 */
function createApiProxyOptions(): ProxyOptions {
  return {
    target: apiTarget,
    changeOrigin: true,
    selfHandleResponse: true,
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq) => {
        if (serviceToken) {
          proxyReq.setHeader("authorization", `Bearer ${serviceToken}`);
        }
      });
      proxy.on("proxyRes", (proxyRes: IncomingMessage, _req: IncomingMessage, res: ServerResponse) => {
        const headers: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (typeof value === "string" || Array.isArray(value)) headers[key] = value;
        }
        const contentType = proxyRes.headers["content-type"] ?? "";
        if (contentType.includes("text/event-stream")) {
          headers["cache-control"] = "no-cache";
          headers["x-accel-buffering"] = "no";
        }
        res.writeHead(proxyRes.statusCode ?? 502, headers);
        // Flush response headers as soon as upstream responds (critical for SSE).
        res.flushHeaders();
        proxyRes.pipe(res);
      });
      proxy.on("error", (_err: Error, _req: IncomingMessage, res: ServerResponse | Socket) => {
        if ("writeHead" in res) {
          if (!res.headersSent) {
            res.writeHead(502, { "content-type": "application/json" });
          }
          res.end(JSON.stringify({ error: { code: "UPSTREAM_UNAVAILABLE", message: "API upstream unavailable", retryable: true } }));
        } else {
          res.destroy();
        }
      });
    },
  };
}

/**
 * Preview cache policy: only content-hashed /assets get immutable long caching;
 * index.html and /v1 keep default ETag/304 behavior.
 */
function previewCacheHeaders(): Plugin {
  return {
    name: "sage-preview-cache-headers",
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/assets/")) {
          res.setHeader("cache-control", "public, max-age=31536000, immutable");
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), previewCacheHeaders()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    host: "0.0.0.0",
    port: 9612,
    strictPort: true,
    proxy: { "/v1": createApiProxyOptions() },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    proxy: { "/v1": createApiProxyOptions() },
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
