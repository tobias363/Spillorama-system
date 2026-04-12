# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ src/

RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-alpine

RUN apk add --no-cache tini
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist/ dist/
COPY public/ public/

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

# tini handles SIGTERM → graceful shutdown
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
