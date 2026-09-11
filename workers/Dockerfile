# CID Portal worker — Node 20, non-root. Build context: ./workers
# The image carries only the compiled worker; every external service
# (Stirling, Crawl4AI, Docling, Meilisearch, Redis) is a sibling container
# reached over the compose-internal network.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
# sharp needs libvips runtime pieces that node:20-slim already provides via its prebuilt binaries;
# tini keeps SIGTERM delivery clean for graceful shutdown.
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN chown -R node:node /app
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
