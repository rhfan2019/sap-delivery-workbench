FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run build
RUN cd vendor/abap-adt && npm ci --omit=dev --ignore-scripts

FROM build AS tooling
ENV NODE_ENV=production
CMD ["node", "scripts/db-migrate.mjs"]

FROM build AS runtime
RUN npm prune --omit=dev && mkdir -p /data/files && chown node:node /data/files
ENV NODE_ENV=production
USER node
EXPOSE 3001
CMD ["node", "scripts/serve.mjs"]

FROM nginx:1.28-alpine AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY infra/production/nginx.conf /etc/nginx/conf.d/default.conf
