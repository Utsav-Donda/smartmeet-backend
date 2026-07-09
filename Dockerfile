# ---------------------------------------------------------------------------
# SmartMeet backend Dockerfile
#
# Design choices:
#   - node:18-alpine keeps the base image small and reduces attack surface.
#   - Two-stage build: "deps" installs dependencies (including dev deps are
#     skipped in the runtime stage) in a layer that is cached independently
#     of application source changes, speeding up rebuilds.
#   - `npm ci --omit=dev` in the runtime stage installs exact, lockfile-
#     pinned production dependencies only (no devDependencies), keeping the
#     final image lean and avoiding "works on my machine" drift.
#   - A dedicated non-root "node" user (built into the official image) runs
#     the process so a container escape doesn't grant root on the host.
#   - Only the files needed at runtime are copied into the final stage.
# ---------------------------------------------------------------------------

# ---- deps stage -------------------------------------------------------------
FROM node:18-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---- runtime stage -----------------------------------------------------------
FROM node:18-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Reuse the already-resolved production node_modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Local fallback storage directory for recordings when S3 credentials are absent.
RUN mkdir -p /app/storage && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]

# ⚡ IMPROVEMENT SUGGESTIONS FOR DOCKERFILE / DEPLOYMENT:
# 1. Add a HEALTHCHECK instruction hitting GET /api/health so orchestrators (ECS/K8s) can auto-restart unhealthy containers.
# 2. Use a multi-arch buildx pipeline and pin the base image by digest to avoid supply-chain drift on alpine tag updates.
# 3. Mount /app/storage as a named volume or move it to S3-only in production to keep containers stateless for horizontal scaling.
# PRIORITY: Medium
# IMPLEMENTATION_EFFORT: Low
# IMPACT: Medium
