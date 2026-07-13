FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM deps AS build
ARG GIT_REF=main
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
RUN mkdir -p dist
RUN GIT_REF="${GIT_REF}" npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
COPY package*.json ./
RUN npm install --omit=dev && \
    chmod +x /app/node_modules/@ccusage/ccusage-linux-x64/bin/ccusage 2>/dev/null || true
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
EXPOSE 8787
# Default to the 'node' user (UID 1000). When the host user has a different
# UID, override with `user: "${UID}:${GID}"` in compose.yml or `--user` at
# runtime so that files written to bind mounts are owned by the host user.
USER node
CMD ["node", "dist/server.js"]
