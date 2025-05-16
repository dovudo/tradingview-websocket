# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/tradingview_vendor ./tradingview_vendor
COPY --from=build /app/README.md ./
COPY --from=build /app/docker-compose.yml ./
COPY --from=build /app/Dockerfile ./
COPY --from=build /app/.gitignore ./
COPY --from=build /app/examples ./examples

RUN mkdir -p logs

EXPOSE 8081 9100

CMD ["node", "dist/main.js"] 