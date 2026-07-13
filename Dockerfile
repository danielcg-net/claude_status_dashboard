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
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
EXPOSE 8787
# Run as root so volume mounts (~/.claude, ~/.claude-status-dashboard)
# are writable regardless of the host user's UID.
USER root
CMD ["node", "dist/server.js"]
