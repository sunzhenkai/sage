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
RUN pnpm exec tsc -b --pretty false

FROM node:24.14.0-bookworm-slim AS runtime
ENV NODE_ENV=development
WORKDIR /workspace
COPY --from=build /workspace ./

FROM runtime AS agent-api
CMD ["node", "apps/agent-api/dist/runtime.js"]

FROM runtime AS agent-worker
CMD ["node", "apps/agent-worker/dist/runtime.js"]

FROM build AS agent-web-build
RUN pnpm --filter @sage/agent-web build

FROM caddy:2.11.4-alpine AS agent-web
COPY --from=agent-web-build /workspace/apps/agent-web/dist /srv
COPY apps/agent-web/Caddyfile /etc/caddy/Caddyfile

