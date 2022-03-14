FROM node:17.6.0 AS ui-build
WORKDIR /usr/src/app
COPY package.json yarn.lock tsconfig.json ./
COPY ./src src
RUN yarn
RUN yarn build

FROM nginx:1.17
ENV JSFOLDER=/usr/share/nginx/html/static/js
COPY ./start-nginx.sh /usr/bin/start-nginx.sh
WORKDIR /usr/share/nginx/html
COPY --from=0 /usr/src/app/dist .
ENTRYPOINT [ "start-nginx.sh" ]
