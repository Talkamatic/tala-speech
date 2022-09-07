FROM node:18-alpine AS ui-build
RUN apk add g++ make py3-pip
WORKDIR /usr/web
COPY package.json yarn.lock tsconfig.json ./
RUN yarn
COPY ./src src
RUN yarn build


FROM node:18-alpine
WORKDIR /web
COPY package.json yarn.lock tsconfig.json ./
RUN yarn install --prod

EXPOSE 3000

COPY --from=ui-build /usr/web/dist ./dist
COPY server ./server

ENV NODE_ENV production

CMD [ "node", "server/index.js" ]
