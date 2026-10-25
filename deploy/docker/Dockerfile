# Multi-stage build for Pariksha self-host container (S-01, S-02, AC-01)
# Stage 1: Build packages and web app
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++ libc-dev
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate

WORKDIR /app

# Copy dependency manifests first for build caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/storage/package.json ./packages/storage/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

# Copy source trees and scripts
COPY scripts ./scripts
COPY packages ./packages
COPY apps ./apps

# Build design tokens, database migrations, web application, and API
ENV NODE_ENV=production
RUN node scripts/tokens.mjs
RUN pnpm turbo run build

# Stage 2: Lean production runner
FROM node:22-alpine AS runner

RUN apk add --no-cache libstdc++ curl
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787
ENV STATIC_DIR=/app/apps/web/dist
ENV STORAGE_DIR=/app/data/storage

# Create persistent storage directory with node ownership
RUN mkdir -p /app/data/storage && chown -R node:node /app

# Copy built node_modules, packages and dist assets
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/packages/core ./packages/core
COPY --from=builder --chown=node:node /app/packages/db ./packages/db
COPY --from=builder --chown=node:node /app/packages/storage ./packages/storage
COPY --from=builder --chown=node:node /app/apps/api ./apps/api
COPY --from=builder --chown=node:node /app/apps/web/dist ./apps/web/dist

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8787/api/v1/health || exit 1

CMD ["node", "apps/api/dist/node.js"]
