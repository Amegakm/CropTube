# Use official Node.js runtime as parent image
FROM node:20-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Deno (yt-dlp's default and most stable JS runtime for EJS/signature solving)
RUN curl -fsSL https://deno.land/install.sh | sh
ENV DENO_INSTALL="/root/.deno"
ENV PATH="$DENO_INSTALL/bin:$PATH"

# Install yt-dlp with [default] extras (EJS scripts) + curl_cffi (chrome impersonation)
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
RUN mkdir -p bin temp/cache && chmod -R 777 bin temp

# Start the server
CMD ["node", "server.js"]
