# syntax=docker/dockerfile:1.7
# ---------- Build stage ----------
# Pin to an exact version (NOT :1 or :latest) for reproducible builds.
FROM oven/bun:1.2.0 AS build
WORKDIR /app

# Install deps first for better layer caching
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN bun run build

# ---------- Runtime stage ----------
# Same image as build for now (avoids fetching oven/bun:1-distroless which
# may not be available in restricted networks). Keeps the image small enough.
FROM oven/bun:1.2.0 AS runtime
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

# Healthcheck via Bun one-liner (no shell needed).
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Run as non-root (bun user is uid 1000 in the oven/bun image)
USER 1000:1000

CMD ["bun", "run", "start"]