# Build isolated-vm against the same Node major version used at runtime.
# Debian/glibc is used rather than Alpine/musl to reduce native-addon
# compatibility surprises. This service is deployed as a Vercel container.
FROM node:24-bookworm-slim AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

RUN addgroup --system --gid 1001 sandboxsvc \
  && adduser --system --uid 1001 --ingroup sandboxsvc sandboxsvc

COPY --from=builder --chown=sandboxsvc:sandboxsvc /app/package.json ./package.json
COPY --from=builder --chown=sandboxsvc:sandboxsvc /app/node_modules ./node_modules
COPY --from=builder --chown=sandboxsvc:sandboxsvc /app/dist ./dist

USER sandboxsvc
EXPOSE 8080
CMD ["node", "dist/server.js"]
