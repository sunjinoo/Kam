FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.mjs ./server.mjs
COPY public ./public
COPY migrations ./migrations
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production
EXPOSE 4173
CMD ["node", "server.mjs"]
