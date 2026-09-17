# Small, standalone image for the code_interpreter sandbox only. isolated-vm
# is a native addon that cannot run inside a Vercel serverless function, so
# this one piece stays on a container host (Cloud Run works well - deploy
# with --min-instances=0 so it costs ~nothing while idle).
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 sandboxsvc

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

USER sandboxsvc

EXPOSE 8080

CMD ["node", "dist/server.js"]
