#!/bin/sh
set -eu

cmd="${1:-web}"

if [ "$#" -gt 0 ]; then
  shift
fi

case "$cmd" in
  web)
    cd /app/packages/web
    exec node ./scripts/next-with-env.js start "$@"
    ;;
  server)
    cd /app
    exec node ./packages/server/src/index.js "$@"
    ;;
  *)
    exec "$cmd" "$@"
    ;;
esac
