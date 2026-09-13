# Savr container.
#
# Single long-lived service: the Express API + the React SPA (served from
# ui/dist) + the optional in-process autonomous Guardian loop. Data persists to
# the container's local /app/data (ephemeral on Fargate by default; mount EFS or
# bake the seeds in — see README "Deploying to AWS").
#
# The app resolves ROOT relative to the TS modules, so the runtime must execute
# the TypeScript source with `tsx` (plain `node dist/...` would resolve data
# paths to a non-existent dist/data). Full `npm ci` keeps tsx available.

# ---- stage 1: build the UI -----------------------------------------------
# VITE_API_TOKEN is baked into the bundle so the public SPA can present the bearer
# token on every state-changing /api POST (the API rejects those without it once
# HOST=0.0.0.0). Pass it at build time: docker build --build-arg VITE_API_TOKEN=<t>.
# Local builds without the arg produce the token-free bundle, exactly like
# `npm run build:ui` locally.
FROM node:22-slim AS ui-builder
WORKDIR /app/ui
ARG VITE_API_TOKEN=
ENV CI=true
COPY ui/package.json ui/package-lock.json* ./
RUN npm ci
COPY ui .
RUN VITE_API_TOKEN="$VITE_API_TOKEN" npm run build

# ---- stage 2: runtime -----------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci
COPY src ./src
COPY data ./data
COPY --from=ui-builder /app/ui/dist ./ui/dist

EXPOSE 3000
# HOST=0.0.0.0 exposes the API beyond loopback — the task REQUIRES API_TOKEN
# (see src/api/routes.ts): every state-changing /api/* route then demands the
# bearer token. In production, provide it via the API_TOKEN SecretsManager
# reference wired in the task definition, not a literal env var.
ENV HOST=0.0.0.0 \
    API_PORT=3000 \
    DEMO_MODE=false \
    AUTOPILOT_ENABLED=false
CMD ["npx", "tsx", "src/api/server.ts"]