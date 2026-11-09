# syntax=docker/dockerfile:1.7
#
# Multi-stage build: the whole monorepo is installed, type-checked and bundled
# INSIDE Docker, so CI runners only need a Docker daemon (no Node toolchain).
# Build from the repo root:   docker build -t backstage-idp-lab .
#
# Stage 1 - "packages": a skeleton with only package.json files, so the
#           dependency layer is cached until a manifest or yarn.lock changes.
# Stage 2 - "build":    yarn install --immutable, tsc, backend bundle (+ frontend).
# Stage 3 - runtime:    production-only node_modules + bundle, non-root user.

ARG NODE_IMAGE=node:24-trixie-slim

# ---------------------------------------------------------------------------
# Stage 1 - yarn install skeleton
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS packages

WORKDIR /app
COPY backstage.json package.json yarn.lock ./
COPY .yarn ./.yarn
COPY .yarnrc.yml ./

COPY packages packages
COPY plugins plugins

# Keep only package.json files (Backstage plugins created later in plugins/ too)
RUN find packages plugins \! -name "package.json" -mindepth 2 -maxdepth 2 -exec rm -rf {} \+

# ---------------------------------------------------------------------------
# Stage 2 - install all dependencies and build
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build

# Toolchain for native modules that may need compiling (e.g. better-sqlite3 used by tests)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ build-essential && \
    rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /app

COPY --from=packages --chown=node:node /app .

RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn install --immutable

COPY --chown=node:node . .

RUN yarn tsc
RUN yarn --cwd packages/backend build

RUN mkdir packages/backend/dist/skeleton packages/backend/dist/bundle \
    && tar xzf packages/backend/dist/skeleton.tar.gz -C packages/backend/dist/skeleton \
    && tar xzf packages/backend/dist/bundle.tar.gz -C packages/backend/dist/bundle

# ---------------------------------------------------------------------------
# Stage 3 - runtime image
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE}

LABEL org.opencontainers.image.title="backstage-idp-lab" \
      org.opencontainers.image.description="FastFlow IDP lab - Backstage on PostgreSQL" \
      org.opencontainers.image.source="https://github.com/thiagopbraga/backstage-idp-lab"

# No compiler toolchain in the runtime image: better-sqlite3 is a devDependency
# (tests/local only) and the remaining native deps ship prebuilt binaries.
# tini = PID 1 that forwards SIGTERM so Kubernetes rollouts drain gracefully.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends tini && \
    rm -rf /var/lib/apt/lists/*

# Least-privileged user from here on (OpenShift will additionally run it with an
# arbitrary UID; files are group-readable so that keeps working).
USER node
WORKDIR /app

COPY --from=build --chown=node:node /app/.yarn ./.yarn
COPY --from=build --chown=node:node /app/.yarnrc.yml ./
COPY --from=build --chown=node:node /app/backstage.json ./
COPY --from=build --chown=node:node /app/yarn.lock /app/package.json /app/packages/backend/dist/skeleton/ ./

RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn workspaces focus --all --production && rm -rf "$(yarn cache clean)"

# Backend bundle (includes the built frontend served by app-backend)
COPY --from=build --chown=node:node /app/packages/backend/dist/bundle/ ./

# Runtime config + demo catalog data
COPY --chown=node:node app-config.yaml app-config.production.yaml app-config.docker.yaml ./
COPY --chown=node:node examples ./examples

ENV NODE_ENV=production

EXPOSE 7007

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:7007/.backstage/health/v1/readiness').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml"]
