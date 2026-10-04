# EDMN Marketplace — production/staging container image.
# One image runs the Next.js server and the background worker (see scripts/start.sh).
FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No database or secrets are needed at build time (all pages render at request time).
RUN npm run build

FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1
RUN groupadd -r edmn && useradd -r -g edmn -d /app edmn && mkdir -p /data && chown edmn:edmn /data
COPY --from=deps --chown=edmn:edmn /app/node_modules ./node_modules
COPY --from=build --chown=edmn:edmn /app/.next ./.next
COPY --from=build --chown=edmn:edmn /app/public ./public
COPY --chown=edmn:edmn package.json package-lock.json next.config.ts tsconfig.json drizzle.config.ts ./
COPY --chown=edmn:edmn drizzle ./drizzle
COPY --chown=edmn:edmn scripts ./scripts
COPY --chown=edmn:edmn src ./src
USER edmn
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "scripts/start.sh"]
