#!/bin/sh
set -eu

cmd="${1:-web}"

if [ "$#" -gt 0 ]; then
  shift
fi

case "$cmd" in
  web)
    cd /app
    exec yarn workspace web start "$@"
    ;;
  server)
    cd /app
    exec yarn workspace server start "$@"
    ;;
  *)
    exec "$cmd" "$@"
    ;;
esac
