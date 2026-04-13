# syntax=docker/dockerfile:1

# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:24-alpine AS deps

WORKDIR /app

# Copy package manifests and prisma schema (needed for prisma generate)
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install production + dev dependencies (dev deps needed for build)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# ── Stage 2: Build the application ───────────────────────────────────────────
FROM node:24-alpine AS build

WORKDIR /app

# Copy dependencies from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma

# Copy application source
COPY . .

# Ensure public directory exists (may be absent in some setups)
RUN mkdir -p public

# Build Next.js (standalone output)
RUN npm run build

# ── Stage 3: Production runner ───────────────────────────────────────────────
FROM node:24-alpine AS runner

LABEL org.opencontainers.image.title="Tally"
LABEL org.opencontainers.image.description="Tally — multi-tenant SaaS license management platform"
LABEL org.opencontainers.image.source="https://github.com/tally-dev/tally-dev"

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy entrypoint script (root-owned, world-executable — no write access for nextjs)
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Copy standalone server
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./

# Copy static assets
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy public assets
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
