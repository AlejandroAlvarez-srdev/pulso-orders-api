# syntax=docker/dockerfile:1

ARG NODE_VERSION=24-alpine

# ---- build: full dependency tree, Prisma client generation, TypeScript compile
FROM node:${NODE_VERSION} AS build
WORKDIR /app
# Prisma's query engine links against OpenSSL.
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
# postinstall runs `prisma generate` against prisma/schema.prisma
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps: drop dev dependencies (the generated Prisma client survives)
FROM build AS prod-deps
RUN npm prune --omit=dev --no-audit --no-fund

# ---- runtime: production dependencies and compiled output only, non-root.
# Files stay root-owned so the node user can read but not modify the app.
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production \
    PORT=3000 \
    PERSISTENCE=prisma
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# tini forwards SIGTERM so Nest shutdown hooks close the Prisma pool cleanly.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
