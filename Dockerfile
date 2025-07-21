# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies including TypeScript
COPY package*.json ./
RUN npm ci

# Install TypeScript globally
RUN npm install -g typescript

# Copy source code
COPY . .

# Build the application
RUN tsc --project tsconfig.json --skipLibCheck

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Copy only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built application and assets
COPY --from=build /app/dist ./dist
COPY --from=build /app/tradingview_vendor ./tradingview_vendor
COPY --from=build /app/examples ./examples

# Create logs directory
RUN mkdir -p logs

EXPOSE 8081 9100

CMD ["node", "dist/main.js"] 