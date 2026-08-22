#!/bin/sh
set -eu
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R node:node /data
  exec su-exec node "$0" "$@"
fi
exec node server/index.js
