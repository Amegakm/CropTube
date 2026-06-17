# Use official Node.js runtime as parent image
FROM node:20-bookworm-slim

# Install system dependencies (ffmpeg, python3, pip, curl)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp with default extras (includes EJS solver scripts) and curl_cffi for chrome impersonation
RUN pip3 install --break-system-packages "yt-dlp[default]" curl_cffi

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application source
COPY . .

# Build the frontend assets
RUN npm run build

# Expose port (3001 as defined in server.js)
EXPOSE 3001

# Set production env vars
ENV NODE_ENV=production
ENV PORT=3001

# Pre-create folders with correct permissions
RUN mkdir -p bin temp && chmod -R 777 bin temp

# Start the server
CMD ["node", "server.js"]
