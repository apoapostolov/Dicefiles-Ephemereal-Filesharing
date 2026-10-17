# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json yarn.lock ./
COPY vendor ./vendor
COPY scripts/check-preview-tools.js ./scripts/check-preview-tools.js
RUN yarn install --frozen-lockfile --non-interactive --production=false
COPY . .
RUN yarn prestart

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /src
COPY package.json yarn.lock ./
COPY vendor ./vendor
COPY scripts/check-preview-tools.js ./scripts/check-preview-tools.js
RUN yarn install --frozen-lockfile --non-interactive --production=true && yarn cache clean

FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.title="Hobbyfiles" \
      org.opencontainers.image.description="Ephemeral filesharing and live community rooms" \
      org.opencontainers.image.source="https://github.com/apoapostolov/Hobbyfiles"
ENV NODE_ENV=production HTTP_PORT=8080 HOBBYFILES_WORKERS=2 HOBBYFILES_NATIVE_TOOLS=false
RUN sed -i 's/Components: main$/Components: main non-free/' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini file libimage-exiftool-perl ghostscript poppler-utils \
      ffmpeg p7zip-full unrar firejail \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/hobbyfiles /data/uploads && chown -R node:node /data
WORKDIR /opt/hobbyfiles
COPY --from=dependencies /src/node_modules ./node_modules
COPY --from=build /src/lib ./lib
COPY --from=build /src/common ./common
COPY --from=build /src/core ./core
COPY --from=build /src/scripts ./scripts
COPY --from=build /src/views ./views
COPY --from=build /src/static ./static
COPY --from=build /src/favicon ./favicon
COPY --from=build /src/server.js /src/defaults.js /src/package.json /src/names.json /src/roomnames.json /src/jail.profile ./
USER node
WORKDIR /data
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.HTTP_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/opt/hobbyfiles/server.js"]
