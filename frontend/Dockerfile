# StarBuddy web — builds the SPA and serves it with Caddy.
#
# Caddy serves the bundle from /srv/frontend and proxies /api, /sanctum,
# /up, /broadcasting to PHP-FPM and /app to Reverb (docker/caddy/Caddyfile,
# bind-mounted by compose so operators can adjust it without a rebuild).

FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv/frontend
