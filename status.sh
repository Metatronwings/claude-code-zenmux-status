#!/usr/bin/env bash
set -a
source "$(dirname "$0")/.env"
set +a

DIR="$(dirname "$0")"
if [ -f "$DIR/dist/index.js" ]; then
  exec node "$DIR/dist/index.js"
else
  exec "$DIR/node_modules/.bin/tsx" "$DIR/src/index.ts"
fi
