# syntax=docker/dockerfile:1
FROM node:20-alpine AS webbuild
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY --from=webbuild /build/public ./public
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/index.js"]