# StarMaker frontend — build-only image.
#
# docker compose builds this image and copies /dist into a shared volume;
# Caddy serves the SPA from that volume and proxies /api, /sanctum and
# /auth to the Laravel backend. This image never runs a server itself.

FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Minimal final stage: just holds the built assets at /dist so compose
# can copy them out (e.g. `cp -r /dist/. /srv/spa/` into the volume).
FROM alpine
COPY --from=build /app/dist /dist
CMD ["sh", "-c", "trap : TERM INT; sleep infinity & wait"]
