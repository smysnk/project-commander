FROM node:22-bookworm-slim AS build
WORKDIR /app

ARG BUILD_VERSION=0.0.0-dev

ENV NEXT_TELEMETRY_DISABLED=1
ENV YARN_NODE_LINKER=node-modules
ENV PROJECT_COMMANDER_BUILD_VERSION=${BUILD_VERSION}

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock ./
COPY packages/agent-master/package.json ./packages/agent-master/package.json
COPY packages/agent-shared/package.json ./packages/agent-shared/package.json
COPY packages/agent-slave/package.json ./packages/agent-slave/package.json
COPY packages/commander-client/package.json ./packages/commander-client/package.json
COPY packages/commander-mcp/package.json ./packages/commander-mcp/package.json
COPY packages/pcctl/package.json ./packages/pcctl/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY packages/web/package.json ./packages/web/package.json
COPY proto ./proto
COPY scripts ./scripts

RUN corepack enable \
  && corepack prepare yarn@4.12.0 --activate \
  && yarn install --immutable

COPY packages ./packages

RUN yarn workspace web build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV SERVER_PORT=4000
ENV WEB_PORT=3000

RUN groupadd --gid 10001 commander \
  && useradd --uid 10001 --gid 10001 --home-dir /home/commander --create-home --shell /usr/sbin/nologin commander \
  && mkdir -p /var/lib/project-commander \
  && chown -R commander:commander /var/lib/project-commander

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/yarn.lock ./yarn.lock
COPY --from=build /app/packages ./packages
COPY --from=build /app/proto ./proto
COPY --from=build /app/scripts ./scripts
COPY docker/docker-entrypoint.sh ./docker/docker-entrypoint.sh

RUN chmod +x ./docker/docker-entrypoint.sh

USER commander

EXPOSE 3000 4000

ENTRYPOINT ["./docker/docker-entrypoint.sh"]
CMD ["web"]
