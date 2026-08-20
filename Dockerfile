# Stage 1: build the Vite frontend
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: production runtime
#
# node:20-slim (glibc) rather than alpine (musl): better-sqlite3 ships prebuilt
# glibc binaries, so alpine would have to compile it from source and needs a
# full python3/make/g++ toolchain in the image to do it.
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/ ./server/
COPY --from=builder /app/dist ./dist

# Cloud Run injects PORT and routes to it; 8080 is its default.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/index.js"]
