# syntax=docker/dockerfile:1

# --- Dependencies (locked) -------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/problem-content/package.json packages/problem-content/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

# --- Build the web SPA -----------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build --workspace @app/web

# --- Production runtime ----------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Runtime dependencies + TypeScript sources executed via tsx.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api ./apps/api
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /app/db ./db

USER node
EXPOSE 8080

# Liveness/readiness without secrets.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Fastify serves the API and the built SPA on one port.
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
