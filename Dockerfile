# ==========================================
# Default Root Dockerfile for GCP Cloud Build
# ==========================================
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json nx.json tsconfig.base.json ./
RUN npm ci

COPY apps ./apps
COPY libs ./libs

RUN NODE_OPTIONS="--max-old-space-size=4096" npx nx build chat-client

FROM nginx:alpine AS runner

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/apps/chat-client/browser /usr/share/nginx/html

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/docker-entrypoint.sh"]
