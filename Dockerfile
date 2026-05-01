# ──────────────────────────────────────────────────────────────
# Stage 1: Builder
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (separate layer for better caching)
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --ignore-scripts

# Generate Prisma client
RUN npx prisma generate

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# ──────────────────────────────────────────────────────────────
# Stage 2: Production image
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Install dumb-init for proper signal handling in containers
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodeuser -u 1001 -G nodejs

WORKDIR /app

# Copy only production artifacts
COPY --from=builder --chown=nodeuser:nodejs /app/dist ./dist
COPY --from=builder --chown=nodeuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodeuser:nodejs /app/prisma ./prisma
COPY --chown=nodeuser:nodejs package.json ./

# Switch to non-root user
USER nodeuser

# Expose port (value should match PORT env var)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

# Use dumb-init as PID 1 for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "-r", "module-alias/register", "dist/server.js"]
