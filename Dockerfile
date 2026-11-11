# Cash Flow 13: one image that serves the API and the built web app.
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build -w @cf13/web

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
COPY deploy ./deploy
ENV NODE_ENV=production CF13_WEB_DIR=/app/apps/web/dist CF13_HOST=0.0.0.0 HOME=/tmp
# the app runs as an unprivileged user
USER node
EXPOSE 8990
CMD ["sh", "deploy/entrypoint.sh"]
