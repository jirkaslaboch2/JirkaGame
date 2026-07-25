# Production Dockerfile for LootVault Gaming Shop
FROM node:22-alpine

WORKDIR /app

# Install build tools required for native SQLite C++ compilation in Alpine
RUN apk add --no-cache python3 make g++

# Copy package manifests
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Expose server port
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production
ENV PORT=3000

# Start Express Application
CMD ["node", "server.js"]
