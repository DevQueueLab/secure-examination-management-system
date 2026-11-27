# syntax=docker/dockerfile:1.7
#
# One Dockerfile, two runtime images that share one cached dependency install:
#   target "api"  Express API (tsup bundle + production node_modules)
#   target "web"  Next.js standalone server
# Build from the repository root, e.g. `docker buildx bake -f docker-compose.yml`.

ARG NODE_IMAGE=node:24-slim

# --- base: Node with the pinned package manager ------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm install --global --no-fund --no-audit pnpm@11.21.0
WORKDIR /repo

# --- manifests only, so the install layer is reused until a manifest or the lockfile changes ---
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# --- full install for building ---------------------------------------------------------
FROM manifests AS deps
RUN --mount=type=cache,id=athena-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# --- API -------------------------------------------------------------------------------
FROM deps AS api-build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @athena/api build

FROM manifests AS api-prod-deps
RUN --mount=type=cache,id=athena-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @athena/api --store-dir /pnpm/store

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production \
    PORT=4901 \
    MIGRATIONS_DIR=/app/apps/api/drizzle \
    SQL_DIR=/app/apps/api/sql
WORKDIR /app
COPY --from=api-prod-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=api-prod-deps --chown=node:node /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=api-build --chown=node:node /repo/apps/api/package.json ./apps/api/package.json
COPY --from=api-build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=api-build --chown=node:node /repo/apps/api/drizzle ./apps/api/drizzle
COPY --from=api-build --chown=node:node /repo/apps/api/src/db/sql ./apps/api/sql
WORKDIR /app/apps/api
USER node
EXPOSE 4901
CMD ["node", "--enable-source-maps", "dist/main.js"]

# --- Web -------------------------------------------------------------------------------
FROM deps AS web-build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN mkdir -p apps/web/public && pnpm --filter @athena/web build

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production PORT=3900 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=web-build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3900
CMD ["node", "apps/web/server.js"]
