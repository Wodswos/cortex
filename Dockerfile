# Cortex 全栈镜像:静态 web + 同步服务,单进程 30090
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
COPY apps/server ./apps/server
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cortex/web build
RUN pnpm --filter @cortex/server build

FROM node:22-alpine
WORKDIR /app
# openssh-client:任务关联远程 tmux 时,服务端 ssh 过去 capture-pane
RUN apk add --no-cache openssh-client
ENV NODE_ENV=production
ENV PORT=30090
ENV DATA_DIR=/app/data
ENV PUBLIC_DIR=/app/public
COPY --from=build /app/apps/server/dist/index.js ./server/index.js
COPY --from=build /app/apps/web/dist ./public
VOLUME /app/data
EXPOSE 30090
CMD ["node", "server/index.js"]
