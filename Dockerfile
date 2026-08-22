# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json ./
COPY server ./server
COPY src ./src
COPY public ./public

RUN npm run build && npm run build:api

FROM node:22-alpine AS api
RUN apk add --no-cache su-exec
WORKDIR /app
COPY --from=build /app/server-dist ./
COPY --from=build /app/public/data/local-edits.json /seed/local-edits.json
COPY --from=build /app/public/data/street-fixes.json /seed/street-fixes.json
COPY --from=build /app/public/data/building-edits.json /seed/building-edits.json
COPY server/docker-entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh && mkdir -p /data && chown node:node /data /seed

ENV NODE_ENV=production
ENV EDITS_DIR=/data
ENV SEED_DIR=/seed
ENV PORT=3000

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
