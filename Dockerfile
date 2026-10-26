# syntax=docker/dockerfile:1.7-labs

############################
# Base
############################
FROM node:20-alpine AS base
WORKDIR /app

############################
# Development Dependencies
############################
FROM base AS deps-dev

RUN apk add --no-cache libc6-compat

COPY package*.json ./

# Install ALL dependencies (including devDependencies)
RUN npm ci

############################
# Production Dependencies
############################
FROM base AS deps-prod

COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

############################
# Build
############################
FROM base AS build

COPY --from=deps-dev /app/node_modules ./node_modules

COPY package*.json ./
COPY tsconfig.json ./

COPY src ./src

RUN npm run build

############################
# Production Runtime
############################
FROM base AS prod

ENV NODE_ENV=production

WORKDIR /app

COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# SQL migrations applied at start by dist/scripts/migrate.js
COPY db/migrations ./db/migrations
COPY public ./public
COPY package*.json ./
COPY entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
