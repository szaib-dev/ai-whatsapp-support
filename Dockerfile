FROM node:22-bookworm-slim AS api-build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY tsconfig*.json ./
COPY apps/api apps/api
RUN ./node_modules/.bin/tsc -p tsconfig.build.json
FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3101
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=api-build /app/dist ./dist
COPY scripts/migrate.mjs scripts/migrate.mjs
COPY scripts/production-check.mjs scripts/production-check.mjs
COPY scripts/migration-status.mjs scripts/migration-status.mjs
COPY scripts/migration-policy.mjs scripts/migration-policy.mjs
COPY deploy/migration-policy.json deploy/migration-policy.json
COPY supabase/migrations supabase/migrations
USER node
EXPOSE 3101
CMD ["node","dist/server.js"]
