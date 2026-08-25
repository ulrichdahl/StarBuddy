# --- Build stage: install all deps and compile TypeScript ---
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Runtime stage: prod deps + compiled output only ---
FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY assets ./assets
COPY locales ./locales
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
