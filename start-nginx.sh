#!/usr/bin/env bash
cp $JSFOLDER/*.js /tmp
export EXISTING_VARS=$(printenv | awk -F= '{print $1}' | sed 's/^/\$/g' | paste -sd,);
for file in /tmp/*.js;
do
  cat $file | envsubst $EXISTING_VARS | tee $JSFOLDER/$(basename $file)
done
sed -i '/^   }/i add_header Access-Control-Allow-Origin *;' /etc/nginx/conf.d/default.conf
nginx -g 'daemon off;'
