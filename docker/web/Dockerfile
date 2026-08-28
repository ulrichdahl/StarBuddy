# StarBuddy web — Caddy with everything it serves baked in: the SPA bundle,
# the Caddyfile, and Laravel's public/ dir (php_fastcgi resolves scripts
# against Caddy's own filesystem, at the same path the FPM container uses).
#
# Build context is the repo root (see .dockerignore there); compose builds it
# as the `web` service. Nothing is bind-mounted, so it deploys identically on
# a plain Docker host and on platforms like Coolify that relocate bind mounts.

FROM node:26-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM caddy:2-alpine
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile
COPY backend/public /var/www/html/public
COPY --from=build /app/dist /srv/frontend
