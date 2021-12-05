FROM node:16 AS ui-build
ENV JQ_VERSION=1.6
RUN wget --no-check-certificate https://github.com/stedolan/jq/releases/download/jq-${JQ_VERSION}/jq-linux64 -O /tmp/jq-linux64
RUN cp /tmp/jq-linux64 /usr/bin/jq
RUN chmod +x /usr/bin/jq
WORKDIR /usr/src/app
COPY package.json yarn.lock tsconfig.json ./
RUN yarn
COPY ./src src
COPY ./public public
RUN jq 'to_entries | map_values({ (.key) : ("$" + .key) }) | reduce .[] as $item ({}; . + $item)' ./src/config.json > ./src/config.tmp.json && mv ./src/config.tmp.json ./src/config.json
RUN yarn build

FROM nginx:1.17
ENV JSFOLDER=/usr/share/nginx/html/static/js
COPY ./start-nginx.sh /usr/bin/start-nginx.sh
WORKDIR /usr/share/nginx/html
COPY --from=0 /usr/src/app/build .
ENTRYPOINT [ "start-nginx.sh" ]
