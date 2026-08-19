FROM node:24.14.0-bookworm-slim AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json eslint.config.js ./
COPY packages ./packages
COPY apps ./apps
COPY examples ./examples
COPY spikes ./spikes
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
RUN pnpm exec tsc -b --pretty false \
 && pnpm --filter @sage/agent-web build

FROM node:24.14.0-bookworm-slim AS runtime
ENV NODE_ENV=development
WORKDIR /workspace
COPY --from=build /workspace ./

FROM runtime AS agent-api
CMD ["node", "apps/agent-api/dist/runtime.js"]

FROM runtime AS agent-worker
CMD ["node", "apps/agent-worker/dist/runtime.js"]

FROM runtime AS agent-web
WORKDIR /workspace/apps/agent-web
CMD ["node", "node_modules/vite/bin/vite.js", "preview", "--host", "0.0.0.0", "--port", "4173", "--strictPort"]
