# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_AGENT_BACKEND_URL=""
ARG VITE_SESSION_API_BASE_URL=""
ARG VITE_TLDRAW_AGENT_STREAM_URL=""

ENV VITE_AGENT_BACKEND_URL="${VITE_AGENT_BACKEND_URL}" \
    VITE_SESSION_API_BASE_URL="${VITE_SESSION_API_BASE_URL}" \
    VITE_TLDRAW_AGENT_STREAM_URL="${VITE_TLDRAW_AGENT_STREAM_URL}"

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime stage
FROM node:20-alpine
WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/dist ./dist

ENV PORT=8080
EXPOSE 8080

CMD ["serve", "-s", "dist/client", "-l", "8080"]