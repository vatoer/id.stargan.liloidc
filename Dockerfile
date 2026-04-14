FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js clients.json users.json ./

EXPOSE 9876

CMD ["node", "index.js"]
