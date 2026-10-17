# Tamagotchi server image.
#
# Multi-stage: the builder has dev dependencies (TypeScript) and compiles the
# server to `dist/`; the runtime stage installs only production dependencies and
# ships the compiled JS. Nothing but the compiled output and the static emulator
# assets (ROM + WASM) is copied — the ROMs are copyrighted firmware, so they are
# baked in at build time from the build context (they are .gitignored, so a CI
# checkout must provide them another way; see emu/README.md).
#
#   docker build -f server/Dockerfile -t tamagotchi-server .
#
# The container listens on 8080 and joins the `proxy` network at runtime, where
# the reverse proxy maps tamagotchi.fugjoo.com to it.

# ---- build stage ----------------------------------------------------------
FROM node:26-alpine AS build
WORKDIR /app

# Install all deps (dev included) first, for a cached layer.
COPY package.json package-lock.json* ./
RUN npm ci

# Compile the server (tsconfig.server.json → dist/server/src/*.js).
COPY tsconfig.json tsconfig.server.json ./
COPY src ./src
COPY server ./server
RUN npx tsc -p tsconfig.server.json && \
    mkdir -p dist/server/src/db && \
    cp server/src/db/schema.sql dist/server/src/db/schema.sql

# ---- runtime stage --------------------------------------------------------
FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only — no TypeScript, no test tooling.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled server + the emulator assets it loads at boot (ROM/WASM). `public/emu`
# holds rom0.bin/rom2.bin/tamalib.wasm; ROMs are provided by the build context.
COPY --from=build /app/dist ./dist
COPY public/emu ./public/emu

# Non-root. The `node` user already exists in the official image.
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/beeps').then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/src/main.js"]
