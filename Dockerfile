# EduPyramids: one image holding the API and the built interface.
# Build:  docker build -t edupyramids .
# Run:    docker compose up -d   (see docker-compose.yml)

# 1. Build the interface. Same origin as the API, so it calls /api.
FROM node:22-alpine AS frontend
WORKDIR /app/edupyramids-frontend
COPY edupyramids-frontend/package*.json ./
RUN npm ci
COPY edupyramids-frontend/ ./
RUN VITE_API_URL=/api npm run build

# 2. The server, with production dependencies only.
FROM node:22-alpine
ENV NODE_ENV=production PORT=5000
WORKDIR /app/edupyramids-backend
COPY edupyramids-backend/package*.json ./
RUN npm ci --omit=dev
COPY edupyramids-backend/ ./
# A Windows checkout may give the scripts CRLF endings, which sh cannot run.
RUN sed -i 's/\r$//' scripts/*.sh
COPY --from=frontend /app/edupyramids-frontend/dist /app/edupyramids-frontend/dist
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD wget -qO- http://127.0.0.1:5000/api/health || exit 1
# Database updates, question and game import, then the server: the same
# steps as on Render, all safe to repeat on every start.
CMD ["sh", "scripts/render-start.sh"]
