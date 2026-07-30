# syntax=docker/dockerfile:1.7
# ---------- Build stage ----------
FROM oven/bun:1 AS build
WORKDIR /app

# Install deps first for better layer caching
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN bun run build

# ---------- Runtime stage ----------
FROM oven/bun:1-distroless AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# Bring only what we need to run
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock ./bun.lock
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma

EXPOSE 3000

# Distroless has no shell; use a Bun one-liner for the healthcheck.
# Falls back to exit 1 if the endpoint is unreachable.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Bun distroless image already runs as non-root (uid 65532)
USER 65532:65532

CMD ["bun", "run", "start"]