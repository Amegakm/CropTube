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

# Install curl_cffi for yt-dlp chrome impersonation
RUN pip3 install --break-system-packages curl_cffi

# Install yt-dlp globally
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

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
