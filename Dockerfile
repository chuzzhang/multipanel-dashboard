FROM node:22-alpine

WORKDIR /app

COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

ENV HOST=0.0.0.0 \
    PORT=8787 \
    NODE_ENV=production

EXPOSE 8787

# data/ 存连接配置与密码，挂卷持久化
VOLUME ["/app/data"]

CMD ["node", "server.js"]
