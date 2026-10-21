FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries in the package; skipping install scripts stops npm
# from trying to compile it (slim has no Python or compiler).
RUN npm ci --omit=dev --ignore-scripts

COPY drizzle ./drizzle
COPY src ./src

RUN mkdir -p /data && chown node:node /data
USER node
ENV DATABASE_PATH=/data/rating.db PORT=8080
EXPOSE 8080
HEALTHCHECK CMD node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Node strips the types itself (22.18+), so there is no build step and no tsx.
CMD ["node", "src/server.node.ts"]
